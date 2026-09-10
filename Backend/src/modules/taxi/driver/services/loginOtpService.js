import crypto from 'node:crypto';
import { ApiError } from '../../../../utils/ApiError.js';
import { env } from '../../../../config/env.js';
import { Owner } from '../../admin/models/Owner.js';
import { ServiceStore } from '../../admin/models/ServiceStore.js';
import { ServiceCenterStaff } from '../../admin/models/ServiceCenterStaff.js';
import { Driver } from '../models/Driver.js';
import { BusDriver } from '../models/BusDriver.js';
import { PoolingVehicle } from '../../admin/models/PoolingVehicle.js';
import { DriverLoginSession } from '../models/DriverLoginSession.js';
import { signAccessToken } from './authService.js';
import { sendOtpSms } from '../../services/smsService.js';

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

const generateOtp = () => String(Math.floor(1000 + Math.random() * 9000));
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
  if (
    normalized === 'service_center' ||
    normalized === 'service-center' ||
    normalized === 'servicecenter'
  ) {
    return 'service_center';
  }
  if (
    normalized === 'service_center_staff' ||
    normalized === 'service-center-staff' ||
    normalized === 'servicecenterstaff' ||
    normalized === 'center_staff'
  ) {
    return 'service_center_staff';
  }
  if (normalized === 'bus_driver' || normalized === 'bus-driver' || normalized === 'busdriver') {
    return 'bus_driver';
  }
  if (normalized === 'pooling_driver' || normalized === 'pooling-driver' || normalized === 'poolingdriver') {
    return 'pooling_driver';
  }
  return 'driver';
};

const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');
const getVisibleOtp = (otp) => (process.env.NODE_ENV !== 'production' ? String(otp) : null);
const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const TEST_LOGIN_OTP_PHONE = '6268423925';
const TEST_LOGIN_OTP_CODE = '0000';
const getStaticDriverOtpConfig = () => ({
  phone: normalizePhone(env.sms?.staticOtpPhone || TEST_LOGIN_OTP_PHONE),
  otp: String(env.sms?.staticOtpCode || TEST_LOGIN_OTP_CODE).trim(),
});
const resolveDriverLoginOtpForPhone = (phone) => {
  const normalizedPhone = normalizePhone(phone);
  const staticOtpConfig = getStaticDriverOtpConfig();
  const defaultOtpEnabled = isTruthy(env.sms?.useDefaultOtp);

  if (defaultOtpEnabled && staticOtpConfig.otp) {
    return {
      otp: staticOtpConfig.otp,
      isStatic: true,
    };
  }

  if (staticOtpConfig.phone && staticOtpConfig.otp && normalizedPhone === staticOtpConfig.phone) {
    return {
      otp: staticOtpConfig.otp,
      isStatic: true,
    };
  }

  return {
    otp: generateOtp(),
    isStatic: false,
  };
};

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

const publicServiceCenterPayload = (center) => ({
  id: center._id,
  name: center.name || '',
  owner_name: center.owner_name || '',
  phone: center.owner_phone || '',
  address: center.address || '',
  status: center.status || 'active',
});

const publicServiceCenterStaffPayload = (staff) => ({
  id: staff._id,
  name: staff.name || '',
  phone: staff.phone || '',
  status: staff.status || 'active',
  serviceCenterId: staff.serviceCenterId ? String(staff.serviceCenterId) : '',
});

const publicBusDriverPayload = (driver) => ({
  id: driver._id,
  name: driver.name || '',
  phone: driver.phone || '',
  email: driver.email || '',
  approve: driver.approve,
  active: driver.active,
  status: driver.status || 'approved',
  assignedBusServiceId: driver.assignedBusServiceId ? String(driver.assignedBusServiceId) : '',
  operatorName: driver.operatorName || '',
  busName: driver.busName || '',
  serviceNumber: driver.serviceNumber || '',
  routeName: driver.routeName || '',
  originCity: driver.originCity || '',
  destinationCity: driver.destinationCity || '',
});

const isApprovedDriver = (driver) =>
  Boolean(driver) &&
  driver.approve !== false &&
  String(driver.status || '').toLowerCase() !== 'pending';

const isApprovedOwner = (owner) =>
  Boolean(owner) &&
  owner.active !== false &&
  (owner.approve === true || String(owner.status || '').toLowerCase() === 'approved');

const isApprovedBusDriver = (driver) =>
  Boolean(driver) &&
  driver.active !== false &&
  driver.approve !== false &&
  !['pending', 'blocked'].includes(String(driver.status || '').toLowerCase());

const isApprovedServiceCenter = (center) =>
  Boolean(center) &&
  center.active !== false &&
  String(center.status || '').toLowerCase() !== 'inactive';

const isApprovedServiceCenterStaff = (staff) =>
  Boolean(staff) &&
  staff.active !== false &&
  String(staff.status || '').toLowerCase() !== 'inactive';

