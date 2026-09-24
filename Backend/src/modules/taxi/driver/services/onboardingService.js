import crypto from 'node:crypto';
import { ApiError } from '../../../../utils/ApiError.js';
import { env } from '../../../../config/env.js';
import { normalizePoint, toPoint } from '../../../../utils/geo.js';
import { uploadDataUrlToCloudinary } from '../../../../utils/cloudinaryUpload.js';
import { Driver } from '../models/Driver.js';
import { DriverRegistrationSession } from '../models/DriverRegistrationSession.js';
import { Owner } from '../../admin/models/Owner.js';
import { ServiceLocation } from '../../admin/models/ServiceLocation.js';
import { Vehicle } from '../../admin/models/Vehicle.js';
import { AdminBusinessSetting } from '../../admin/models/AdminBusinessSetting.js';
import {
  listDriverDocumentUploadFields,
  listDriverNeededDocuments,
  listDriverVehicleFieldTemplates,
  listOwnerDocumentUploadFields,
  listOwnerNeededDocuments,
} from '../../admin/services/adminService.js';
import { hashPassword, signAccessToken } from './authService.js';
import { findExistingDriverAccount, startDriverLoginOtp } from './loginOtpService.js';
import { findZoneByPickup } from './locationService.js';
import { sendOtpSms } from '../../services/smsService.js';
import { WalletTransaction } from '../models/WalletTransaction.js';
import { applyDriverWalletAdjustment } from './walletService.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const DRIVER_NAME_REGEX = /^[A-Za-z]+(?:[ .'-][A-Za-z]+)*$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const VEHICLE_NUMBER_PATTERNS = [
  /^[A-Z]{2}\d{1,2}[A-Z]{1,5}\d{4}$/,
];
const ALLOWED_SERVICE_CATEGORIES = ['taxi', 'outstation', 'delivery', 'pooling'];

const VEHICLE_TYPE_MAP = {
  v1: 'bike',
  v2: 'car',
  v3: 'auto',
  bike: 'bike',
  cab: 'car',
  car: 'car',
  auto: 'auto',
  taxi: 'car',
};

const normalizePhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '').trim();
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
};

const normalizeRole = (role) => {
  const normalized = String(role || 'driver').toLowerCase();
  if (normalized === 'vendor' || normalized === 'owner') return 'vendor';
  if (normalized === 'super_fleet_owner' || normalized === 'super-fleet-owner' || normalized === 'superfleetowner' || normalized === 'service_center') return 'super_fleet_owner';
  return 'driver';
};

const isOwnerRole = (role) => {
  const normalized = normalizeRole(role);
  return normalized === 'vendor' || normalized === 'super_fleet_owner' || normalized === 'owner';
};
const normalizeServiceCategories = (value, fallback = 'taxi') => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const normalized = [...new Set(
    rawValues
      .map((item) => String(item || '').trim().toLowerCase())
      .flatMap((item) => {
        if (item === 'both') return ['taxi', 'outstation'];
        return item ? [item] : [];
      })
      .filter((item) => ALLOWED_SERVICE_CATEGORIES.includes(item)),
  )];

  if (normalized.length > 0) {
    return normalized;
  }

  const fallbackValue = String(fallback || 'taxi').trim().toLowerCase();
  if (fallbackValue === 'both') {
    return ['taxi', 'outstation'];
  }

  return ALLOWED_SERVICE_CATEGORIES.includes(fallbackValue) ? [fallbackValue] : ['taxi'];
};

const getPrimaryRegisterFor = (serviceCategories = [], fallback = 'taxi') => {
  const normalized = normalizeServiceCategories(serviceCategories, fallback);

  if (normalized.includes('taxi') && normalized.includes('outstation')) {
    return 'both';
  }

  if (normalized.includes('taxi')) return 'taxi';
  if (normalized.includes('outstation')) return 'outstation';
  if (normalized.includes('delivery')) return 'delivery';
  if (normalized.includes('pooling')) return 'pooling';

  return String(fallback || 'taxi').trim().toLowerCase() || 'taxi';
};
const normalizeReferralCode = (value = '') => String(value || '').trim().toUpperCase();
const generateDriverReferralCode = (driver) => {
  const idPart = String(driver?._id || '')
    .slice(-6)
    .toUpperCase();
  const phonePart = String(driver?.phone || '').slice(-4);
  return `DRV${phonePart}${idPart}`.replace(/\W/g, '');
};

export const getDriverReferralProgramSettings = async () => {
  const setting = await AdminBusinessSetting.findOne({ scope: 'default' }).lean();
  const driverReferral = setting?.referral?.driver || {};

  return {
    enabled: Boolean(driverReferral.enabled),
    type: String(driverReferral.type || 'instant_referrer').trim().toLowerCase(),
    amount: Math.max(0, Number(driverReferral.amount || 0) || 0),
    rideCount: Math.max(0, Number(driverReferral.ride_count || 0) || 0),
  };
};

