import crypto from 'node:crypto';
import { ApiError } from '../../../../utils/ApiError.js';
import { Owner } from '../../admin/models/Owner.js';
import { Driver } from '../models/Driver.js';
import { PoolingVehicle } from '../../admin/models/PoolingVehicle.js';
import { DriverLoginSession } from '../models/DriverLoginSession.js';
import { signAccessToken } from './authService.js';
import { sendOtpSms } from '../../services/smsService.js';
import { getVisibleOtp, resolveOtpForPhone } from '../../services/otpSecurity.js';

const LOGIN_OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const normalizePhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '').trim();
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
};

const buildPhoneCandidates = (phone) => {
  const normalizedPhone = normalizePhone(phone);
  const candidates = new Set();

  if (normalizedPhone) {
    candidates.add(normalizedPhone);
    candidates.add(`91${normalizedPhone}`);
    candidates.add(`+91${normalizedPhone}`);
  }

  return [...candidates];
};

const normalizeRole = (role) => {
  const normalized = String(role || 'driver').toLowerCase();
  if (
    normalized === 'owner' ||
    normalized === 'vendor' ||
    normalized === 'super_fleet_owner' ||
    normalized === 'super-fleet-owner' ||
    normalized === 'superfleetowner'
  ) {
    return 'owner';
  }
  if (normalized === 'pooling_driver' || normalized === 'pooling-driver' || normalized === 'poolingdriver') {
    return 'pooling_driver';
  }
  return 'driver';
};

const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');
const resolveDriverLoginOtpForPhone = (phone) => resolveOtpForPhone(normalizePhone(phone), normalizePhone);

const getSession = async (phone) => {
  const session = await DriverLoginSession.findOne({ phone: normalizePhone(phone) }).select('+otpHash');

  if (!session) {
    throw new ApiError(404, 'Login session not found');
  }

  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
    await DriverLoginSession.deleteOne({ _id: session._id });
    throw new ApiError(410, 'Login session expired');
  }

  return session;
};

const publicSessionPayload = (session, debugOtp = null) => ({
  phone: session.phone,
  status: 'otp_sent',
  debugOtp,
});

const publicDriverPayload = (driver) => ({
  id: driver._id,
  name: driver.name,
  phone: driver.phone,
  email: driver.email,
  gender: driver.gender,
  vehicleType: driver.vehicleType,
  registerFor: driver.registerFor,
  vehicleNumber: driver.vehicleNumber,
  vehicleColor: driver.vehicleColor,
  city: driver.city,
  approve: driver.approve,
  status: driver.status,
  rating: driver.rating,
  isOnline: driver.isOnline,
  isOnRide: driver.isOnRide,
});

const publicOwnerPayload = (owner) => ({
  id: owner._id,
  name: owner.name || owner.company_name || '',
  company_name: owner.company_name || '',
  phone: owner.mobile || owner.phone || '',
  email: owner.email || '',
  city: owner.city || '',
  approve: owner.approve,
  status: owner.status,
});

const isApprovedDriver = (driver) =>
  Boolean(driver) &&
  driver.approve !== false &&
  String(driver.status || '').toLowerCase() !== 'pending';

const isApprovedOwner = (owner) =>
  Boolean(owner) &&
  owner.active !== false &&
  (owner.approve === true || String(owner.status || '').toLowerCase() === 'approved');

export const findExistingDriverAccount = async ({ phone, role }) => {
  const normalizedPhone = normalizePhone(phone);
  const rawRole = String(role || 'driver').toLowerCase();
  const normalizedRole = ['vendor', 'owner', 'super_fleet_owner'].includes(rawRole) ? 'owner' : rawRole;
  const phoneCandidates = buildPhoneCandidates(phone);

  if (!normalizedPhone) return null;

  let account = null;
  let detectedRole = rawRole;

  if (['vendor', 'owner', 'super_fleet_owner'].includes(normalizedRole)) {
    account = await Owner.findOne({
      $or: [{ mobile: { $in: phoneCandidates } }, { phone: { $in: phoneCandidates } }],
    });
    if (account) {
      detectedRole = account.account_type || 'vendor';
    }
  } else if (normalizedRole === 'pooling_driver') {
    account = await PoolingVehicle.findOne({ driverPhone: { $in: phoneCandidates } });
  } else {
    account = await Driver.findOne({ phone: { $in: phoneCandidates } });
  }

  if (!account) {
    account = await Driver.findOne({ phone: { $in: phoneCandidates } });
    if (account) {
      detectedRole = 'driver';
    } else {
      account = await Owner.findOne({
        $or: [{ mobile: { $in: phoneCandidates } }, { phone: { $in: phoneCandidates } }],
      });
      if (account) {
        detectedRole = account.account_type || 'vendor';
      } else {
        account = await PoolingVehicle.findOne({ driverPhone: { $in: phoneCandidates } });
        if (account) {
          detectedRole = 'pooling_driver';
        }
      }
    }
  }

  if (!account) return null;
  return { account, role: detectedRole };
};