export const findExistingDriverAccount = async ({ phone, role }) => {
  const normalizedPhone = normalizePhone(phone);
  const rawRole = String(role || 'driver').toLowerCase();
  const normalizedRole = ['vendor', 'owner', 'super_fleet_owner', 'service_center'].includes(rawRole) ? 'owner' : rawRole;
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
  } else if (normalizedRole === 'service_center') {
    account = await ServiceStore.findOne({ owner_phone: { $in: phoneCandidates } });
  } else if (normalizedRole === 'service_center_staff') {
    account = await ServiceCenterStaff.findOne({ phone: { $in: phoneCandidates } });
  } else if (normalizedRole === 'bus_driver') {
    account = await BusDriver.findOne({ phone: { $in: phoneCandidates } });
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
        account = await ServiceStore.findOne({ owner_phone: { $in: phoneCandidates } });
        if (account) {
          detectedRole = 'super_fleet_owner';
        } else {
          account = await ServiceCenterStaff.findOne({ phone: { $in: phoneCandidates } });
          if (account) {
            detectedRole = 'service_center_staff';
          } else {
            account = await BusDriver.findOne({ phone: { $in: phoneCandidates } });
            if (account) {
              detectedRole = 'bus_driver';
            } else {
              account = await PoolingVehicle.findOne({ driverPhone: { $in: phoneCandidates } });
              if (account) {
                detectedRole = 'pooling_driver';
              }
            }
          }
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
        : normalizedRole === 'service_center'
          ? 'Service center'
          : normalizedRole === 'service_center_staff'
            ? 'Service center staff'
            : normalizedRole === 'bus_driver'
              ? 'Bus driver'
              : normalizedRole === 'pooling_driver'
                ? 'Pooling driver'
                : 'Driver'
      } account not found`,
    );
  }

  const { account, role: activeRole } = found;

  // Allow login even if account is pending approval to show registration status
  // if (
  //   (normalizedRole === 'owner' && !isApprovedOwner(account)) ||
  //   (normalizedRole === 'service_center' && !isApprovedServiceCenter(account)) ||
  //   (normalizedRole === 'service_center_staff' && !isApprovedServiceCenterStaff(account)) ||
  //   (normalizedRole === 'driver' && !isApprovedDriver(account)) ||
  //   (normalizedRole === 'bus_driver' && !isApprovedBusDriver(account))
  // ) {
  //   throw new ApiError(
  //     403,
  //     `${
  //       normalizedRole === 'owner'
  //         ? 'Owner'
  //         : normalizedRole === 'service_center'
  //           ? 'Service center'
  //         : normalizedRole === 'service_center_staff'
  //           ? 'Service center staff'
  //         : normalizedRole === 'bus_driver'
  //           ? 'Bus driver'
  //           : 'Driver'
  //     } account is pending approval`,
  //   );
  // }

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
      : normalizedRole === 'service_center'
        ? await ServiceStore.findById(session.driverId)
        : normalizedRole === 'service_center_staff'
          ? await ServiceCenterStaff.findById(session.driverId)
          : normalizedRole === 'bus_driver'
            ? await BusDriver.findById(session.driverId)
            : normalizedRole === 'pooling_driver'
              ? await PoolingVehicle.findById(session.driverId)
              : await Driver.findById(session.driverId);

  if (!account) {
    throw new ApiError(
      404,
      `${normalizedRole === 'owner'
        ? 'Owner'
        : normalizedRole === 'service_center'
          ? 'Service center'
          : normalizedRole === 'service_center_staff'
            ? 'Service center staff'
            : normalizedRole === 'bus_driver'
              ? 'Bus driver'
              : normalizedRole === 'pooling_driver'
                ? 'Pooling driver'
                : 'Driver'
      } account not found`,
    );
  }

  // Allow verification even if account is pending approval
  // if (
  //   (normalizedRole === 'owner' && !isApprovedOwner(account)) ||
  //   (normalizedRole === 'service_center' && !isApprovedServiceCenter(account)) ||
  //   (normalizedRole === 'service_center_staff' && !isApprovedServiceCenterStaff(account)) ||
  //   (normalizedRole === 'driver' && !isApprovedDriver(account)) ||
  //   (normalizedRole === 'bus_driver' && !isApprovedBusDriver(account))
  // ) {
  //   throw new ApiError(
  //     403,
  //     `${
  //       normalizedRole === 'owner'
  //         ? 'Owner'
  //         : normalizedRole === 'service_center'
  //           ? 'Service center'
  //         : normalizedRole === 'service_center_staff'
  //           ? 'Service center staff'
  //         : normalizedRole === 'bus_driver'
  //           ? 'Bus driver'
  //           : 'Driver'
  //       } account is pending approval`,
  //     );
  //   }

  if (normalizedRole === 'bus_driver') {
    account.lastLoginAt = new Date();
    await account.save();
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
        : normalizedRole === 'service_center'
          ? publicServiceCenterPayload(account)
          : normalizedRole === 'service_center_staff'
            ? publicServiceCenterStaffPayload(account)
            : normalizedRole === 'bus_driver'
              ? publicBusDriverPayload(account)
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