const findDriverByReferralCode = async (referralCode) => {
  const normalizedCode = normalizeReferralCode(referralCode);

  if (!normalizedCode) {
    return null;
  }

  return Driver.findOne({ referralCode: normalizedCode });
};

const creditDriverWalletByReference = async ({ driverId, amount, title, referenceKey, metadata = {} }) => {
  const normalizedAmount = Math.max(0, Number(amount || 0) || 0);
  const normalizedReferenceKey = String(referenceKey || '').trim();

  if (!driverId || normalizedAmount <= 0 || !normalizedReferenceKey) {
    return 'skipped';
  }

  const existingTransaction = await WalletTransaction.findOne({
    driverId,
    'metadata.referenceKey': normalizedReferenceKey,
  })
    .select('_id')
    .lean();

  if (existingTransaction) {
    return 'existing';
  }

  await applyDriverWalletAdjustment({
    driverId,
    amount: normalizedAmount,
    type: 'adjustment',
    description: String(title || 'Referral Reward').trim(),
    metadata: {
      ...metadata,
      referenceKey: normalizedReferenceKey,
      source: 'driver_referral',
    },
  });

  return 'credited';
};

const processDriverSignupReferralRewards = async ({ driver, referrer }) => {
  if (!driver?._id || !referrer?._id) {
    return;
  }

  const settings = await getDriverReferralProgramSettings();
  if (!settings.enabled || settings.amount <= 0) {
    return;
  }

  const referralType = settings.type;
  const rewardBaseKey = `driver-referral:signup:${String(driver._id)}`;

  if (referralType === 'instant_referrer' || referralType === 'instant_referrer_new') {
    await creditDriverWalletByReference({
      driverId: referrer._id,
      amount: settings.amount,
      title: `Referral reward for inviting driver ${driver.phone || ''}`.trim(),
      referenceKey: `${rewardBaseKey}:referrer`,
      metadata: {
        invitedDriverId: String(driver._id),
      },
    });
  }

  if (referralType === 'instant_referrer_new') {
    await creditDriverWalletByReference({
      driverId: driver._id,
      amount: settings.amount,
      title: 'Welcome referral reward',
      referenceKey: `${rewardBaseKey}:new-driver`,
      metadata: {
        referrerDriverId: String(referrer._id),
      },
    });

    driver.referralRewardGrantedAt = driver.referralRewardGrantedAt || new Date();
    await driver.save();
  }
};

const matchesDocumentRole = (accountType, role) => {
  const normalizedAccountType = String(accountType || 'individual').trim().toLowerCase();
  const normalizedRole = normalizeRole(role);

  if (normalizedAccountType === 'both') {
    return true;
  }

  if (normalizedRole === 'owner') {
    return normalizedAccountType === 'fleet_drivers';
  }

  return normalizedAccountType === 'individual';
};

const matchesVehicleFieldRole = (accountType, role) => {
  const normalizedAccountType = String(accountType || 'individual').trim().toLowerCase();
  const normalizedRole = normalizeRole(role);

  if (normalizedAccountType === 'both') {
    return true;
  }

  if (normalizedRole === 'owner') {
    return normalizedAccountType === 'fleet_drivers';
  }

  return normalizedAccountType === 'individual';
};

const getRequiredVehicleFieldMap = async (role) => {
  const configs = await listDriverVehicleFieldTemplates({ activeOnly: true });

  return configs
    .filter((item) => item.active !== false && matchesVehicleFieldRole(item.account_type, role))
    .reduce((acc, item) => {
      acc[String(item.field_key || '').trim()] = item;
      return acc;
    }, {});
};

const generateOtp = () => String(Math.floor(1000 + Math.random() * 9000));

const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');
const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const getStaticDriverOtpConfig = () => ({
  phone: normalizePhone(env.sms?.staticOtpPhone || ''),
  otp: String(env.sms?.staticOtpCode || '').trim(),
});
const resolveDriverOnboardingOtpForPhone = (phone) => {
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

const getVehicleType = (vehicleTypeId, registerFor = '') => {
  const type = VEHICLE_TYPE_MAP[String(vehicleTypeId || registerFor || '').trim().toLowerCase()];
  return type || 'car';
};

const getGenericVehicleTypeFromCatalog = (vehicle = {}) => {
  const value = String(vehicle.icon_types || vehicle.name || '').trim().toLowerCase();

  if (value.includes('bike')) {
    return 'bike';
  }

  if (value.includes('auto')) {
    return 'auto';
  }

  return 'car';
};

const getServiceLocationName = (serviceLocation = {}) =>
  String(serviceLocation.service_location_name || serviceLocation.name || '').trim();

const getServiceLocationCoordinates = (serviceLocation = {}) => {
  if (Array.isArray(serviceLocation?.location?.coordinates) && serviceLocation.location.coordinates.length === 2) {
    return serviceLocation.location.coordinates;
  }

  if (
    typeof serviceLocation?.longitude === 'number' &&
    typeof serviceLocation?.latitude === 'number'
  ) {
    return [serviceLocation.longitude, serviceLocation.latitude];
  }

  if (Array.isArray(serviceLocation?.coordinates) && serviceLocation.coordinates.length === 2) {
    return serviceLocation.coordinates;
  }

  return null;
};

const getValidatedServiceLocationCoordinates = (serviceLocation = {}) => {
  const coordinates = getServiceLocationCoordinates(serviceLocation);

  if (!coordinates) {
    return null;
  }

  try {
    return normalizePoint(coordinates, 'location');
  } catch {
    return null;
  }
};

const normalizeStoredDocument = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return {
      secureUrl: value,
      previewUrl: value,
      uploaded: true,
      identifyNumber: '',
      identify_number: '',
      expiryDate: '',
      expiry_date: '',
    };
  }

  const identifyNumber = String(
    value.identifyNumber ||
    value.identify_number ||
    value.documentNumber ||
    value.document_number ||
    '',
  ).trim();
  const expiryDate = String(
    value.expiryDate ||
    value.expiry_date ||
    value.expiry ||
    value.expiresAt ||
    '',
  ).trim();

  return {
    ...value,
    previewUrl: value.previewUrl || value.secureUrl || '',
    uploaded: value.uploaded ?? Boolean(value.secureUrl || value.previewUrl),
    identifyNumber,
    identify_number: identifyNumber,
    documentNumber: identifyNumber,
    document_number: identifyNumber,
    expiryDate,
    expiry_date: expiryDate,
  };
};