export const startDriverLoginOtp = async ({ phone, role = 'driver' }) => {
  const normalizedPhone = normalizePhone(phone);
  const normalizedRole = normalizeRole(role);

  if (!normalizedPhone || normalizedPhone.length !== 10) {
    throw new ApiError(400, 'A valid 10-digit mobile number is required');
  }

  const found = await findExistingDriverAccount({ phone: normalizedPhone, role: normalizedRole });

  if (!found) {
    throw new ApiError(
      404,
      `${normalizedRole === 'owner'
        ? 'Owner'
        : normalizedRole === 'pooling_driver'
          ? 'Pooling driver'
          : 'Driver'
      } account not found`,
    );
  }

  const { account, role: activeRole } = found;

  const { otp, isStatic } = resolveDriverLoginOtpForPhone(normalizedPhone);
  const now = Date.now();
  const existingSession = await DriverLoginSession.findOne({ phone: normalizedPhone }).lean();

  if (
    existingSession?.lastOtpSentAt &&
    now - new Date(existingSession.lastOtpSentAt).getTime() < OTP_RESEND_COOLDOWN_MS
  ) {
    throw new ApiError(429, 'Please wait before requesting another OTP');
  }

  const session = await DriverLoginSession.findOneAndUpdate(
    { phone: normalizedPhone },
    {
      phone: normalizedPhone,
      driverId: account._id,
      accountRole: activeRole,
      otpHash: hashOtp(otp),
      otpExpiresAt: new Date(now + LOGIN_OTP_TTL_MS),
      verifiedAt: null,
      lastOtpSentAt: new Date(now),
      otpSendCount: Number(existingSession?.otpSendCount || 0) + 1,
      otpAttemptCount: 0,
      expiresAt: new Date(now + LOGIN_OTP_TTL_MS),
    },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  );

  const smsDispatch = isStatic
    ? {
      mode: 'static',
      message: 'Static OTP enabled',
    }
    : await sendOtpSms({
      phone: normalizedPhone,
      otp,
      purpose: 'driver login OTP',
    });
  const debugOtp = getVisibleOtp(otp);

  if (debugOtp) {
    console.log(`[loginOtpService] OTP for ${normalizedPhone} = ${debugOtp} (${smsDispatch.mode})`);
  }

  return {
    message: smsDispatch.mode === 'live' ? 'OTP sent successfully' : 'OTP generated successfully',
    session: publicSessionPayload(session, debugOtp),
  };
};

export const verifyDriverLoginOtp = async ({ phone, otp }) => {
  const session = await getSession(phone);
  const normalizedRole = normalizeRole(session.accountRole);

  if (!otp || String(otp).trim().length !== 4) {
    throw new ApiError(400, 'A valid 4-digit OTP is required');
  }

  if (!session.otpExpiresAt || new Date(session.otpExpiresAt).getTime() < Date.now()) {
    throw new ApiError(410, 'OTP has expired');
  }

  if (Number(session.otpAttemptCount || 0) >= MAX_OTP_ATTEMPTS) {
    throw new ApiError(429, 'Too many invalid OTP attempts. Request a new OTP.');
  }

  if (session.otpHash !== hashOtp(otp)) {
    session.otpAttemptCount = Number(session.otpAttemptCount || 0) + 1;
    await session.save();
    throw new ApiError(401, 'Invalid OTP');
  }

  session.otpAttemptCount = 0;

  const account =
    normalizedRole === 'owner'
      ? await Owner.findById(session.driverId)
      : normalizedRole === 'pooling_driver'
        ? await PoolingVehicle.findById(session.driverId)
        : await Driver.findById(session.driverId);

  if (!account) {
    throw new ApiError(
      404,
      `${normalizedRole === 'owner'
        ? 'Owner'
        : normalizedRole === 'pooling_driver'
          ? 'Pooling driver'
          : 'Driver'
      } account not found`,
    );
  }

  session.verifiedAt = new Date();
  session.expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await session.save();
  await DriverLoginSession.deleteOne({ _id: session._id });

  return {
    message: 'OTP verified successfully',
    token: signAccessToken({ sub: String(account._id), role: normalizedRole }),
    driver:
      normalizedRole === 'owner'
        ? publicOwnerPayload(account)
        : normalizedRole === 'pooling_driver'
          ? {
            id: account._id,
            name: account.driverName || 'Pooling Driver',
            phone: account.driverPhone || '',
            approve: account.approve !== false,
            status: account.status || 'active',
          }
          : publicDriverPayload(account),
  };
};