const publicSessionPayload = (session, debugOtp = null) => ({
  registrationId: session.registrationId,
  phone: session.phone,
  role: session.role,
  status: session.status,
  otpVerified: Boolean(session.otpVerifiedAt),
  documentsUploaded: Object.keys(session.documents || {}).filter((key) => Boolean(session.documents?.[key])),
  debugOtp,
});

const publicDriverPayload = (driver) => {
  if (!driver) {
    return null;
  }

  return {
    id: driver._id,
    name: driver.name,
    phone: driver.phone,
    email: driver.email,
    gender: driver.gender,
    vehicleType: driver.vehicleType,
    registerFor: driver.registerFor,
    serviceCategories: Array.isArray(driver.serviceCategories) ? driver.serviceCategories : [],
    vehicleNumber: driver.vehicleNumber,
    vehicleColor: driver.vehicleColor,
    city: driver.city,
    approve: driver.approve,
    status: driver.status,
    rating: driver.rating,
  };
};

const getSession = async (registrationId, phone = '') => {
  const query = registrationId
    ? { registrationId: String(registrationId) }
    : { phone: normalizePhone(phone) };

  const session = await DriverRegistrationSession.findOne(query).select('+otpHash +personal.passwordHash');

  if (!session) {
    throw new ApiError(404, 'Registration session not found');
  }

  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
    await DriverRegistrationSession.deleteOne({ _id: session._id });
    throw new ApiError(410, 'Registration session expired');
  }

  return session;
};

// Exported so fleet-owner driver creation stores documents in exactly the same
// shape as self-onboarding drivers, rather than inventing a second format.
export const uploadRegistrationDocument = async (documentKey, value) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && value.secureUrl) {
    return normalizeStoredDocument(value);
  }

  const dataUrl = typeof value === 'string' ? value : value.dataUrl;
  const originalFilename = typeof value === 'object'
    ? value.fileName || value.originalFilename || documentKey
    : documentKey;
  const identifyNumber = typeof value === 'object'
    ? String(
      value.identifyNumber ||
      value.identify_number ||
      value.documentNumber ||
      value.document_number ||
      '',
    ).trim()
    : '';
  const expiryDate = typeof value === 'object'
    ? String(value.expiryDate || value.expiry_date || value.expiry || value.expiresAt || '').trim()
    : '';

  if (!dataUrl) {
    throw new ApiError(400, `${documentKey} must contain an image data URL`);
  }

  const safeSuffix = String(originalFilename)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]/g, '');

  const uploaded = await uploadDataUrlToCloudinary({
    dataUrl,
    folder: `${documentKey}/driver-documents`,
    publicIdPrefix: `driver-${documentKey}`,
    publicIdSuffix: safeSuffix,
  });

  return {
    key: documentKey,
    fileName: originalFilename,
    uploaded: true,
    uploadedAt: new Date().toISOString(),
    previewUrl: uploaded.secureUrl,
    secureUrl: uploaded.secureUrl,
    publicId: uploaded.publicId,
    resourceType: uploaded.resourceType,
    format: uploaded.format,
    bytes: uploaded.bytes,
    width: uploaded.width,
    height: uploaded.height,
    identifyNumber,
    identify_number: identifyNumber,
    documentNumber: identifyNumber,
    document_number: identifyNumber,
    expiryDate,
    expiry_date: expiryDate,
    cloudinary: uploaded,
  };
};

export const startDriverOnboarding = async ({ phone, role = 'driver' }) => {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone || normalizedPhone.length !== 10) {
    throw new ApiError(400, 'A valid 10-digit mobile number is required');
  }

  const normalizedRole = normalizeRole(role);
  const existingAccountInfo = await findExistingDriverAccount({ phone: normalizedPhone, role: normalizedRole });

  if (existingAccountInfo) {
    const loginResult = await startDriverLoginOtp({
      phone: normalizedPhone,
      role: existingAccountInfo.role,
    });

    return {
      ...loginResult,
      loginMode: true,
      existingAccount: true,
      session: {
        ...(loginResult.session || {}),
        loginMode: true,
        existingAccount: true,
      },
    };
  }

  const { otp, isStatic } = resolveDriverOnboardingOtpForPhone(normalizedPhone);
  const now = Date.now();
  const registrationId = crypto.randomUUID();
  const existingSession = await DriverRegistrationSession.findOne({ phone: normalizedPhone }).lean();

  if (
    existingSession?.lastOtpSentAt &&
    now - new Date(existingSession.lastOtpSentAt).getTime() < OTP_RESEND_COOLDOWN_MS
  ) {
    throw new ApiError(429, 'Please wait before requesting another OTP');
  }

  const session = await DriverRegistrationSession.findOneAndUpdate(
    { phone: normalizedPhone },
    {
      registrationId,
      phone: normalizedPhone,
      role: normalizedRole,
      status: 'otp_sent',
      otpHash: hashOtp(otp),
      otpExpiresAt: new Date(now + OTP_TTL_MS),
      otpVerifiedAt: null,
      lastOtpSentAt: new Date(now),
      otpSendCount: Number(existingSession?.otpSendCount || 0) + 1,
      otpAttemptCount: 0,
      expiresAt: new Date(now + SESSION_TTL_MS),
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
      purpose: 'driver onboarding OTP',
    });
  const debugOtp = process.env.NODE_ENV !== 'production' ? otp : null;

  if (debugOtp) {
    console.log(`[onboardingService] OTP for ${normalizedPhone} = ${debugOtp} (${smsDispatch.mode})`);
  }

  return {
    message: smsDispatch.mode === 'live' ? 'OTP sent successfully' : 'OTP generated successfully',
    session: publicSessionPayload(session, debugOtp),
  };
};

export const verifyDriverOtp = async ({ registrationId, phone, otp }) => {
  const session = await getSession(registrationId, phone);

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

  session.status = 'otp_verified';
  session.otpVerifiedAt = new Date();
  session.otpAttemptCount = 0;
  await session.save();

  return {
    message: 'OTP verified successfully',
    session: publicSessionPayload(session),
  };
};

export const saveDriverPersonalDetails = async ({ registrationId, phone, fullName, email, gender, password }) => {
  const session = await getSession(registrationId, phone);
  const isOwner = isOwnerRole(session.role);

  if (!session.otpVerifiedAt) {
    throw new ApiError(400, 'Verify OTP before continuing');
  }

  if (!fullName || !email || !gender) {
    throw new ApiError(400, 'fullName, email and gender are required');
  }

  const normalizedName = String(fullName).trim();
  const normalizedEmail = String(email).trim().toLowerCase();

  if (!DRIVER_NAME_REGEX.test(normalizedName)) {
    throw new ApiError(400, `${isOwner ? 'Owner' : 'Driver'} name should contain alphabets only`);
  }

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new ApiError(400, 'A valid email address is required');
  }

  session.personal = {
    fullName: normalizedName,
    email: normalizedEmail,
    gender: String(gender).trim(),
    passwordHash: await hashPassword(
      !isOwner && String(password || '').trim()
        ? String(password)
        : crypto.randomBytes(24).toString('hex'),
    ),
  };
  session.status = 'personal_saved';
  await session.save();

  return {
    message: 'Personal details saved',
    personal: {
      fullName: session.personal.fullName,
      email: session.personal.email,
      gender: session.personal.gender,
    },
    session: publicSessionPayload(session),
  };
};

export const saveDriverReferral = async ({ registrationId, phone, referralCode = '' }) => {
  const session = await getSession(registrationId, phone);

  const normalizedReferralCode = normalizeReferralCode(referralCode);

  if (normalizedReferralCode) {
    const referrer = await findDriverByReferralCode(normalizedReferralCode);
    if (!referrer?._id) {
      throw new ApiError(400, 'Invalid referral code');
    }
  }

  session.referralCode = normalizedReferralCode;
  await session.save();

  return {
    message: 'Referral code saved',
    referralCode: session.referralCode,
    session: publicSessionPayload(session),
  };
};

export const saveDriverVehicle = async ({
  registrationId,
  phone,
  registerFor,
  serviceCategories,
  locationId,
  locationName,
  serviceLocation,
  vehicleTypeId,
  make,
  model,
  year,
  number,
  color,
  companyName,
  companyAddress,
  city,
  postalCode,
  taxNumber,
  vehicles = [],
  customFields = {},
  vehicle_usage_type: vehicleUsageType,
}) => {
  const session = await getSession(registrationId, phone);

  if (!session.personal?.fullName) {
    throw new ApiError(400, 'Save personal details before vehicle details');
  }

  const selectedServiceLocation = serviceLocation || (locationId ? await ServiceLocation.findById(locationId).lean() : null);
  const selectedLocation = getServiceLocationName(selectedServiceLocation) || String(locationName || city || '').trim();
  const isOwner = isOwnerRole(session.role);
  // Whoever registers through the driver app is a taxi driver, always — there
  // is no separate Delivery/Pooling/Outstation product for this app, and a
  // driver never chooses a category. Anything the client sent here is
  // ignored; 'both' (taxi+outstation) is never produced, since "taxi" already
  // covers local and intercity rides (the module list on their subscription
  // tier is what actually gates ride types, not this field — see
  // matchingService.js). Owner/vendor/super-fleet-owner sessions are a
  // separate onboarding flow with their own meaning for these fields and are
  // left exactly as before.
  const normalizedServiceCategories = isOwner
    ? normalizeServiceCategories(serviceCategories, registerFor || session.role || 'taxi')
    : ['taxi'];
  const normalizedRegisterFor = isOwner
    ? getPrimaryRegisterFor(normalizedServiceCategories, registerFor || session.role || 'taxi')
    : 'taxi';

  if (!selectedLocation) {
    throw new ApiError(400, 'A valid service location is required');
  }

  const requiredFieldMap = await getRequiredVehicleFieldMap(session.role);
  const normalizedYear = String(year || '').trim();
  const normalizedNumber = String(number || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const normalizedPostalCode = String(postalCode || '').replace(/\D/g, '');
  const normalizedCustomFields = Object.entries(customFields || {}).reduce((acc, [key, value]) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      return acc;
    }

    if (Array.isArray(value)) {
      acc[normalizedKey] = value.map((item) => String(item || '').trim()).filter(Boolean);
      return acc;
    }

    acc[normalizedKey] = String(value || '').trim();
    return acc;
  }, {});
  const hasValue = (value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
  const requireField = (fieldKey, value, fallbackMessage) => {
    const config = requiredFieldMap[fieldKey];
    if (config?.is_required && !hasValue(value)) {
      throw new ApiError(400, `${config.name || fallbackMessage} is required`);
    }
  };

  requireField('locationId', locationId, 'Operating city');

  if (isOwner) {
    requireField('companyName', companyName, 'Company name');
    requireField('companyAddress', companyAddress, 'Company address');
    requireField('city', city, 'City');
    requireField('postalCode', normalizedPostalCode, 'Postal code');
    // Note: GST (taxNumber) is optional for owner / vendor / super_fleet_owner

    if (normalizedPostalCode && !/^\d{6}$/.test(normalizedPostalCode)) {
      throw new ApiError(400, 'Postal code must be a 6 digit number');
    }

    if (Array.isArray(vehicles) && vehicles.length > 0) {
      vehicles.forEach((v, index) => {
        const vTypeId = v?.vehicleTypeId || v?.vehicle_type_id || v?.vehicleType || v?.vehicle_type;
        if (!vTypeId) {
          throw new ApiError(400, `Vehicle #${index + 1}: vehicle type is required`);
        }
      });
    }
  } else {
    const vehicleYear = Number(normalizedYear);
    const currentYear = new Date().getFullYear();

    // No requireField('serviceCategories', ...) here: it is forced to
    // ['taxi'] above and can never fail this check.
    requireField('vehicleTypeId', vehicleTypeId, 'Vehicle type');
    requireField('make', make, 'Brand / Make');
    requireField('model', model, 'Model');
    requireField('year', normalizedYear, 'Year');
    requireField('number', normalizedNumber, 'Plate number');
    requireField('color', color, 'Exterior color');

    if (normalizedYear && (!/^\d{4}$/.test(normalizedYear) || vehicleYear < 1980 || vehicleYear > currentYear)) {
      throw new ApiError(400, `Vehicle year must be between 1980 and ${currentYear}`);
    }

    if (normalizedNumber && !VEHICLE_NUMBER_PATTERNS.some((pattern) => pattern.test(normalizedNumber))) {
      throw new ApiError(400, 'Vehicle number must be in a valid format, for example DL1AB2345, DL1ABCD1234, or MH12AB1234');
    }
  }

  Object.values(requiredFieldMap)
    .filter((config) => {
      const key = String(config.field_key || '').trim();
      return key && ![
        'locationId',
        'serviceCategories',
        'vehicleTypeId',
        'make',
        'model',
        'year',
        'number',
        'color',
        'companyName',
        'companyAddress',
        'city',
        'postalCode',
        'taxNumber',
      ].includes(key);
    })
    .forEach((config) => {
      if (config.is_required && !hasValue(normalizedCustomFields[config.field_key])) {
        throw new ApiError(400, `${config.name || config.field_key} is required`);
      }
    });

  const rawVehicleUsageType = String(vehicleUsageType || '').trim().toLowerCase();
  if (rawVehicleUsageType && rawVehicleUsageType !== 'commercial' && rawVehicleUsageType !== 'private') {
    throw new ApiError(400, "vehicle_usage_type must be either 'commercial' or 'private'", null, 'INVALID_USAGE_TYPE');
  }
  const normalizedVehicleUsageType = rawVehicleUsageType;

  session.vehicle = {
    registerFor: normalizedRegisterFor,
    serviceCategories: normalizedServiceCategories,
    locationId: String(locationId || '').trim(),
    locationName: selectedLocation,
    serviceLocation: selectedServiceLocation
      ? {
        _id: selectedServiceLocation._id || locationId || '',
        name: selectedServiceLocation.name || selectedServiceLocation.service_location_name || selectedLocation,
        service_location_name:
          selectedServiceLocation.service_location_name || selectedServiceLocation.name || selectedLocation,
        address: selectedServiceLocation.address || '',
        country: selectedServiceLocation.country || '',
        currency_name: selectedServiceLocation.currency_name || '',
        currency_symbol: selectedServiceLocation.currency_symbol || '',
        currency_code: selectedServiceLocation.currency_code || '',
        timezone: selectedServiceLocation.timezone || '',
        unit: selectedServiceLocation.unit || 'km',
        latitude: selectedServiceLocation.latitude ?? null,
        longitude: selectedServiceLocation.longitude ?? null,
        location: selectedServiceLocation.location || null,
        coordinates: getServiceLocationCoordinates(selectedServiceLocation),
      }
      : null,
    vehicleTypeId: String(vehicleTypeId || '').trim(),
    make: String(make || '').trim(),
    model: String(model || '').trim(),
    year: normalizedYear,
    number: normalizedNumber,
    color: String(color || '').trim(),
    companyName: String(companyName || '').trim(),
    companyAddress: String(companyAddress || '').trim(),
    city: String(city || selectedLocation).trim(),
    postalCode: normalizedPostalCode,
    taxNumber: String(taxNumber || '').trim().toUpperCase(),
    // Commercial vs private. Blank is allowed here so existing app builds
    // can still finish onboarding; it only blocks Prime/Middle plans later.
    vehicleUsageType: normalizedVehicleUsageType,
    customFields: normalizedCustomFields,
  };
  session.status = 'vehicle_saved';
  await session.save();

  return {
    message: 'Vehicle details saved',
    vehicle: session.vehicle,
    session: publicSessionPayload(session),
  };
};

export const saveDriverDocuments = async ({ registrationId, phone, documents = {} }) => {
  const session = await getSession(registrationId, phone);

  const updatedDocuments = {};
  const uploadedDocumentKeys = [];

  for (const [documentKey, value] of Object.entries(documents || {})) {
    const uploadedDocument = await uploadRegistrationDocument(documentKey, value);

    if (uploadedDocument) {
      updatedDocuments[documentKey] = uploadedDocument;
      uploadedDocumentKeys.push(documentKey);
    }
  }

  session.documents = {
    ...(session.documents || {}),
    ...updatedDocuments,
  };
  session.status = 'documents_saved';
  await session.save();

  return {
    message: 'Documents uploaded successfully',
    uploadedDocumentKeys,
    documents: session.documents,
    session: publicSessionPayload(session),
  };
};

export const completeDriverOnboarding = async ({ registrationId, phone, documents = {} }) => {
  const session = await getSession(registrationId, phone);

  if (session.finalDriverId) {
    const existingDriver = await Driver.findById(session.finalDriverId);
    await DriverRegistrationSession.deleteOne({ _id: session._id });
    return {
      message: 'Registration already completed',
      driver: publicDriverPayload(existingDriver),
      documents: session.documents,
      session: publicSessionPayload(session),
    };
  }

  if (!session.otpVerifiedAt) {
    throw new ApiError(400, 'Verify OTP before submission');
  }

  if (!session.personal?.fullName || !session.personal?.passwordHash) {
    throw new ApiError(400, 'Personal details are incomplete');
  }

  if (!session.vehicle?.locationName) {
    throw new ApiError(400, 'Vehicle details are incomplete');
  }

  const finalDocuments = Object.keys(documents || {}).length > 0 ? documents : session.documents || {};
  const normalizedDocuments = {};
  for (const [documentKey, value] of Object.entries(finalDocuments)) {
    normalizedDocuments[documentKey] = normalizeStoredDocument(value);
  }

  const configuredUploadFields =
    String(session.role || '').toLowerCase() === 'owner'
      ? await listOwnerDocumentUploadFields({ activeOnly: true })
      : await listDriverDocumentUploadFields({ activeOnly: true });
  const configuredTemplates =
    String(session.role || '').toLowerCase() === 'owner'
      ? (await listOwnerNeededDocuments()).filter((item) => item.active !== false)
      : await listDriverNeededDocuments({ activeOnly: true, includeFields: true });
  const requiredDocuments = configuredUploadFields
    .filter((field) => Boolean(field.required) && matchesDocumentRole(field.account_type, session.role))
    .map((field) => field.key);
  const missingDocuments = requiredDocuments.filter((key) => !normalizedDocuments?.[key]);
  const missingDocumentDetails = [];

  for (const template of configuredTemplates) {
    if (!matchesDocumentRole(template.account_type, session.role) || !template.is_required) {
      continue;
    }

    const templateFields = Array.isArray(template.fields) ? template.fields : [];
    const templateDocuments = templateFields
      .map((field) => normalizedDocuments?.[field.key])
      .filter(Boolean);

    if (templateDocuments.length === 0) {
      continue;
    }

    const templateName = String(template.name || 'Document').trim();
    const identifyNumber = templateDocuments.find((item) => String(item?.identifyNumber || '').trim())?.identifyNumber || '';
    const expiryDate = templateDocuments.find((item) => String(item?.expiryDate || '').trim())?.expiryDate || '';

    if (template.has_identify_number && !identifyNumber) {
      missingDocumentDetails.push(`${templateName} ID number`);
    }

    if (template.has_expiry_date && !expiryDate) {
      missingDocumentDetails.push(`${templateName} expiry date`);
    }
  }

  if (missingDocuments.length > 0) {
    throw new ApiError(400, `Missing required documents: ${missingDocuments.join(', ')}`);
  }

  if (missingDocumentDetails.length > 0) {
    throw new ApiError(400, `Missing required document details: ${missingDocumentDetails.join(', ')}`);
  }

  let resolvedServiceLocation = session.vehicle.serviceLocation || null;

  if (!resolvedServiceLocation && session.vehicle.locationId) {
    resolvedServiceLocation = await ServiceLocation.findById(session.vehicle.locationId).lean();
  }

  const serviceLocationCoordinates = getValidatedServiceLocationCoordinates(resolvedServiceLocation || {});
  const roleStr = String(session.role || '').toLowerCase();
  const isOwnerRegistration = ['owner', 'vendor', 'super_fleet_owner', 'service_center'].includes(roleStr);
  const targetAccountType = ['super_fleet_owner', 'service_center'].includes(roleStr) ? 'super_fleet_owner' : 'vendor';

  if (!serviceLocationCoordinates && !isOwnerRegistration) {
    throw new ApiError(400, `Unsupported service location: ${session.vehicle.locationName}`);
  }

  const zone = serviceLocationCoordinates ? await findZoneByPickup(serviceLocationCoordinates) : null;
  const selectedVehicle =
    session.vehicle.vehicleTypeId && /^[a-f\d]{24}$/i.test(String(session.vehicle.vehicleTypeId))
      ? await Vehicle.findById(session.vehicle.vehicleTypeId).lean()
      : null;
  const vehicleType = selectedVehicle
    ? getGenericVehicleTypeFromCatalog(selectedVehicle)
    : getVehicleType(session.vehicle.vehicleTypeId, session.vehicle.registerFor);
  const submittedAt = new Date();

  if (isOwnerRegistration) {
    const normalizedEmail = String(session.personal.email || '').trim().toLowerCase();
    const normalizedMobile = String(session.phone || '').trim();
    const serviceLocationId =
      session.vehicle.locationId && /^[a-f\d]{24}$/i.test(String(session.vehicle.locationId))
        ? session.vehicle.locationId
        : null;

    const duplicateOwner = await Owner.findOne({
      $or: [
        { email: normalizedEmail },
        { mobile: normalizedMobile },
      ],
    }).lean();

    if (duplicateOwner) {
      throw new ApiError(409, 'Owner already exists with this phone or email');
    }

    const submittedVehicles = Array.isArray(session.vehicle?.vehiclesList)
      ? session.vehicle.vehiclesList
      : [session.vehicle];
    const initialVehicleCount = Math.max(1, submittedVehicles.length);

    const minRequired = targetAccountType === 'super_fleet_owner' ? 5 : 2;
    const needsGracePeriod = initialVehicleCount < minRequired;
    const gracePeriodEndsAt = needsGracePeriod
      ? new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      : null;

    const owner = await Owner.create({
      company_name: String(session.vehicle.companyName || session.personal.fullName || '').trim(),
      owner_name: String(session.personal.fullName || '').trim() || null,
      name: String(session.personal.fullName || '').trim(),
      mobile: normalizedMobile,
      email: normalizedEmail,
      password: session.personal.passwordHash,
      service_location_id: serviceLocationId || null,
      legacy_service_location_id: serviceLocationId ? '' : String(session.vehicle.locationId || '').trim(),
      transport_type: String(session.vehicle.registerFor || 'taxi').trim().toLowerCase(),
      phone: normalizedMobile,
      address: String(session.vehicle.companyAddress || '').trim() || null,
      postal_code: String(session.vehicle.postalCode || '').trim() || null,
      city: String(session.vehicle.city || session.vehicle.locationName || '').trim() || null,
      tax_number: String(session.vehicle.taxNumber || '').trim() || null,
      account_type: targetAccountType,
      vehicle_count: initialVehicleCount,
      no_of_vehicles: initialVehicleCount,
      grace_period_ends_at: gracePeriodEndsAt,
      active: true,
      approve: false,
      status: 'pending',
      user_snapshot: {
        source: 'owner_onboarding',
        registrationId: session.registrationId,
        verifiedAt: session.otpVerifiedAt,
        submittedAt,
        location: serviceLocationCoordinates ? toPoint(serviceLocationCoordinates, 'location') : null,
        zoneId: zone?._id || null,
        documents: normalizedDocuments,
        onboardingVehicle: {
          ...session.vehicle,
        },
      },
      area_snapshot: resolvedServiceLocation || null,
    });

    if (session.vehicle?.selfDrive) {
      const selfDriveDriver = await Driver.create({
        name: owner.name,
        phone: owner.mobile,
        email: owner.email,
        password: owner.password,
        owner_id: owner._id,
        is_self_drive_owner: true,
        service_location_id: owner.service_location_id,
        approve: false,
        status: 'pending',
      });
      owner.self_drive_driver_id = selfDriveDriver._id;
      await owner.save();
    }

    session.status = 'completed';
    session.completedAt = submittedAt;
    await session.save();
    await DriverRegistrationSession.deleteOne({ _id: session._id });

    return {
      message: 'Owner registration completed successfully',
      owner: {
        id: owner._id,
        name: owner.owner_name || owner.name || owner.company_name || '',
        company_name: owner.company_name || '',
        phone: owner.mobile || owner.phone || '',
        email: owner.email || '',
        approve: owner.approve,
        status: owner.status,
      },
      documents: normalizedDocuments,
      token: signAccessToken({ sub: String(owner._id), role: 'owner' }),
      session: publicSessionPayload(session),
    };
  }

  const normalizedReferralCode = normalizeReferralCode(session.referralCode);
  const referrer = normalizedReferralCode
    ? await findDriverByReferralCode(normalizedReferralCode)
    : null;

  if (normalizedReferralCode && !referrer?._id) {
    throw new ApiError(400, 'Invalid referral code');
  }

  const driver = await Driver.create({
    name: session.personal.fullName,
    phone: session.phone,
    email: session.personal.email,
    gender: session.personal.gender,
    password: session.personal.passwordHash,
    service_location_id:
      session.vehicle.locationId && /^[a-f\d]{24}$/i.test(String(session.vehicle.locationId))
        ? session.vehicle.locationId
        : null,
    vehicleType,
    vehicleTypeId: selectedVehicle?._id || null,
    vehicleIconType: selectedVehicle?.icon_types || vehicleType,
    registerFor: session.vehicle.registerFor,
    serviceCategories: Array.isArray(session.vehicle.serviceCategories) ? session.vehicle.serviceCategories : [],
    vehicleMake: session.vehicle.make,
    vehicleModel: session.vehicle.model,
    vehicleNumber: session.vehicle.number,
    vehicleColor: session.vehicle.color,
    vehicle_usage_type: session.vehicle.vehicleUsageType || '',
    city: session.vehicle.city || session.vehicle.locationName,
    referredBy: referrer?._id || null,
    approve: false,
    status: 'pending',
    zoneId: zone?._id || null,
    location: toPoint(serviceLocationCoordinates, 'location'),
    documents: normalizedDocuments,
    onboarding: {
      registrationId: session.registrationId,
      role: session.role,
      verifiedAt: session.otpVerifiedAt,
      submittedAt,
      personal: {
        fullName: session.personal.fullName,
        email: session.personal.email,
        gender: session.personal.gender,
      },
      vehicle: {
        registerFor: session.vehicle.registerFor,
        serviceCategories: Array.isArray(session.vehicle.serviceCategories) ? session.vehicle.serviceCategories : [],
        locationId: session.vehicle.locationId,
        locationName: session.vehicle.locationName,
        vehicleTypeId: session.vehicle.vehicleTypeId,
        make: session.vehicle.make,
        model: session.vehicle.model,
        year: session.vehicle.year,
        number: session.vehicle.number,
        color: session.vehicle.color,
        city: session.vehicle.city,
        customFields: session.vehicle.customFields || {},
      },
    },
  });

  if (!String(driver.referralCode || '').trim()) {
    driver.referralCode = generateDriverReferralCode(driver);
    await driver.save();
  }

  if (referrer?._id) {
    await Driver.updateOne({ _id: referrer._id }, { $inc: { referralCount: 1 } });
    await processDriverSignupReferralRewards({ driver, referrer });
  }

  session.finalDriverId = driver._id;
  session.status = 'completed';
  session.completedAt = submittedAt;
  await session.save();
  await DriverRegistrationSession.deleteOne({ _id: session._id });

  return {
    message: 'Driver registration completed successfully',
    driver: publicDriverPayload(driver),
    documents: normalizedDocuments,
    token: signAccessToken({ sub: String(driver._id), role: 'driver' }),
    session: publicSessionPayload(session),
  };
};

export const getDriverOnboardingSession = async ({ registrationId, phone }) => {
  const session = await getSession(registrationId, phone);
  return {
    session: publicSessionPayload(session),
    personal: session.personal,
    referralCode: session.referralCode,
    vehicle: session.vehicle,
    documents: session.documents,
    completedAt: session.completedAt,
  };
};
