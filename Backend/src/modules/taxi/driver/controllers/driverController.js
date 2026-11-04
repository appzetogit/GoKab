import crypto from "node:crypto";
import { isRazorpayTestModeAllowed, isRazorpayTestPayment, safeEqualHex } from "../../services/razorpaySecurity.js";
import mongoose from "mongoose";
import { asyncHandler } from "../../../../utils/asyncHandler.js";
import { resolveDriverBanner, resolveDriverProfileImage } from "../services/driverBannerService.js";
import QRCode from "qrcode";
import { Env, StandardCheckoutClient, StandardCheckoutPayRequest, PrefillUserLoginDetails } from "@phonepe-pg/pg-sdk-node";
import { env } from "../../../../config/env.js";
import { ApiError } from "../../../../utils/ApiError.js";
import { normalizePoint, toPoint } from "../../../../utils/geo.js";
import { Driver } from "../models/Driver.js";
import { Zone } from "../models/Zone.js";
import { DriverLoginSession } from "../models/DriverLoginSession.js";
import { WalletTransaction } from "../models/WalletTransaction.js";
import { WithdrawalRequest } from "../../admin/models/WithdrawalRequest.js";
import { notifyAdminsOfWithdrawal } from "../../services/withdrawalNotifyService.js";
import { Ride } from "../../user/models/Ride.js";
import { Owner } from "../../admin/models/Owner.js";
import { ServiceLocation } from "../../admin/models/ServiceLocation.js";
import { Vehicle } from "../../admin/models/Vehicle.js";
import { AdminBusinessSetting } from "../../admin/models/AdminBusinessSetting.js";
import { Notification } from "../../admin/promotions/models/Notification.js";
import { NotificationRead } from "../models/NotificationRead.js";
import { settleAwaitingPlatformEscrow } from "../services/escrowService.js";
import { mediaService } from "../../../../services/media.service.js";
import { FleetVehicle } from "../../admin/models/FleetVehicle.js";
import { buildAssignedByPayload } from "../../services/networkNotificationService.js";
import {
  findMissingDocuments,
  findMissingDocumentDetails,
} from "../../services/fleetVehicleDocumentRules.js";
import { PoolingVehicle } from "../../admin/models/PoolingVehicle.js";
import { PoolingBooking } from "../../admin/models/PoolingBooking.js";
import { uploadDataUrlToCloudinary } from "../../../../utils/cloudinaryUpload.js";
import {
  completePoolingDriverOnboarding,
  getPoolingDriverOnboardingSession,
  requireVerifiedPoolingDriverOnboardingSession,
  savePoolingDriverOnboardingDetails,
  startPoolingDriverOnboarding,
  verifyPoolingDriverOnboardingOtp,
} from "../services/poolingOnboardingService.js";
import {
  comparePassword,
  hashPassword,
  signAccessToken,
} from "../services/authService.js";
import { cancelScheduledRideByDriver, emitToDriver } from "../../services/dispatchService.js";
import { notifyLateAvailableDriver } from "../../services/dispatchService.js";
import { findZoneByPickup } from "../services/locationService.js";
import { listDriverServiceLocations } from "../services/serviceLocationService.js";
import {
  applyDriverWalletAdjustment,
  ensureDriverWalletCanAcceptRide,
  serializeDriverWallet,
  topUpDriverWallet,
} from "../services/walletService.js";
import {
  startDriverLoginOtp,
  verifyDriverLoginOtp,
} from "../services/loginOtpService.js";
import { verifyAccessToken } from "../../services/tokenService.js";
import { clearDriverActiveRideIfStale } from "../../services/rideService.js";
import { getWalletSettings } from "../../services/appSettingsService.js";
import { RIDE_LIVE_STATUS, RIDE_STATUS } from "../../constants/index.js";
import {
  ensureThirdPartySettings,
  listDriverNeededDocuments,
  listDriverVehicleFieldTemplates,
  listOwnerNeededDocuments,
  adjustOwnerWallet,
  listOwnerWalletHistory,
} from "../../admin/services/adminService.js";
import { OwnerWalletTransaction } from "../../admin/models/OwnerWalletTransaction.js";
import { resolveConfiguredGatewayCredentials } from "../../services/paymentGatewayService.js";
import { assignPushTokenToEntity } from "../../services/pushTokenService.js";
import {
  completeDriverOnboarding,
  getDriverOnboardingSession,
  saveDriverDocuments,
  saveDriverPersonalDetails,
  saveDriverReferral,
  getDriverReferralProgramSettings,
  saveDriverVehicle,
  startDriverOnboarding,
  uploadRegistrationDocument,
  verifyDriverOtp,
} from "../services/onboardingService.js";
import {
  buildDriverTodaySummaryFromDocument,
  syncDriverTodaySummaryDocument,
} from "../services/driverTodaySummaryService.js";
import {
  buildPaymentRequestContext,
  logPaymentDiagnostic,
  summarizeCheckoutUrl,
  summarizePhonePeCredentialMeta,
  summarizePhonePePayload,
  summarizePhonePeRequestBody,
} from "../../services/paymentDiagnostics.js";

const generateDriverReferralCode = (driver) => {
  const idPart = String(driver?._id || "")
    .slice(-6)
    .toUpperCase();
  const phonePart = String(driver?.phone || "").slice(-4);
  return `DRV${phonePart}${idPart}`.replace(/\W/g, "");
};

const MAX_EMERGENCY_CONTACTS = 5;
const EMERGENCY_CONTACT_NAME_REGEX = /^[A-Za-z]+(?:[ .'-][A-Za-z]+)*$/;
const DRIVER_NAME_REGEX = /^[A-Za-z]+(?:[ .'-][A-Za-z]+)*$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DRIVER_GENDERS = new Map([
  ["male", "Male"],
  ["female", "Female"],
  ["other", "Other"],
]);
const RAZORPAY_QR_MAX_AMOUNT = 500000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const toIstDayKey = (value = new Date()) =>
  new Date(new Date(value).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

const toCleanString = (value = "") => String(value || "").trim();
const DATA_URL_PATTERN = /^data:[^;]+;base64,/i;

// An image field that may arrive either as an already-hosted URL (returned
// untouched) or as a base64 data URL (uploaded, hosted URL returned). Storing
// the raw data URL instead leaves a multi-megabyte string inside the driver
// document and in every later `GET /me` response.
const resolveHostedImageUrl = async (
  value,
  { folder, publicIdPrefix, maxBytes = 0, label = "Image" },
) => {
  const raw = String(value || "").trim();
  if (!raw || !DATA_URL_PATTERN.test(raw)) {
    return raw;
  }

  if (maxBytes > 0) {
    const decodedBytes = Math.floor((raw.length - raw.indexOf(",") - 1) * 0.75);
    if (decodedBytes > maxBytes) {
      throw new ApiError(
        400,
        `${label} must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller`,
        { max_bytes: maxBytes },
        "IMAGE_TOO_LARGE",
      );
    }
  }

  const uploaded = await uploadDataUrlToCloudinary({ dataUrl: raw, folder, publicIdPrefix });
  return String(uploaded?.secureUrl || "").trim();
};

const normalizeFleetVehicleDocumentValue = async (documentKey, value) => {
  if (!value) {
    return null;
  }

  // A data URL (what the registration screen's image picker sends) was
  // stored as-is — the field ended up holding a multi-megabyte base64 string
  // instead of a hosted image URL, unlike every registration document, which
  // goes through Cloudinary via uploadRegistrationDocument. Route the same
  // way here; an already-hosted URL or {secureUrl} object (what most fleet
  // vehicle documents actually send today, including every existing test
  // fixture) is left exactly as before.
  const dataUrl = typeof value === "string" ? value : value?.dataUrl;
  if (typeof dataUrl === "string" && DATA_URL_PATTERN.test(dataUrl)) {
    const uploaded = await uploadRegistrationDocument(documentKey, value);
    return uploaded ? { ...uploaded, uploaded: true } : null;
  }

  if (typeof value === "string") {
    const url = String(value || "").trim();
    if (!url) {
      return null;
    }

    return {
      previewUrl: url,
      secureUrl: url,
      uploaded: true,
    };
  }

  if (typeof value !== "object") {
    return null;
  }

  const previewUrl = String(
    value.previewUrl ||
      value.secureUrl ||
      value.url ||
      value.imageUrl ||
      value.image ||
      value.fileUrl ||
      value.document ||
      value.file ||
      "",
  ).trim();

  if (!previewUrl) {
    return null;
  }

  return {
    ...value,
    previewUrl,
    secureUrl: String(value.secureUrl || previewUrl).trim(),
    uploaded: value.uploaded ?? true,
  };
};

// The app sends expiryDate as free text (`dd MMM yyyy`, e.g. "12 Mar 2031").
// Parses it and stamps a normalised ISO date (`expiresAt`) onto the same
// object so a future cron can find documents expiring soon without
// re-parsing. Mutates each object in `documents` in place — called on the
// raw, not-yet-uploaded documents map, same as findMissingDocuments/
// findMissingDocumentDetails, so a bad date is rejected before anything
// reaches Cloudinary.
const validateAndStampDocumentExpiry = (documents = {}) => {
  if (!documents || typeof documents !== "object") return;

  for (const [key, value] of Object.entries(documents)) {
    if (!value || typeof value !== "object") continue;

    const rawExpiry = String(value.expiryDate ?? value.expiry_date ?? "").trim();
    if (!rawExpiry) continue;

    const parsed = new Date(rawExpiry);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() < Date.now()) {
      throw new ApiError(
        400,
        `${key} expiry date is invalid or already in the past`,
        { key },
        "DOCUMENT_EXPIRED",
      );
    }

    value.expiresAt = parsed.toISOString();
  }
};

const normalizeFleetVehicleDocuments = async (documents = {}, rcFile = "") => {
  const normalizedDocuments = {};

  if (documents && typeof documents === "object" && !Array.isArray(documents)) {
    for (const [key, value] of Object.entries(documents)) {
      const normalizedValue = await normalizeFleetVehicleDocumentValue(String(key).trim(), value);
      if (normalizedValue) {
        normalizedDocuments[String(key).trim()] = normalizedValue;
      }
    }
  }

  const normalizedRcFile = String(rcFile || "").trim();
  if (normalizedRcFile && !normalizedDocuments.rc) {
    normalizedDocuments.rc = await normalizeFleetVehicleDocumentValue("rc", normalizedRcFile);
  }

  return normalizedDocuments;
};

const serializeDriverRouteBooking = (routeBooking = {}) => {
  const coordinates = Array.isArray(routeBooking?.anchorLocation?.coordinates)
    ? routeBooking.anchorLocation.coordinates
    : [];

  return {
    enabled: Boolean(routeBooking?.enabled && coordinates.length === 2),
    coordinates: coordinates.length === 2 ? coordinates : null,
    label: String(routeBooking?.label || "").trim(),
    updatedAt: routeBooking?.updatedAt || null,
  };
};

const serializeDriverBankDetails = (bankDetails = {}) => ({
  accountHolderName: String(bankDetails?.accountHolderName || "").trim(),
  upiId: String(bankDetails?.upiId || "").trim(),
  qrCodeImage: String(bankDetails?.qrCodeImage || "").trim(),
  accountNumber: String(bankDetails?.accountNumber || "").trim(),
  ifsc: String(bankDetails?.ifsc || "").trim().toUpperCase(),
  branchName: String(bankDetails?.branchName || "").trim(),
  updatedAt: bankDetails?.updatedAt || null,
});

const normalizeDriverBankDetails = (payload = {}, existing = {}) => {
  const next = serializeDriverBankDetails(existing);

  if (Object.prototype.hasOwnProperty.call(payload, "accountHolderName")) {
    next.accountHolderName = String(payload.accountHolderName || "").trim().slice(0, 120);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "upiId")) {
    const upiId = String(payload.upiId || "").trim().toLowerCase();
    if (upiId && !/^[a-z0-9.\-_]{2,}@[a-z0-9.\-_]{2,}$/i.test(upiId)) {
      throw new ApiError(400, "Enter a valid UPI ID");
    }
    next.upiId = upiId;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "qrCodeImage")) {
    next.qrCodeImage = String(payload.qrCodeImage || "").trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, "accountNumber")) {
    const accountNumber = String(payload.accountNumber || "").replace(/\s/g, "");
    if (accountNumber && !/^\d{6,20}$/.test(accountNumber)) {
      throw new ApiError(400, "Account number must be 6 to 20 digits");
    }
    next.accountNumber = accountNumber;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "ifsc")) {
    const ifsc = String(payload.ifsc || "").trim().toUpperCase();
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      throw new ApiError(400, "Enter a valid IFSC code");
    }
    next.ifsc = ifsc;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "branchName")) {
    next.branchName = String(payload.branchName || "").trim().slice(0, 120);
  }

  next.updatedAt = new Date();
  return next;
};

const getIstDayStart = (value = new Date()) => {
  const timestamp = new Date(value).getTime();
  const shifted = timestamp + IST_OFFSET_MS;
  const dayStartShifted = Math.floor(shifted / DAY_MS) * DAY_MS;
  return new Date(dayStartShifted - IST_OFFSET_MS);
};

const getIstWeekKey = (value = new Date()) => {
  const dayStart = getIstDayStart(value);
  const shifted = dayStart.getTime() + IST_OFFSET_MS;
  const shiftedDate = new Date(shifted);
  const day = shiftedDate.getUTCDay();
  const mondayDistance = day === 0 ? 6 : day - 1;
  const weekStart = new Date(dayStart.getTime() - mondayDistance * DAY_MS);
  return toIstDayKey(weekStart);
};

const getIstMonthKey = (value = new Date()) => {
  const shifted = new Date(new Date(value).getTime() + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const getConfiguredAppName = async () => {
  try {
    const settings = await AdminBusinessSetting.findOne({ scope: "default" })
      .select("general.app_name")
      .lean();

    return String(settings?.general?.app_name || "").trim() || "App";
  } catch {
    return "App";
  }
};

const pruneDailyActivity = (items = []) =>
  (Array.isArray(items) ? items : [])
    .filter((item) => item?.date)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
    .slice(-120);

const pruneClaimedRewards = (items = []) =>
  (Array.isArray(items) ? items : [])
    .filter((item) => item?.rewardType && item?.rewardKey)
    .sort((left, right) => new Date(left.claimedAt || 0) - new Date(right.claimedAt || 0))
    .slice(-200);

const appendDailyActivityMinutes = (dailyActivity = [], dateKey, minutes) => {
  const safeMinutes = Math.max(0, Number(minutes || 0));
  if (!dateKey || safeMinutes <= 0) {
    return pruneDailyActivity(dailyActivity);
  }

  const next = [...(Array.isArray(dailyActivity) ? dailyActivity : [])];
  const index = next.findIndex((item) => item?.date === dateKey);

  if (index >= 0) {
    next[index] = {
      ...next[index],
      activeMinutes: Math.round((Number(next[index]?.activeMinutes || 0) + safeMinutes) * 100) / 100,
    };
  } else {
    next.push({
      date: dateKey,
      activeMinutes: Math.round(safeMinutes * 100) / 100,
    });
  }

  return pruneDailyActivity(next);
};

const mergeOnlineSessionIntoTracking = (tracking = {}, sessionStart, sessionEnd = new Date()) => {
  const start = sessionStart ? new Date(sessionStart) : null;
  const end = sessionEnd ? new Date(sessionEnd) : null;

  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return {
      ...tracking,
      dailyActivity: pruneDailyActivity(tracking?.dailyActivity),
    };
  }

  let cursor = new Date(start);
  let nextDailyActivity = Array.isArray(tracking?.dailyActivity) ? [...tracking.dailyActivity] : [];

  while (cursor < end) {
    const nextDayStart = new Date(getIstDayStart(cursor).getTime() + DAY_MS);
    const segmentEnd = nextDayStart < end ? nextDayStart : end;
    const minutes = (segmentEnd.getTime() - cursor.getTime()) / 60000;
    nextDailyActivity = appendDailyActivityMinutes(nextDailyActivity, toIstDayKey(cursor), minutes);
    cursor = segmentEnd;
  }

  return {
    ...tracking,
    dailyActivity: nextDailyActivity,
  };
};

const collectWeekWindows = (count = 1, fromDate = new Date()) => {
  const total = Math.max(1, Number(count || 1));
  const windows = [];
  const currentDayStart = getIstDayStart(fromDate);
  const shifted = currentDayStart.getTime() + IST_OFFSET_MS;
  const shiftedDate = new Date(shifted);
  const day = shiftedDate.getUTCDay();
  const mondayDistance = day === 0 ? 6 : day - 1;
  const currentWeekStart = new Date(currentDayStart.getTime() - mondayDistance * DAY_MS);

  for (let index = 0; index < total; index += 1) {
    const start = new Date(currentWeekStart.getTime() - index * 7 * DAY_MS);
    const end = new Date(start.getTime() + 7 * DAY_MS);
    windows.unshift({
      key: toIstDayKey(start),
      start,
      end,
    });
  }

  return windows;
};

const countCompletedRidesInRange = (rides = [], start, end) =>
  rides.filter((ride) => {
    const status = String(ride?.status || "").toLowerCase();
    const liveStatus = String(ride?.liveStatus || "").toLowerCase();
    if (!["completed", "delivered"].includes(status) && !["completed", "delivered"].includes(liveStatus)) {
      return false;
    }

    const rideDate = new Date(ride?.completedAt || ride?.updatedAt || ride?.createdAt || 0);
    return rideDate >= start && rideDate < end;
  }).length;

const countPeakHourTripsInRange = (rides = [], start, end) =>
  rides.filter((ride) => {
    const status = String(ride?.status || "").toLowerCase();
    const liveStatus = String(ride?.liveStatus || "").toLowerCase();
    if (!["completed", "delivered"].includes(status) && !["completed", "delivered"].includes(liveStatus)) {
      return false;
    }
    const rideDate = new Date(ride?.completedAt || ride?.updatedAt || ride?.createdAt || 0);
    if (!(rideDate >= start && rideDate < end)) {
      return false;
    }
    const hour = new Date(rideDate.getTime() + IST_OFFSET_MS).getUTCHours();
    return (hour >= 7 && hour < 11) || (hour >= 17 && hour < 21);
  }).length;

const getCurrentActiveStreak = (dailyActivity = [], minimumMinutes = 1) => {
  const activityMap = new Map((Array.isArray(dailyActivity) ? dailyActivity : []).map((item) => [item.date, Number(item.activeMinutes || 0)]));
  let streak = 0;
  let cursor = getIstDayStart(new Date());

  while (true) {
    const key = toIstDayKey(cursor);
    const minutes = Number(activityMap.get(key) || 0);
    if (minutes < minimumMinutes) {
      break;
    }
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }

  return streak;
};

const hasClaimedReward = (claimedRewards = [], rewardType, rewardKey, periodKey) =>
  (Array.isArray(claimedRewards) ? claimedRewards : []).some((item) =>
    item?.rewardType === rewardType &&
    item?.rewardKey === rewardKey &&
    item?.periodKey === periodKey,
  );

const buildDriverIncentiveSnapshot = ({ driver, settings, rides }) => {
  const tracking = driver?.incentiveTracking || {};
  const dailyActivity = Array.isArray(tracking.dailyActivity) ? tracking.dailyActivity : [];
  const claimedRewards = Array.isArray(tracking.claimedRewards) ? tracking.claimedRewards : [];
  const milestonePrograms = Array.isArray(settings?.milestone_programs) ? settings.milestone_programs : [];
  const rewardFeatures = Array.isArray(settings?.reward_features) ? settings.reward_features : [];
  const dailyActivityMap = new Map(dailyActivity.map((item) => [item.date, Number(item.activeMinutes || 0)]));

  const milestones = milestonePrograms.map((item, index) => {
    const requiredWeeks = Math.max(1, Number(item.required_weeks || 1));
    const requiredHours = Math.max(0, Number(item.active_hours_per_day || 0));
    const minTripsPerWeek = Math.max(0, Number(item.min_trips_per_week || 0));
    const weekWindows = collectWeekWindows(requiredWeeks, new Date());
    const qualifyingWeeks = weekWindows.filter((week) => {
      const tripCount = countCompletedRidesInRange(rides, week.start, week.end);
      return tripCount >= minTripsPerWeek;
    }).length;

    const targetDays = requiredWeeks * 7;
    let qualifyingDays = 0;
    for (let offset = 0; offset < targetDays; offset += 1) {
      const day = new Date(getIstDayStart(new Date()).getTime() - offset * DAY_MS);
      const dayKey = toIstDayKey(day);
      if ((Number(dailyActivityMap.get(dayKey) || 0) / 60) >= requiredHours) {
        qualifyingDays += 1;
      }
    }

    const periodKey = `milestone:${item.id || index}`;
    const eligible = Boolean(item.enabled) && qualifyingWeeks >= requiredWeeks && qualifyingDays >= targetDays;

    return {
      ...item,
      periodKey,
      progress: {
        qualifyingWeeks,
        targetWeeks: requiredWeeks,
        qualifyingDays,
        targetDays,
      },
      isEligible: eligible,
      isClaimed: hasClaimedReward(claimedRewards, "milestone", item.id || String(index), periodKey),
    };
  });

  const currentWeekWindow = collectWeekWindows(1, new Date())[0];
  const currentWeekTrips = currentWeekWindow ? countCompletedRidesInRange(rides, currentWeekWindow.start, currentWeekWindow.end) : 0;
  const currentPeakTrips = currentWeekWindow ? countPeakHourTripsInRange(rides, currentWeekWindow.start, currentWeekWindow.end) : 0;
  const currentStreak = getCurrentActiveStreak(dailyActivity, 1);
  const weekendCount = collectWeekWindows(4, new Date()).reduce((total, week) => {
    const saturday = new Date(week.start.getTime() + 5 * DAY_MS);
    const sunday = new Date(week.start.getTime() + 6 * DAY_MS);
    const weekendTrips = countCompletedRidesInRange(rides, saturday, new Date(sunday.getTime() + DAY_MS));
    return total + (weekendTrips > 0 ? 1 : 0);
  }, 0);
  const currentMonthKey = getIstMonthKey(new Date());
  const monthStart = new Date(`${currentMonthKey}-01T00:00:00.000Z`);
  const monthCompleted = rides.filter((ride) => {
    const status = String(ride?.status || "").toLowerCase();
    const liveStatus = String(ride?.liveStatus || "").toLowerCase();
    if (!["completed", "delivered"].includes(status) && !["completed", "delivered"].includes(liveStatus)) {
      return false;
    }
    const rideDate = new Date(ride?.completedAt || ride?.updatedAt || ride?.createdAt || 0);
    return getIstMonthKey(rideDate) === currentMonthKey;
  }).length;
  const monthCancelled = rides.filter((ride) => {
    const status = String(ride?.status || "").toLowerCase();
    return status === "cancelled" && getIstMonthKey(new Date(ride?.updatedAt || ride?.createdAt || 0)) === currentMonthKey;
  }).length;
  const cancellationRate = monthCompleted + monthCancelled > 0
    ? Number(((monthCancelled / (monthCompleted + monthCancelled)) * 100).toFixed(2))
    : 0;

  const features = rewardFeatures.map((item, index) => {
    const key = item.key || item.id || `feature_${index + 1}`;
    let currentValue = 0;
    let periodKey = key;

    switch (key) {
      case "daily_active_streak":
        currentValue = currentStreak;
        periodKey = `${key}:${getIstWeekKey(new Date())}`;
        break;
      case "weekly_trip_quest":
        currentValue = currentWeekTrips;
        periodKey = `${key}:${getIstWeekKey(new Date())}`;
        break;
      case "peak_hour_booster":
        currentValue = currentPeakTrips;
        periodKey = `${key}:${getIstWeekKey(new Date())}`;
        break;
      case "weekend_warrior":
        currentValue = weekendCount;
        periodKey = `${key}:${currentMonthKey}`;
        break;
      case "rating_guard":
        currentValue = Number(driver?.rating || 0);
        periodKey = `${key}:${currentMonthKey}`;
        break;
      case "cancellation_guard":
        currentValue = cancellationRate;
        periodKey = `${key}:${currentMonthKey}`;
        break;
      default:
        currentValue = Number(item.target_value || 0);
        periodKey = `${key}:${currentMonthKey}`;
        break;
    }

    const target = Number(item.target_value || 0);
    const isEligible = key === "cancellation_guard"
      ? currentValue <= target
      : currentValue >= target;

    return {
      ...item,
      key,
      periodKey,
      currentValue,
      targetValue: target,
      isEligible: Boolean(item.enabled) && isEligible,
      isClaimed: hasClaimedReward(claimedRewards, "feature", key, periodKey),
    };
  });

  return {
    settings: {
      enabled: Boolean(settings?.enabled),
      milestone_program_enabled: Boolean(settings?.milestone_program_enabled),
      type: settings?.type || "instant_referrer",
    },
    summary: {
      streakDays: currentStreak,
      currentWeekTrips,
      currentPeakTrips,
      weekendCount,
      monthCancellationRate: cancellationRate,
      totalClaimedRewards: claimedRewards.length,
    },
    milestones,
    features,
    claimedRewards,
    walletBalance: Number(driver?.wallet?.balance || 0),
  };
};

const buildDriverTodaySummary = async (driver) => buildDriverTodaySummaryFromDocument(driver);

const normalizePaymentAmount = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, "amount must be a positive number");
  }

  if (amount > RAZORPAY_QR_MAX_AMOUNT) {
    throw new ApiError(400, "amount is too large for QR collection");
  }

  return Math.round(amount * 100);
};

const razorpayRequest = async ({ method, path, body }) => {
  const { keyId, keySecret } = await resolveConfiguredGatewayCredentials("razor_pay");
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status || 502,
      payload?.error?.description ||
        payload?.error?.message ||
        "Razorpay QR request failed",
      {
        provider: "razorpay",
        path,
        code: payload?.error?.code || null,
      },
    );
  }

  return payload;
};

const shouldFallbackToPaymentLinkQr = (error) => {
  const message = String(error?.message || "").toLowerCase();

  return (
    error?.statusCode === 404 ||
    message.includes("requested url was not found") ||
    message.includes("qr") && message.includes("not") && message.includes("enabled")
  );
};

const shouldFallbackToStandardPaymentLink = (error) => {
  const message = String(error?.message || "").toLowerCase();

  return (
    message.includes("upi payment links are not supported in test mode") ||
    message.includes("upi payment link") && message.includes("test mode")
  );
};

const buildPaymentLinkBody = ({ amountInPaise, rideId, driverId, serviceType, expireBy, referenceId, upiLink }) => ({
  ...(upiLink ? { upi_link: true } : {}),
  amount: amountInPaise,
  currency: "INR",
  accept_partial: false,
  expire_by: expireBy,
  reference_id: referenceId,
  description: `Taxi fare for ride ${rideId}`,
  reminder_enable: false,
  notes: {
    rideId: String(rideId),
    driverId: String(driverId),
    serviceType: serviceType || "ride",
    source: "driver_collect_amount",
    fallback: upiLink ? "upi_payment_link_qr" : "standard_payment_link_qr",
  },
});

const createPaymentLinkQr = async ({ amountInPaise, rideId, driverId, serviceType }) => {
  const referenceId = `ride_${String(rideId).slice(-18)}_${Date.now().toString(36)}`.slice(0, 40);
  const expireBy = Math.floor(Date.now() / 1000) + 30 * 60;
  let providerMode = "upi_payment_link_qr";
  let paymentLink;

  try {
    paymentLink = await razorpayRequest({
      method: "POST",
      path: "/payment_links",
      body: buildPaymentLinkBody({
        amountInPaise,
        rideId,
        driverId,
        serviceType,
        expireBy,
        referenceId,
        upiLink: true,
      }),
    });
  } catch (error) {
    if (!shouldFallbackToStandardPaymentLink(error)) {
      throw error;
    }

    providerMode = "standard_payment_link_qr";
    paymentLink = await razorpayRequest({
      method: "POST",
      path: "/payment_links",
      body: buildPaymentLinkBody({
        amountInPaise,
        rideId,
        driverId,
        serviceType,
        expireBy,
        referenceId: `${referenceId}_std`.slice(0, 40),
        upiLink: false,
      }),
    });
  }

  const paymentUrl = paymentLink.short_url || paymentLink.shortUrl || paymentLink.url;

  if (!paymentUrl) {
    throw new ApiError(502, "Razorpay payment link was created without a payment URL");
  }

  const imageUrl = await QRCode.toDataURL(paymentUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 8,
  });

  return {
    id: paymentLink.id,
    entity: paymentLink.entity || "payment_link",
    status: paymentLink.status || "created",
    imageUrl,
    linkUrl: paymentUrl,
    amount: amountInPaise / 100,
    currency: "INR",
    description: paymentLink.description,
    closeBy: paymentLink.expire_by || expireBy,
    rawStatus: paymentLink.status || "created",
    providerMode,
  };
};

const PAYMENT_PAID_STATUSES = new Set(["paid", "captured", "completed"]);
const PAYMENT_OPEN_STATUSES = new Set(["created", "active", "issued", "partially_paid"]);

const normalizeCollectionStatus = (status) => {
  const normalized = String(status || "").toLowerCase();

  if (PAYMENT_PAID_STATUSES.has(normalized)) {
    return "paid";
  }

  if (PAYMENT_OPEN_STATUSES.has(normalized)) {
    return normalized === "partially_paid" ? "active" : normalized;
  }

  if (normalized === "closed") {
    return "closed";
  }

  if (["cancelled", "canceled", "expired", "failed"].includes(normalized)) {
    return normalized === "canceled" ? "cancelled" : normalized;
  }

  return normalized || "pending";
};

const getPaymentCollectionPath = ({ providerId, providerMode }) => {
  if (!providerId) {
    throw new ApiError(400, "payment collection id is required");
  }

  if (String(providerMode || "").includes("payment_link")) {
    return `/payment_links/${providerId}`;
  }

  return `/payments/qr_codes/${providerId}`;
};

const serializeDriverPaymentCollection = (collection = {}) => {
  const status = normalizeCollectionStatus(collection.status);

  return {
    provider: collection.provider || "razorpay",
    id: collection.providerId || collection.id || "",
    providerMode: collection.providerMode || "",
    status,
    paid: PAYMENT_PAID_STATUSES.has(status),
    amount: Number(collection.amount || 0),
    currency: collection.currency || "INR",
    linkUrl: collection.linkUrl || "",
    paidAt: collection.paidAt || null,
    updatedAt: collection.updatedAt || null,
  };
};

const refreshDriverPaymentCollection = async (ride) => {
  const collection = ride?.driverPaymentCollection || {};
  const providerId = String(collection.providerId || "").trim();

  if (!providerId) {
    return serializeDriverPaymentCollection(collection);
  }

  const providerMode = collection.providerMode || "";
  const providerPayload = await razorpayRequest({
    method: "GET",
    path: getPaymentCollectionPath({ providerId, providerMode }),
  });
  const receivedAmount = Number(
    providerPayload?.amount_paid ||
      providerPayload?.amount_paid_total ||
      providerPayload?.payments_amount_received ||
      providerPayload?.amount_received ||
      0,
  );
  const expectedAmount = Number(collection.amount || 0) * 100;
  const isProviderAmountPaid = expectedAmount > 0 && receivedAmount >= expectedAmount;
  const providerStatus = normalizeCollectionStatus(providerPayload?.status);
  const isPaid = PAYMENT_PAID_STATUSES.has(providerStatus) || isProviderAmountPaid;
  const nextStatus = isPaid ? "paid" : providerStatus;
  const nextCollection = {
    provider: "razorpay",
    providerId,
    providerMode,
    status: nextStatus,
    amount: Number(collection.amount || 0),
    currency: collection.currency || "INR",
    linkUrl: collection.linkUrl || providerPayload?.short_url || providerPayload?.url || "",
    paidAt: isPaid ? collection.paidAt || new Date() : collection.paidAt || null,
    updatedAt: new Date(),
  };

  ride.driverPaymentCollection = nextCollection;
  await ride.save();

  // A published ride completed as collected by the platform settles once
  // Razorpay confirms the QR was paid. The cron retries if this fails.
  if (isPaid) {
    await settleAwaitingPlatformEscrow(ride._id).catch((error) =>
      console.error(`[driverController] escrow settlement after QR payment on ${ride._id} failed:`, error?.message || error),
    );
  }

  return serializeDriverPaymentCollection(nextCollection);
};

const sanitizeEmergencyPhone = (value) =>
  String(value || "")
    .replace(/\D/g, "")
    .slice(-10);

const serializeEmergencyContact = (contact = {}) => ({
  id: String(contact._id || contact.id || ""),
  name: String(contact.name || "").trim(),
  phone: sanitizeEmergencyPhone(contact.phone),
  source:
    String(contact.source || "manual").toLowerCase() === "device"
      ? "device"
      : "manual",
});

const resolveVehicleMapIcon = async (vehicleTypeId) => {
  if (!vehicleTypeId) {
    return "";
  }

  const vehicle = await Vehicle.findById(vehicleTypeId).select("icon map_icon image").lean();
  return vehicle?.map_icon || vehicle?.icon || vehicle?.image || "";
};

const normalizePhone = (value) =>
  String(value || "")
    .replace(/\D/g, "")
    .trim();

const isOwnerApproved = (owner) =>
  Boolean(owner) &&
  owner.active !== false &&
  (owner.approve === true ||
    String(owner.status || "").toLowerCase() === "approved");

const resolveOwnerForFleet = async (requester = {}) => {
  const onboardingRole = String(
    requester?.onboarding?.role || "",
  ).toLowerCase();
  const convertedOwnerId = requester?.onboarding?.convertedOwnerId || null;

  if (onboardingRole === "owner" && convertedOwnerId) {
    const owner = await Owner.findById(convertedOwnerId)
      .select("service_location_id active approve status")
      .lean();
    if (isOwnerApproved(owner)) return owner;
  }

  const mobile = String(requester?.phone || "").trim();
  const email = String(requester?.email || "")
    .trim()
    .toLowerCase();

  if (!mobile && !email) {
    return null;
  }

  const owner = await Owner.findOne({
    $or: [...(mobile ? [{ mobile }] : []), ...(email ? [{ email }] : [])],
  })
    .select("service_location_id active approve status")
    .lean();

  return isOwnerApproved(owner) ? owner : null;
};

// A fleet owner uploads their hired driver's ID documents on the driver's behalf.
// Stored through the same uploader the driver's own onboarding uses, so the
// resulting `documents` map has one shape regardless of who filed it.
const uploadOwnerFleetDriverDocuments = async (documents = {}) => {
  const uploaded = {};

  for (const [documentKey, value] of Object.entries(documents || {})) {
    if (!value) {
      continue;
    }

    const storedDocument = await uploadRegistrationDocument(documentKey, value);

    if (storedDocument) {
      uploaded[documentKey] = storedDocument;
    }
  }

  return uploaded;
};

const resolveAuthenticatedOwner = async (req) => {
  if (String(req.auth?.role || "").toLowerCase() === "owner") {
    const owner = await Owner.findById(req.auth?.sub)
      .select("name company_name owner_name mobile phone email city transport_type service_location_id active approve status wallet")
      .lean();
    return isOwnerApproved(owner) ? owner : null;
  }

  const requester = await Driver.findById(req.auth?.sub)
    .select("onboarding phone email service_location_id")
    .lean();

  if (!requester) {
    return null;
  }

  return resolveOwnerForFleet(requester);
};

const serializeOwnerProfile = (owner = {}) => ({
  id: owner._id,
  name: owner.owner_name || owner.name || owner.company_name || "Owner",
  phone: owner.mobile || owner.phone || "",
  email: owner.email || "",
  profileImage: "",
  gender: "",
  vehicleType: owner.transport_type || "taxi",
  vehicleTypeId: null,
  vehicleIconType: owner.transport_type || "taxi",
  vehicleIconUrl: "",
  vehicleMake: owner.company_name || "",
  vehicleModel: "",
  registerFor: owner.transport_type || "taxi",
  vehicleNumber: "",
  vehicleColor: "",
  vehicleImage: "",
  city: owner.city || "",
  approve: owner.approve,
  status: owner.status || "approved",
  rating: 0,
  wallet: {
    balance: Number(owner.wallet?.balance || 0),
    currency: "INR",
  },
  referralCode: "",
  deletionRequest: owner.deletionRequest || { status: "none" },
  isOnline: false,
  isOnRide: false,
  onlineSelfie: {},
  location: null,
  zoneId: null,
  documents: {},
  emergencyContacts: [],
  onboarding: {
    role: "owner",
    convertedOwnerId: String(owner._id || ""),
  },
});

const normalizeOwnerFleetVehicleKind = (vehicleType = {}) => {
  const rawValue = String(
    vehicleType?.icon_types || vehicleType?.vehicle_type || vehicleType?.name || "",
  )
    .trim()
    .toLowerCase();

  if (rawValue.includes("bike")) return "bike";
  if (rawValue.includes("auto")) return "auto";
  return "car";
};

const serializeDriverZone = (zone = null) =>
  zone
    ? {
        id: String(zone._id || zone.id || ""),
        _id: String(zone._id || zone.id || ""),
        name: String(zone.name || "").trim(),
      }
    : null;

const serializeOwnerFleetAssignedVehicle = (vehicle = null) =>
  vehicle
    ? {
        id: String(vehicle._id || vehicle.id || ""),
        _id: String(vehicle._id || vehicle.id || ""),
        vehicleTypeId: String(
          vehicle.vehicle_type_id?._id || vehicle.vehicle_type_id || "",
        ).trim(),
        vehicleTypeName: String(
          vehicle.vehicle_type_id?.name ||
            vehicle.vehicle_type_id?.type_name ||
            "",
        ).trim(),
        vehicleIconType: String(
          vehicle.vehicle_type_id?.icon_types ||
            vehicle.transport_type ||
            "car",
        ).trim(),
        vehicleMake: String(vehicle.car_brand || "").trim(),
        vehicleModel: String(vehicle.car_model || "").trim(),
        vehicleNumber: String(vehicle.license_plate_number || "").trim(),
        vehicleColor: String(vehicle.car_color || "").trim(),
        transportType: String(vehicle.transport_type || "taxi").trim(),
        status: String(vehicle.status || "pending").trim(),
      }
    : null;

// `uploadRegistrationDocument` doesn't stamp a review-status baseline on a
// freshly uploaded document (only re-normalizing an already-stored one does),
// so a just-uploaded fleet-driver document has no `status` field yet here —
// default it to 'pending', which is true of every document until admin acts.
const serializeOwnerFleetDriverDocuments = (documents = {}) => {
  const result = {};
  for (const [key, value] of Object.entries(documents || {})) {
    if (!value) continue;
    result[key] = {
      uploaded: Boolean(value.uploaded ?? true),
      status: value.status || value.reviewStatus || value.verificationStatus || "pending",
      previewUrl: value.previewUrl || value.secureUrl || "",
    };
  }
  return result;
};

const serializeOwnerFleetDriver = (driver = {}, assignedVehicle = null) => ({
  id: String(driver._id),
  name: driver.name || "",
  phone: driver.phone || "",
  approve: driver.approve,
  status: driver.status,
  isOnline: Boolean(driver.isOnline),
  isOnRide: Boolean(driver.isOnRide),
  assignedFleetVehicleId: driver.assignedFleetVehicleId
    ? String(driver.assignedFleetVehicleId)
    : null,
  assignedVehicle: serializeOwnerFleetAssignedVehicle(assignedVehicle),
  documents: serializeOwnerFleetDriverDocuments(driver.documents),
  createdAt: driver.createdAt,
});

const serializeOwnerFleetAssignedDriver = (driver = null) =>
  driver
    ? {
        id: String(driver._id || driver.id || ""),
        _id: String(driver._id || driver.id || ""),
        name: String(driver.name || "").trim(),
        phone: String(driver.phone || "").trim(),
        vehicleNumber: String(driver.vehicleNumber || "").trim(),
        isOnRide: Boolean(driver.isOnRide),
        zone: serializeDriverZone(driver.zoneId),
      }
    : null;

const listAvailableOwnerFleetZones = async (owner = {}) => {
  const query = {
    active: true,
    status: "active",
  };

  if (owner?.service_location_id && mongoose.isValidObjectId(owner.service_location_id)) {
    query.service_location_id = owner.service_location_id;
  }

  let zones = await Zone.find(query)
    .select("name service_location_id active status")
    .sort({ name: 1, createdAt: -1 })
    .lean();

  if (zones.length === 0) {
    zones = await Zone.find({
      active: true,
      status: "active",
    })
      .select("name service_location_id active status")
      .sort({ name: 1, createdAt: -1 })
      .lean();
  }

  return zones;
};

const resolveOwnerFleetVehicleAssignment = async ({
  owner,
  driverId = null,
  assignedFleetVehicleId,
}) => {
  const normalizedVehicleId = String(assignedFleetVehicleId || "").trim();

  if (!normalizedVehicleId) {
    return null;
  }

  if (!mongoose.isValidObjectId(normalizedVehicleId)) {
    throw new ApiError(400, "A valid fleet vehicle is required");
  }

  const vehicle = await FleetVehicle.findOne({
    _id: normalizedVehicleId,
    owner_id: owner._id,
    active: true,
  })
    .populate("vehicle_type_id", "name type_name transport_type icon_types")
    .lean();

  if (!vehicle) {
    throw new ApiError(404, "Assigned fleet vehicle not found");
  }

  const existingDriver = await Driver.findOne({
    owner_id: owner._id,
    assignedFleetVehicleId: vehicle._id,
    deletedAt: null,
    ...(driverId ? { _id: { $ne: driverId } } : {}),
  })
    .select("name phone")
    .lean();

  if (existingDriver) {
    throw new ApiError(
      409,
      `Vehicle is already assigned to ${existingDriver.name || existingDriver.phone || "another driver"}`,
    );
  }

  return vehicle;
};

const serializeDriverNotification = (item = {}, readAt = null) => ({
  id: String(item._id || ""),
  isRead: Boolean(readAt),
  readAt: readAt || null,
  title: String(item.push_title || "").trim(),
  body: String(item.message || "").trim(),
  image: String(item.image || "").trim(),
  sendTo: String(item.send_to || "all").trim(),
  serviceLocationName: String(item.service_location_name || "").trim(),
  sentAt: item.sent_at || item.createdAt || null,
  createdAt: item.createdAt || null,
});

const serializeDriverScheduledRide = (ride = {}, currentDriverId = "", { assignedBy = null } = {}) => ({
  rideId: String(ride._id || ""),
  origin: ride.origin || "customer_app",
  assigned_by: ride.assignment?.mode === "direct_assign" ? assignedBy || null : null,
  type: ride.serviceType || "ride",
  serviceType: ride.serviceType || "ride",
  status: ride.status || RIDE_STATUS.SEARCHING,
  liveStatus: ride.liveStatus || RIDE_LIVE_STATUS.SEARCHING,
  fare: Number(ride.fare || 0),
  baseFare: Number(ride.baseFare || ride.fare || 0),
  bookingMode: ride.bookingMode || "normal",
  estimatedDistanceMeters: Number(ride.estimatedDistanceMeters || 0),
  estimatedDurationMinutes: Number(ride.estimatedDurationMinutes || 0),
  paymentMethod: ride.paymentMethod || "cash",
  pickupLocation: ride.pickupLocation || null,
  pickupAddress: ride.pickupAddress || "",
  dropLocation: ride.dropLocation || null,
  dropAddress: ride.dropAddress || "",
  scheduledAt: ride.scheduledAt || null,
  roundTrip: ride.roundTrip?.isRoundTrip
    ? { isRoundTrip: true, legType: ride.roundTrip.legType, returnAt: ride.roundTrip.returnAt }
    : null,
  intercity: ride.intercity || null,
  driverId: ride.driverId ? String(ride.driverId) : null,
  isAssignedToCurrentDriver:
    Boolean(ride.driverId) && String(ride.driverId) === String(currentDriverId || ""),
  vehicleTypeId: ride.vehicleTypeId ? String(ride.vehicleTypeId) : null,
  vehicleTypeIds: Array.isArray(ride.dispatchVehicleTypeIds)
    ? ride.dispatchVehicleTypeIds.map((item) => String(item))
    : [],
  serviceLocationId: ride.service_location_id ? String(ride.service_location_id) : null,
  transportType: ride.transport_type || "taxi",
  user: ride.userId
    ? {
        id: String(ride.userId._id || ""),
        name: ride.userId.name || "Customer",
        phone: ride.userId.phone || "",
        countryCode: ride.userId.countryCode || "",
      }
    : null,
  createdAt: ride.createdAt || null,
  updatedAt: ride.updatedAt || null,
});

export const registerDriver = async (req, res) => {
  throw new ApiError(410, "Legacy driver register endpoint is disabled. Use the OTP onboarding flow.");

  const { name, phone, password, vehicleType, location } = req.body;

  if (!name || !phone || !password || !vehicleType || !location) {
    throw new ApiError(
      400,
      "name, phone, password, vehicleType and location are required",
    );
  }

  const existingDriver = await Driver.findOne({ phone });

  if (existingDriver) {
    throw new ApiError(409, "Phone number is already registered");
  }

  const coordinates = normalizePoint(location, "location");
  const zone = await findZoneByPickup(coordinates);

  const driver = await Driver.create({
    name,
    phone,
    password: await hashPassword(password),
    vehicleType,
    approve: true,
    status: "approved",
    zoneId: zone?._id || null,
    location: toPoint(coordinates, "location"),
  });

  const token = signAccessToken({ sub: String(driver._id), role: "driver" });

  res.status(201).json({
    success: true,
    data: {
      token,
      driver: {
        id: driver._id,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        rating: driver.rating,
        status: driver.status,
      },
    },
  });
};

export const loginDriver = async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    throw new ApiError(400, "phone and password are required");
  }

  const driver = await Driver.findOne({ phone }).select("+password");

  if (!driver || !(await comparePassword(password, driver.password))) {
    throw new ApiError(401, "Invalid phone or password");
  }

  if (
    driver.approve === false ||
    String(driver.status || "").toLowerCase() === "pending"
  ) {
    throw new ApiError(403, "Driver account is pending approval");
  }

  await clearDriverActiveRideIfStale(driver);

  const token = signAccessToken({ sub: String(driver._id), role: "driver" });

  res.json({
    success: true,
    data: {
      token,
      driver: {
        id: driver._id,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        isOnline: driver.isOnline,
        isOnRide: driver.isOnRide,
        status: driver.status,
      },
    },
  });
};

export const goOnline = async (req, res) => {
  const { location, selfieImageUrl } = req.body;

  const coordinates = normalizePoint(location, "location");
  const existingDriver = await Driver.findById(req.auth.sub);

  if (!existingDriver) {
    throw new ApiError(404, "Driver not found");
  }

  const resolvedLiveZone =
    existingDriver.owner_id && existingDriver.zoneId
      ? { _id: existingDriver.zoneId }
      : await findZoneByPickup(coordinates);

  const todayKey = new Date().toISOString().slice(0, 10);
  const hasTodaySelfie =
    String(existingDriver.onlineSelfie?.forDate || "") === todayKey &&
    String(existingDriver.onlineSelfie?.imageUrl || "").trim();

  const businessSettingDoc = await AdminBusinessSetting.findOne({ scope: "default" }).lean();
  const requireDailySelfie = ["1", "true", "yes", "on"].includes(
    String(businessSettingDoc?.customization?.enable_daily_driver_selfie ?? "0").trim().toLowerCase()
  );

  if (requireDailySelfie && !hasTodaySelfie && !String(selfieImageUrl || "").trim()) {
    throw new ApiError(
      400,
      "A selfie is required before going online today",
      null,
      "SELFIE_REQUIRED",
    );
  }

  await ensureDriverWalletCanAcceptRide(existingDriver);
  await clearDriverActiveRideIfStale(existingDriver);
  const trackingBeforeOnline = mergeOnlineSessionIntoTracking(
    existingDriver.incentiveTracking || {},
    existingDriver.incentiveTracking?.currentOnlineStartedAt,
    new Date(),
  );
  const nextTodaySummary = buildDriverTodaySummaryFromDocument(existingDriver);

  // Uploaded only now, after every check above that can refuse going online,
  // so a refused request never leaves an orphaned selfie behind.
  const hostedSelfieUrl = await resolveHostedImageUrl(selfieImageUrl, {
    folder: `${env.cloudinary.folder}/driver-selfies`,
    publicIdPrefix: `selfie-${String(existingDriver._id)}`,
    label: "Selfie",
  });

  const nextOnlineSelfie =
    hasTodaySelfie && !hostedSelfieUrl
      ? existingDriver.onlineSelfie
      : {
          imageUrl: hostedSelfieUrl,
          capturedAt: new Date(),
          uploadedAt: new Date(),
          forDate: todayKey,
        };

  const driver = await Driver.findByIdAndUpdate(
    req.auth.sub,
    {
      isOnline: true,
      zoneId: resolvedLiveZone?._id || null,
      location: toPoint(coordinates, "location"),
      locationUpdatedAt: new Date(),
      onlineSelfie: nextOnlineSelfie,
      incentiveTracking: {
        ...trackingBeforeOnline,
        currentOnlineStartedAt: new Date(),
        claimedRewards: pruneClaimedRewards(trackingBeforeOnline?.claimedRewards),
      },
      todaySummary: nextTodaySummary,
    },
    { returnDocument: 'after' },
  );

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const vehicleIconUrl = await resolveVehicleMapIcon(driver.vehicleTypeId);

  res.json({
    success: true,
    data: {
      ...driver.toObject(),
      vehicleIconUrl,
      onlineSelfie: driver.onlineSelfie || {},
    },
  });

  notifyLateAvailableDriver(driver._id).catch((error) => {
    console.error("Failed to notify late-available driver on goOnline", error);
  });
};

export const getCurrentDriver = async (req, res) => {
  if (String(req.auth?.role || "").toLowerCase() === "owner") {
    const owner = await Owner.findById(req.auth.sub);

    if (!owner) {
      throw new ApiError(404, "Owner not found");
    }

    res.json({
      success: true,
      data: serializeOwnerProfile(owner.toObject()),
    });
    return;
  }

  if (String(req.auth?.role || "").toLowerCase() === "pooling_driver") {
    const poolingVehicle = await PoolingVehicle.findById(req.auth.sub);

    if (!poolingVehicle) {
      throw new ApiError(404, "Pooling driver not found");
    }

    res.json({
      success: true,
      data: {
        id: poolingVehicle._id,
        name: poolingVehicle.driverName || "Pooling Driver",
        phone: poolingVehicle.driverPhone || "",
        approve: poolingVehicle.approve !== false,
        status: poolingVehicle.status || "active",
        vehicleMake: poolingVehicle.name || "",
        vehicleModel: poolingVehicle.vehicleModel || "",
        vehicleNumber: poolingVehicle.vehicleNumber || "",
        vehicleColor: poolingVehicle.color || "",
        vehicleImage: poolingVehicle.images?.[0] || "",
        poolingVehicle: {
          id: poolingVehicle._id,
          name: poolingVehicle.name || "",
          vehicleModel: poolingVehicle.vehicleModel || "",
          vehicleNumber: poolingVehicle.vehicleNumber || "",
          vehicleType: poolingVehicle.vehicleType || "sedan",
          color: poolingVehicle.color || "",
          capacity: poolingVehicle.capacity || 0,
          images: poolingVehicle.images || [],
        },
      },
    });
    return;
  }

  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  res.json({
    success: true,
    data: await buildCurrentDriverProfile(driver),
  });
};

// The one definition of the driver profile payload — `GET /me` and
// `PATCH /me` both return it, so the app can use either response to refresh
// its profile state without a follow-up fetch and the two can never drift.
const buildCurrentDriverProfile = async (driver) => {
  if (!String(driver.referralCode || "").trim()) {
    driver.referralCode = generateDriverReferralCode(driver);
    await driver.save();
  }

  await clearDriverActiveRideIfStale(driver);
  await driver.populate("zoneId", "name");
  const vehicleIconUrl = await resolveVehicleMapIcon(driver.vehicleTypeId);
  const todaySummary = await syncDriverTodaySummaryDocument(driver);
  // Lifetime count of trips this driver actually drove to completion.
  const totalRides = await Ride.countDocuments({ driverId: driver._id, status: RIDE_STATUS.COMPLETED });

  return {
    id: driver._id,
    name: driver.name,
    phone: driver.phone,
    email: driver.email,
    owner_id: driver.owner_id || null,
    salary: Number(driver.salary || 0),
    profileImage: driver.profileImage || "",
    bannerImage: driver.bannerImage || "",
    gender: driver.gender,
    total_rides: totalRides,
    vehicleType: driver.vehicleType,
    vehicleTypeId: driver.vehicleTypeId,
    vehicleIconType: driver.vehicleIconType,
    vehicleIconUrl,
    vehicleMake: driver.vehicleMake,
    vehicleModel: driver.vehicleModel,
    registerFor: driver.registerFor,
    vehicleNumber: driver.vehicleNumber,
    vehicleColor: driver.vehicleColor,
    vehicleImage: driver.vehicleImage || "",
    city: driver.city,
    approve: driver.approve,
    status: driver.status,
    rating: driver.rating,
    wallet: await serializeDriverWallet(driver),
    bankDetails: serializeDriverBankDetails(driver.bankDetails),
    referralCode: driver.referralCode || "",
    deletionRequest: driver.deletionRequest || { status: "none" },
    isOnline: driver.isOnline,
    isOnRide: driver.isOnRide,
    onlineSelfie: driver.onlineSelfie || {},
    location: driver.location,
    zoneId: driver.zoneId?._id || driver.zoneId || null,
    zone: serializeDriverZone(driver.zoneId),
    assignedFleetVehicleId: driver.assignedFleetVehicleId
      ? String(driver.assignedFleetVehicleId)
      : null,
    routeBooking: serializeDriverRouteBooking(driver.routeBooking),
    documents: driver.documents || {},
    emergencyContacts: Array.isArray(driver.emergencyContacts)
      ? driver.emergencyContacts.map(serializeEmergencyContact)
      : [],
    onboarding: driver.onboarding || {},
    todaySummary: todaySummary || buildDriverTodaySummaryFromDocument(driver),
    // Read-only account info for the Edit Profile screen — PATCH /me must
    // never accept these back (see updateCurrentDriver).
    account_type: driver.account_type || "individual",
    driver_category: driver.driver_category || "lower",
    createdAt: driver.createdAt,
  };
};

export const getDriverEmergencyContacts = async (req, res) => {
  const isOwner = String(req.auth?.role || "").toLowerCase() === "owner";
  const account = isOwner
    ? await Owner.findById(req.auth.sub).lean()
    : await Driver.findById(req.auth.sub).lean();

  if (!account) {
    throw new ApiError(404, isOwner ? "Owner not found" : "Driver not found");
  }

  res.json({
    success: true,
    data: {
      results: Array.isArray(account.emergencyContacts)
        ? account.emergencyContacts.map(serializeEmergencyContact)
        : [],
      limit: MAX_EMERGENCY_CONTACTS,
    },
  });
};

const DRIVER_NOTIFICATION_LIMIT = 100;

// Read state is kept per account (see NotificationRead), and drivers and
// owners share this inbox, so both the account and its role are needed.
const resolveNotificationAccount = async (req) => {
  const isOwner = String(req.auth?.role || "").toLowerCase() === "owner";
  const account = isOwner
    ? await Owner.findById(req.auth.sub).select("_id service_location_id").lean()
    : await Driver.findById(req.auth.sub).select("_id service_location_id").lean();

  if (!account) {
    throw new ApiError(404, isOwner ? "Owner not found" : "Driver not found");
  }

  return { account, accountRole: isOwner ? "owner" : "driver" };
};

const buildDriverNotificationQuery = (account) => {
  const serviceLocationId = account.service_location_id || null;
  const query = {
    status: "sent",
    send_to: { $in: ["all", "drivers"] },
  };

  if (serviceLocationId) {
    query.$or = [
      { service_location_id: serviceLocationId },
      { send_to: "all" },
      { send_to: "drivers" },
    ];
  }

  return query;
};

const listVisibleDriverNotifications = (account) =>
  Notification.find(buildDriverNotificationQuery(account))
    .sort({ sent_at: -1, createdAt: -1 })
    .limit(DRIVER_NOTIFICATION_LIMIT)
    .lean();

export const getDriverNotifications = async (req, res) => {
  const { account, accountRole } = await resolveNotificationAccount(req);
  const notifications = await listVisibleDriverNotifications(account);

  const reads = notifications.length
    ? await NotificationRead.find({
      account_role: accountRole,
      account_id: account._id,
      notification_id: { $in: notifications.map((item) => item._id) },
    })
      .select("notification_id read_at")
      .lean()
    : [];
  const readAtById = new Map(reads.map((row) => [String(row.notification_id), row.read_at]));

  res.json({
    success: true,
    data: {
      results: notifications.map((item) =>
        serializeDriverNotification(item, readAtById.get(String(item._id)) || null),
      ),
    },
  });
};

export const markDriverNotificationRead = async (req, res) => {
  const notificationId = String(req.params.id || "").trim();

  if (!mongoose.isValidObjectId(notificationId)) {
    throw new ApiError(404, "Notification not found", null, "NOTIFICATION_NOT_FOUND");
  }

  const { account, accountRole } = await resolveNotificationAccount(req);
  const notification = await Notification.findOne({
    ...buildDriverNotificationQuery(account),
    _id: notificationId,
  })
    .select("_id")
    .lean();

  if (!notification) {
    throw new ApiError(404, "Notification not found", null, "NOTIFICATION_NOT_FOUND");
  }

  // Marking an already-read notification keeps its original read time.
  const read = await NotificationRead.findOneAndUpdate(
    { account_role: accountRole, account_id: account._id, notification_id: notification._id },
    { $setOnInsert: { read_at: new Date() } },
    { upsert: true, returnDocument: "after" },
  ).lean();

  res.json({
    success: true,
    data: { id: String(notification._id), readAt: read.read_at },
  });
};

export const markAllDriverNotificationsRead = async (req, res) => {
  const { account, accountRole } = await resolveNotificationAccount(req);
  const notifications = await listVisibleDriverNotifications(account);

  if (!notifications.length) {
    res.json({ success: true, data: { updated: 0 } });
    return;
  }

  const notificationIds = notifications.map((item) => item._id);
  const alreadyRead = await NotificationRead.find({
    account_role: accountRole,
    account_id: account._id,
    notification_id: { $in: notificationIds },
  })
    .select("notification_id")
    .lean();
  const readIds = new Set(alreadyRead.map((row) => String(row.notification_id)));
  const unreadIds = notificationIds.filter((id) => !readIds.has(String(id)));

  if (unreadIds.length) {
    const now = new Date();
    await NotificationRead.bulkWrite(
      unreadIds.map((notificationId) => ({
        updateOne: {
          filter: { account_role: accountRole, account_id: account._id, notification_id: notificationId },
          update: { $setOnInsert: { read_at: now } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  res.json({ success: true, data: { updated: unreadIds.length } });
};

export const getDriverScheduledRides = async (req, res) => {
  const driver = await Driver.findById(req.auth.sub)
    .select("service_location_id vehicleTypeId")
    .lean();

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const safePage = Math.max(1, Number(req.query?.page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(req.query?.limit) || 20));
  const openScheduledRideQuery = {
    driverId: null,
    status: RIDE_STATUS.SEARCHING,
    liveStatus: RIDE_LIVE_STATUS.SEARCHING,
    ...(driver.service_location_id ? { service_location_id: driver.service_location_id } : {}),
  };

  if (driver.vehicleTypeId) {
    openScheduledRideQuery.$or = [
      { vehicleTypeId: driver.vehicleTypeId },
      { dispatchVehicleTypeIds: driver.vehicleTypeId },
    ];
  }

  const query = {
    scheduledAt: { $ne: null, $gte: new Date() },
    $or: [
      openScheduledRideQuery,
      {
        driverId: req.auth.sub,
        status: { $in: [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED] },
        liveStatus: {
          $in: [
            RIDE_LIVE_STATUS.SEARCHING,
            RIDE_LIVE_STATUS.ACCEPTED,
            RIDE_LIVE_STATUS.ARRIVING,
          ],
        },
      },
    ],
  };

  const [rides, totalCount] = await Promise.all([
    Ride.find(query)
      .sort({ scheduledAt: 1, createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .select([
        "serviceType",
        "status",
        "liveStatus",
        "fare",
        "baseFare",
        "bookingMode",
        "estimatedDistanceMeters",
        "estimatedDurationMinutes",
        "paymentMethod",
        "pickupLocation",
        "pickupAddress",
        "dropLocation",
        "dropAddress",
        "scheduledAt",
        "roundTrip",
        "driverId",
        "intercity",
        "vehicleTypeId",
        "dispatchVehicleTypeIds",
        "service_location_id",
        "transport_type",
        "userId",
        "origin",
        "created_by_driver_id",
        "organization_owner_id",
        "assignment",
        "createdAt",
        "updatedAt",
      ].join(" "))
      .populate("userId", "name phone countryCode")
      .lean(),
    Ride.countDocuments(query),
  ]);

  const assignerIds = rides
    .map((ride) => ride.assignment?.assigned_by_driver_id || ride.created_by_driver_id)
    .filter(Boolean);
  const creatorIds = rides.map((ride) => ride.created_by_driver_id).filter(Boolean);
  const ownerIds = rides.map((ride) => ride.organization_owner_id).filter(Boolean);
  const identityDriverIds = [...new Set([...assignerIds, ...creatorIds].map(String))];

  const [identityDrivers, owners] = await Promise.all([
    identityDriverIds.length
      ? Driver.find({ _id: { $in: identityDriverIds } }).select("name phone").lean()
      : [],
    ownerIds.length
      ? Owner.find({ _id: { $in: ownerIds } }).select("company_name owner_name name").lean()
      : [],
  ]);
  const identityDriverMap = new Map(identityDrivers.map((driver) => [String(driver._id), driver]));
  const ownerMap = new Map(owners.map((owner) => [String(owner._id), owner]));

  res.json({
    success: true,
    data: {
      results: rides.map((ride) => {
        const assignerId = ride.assignment?.assigned_by_driver_id || ride.created_by_driver_id || null;
        const assignedBy = buildAssignedByPayload({
          assignerId,
          assignerDriver: assignerId ? identityDriverMap.get(String(assignerId)) : null,
          organization: ride.organization_owner_id ? ownerMap.get(String(ride.organization_owner_id)) : null,
          creatorDriver: ride.created_by_driver_id ? identityDriverMap.get(String(ride.created_by_driver_id)) : null,
        });

        return serializeDriverScheduledRide(ride, req.auth.sub, { assignedBy });
      }),
      totalCount,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
        hasNextPage: safePage * safeLimit < totalCount,
        hasPrevPage: safePage > 1,
      },
    },
  });
};

const REFERRAL_ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const REFERRAL_LIST_LIMIT = 200;

/**
 * Drivers this driver referred, with how much the referrals have produced.
 * "Active" = approved and seen on the platform in the last 30 days (currently
 * online, reported a position, or finished a ride).
 */
export const getDriverReferrals = async (req, res) => {
  const driverId = String(req.auth.sub);

  const referred = await Driver.find({ referredBy: driverId, deletedAt: null })
    .select("name createdAt approve status isOnline locationUpdatedAt")
    .sort({ createdAt: -1 })
    .lean();
  const referredIds = referred.map((item) => item._id);

  const [rideRows, earnedRows] = await Promise.all([
    referredIds.length
      ? Ride.aggregate([
          { $match: { driverId: { $in: referredIds }, status: RIDE_STATUS.COMPLETED } },
          {
            $group: {
              _id: "$driverId",
              count: { $sum: 1 },
              lastRideAt: { $max: { $ifNull: ["$completedAt", "$createdAt"] } },
            },
          },
        ])
      : [],
    // Only the referrer-side credits: a driver who was themselves referred may
    // also hold a "new-driver" welcome credit, which is not something they earned
    // by referring anyone.
    WalletTransaction.aggregate([
      {
        $match: {
          driverId: new mongoose.Types.ObjectId(driverId),
          amount: { $gt: 0 },
          "metadata.source": "driver_referral",
          "metadata.referenceKey": { $regex: ":referrer$" },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  const ridesByDriver = new Map(rideRows.map((row) => [String(row._id), row]));
  const activeSince = Date.now() - REFERRAL_ACTIVE_WINDOW_MS;
  const isRecent = (value) => value && new Date(value).getTime() >= activeSince;

  const results = referred.slice(0, REFERRAL_LIST_LIMIT).map((item) => {
    const rides = ridesByDriver.get(String(item._id));
    const approved =
      item.approve === true &&
      !["inactive", "rejected", "pending"].includes(String(item.status || "").toLowerCase());

    return {
      name: item.name || "Driver",
      joined_at: item.createdAt,
      active:
        approved &&
        Boolean(item.isOnline || isRecent(item.locationUpdatedAt) || isRecent(rides?.lastRideAt)),
      rides_completed: rides?.count || 0,
    };
  });

  res.json({
    success: true,
    data: {
      stats: {
        total_referrals: referred.length,
        rides_completed: rideRows.reduce((sum, row) => sum + row.count, 0),
        total_earned: earnedRows[0]?.total || 0,
      },
      results,
    },
  });
};

// "Rahul Sharma" -> "Rahul S." — riders never see their name published in full
// to a stranger.
const maskRiderName = (name = "") => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Rider";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};

const DRIVER_RATINGS_RECENT_LIMIT = 20;

/** What riders have said about this driver: star distribution + latest reviews. */
export const getDriverRatings = async (req, res) => {
  const driverId = new mongoose.Types.ObjectId(String(req.auth.sub));
  const reviewed = {
    driverId,
    "feedback.submittedAt": { $ne: null },
    "feedback.rating": { $gte: 1 },
  };

  const [distributionRows, recent] = await Promise.all([
    Ride.aggregate([
      { $match: reviewed },
      { $group: { _id: "$feedback.rating", count: { $sum: 1 } } },
    ]),
    Ride.find(reviewed)
      .sort({ "feedback.submittedAt": -1 })
      .limit(DRIVER_RATINGS_RECENT_LIMIT)
      .select("feedback serviceType userId")
      .populate("userId", "name")
      .lean(),
  ]);

  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const row of distributionRows) {
    const stars = Math.round(Number(row._id));
    if (distribution[stars] !== undefined) {
      distribution[stars] += row.count;
    }
  }

  res.json({
    success: true,
    data: {
      total: Object.values(distribution).reduce((sum, count) => sum + count, 0),
      distribution,
      results: recent.map((ride) => ({
        rider_name: maskRiderName(ride.userId?.name),
        rating: ride.feedback.rating,
        comment: ride.feedback.comment || "",
        createdAt: ride.feedback.submittedAt,
        service_type: ride.serviceType || "ride",
      })),
    },
  });
};

export const cancelDriverScheduledRide = async (req, res) => {
  const rideId = toCleanString(req.params?.rideId);

  if (!rideId) {
    throw new ApiError(400, "Ride id is required");
  }

  const ride = await cancelScheduledRideByDriver({
    rideId,
    driverId: req.auth.sub,
  });

  if (!ride) {
    throw new ApiError(404, "Scheduled ride not found for this driver");
  }

  res.json({
    success: true,
    message: "Scheduled ride cancelled successfully",
    data: {
      rideId: String(ride._id || ""),
      status: ride.status || RIDE_STATUS.CANCELLED,
      liveStatus: ride.liveStatus || RIDE_LIVE_STATUS.CANCELLED,
    },
  });
};

const DRIVER_PUSH_ROLE_MODEL_MAP = {
  driver: Driver,
  owner: Owner,
};

const resolvePushTokenEntityForRole = async (req) => {
  const role = String(req.auth?.role || "").toLowerCase();
  const Model = DRIVER_PUSH_ROLE_MODEL_MAP[role];

  if (!Model) {
    throw new ApiError(403, "Unsupported role for driver push notifications");
  }

  const entity = await Model.findById(req.auth?.sub);

  if (!entity) {
    throw new ApiError(404, "Authenticated account not found");
  }

  if (
    role === "driver" &&
    (entity.approve === false ||
      String(entity.status || "").toLowerCase() === "pending")
  ) {
    throw new ApiError(403, "Driver account is pending approval");
  }

  if (
    role === "owner" &&
    (entity.active === false ||
      entity.approve === false ||
      String(entity.status || "").toLowerCase() === "pending")
  ) {
    throw new ApiError(403, "Owner account is pending approval");
  }

  return entity;
};

export const saveDriverFcmToken = async (req, res) => {
  const entity = await resolvePushTokenEntityForRole(req);

  const saved = assignPushTokenToEntity(entity, {
    token: req.body?.token,
    platform: req.body?.platform,
  });

  await entity.save();

  res.json({
    success: true,
    data: {
      message: "FCM token saved successfully",
      platform: saved.platform,
      field: saved.fieldName,
      role: String(req.auth?.role || "").toLowerCase(),
    },
  });
};

export const addDriverEmergencyContact = async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const phone = sanitizeEmergencyPhone(req.body?.phone);
  const source =
    String(req.body?.source || "manual").toLowerCase() === "device"
      ? "device"
      : "manual";

  if (!name) {
    throw new ApiError(400, "Contact name is required");
  }

  if (!EMERGENCY_CONTACT_NAME_REGEX.test(name)) {
    throw new ApiError(400, "Contact name can contain alphabets only");
  }

  if (!/^\d{10}$/.test(phone)) {
    throw new ApiError(400, "A valid 10-digit contact number is required");
  }

  const isOwner = String(req.auth?.role || "").toLowerCase() === "owner";
  const account = isOwner
    ? await Owner.findById(req.auth.sub)
    : await Driver.findById(req.auth.sub);

  if (!account) {
    throw new ApiError(404, isOwner ? "Owner not found" : "Driver not found");
  }

  const existingContacts = Array.isArray(account.emergencyContacts)
    ? account.emergencyContacts
    : [];

  if (existingContacts.length >= MAX_EMERGENCY_CONTACTS) {
    throw new ApiError(
      400,
      `You can add up to ${MAX_EMERGENCY_CONTACTS} emergency contacts`,
    );
  }

  if (
    existingContacts.some(
      (contact) => sanitizeEmergencyPhone(contact.phone) === phone,
    )
  ) {
    throw new ApiError(409, "This contact number is already added");
  }

  account.emergencyContacts = [
    ...existingContacts,
    {
      name: name.slice(0, 80),
      phone,
      source,
    },
  ];

  await account.save();

  const addedContact =
    account.emergencyContacts[account.emergencyContacts.length - 1];

  res.status(201).json({
    success: true,
    data: serializeEmergencyContact(addedContact),
  });
};

export const deleteDriverEmergencyContact = async (req, res) => {
  const isOwner = String(req.auth?.role || "").toLowerCase() === "owner";
  const account = isOwner
    ? await Owner.findById(req.auth.sub)
    : await Driver.findById(req.auth.sub);

  if (!account) {
    throw new ApiError(404, isOwner ? "Owner not found" : "Driver not found");
  }

  const existingContacts = Array.isArray(account.emergencyContacts)
    ? account.emergencyContacts
    : [];
  const nextContacts = existingContacts.filter(
    (contact) => String(contact._id) !== String(req.params.contactId),
  );

  if (nextContacts.length === existingContacts.length) {
    throw new ApiError(404, "Emergency contact not found");
  }

  account.emergencyContacts = nextContacts;
  await account.save();

  res.json({
    success: true,
    data: {
      deleted: true,
      results: account.emergencyContacts.map(serializeEmergencyContact),
    },
  });
};

export const updateCurrentDriver = async (req, res) => {
  if (String(req.auth?.role || "").toLowerCase() === "owner") {
    throw new ApiError(403, "Owner profile editing is not available from this screen");
  }

  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "name")) {
    const name = String(req.body.name || "").trim();
    if (!DRIVER_NAME_REGEX.test(name)) {
      throw new ApiError(400, "Full name can contain alphabets only");
    }
    driver.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "email")) {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    if (email && !EMAIL_REGEX.test(email)) {
      throw new ApiError(400, "Enter a valid email address");
    }
    driver.email = email;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "gender")) {
    // Same three values registration offers; stored the way registration
    // stores them, so the profile and onboarding never disagree on casing.
    const gender = DRIVER_GENDERS.get(String(req.body.gender || "").trim().toLowerCase());
    if (!gender) {
      throw new ApiError(422, "Gender must be Male, Female or Other", { options: [...DRIVER_GENDERS.values()] }, "INVALID_GENDER");
    }
    driver.gender = gender;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "profileImage")) {
    // Stored as a URL, never as the base64 itself: a data URL is re-encoded and
    // hosted, an image this server already hosts is kept, '' clears it.
    // Anything else is refused. Storing raw base64 made every /drivers/me
    // response carry the whole photo, and a bad upload broke the app's decoder.
    const rawProfileImage = String(req.body.profileImage ?? "").trim();
    driver.profileImage = /^https?:\/\//i.test(rawProfileImage) && isOwnStorageUrl(rawProfileImage, req)
      ? rawProfileImage
      : await resolveDriverProfileImage(rawProfileImage, { current: driver.profileImage, req });
  }

  const bannerInput = req.body?.bannerImage !== undefined ? req.body.bannerImage : req.body?.banner_image;
  if (bannerInput !== undefined) {
    driver.bannerImage = await resolveDriverBanner(bannerInput, { current: driver.bannerImage, req });
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "routeBooking")) {
    const routeBookingPayload = req.body?.routeBooking || {};
    const enabled = Boolean(routeBookingPayload?.enabled);

    if (!enabled) {
      driver.routeBooking = {
        enabled: false,
        anchorLocation: null,
        label: "",
        updatedAt: new Date(),
      };
    } else {
      const coordinates = normalizePoint(
        routeBookingPayload?.coordinates || routeBookingPayload?.anchorLocation,
        "routeBooking.coordinates",
      );

      driver.routeBooking = {
        enabled: true,
        anchorLocation: toPoint(coordinates, "routeBooking.coordinates"),
        label: String(routeBookingPayload?.label || "").trim(),
        updatedAt: new Date(),
      };
    }
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "bankDetails")) {
    const bankPayload = req.body?.bankDetails || {};
    // Validated first (UPI/IFSC/account-number format) so a request that is
    // going to be refused never uploads the QR image.
    const nextBankDetails = normalizeDriverBankDetails(bankPayload, driver.bankDetails || {});

    if (Object.prototype.hasOwnProperty.call(bankPayload, "qrCodeImage")) {
      nextBankDetails.qrCodeImage = await resolveHostedImageUrl(nextBankDetails.qrCodeImage, {
        folder: `${env.cloudinary.folder}/driver-payout-qr`,
        publicIdPrefix: `payout-qr-${String(driver._id)}`,
        maxBytes: 2 * 1024 * 1024,
        label: "QR image",
      });
    }

    driver.bankDetails = nextBankDetails;
  }

  await driver.save();

  res.json({
    success: true,
    data: await buildCurrentDriverProfile(driver),
  });
};

export const requestDriverAccountDeletion = async (req, res) => {
  const driverId = req.auth?.sub;
  const reason = String(req.body?.reason || "").trim();

  if (!reason) {
    throw new ApiError(400, "Deletion reason is required");
  }

  const driver = await Driver.findById(driverId);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  if (
    driver.deletedAt ||
    driver.approve === false ||
    String(driver.status || "").toLowerCase() === "inactive"
  ) {
    throw new ApiError(400, "Account is already inactive");
  }

  if (driver.deletionRequest?.status === "pending") {
    res.json({
      success: true,
      data: {
        deletionRequestStatus: "pending",
        requestedAt: driver.deletionRequest.requestedAt || null,
      },
      message: "Deletion request is already pending admin review",
    });
    return;
  }

  driver.deletionRequest = {
    status: "pending",
    reason: reason.slice(0, 300),
    requestedAt: new Date(),
    reviewedAt: null,
    reviewedBy: null,
    adminNote: "",
  };

  await driver.save();

  res.status(201).json({
    success: true,
    data: {
      deletionRequestStatus: driver.deletionRequest.status,
      requestedAt: driver.deletionRequest.requestedAt,
    },
  });
};

const DOCUMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_IMAGE_DATA_URL = /^data:image\/(?:jpeg|jpg|png|webp);base64,/i;
// Matches the keys documents are stored under (template field keys).
const DOCUMENT_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// A URL is only accepted as-is when this server already hosts it (an image
// uploaded through the app's upload endpoint earlier): never an arbitrary
// link someone wants shown to the admin as a "document".
const isOwnStorageUrl = (value, req) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!parsed.pathname.startsWith("/images/") && !parsed.pathname.startsWith("/api/images/")) return false;

  const ownHosts = new Set([String(req.get("host") || "").toLowerCase()]);
  const configuredBase = String(process.env.STORAGE_BASE_URL || "").trim();
  if (configuredBase) {
    try {
      ownHosts.add(new URL(configuredBase).host.toLowerCase());
    } catch {
      // A malformed STORAGE_BASE_URL just doesn't add a host.
    }
  }
  return ownHosts.has(parsed.host.toLowerCase());
};

/**
 * PATCH /drivers/documents/:documentKey
 *
 * Body: `{ document: { dataUrl, fileName?, identifyNumber?, expiryDate? } }`.
 * `dataUrl` is a JPEG, PNG or WebP data URL of at most 5 MB; the server
 * re-encodes and hosts it. Instead of `dataUrl` the app may send `url` /
 * `previewUrl`, but only for an image this server already hosts. The document
 * always goes back to pending review.
 */
export const updateCurrentDriverDocument = async (req, res) => {
  const documentKey = String(req.params.documentKey || "").trim();
  const document = req.body?.document && typeof req.body.document === "object" ? req.body.document : {};

  if (!documentKey) {
    throw new ApiError(400, "Document key is required");
  }

  if (!DOCUMENT_KEY_PATTERN.test(documentKey)) {
    throw new ApiError(422, "Invalid document key", null, "INVALID_DOCUMENT_KEY");
  }

  const dataUrl = String(document.dataUrl || document.data_url || "").trim();
  const hostedUrl = String(document.previewUrl || document.secureUrl || document.url || "").trim();

  let previewUrl = "";
  if (dataUrl) {
    if (!DOCUMENT_IMAGE_DATA_URL.test(dataUrl)) {
      throw new ApiError(422, "Document must be a JPEG, PNG or WebP image sent as a data URL", null, "INVALID_DOCUMENT_IMAGE");
    }
    const decodedBytes = Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
    if (decodedBytes > DOCUMENT_IMAGE_MAX_BYTES) {
      throw new ApiError(400, "Document image must be 5 MB or smaller", { max_bytes: DOCUMENT_IMAGE_MAX_BYTES }, "IMAGE_TOO_LARGE");
    }
    try {
      previewUrl = (await mediaService.uploadMedia(dataUrl, "documents", "", req)).url;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // sharp throws on bytes that only claim to be an image.
      throw new ApiError(422, "Document image could not be read", null, "INVALID_DOCUMENT_IMAGE");
    }
  } else if (hostedUrl) {
    if (!isOwnStorageUrl(hostedUrl, req)) {
      throw new ApiError(422, "Send the document as a data URL", null, "INVALID_DOCUMENT_IMAGE");
    }
    previewUrl = hostedUrl;
  } else {
    throw new ApiError(400, "document.dataUrl is required", null, "FIELD_REQUIRED");
  }

  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const existingDocument = driver.documents?.[documentKey] || {};
  const existingStatus = String(
    existingDocument.status ||
    existingDocument.verificationStatus ||
    existingDocument.approvalStatus ||
    existingDocument.reviewStatus ||
    "",
  ).trim().toLowerCase();

  // Only these details come from the client; review state, URLs and anything
  // else are set here, never copied from the request.
  const fileName = String(document.fileName || documentKey).trim().slice(0, 120) || documentKey;
  const clientDetails = {};
  if (document.identifyNumber !== undefined || document.identify_number !== undefined) {
    clientDetails.identifyNumber = String(document.identifyNumber ?? document.identify_number ?? "").trim().slice(0, 64);
  }
  if (document.expiryDate !== undefined || document.expiry_date !== undefined) {
    const rawExpiry = String(document.expiryDate ?? document.expiry_date ?? "").trim();
    if (rawExpiry && Number.isNaN(new Date(rawExpiry).getTime())) {
      throw new ApiError(422, "expiryDate must be a valid date", null, "INVALID_DATE");
    }
    clientDetails.expiryDate = rawExpiry;
  }

  const updatedDocument = {
    ...(typeof existingDocument === "object" ? existingDocument : {}),
    ...clientDetails,
    key: documentKey,
    fileName,
    fileNames: [fileName],
    uploaded: true,
    uploadedAt: new Date().toISOString(),
    previewUrl,
    secureUrl: String(document.secureUrl || previewUrl).trim(),
    imageUrl: previewUrl,
    images: [previewUrl],
    status: "pending",
    verificationStatus: "pending",
    reviewStatus: "pending",
    comment: "",
    remarks: "",
    reason: "",
    admin_comment: "",
    rejection_reason: "",
    reviewedAt: null,
    reverificationRequestedAt: new Date().toISOString(),
  };

  driver.documents = {
    ...(driver.documents || {}),
    [documentKey]: updatedDocument,
  };

  driver.markModified("documents");
  await driver.save();

  res.json({
    success: true,
    data: {
      document: updatedDocument,
      documents: driver.documents || {},
    },
  });
};

export const deleteCurrentDriverAccount = async (req, res) => {
  const driverId = req.auth?.sub;
  const authRole = String(req.auth?.role || "").toLowerCase();
  const reason = String(req.body?.reason || "").trim();

  if (authRole === "owner") {
    const owner = await Owner.findById(driverId);

    if (!owner) {
      throw new ApiError(404, "Owner not found");
    }

    if (owner.deletedAt) {
      res.json({
        success: true,
        data: {
          deleted: true,
          softDeleted: true,
          ownerId: String(owner._id),
        },
        message: "Owner account already deleted",
      });
      return;
    }

    const deletionReason =
      reason ||
      owner.deletionRequest?.reason ||
      owner.deletion_reason ||
      "Deleted by account owner";
    const now = new Date();

    owner.deletedAt = now;
    owner.deletion_reason = deletionReason.slice(0, 300);
    owner.active = false;
    owner.approve = false;
    owner.status = "inactive";
    owner.deletionRequest = {
      ...(owner.deletionRequest || {}),
      status: "approved",
      reason: deletionReason.slice(0, 300),
      requestedAt: owner.deletionRequest?.requestedAt || now,
      reviewedAt: now,
      reviewedBy: null,
      adminNote: "",
    };

    await owner.save();

    await DriverLoginSession.deleteMany({
      $or: [{ driverId: owner._id }, { phone: owner.mobile }, { phone: owner.phone }],
    });

    res.json({
      success: true,
      data: {
        deleted: true,
        softDeleted: true,
        ownerId: String(owner._id),
      },
      message: "Owner account deleted successfully",
    });
    return;
  }

  const activeRide = await Ride.findOne({
    driverId,
    status: { $in: [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] },
  }).select("_id status");

  if (activeRide) {
    throw new ApiError(409, "Complete or cancel your active ride before deleting your account");
  }

  const driver = await Driver.findById(driverId);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  if (driver.deletedAt) {
    res.json({
      success: true,
      data: {
        deleted: true,
        softDeleted: true,
        driverId: String(driver._id),
      },
      message: "Driver account already deleted",
    });
    return;
  }

  const deletionReason = reason || driver.deletionRequest?.reason || driver.deletion_reason || "Deleted by account owner";
  const now = new Date();

  driver.deletedAt = now;
  driver.deletion_reason = deletionReason.slice(0, 300);
  driver.approve = false;
  driver.status = "inactive";
  driver.isOnline = false;
  driver.isOnRide = false;
  driver.socketId = null;
  driver.deletionRequest = {
    ...(driver.deletionRequest || {}),
    status: "approved",
    reason: deletionReason.slice(0, 300),
    requestedAt: driver.deletionRequest?.requestedAt || now,
    reviewedAt: now,
    reviewedBy: null,
    adminNote: "",
  };

  await driver.save();

  await DriverLoginSession.deleteMany({
    $or: [
      { driverId: driver._id },
      { phone: driver.phone },
    ],
  });

  res.json({
    success: true,
    data: {
      deleted: true,
      softDeleted: true,
      driverId: String(driver._id),
    },
    message: "Driver account deleted successfully",
  });
};

// `OwnerWalletTransaction` only stores a credit/debit `kind`, not a real
// transaction type, so this normalizes it into the same shape driver wallet
// transactions already have (type/description/balanceAfter/metadata) —
// used both by the wallet list endpoint and the top-up verify response, so
// they can't drift out of sync with each other again.
const normalizeOwnerWalletTransaction = (tx) => {
  if (!tx) return null;
  const source = String(tx.metadata?.source || "").toLowerCase();
  const isTopUp = tx.kind !== "debit" && source === "razorpay";
  return {
    _id: tx._id,
    amount: tx.kind === "debit" ? -Math.abs(tx.amount) : Math.abs(tx.amount),
    type: isTopUp ? "top_up" : "adjustment",
    description: tx.title || "",
    metadata: tx.metadata || {},
    createdAt: tx.createdAt,
    balanceAfter: tx.balance,
  };
};

export const getMyWallet = async (req, res) => {
  if (String(req.auth?.role || "").toLowerCase() === "owner") {
    const owner = await Owner.findById(req.auth.sub).lean();

    if (!owner) {
      throw new ApiError(404, "Owner not found");
    }

    const [ownerTransactions, withdrawalRequests] = await Promise.all([
      OwnerWalletTransaction.find({ ownerId: req.auth.sub })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      WithdrawalRequest.find({ owner_id: req.auth.sub })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const transactions = ownerTransactions.map(normalizeOwnerWalletTransaction);

    res.json({
      success: true,
      data: {
        wallet: {
          balance: Number(owner.wallet?.balance || 0),
          currency: "INR",
        },
        transactions,
        withdrawalRequests,
        settings: await getWalletSettings(),
      },
    });
    return;
  }

  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const transactions = await WalletTransaction.find({ driverId: req.auth.sub })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  const withdrawalRequests = await WithdrawalRequest.find({ driver_id: req.auth.sub })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  const walletSettings = await getWalletSettings();

  res.json({
    success: true,
    data: {
      wallet: await serializeDriverWallet(driver),
      transactions,
      withdrawalRequests,
      settings: walletSettings,
    },
  });
};

export const createDriverWithdrawalRequest = async (req, res) => {
  if (String(req.auth?.role || "").toLowerCase() === "owner") {
    const owner = await Owner.findById(req.auth.sub);

    if (!owner) {
      throw new ApiError(404, "Owner not found");
    }

    const walletSettings = await getWalletSettings();
    const isTransferEnabled = ["1", "true", "yes", "on"].includes(
      String(walletSettings.enable_wallet_transfer_driver ?? "1").trim().toLowerCase(),
    );
    const minimumTransferAmount = Number(walletSettings.minimum_wallet_amount_for_transfer || 0);
    const amount = Number(req.body?.amount);
    const paymentMethod = String(req.body?.payment_method || req.body?.paymentMethod || "bank_transfer").trim().toLowerCase() || "bank_transfer";
    const currentBalance = Number(owner.wallet?.balance || 0);

    if (!isTransferEnabled) {
      throw new ApiError(403, "Withdrawals are disabled by admin");
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ApiError(400, "amount must be greater than zero");
    }

    if (minimumTransferAmount > 0 && amount < minimumTransferAmount) {
      throw new ApiError(400, `amount must be at least ${minimumTransferAmount}`);
    }

    if (amount > currentBalance) {
      throw new ApiError(400, "Withdrawal amount cannot exceed current balance");
    }

    const pendingRequest = await WithdrawalRequest.findOne({
      owner_id: req.auth.sub,
      amount,
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .lean();

    if (pendingRequest && (Date.now() - new Date(pendingRequest.createdAt).getTime()) < 60 * 1000) {
      throw new ApiError(409, "A similar withdrawal request was just submitted");
    }

    const created = await WithdrawalRequest.create({
      transactionId: `wdr_${Date.now().toString(36)}`,
      owner_id: req.auth.sub,
      amount: Math.round(amount * 100) / 100,
      payment_method: paymentMethod,
      bank_details_snapshot: {
        accountHolderName: String(req.body?.accountHolderName || "").trim(),
        upiId: String(req.body?.upiId || "").trim(),
        accountNumber: String(req.body?.accountNumber || "").trim(),
        ifsc: String(req.body?.ifsc || "").trim(),
        branchName: String(req.body?.branchName || "").trim(),
      },
      status: "pending",
    });

    res.status(201).json({
      success: true,
      data: {
        request: created,
        wallet: { balance: currentBalance, currency: "INR" },
      },
      message: "Withdrawal request sent to admin",
    });
    return;
  }

  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const wallet = await serializeDriverWallet(driver);
  const walletSettings = await getWalletSettings();
  const isTransferEnabled = ['1', 'true', 'yes', 'on'].includes(
    String(walletSettings.enable_wallet_transfer_driver ?? '1').trim().toLowerCase(),
  );
  const minimumTransferAmount = Number(wallet.minimumTransferAmount ?? walletSettings.minimum_wallet_amount_for_transfer ?? 0);
  const amount = Number(req.body?.amount);
  const paymentMethod = String(req.body?.payment_method || req.body?.paymentMethod || 'bank_transfer').trim().toLowerCase() || 'bank_transfer';

  if (!isTransferEnabled) {
    throw new ApiError(403, "Withdrawals are disabled by admin");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, "amount must be greater than zero");
  }

  if (minimumTransferAmount > 0 && amount < minimumTransferAmount) {
    throw new ApiError(400, `amount must be at least ${minimumTransferAmount}`);
  }

  // Money frozen against an open escrow is already promised to another driver,
  // so it must not be withdrawable even though it still sits in `balance`.
  const withdrawableBalance = Number(wallet.available ?? wallet.balance ?? 0);
  if (amount > withdrawableBalance) {
    throw new ApiError(
      400,
      Number(wallet.frozenBalance || 0) > 0
        ? `Withdrawal amount cannot exceed your available balance (₹${withdrawableBalance}); ₹${wallet.frozenBalance} is held for ongoing rides`
        : "Withdrawal amount cannot exceed current balance",
    );
  }

  // The admin has to know where to send the money.
  const payout = serializeDriverBankDetails(driver.bankDetails || {});
  const hasBank = Boolean(payout.accountNumber && payout.ifsc);
  if (!payout.upiId && !hasBank) {
    throw new ApiError(400, "Add your bank account or UPI ID before withdrawing", null, "PAYOUT_METHOD_REQUIRED");
  }

  // One request at a time, and what is already waiting counts against the balance.
  const pendingRequests = await WithdrawalRequest.find({ driver_id: req.auth.sub, status: 'pending' }).lean();
  if (pendingRequests.length) {
    throw new ApiError(409, "You already have a withdrawal request waiting for approval", null, "WITHDRAWAL_PENDING");
  }

  const created = await WithdrawalRequest.create({
    transactionId: `wdr_${Date.now().toString(36)}`,
    driver_id: req.auth.sub,
    amount: Math.round(amount * 100) / 100,
    payment_method: paymentMethod,
    bank_details_snapshot: payout,
    status: 'pending',
  });

  notifyAdminsOfWithdrawal({ request: created, driverName: driver.name });

  res.status(201).json({
    success: true,
    data: {
      request: created,
      wallet,
    },
    message: "Withdrawal request sent to admin",
  });
};

/** The driver's own withdrawal requests, newest first. */
export const listMyWithdrawalRequests = async (req, res) => {
  const requests = await WithdrawalRequest.find({ driver_id: req.auth.sub })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('transactionId amount payment_method status createdAt updatedAt')
    .lean();

  res.json({ success: true, data: { results: requests } });
};

export const topUpMyWallet = async (req, res) => {
  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, "amount must be greater than zero");
  }

  const result = await topUpDriverWallet({
    driverId: req.auth.sub,
    amount,
    metadata: {
      source: req.body.source || "manual",
      referenceId: req.body.referenceId || null,
    },
  });

  const payload = {
    wallet: result.wallet,
    transaction: result.transaction,
  };

  emitToDriver(req.auth.sub, "driver:wallet:updated", payload);

  res.json({
    success: true,
    data: payload,
  });
};

export const createDriverPaymentQr = async (req, res) => {
  const amountInPaise = normalizePaymentAmount(req.body.amount);
  const rideId = String(req.body.rideId || "").trim();

  if (!rideId) {
    throw new ApiError(400, "rideId is required");
  }

  const ride = await Ride.findOne({
    _id: rideId,
    driverId: req.auth.sub,
  })
    .select("_id fare paymentMethod serviceType driverPaymentCollection");

  if (!ride) {
    throw new ApiError(404, "Ride not found for this driver");
  }

  let payload;

  try {
    const appName = await getConfiguredAppName();
    const qr = await razorpayRequest({
      method: "POST",
      path: "/payments/qr_codes",
      body: {
        type: "upi_qr",
        name: `${appName} Taxi Fare`,
        usage: "single_use",
        fixed_amount: true,
        payment_amount: amountInPaise,
        description: `Taxi fare for ride ${rideId}`,
        close_by: Math.floor(Date.now() / 1000) + 30 * 60,
        notes: {
          rideId,
          driverId: String(req.auth.sub),
          serviceType: ride.serviceType || "ride",
          source: "driver_collect_amount",
        },
      },
    });

    payload = {
      id: qr.id,
      entity: qr.entity,
      status: qr.status,
      imageUrl: qr.image_url,
      linkUrl: qr.image_url,
      amount: amountInPaise / 100,
      currency: "INR",
      description: qr.description,
      closeBy: qr.close_by || null,
      rawStatus: qr.status,
      providerMode: "razorpay_qr",
    };
  } catch (error) {
    if (!shouldFallbackToPaymentLinkQr(error)) {
      throw error;
    }

    payload = await createPaymentLinkQr({
      amountInPaise,
      rideId,
      driverId: req.auth.sub,
      serviceType: ride.serviceType,
    });
  }

  ride.driverPaymentCollection = {
    provider: "razorpay",
    providerId: payload.id,
    providerMode: payload.providerMode,
    status: normalizeCollectionStatus(payload.rawStatus || payload.status),
    amount: payload.amount,
    currency: payload.currency || "INR",
    linkUrl: payload.linkUrl || "",
    paidAt: null,
    updatedAt: new Date(),
  };
  await ride.save();

  res.json({
    success: true,
    data: payload,
  });
};

const resolveRazorpayCredentials = async () => {
  return resolveConfiguredGatewayCredentials("razor_pay");
};

const resolvePhonePeCredentials = async () => {
  return resolveConfiguredGatewayCredentials("phone_pay");
};

const normalizeOriginCandidate = (value = "") => {
  const trimmedValue = String(value || "").trim();
  if (!trimmedValue || trimmedValue === "*") {
    return "";
  }

  try {
    return new URL(trimmedValue).origin.replace(/\/+$/, "");
  } catch {
    return "";
  }
};

const isPublicWebOrigin = (value = "") => {
  const origin = normalizeOriginCandidate(value);
  if (!origin) {
    return false;
  }

  try {
    const { protocol, hostname } = new URL(origin);
    if (!["http:", "https:"].includes(protocol)) {
      return false;
    }

    return !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname);
  } catch {
    return false;
  }
};

const getFrontendBaseUrl = (req) => {
  const configuredOrigins = [
    env.phonePeRedirectBaseUrl,
    env.publicFrontendUrl,
    ...String(env.corsOrigin || "")
      .split(",")
      .map((value) => value.trim()),
  ]
    .map(normalizeOriginCandidate)
    .filter(Boolean);

  const requestCandidates = [
    normalizeOriginCandidate(req?.get?.("origin")),
    normalizeOriginCandidate(req?.get?.("referer")),
    (() => {
      const forwardedProto = String(req?.get?.("x-forwarded-proto") || "").trim();
      const forwardedHost = String(req?.get?.("x-forwarded-host") || "").trim();
      if (!forwardedProto || !forwardedHost) {
        return "";
      }
      return normalizeOriginCandidate(`${forwardedProto}://${forwardedHost}`);
    })(),
    (() => {
      const host = String(req?.get?.("host") || "").trim();
      const proto =
        String(req?.protocol || "").trim() ||
        String(req?.get?.("x-forwarded-proto") || "").trim() ||
        "http";
      if (!host) {
        return "";
      }
      return normalizeOriginCandidate(`${proto}://${host}`);
    })(),
  ].filter(Boolean);

  const preferredPublicOrigin =
    configuredOrigins.find(isPublicWebOrigin) ||
    requestCandidates.find(isPublicWebOrigin);

  if (preferredPublicOrigin) {
    return preferredPublicOrigin;
  }

  return (
    configuredOrigins[0] ||
    requestCandidates[0] ||
    "http://localhost:5173"
  ).replace(/\/+$/, "");
};

const getPhonePeApiBaseUrl = (environment = "test") =>
  String(environment).trim().toLowerCase() === "production"
    ? "https://api.phonepe.com/apis/pg"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox";

const getPhonePeAuthUrl = (environment = "test") =>
  String(environment).trim().toLowerCase() === "production"
    ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";

const phonePeAccessTokenCache = new Map();
const phonePeClientCache = new Map();

const getPhonePeCheckoutClient = ({
  clientId,
  clientSecret,
  clientVersion,
  environment,
}) => {
  const normalizedEnvironment = String(environment || "test").trim().toLowerCase();
  const normalizedVersion = Number.parseInt(String(clientVersion || "1"), 10) || 1;
  const cacheKey = `${normalizedEnvironment}::${clientId}::${normalizedVersion}`;

  if (phonePeClientCache.has(cacheKey)) {
    return phonePeClientCache.get(cacheKey);
  }

  const client = StandardCheckoutClient.getInstance(
    clientId,
    clientSecret,
    normalizedVersion,
    normalizedEnvironment === "production" ? Env.PRODUCTION : Env.SANDBOX,
  );

  phonePeClientCache.set(cacheKey, client);
  return client;
};

const getPhonePeAccessToken = async ({
  clientId,
  clientSecret,
  clientVersion,
  environment,
}) => {
  const cacheKey = `${String(environment).trim().toLowerCase()}::${clientId}::${clientVersion}`;
  const cachedToken = phonePeAccessTokenCache.get(cacheKey);
  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  if (cachedToken?.accessToken && Number(cachedToken.expiresAt || 0) - 60 > nowEpochSeconds) {
    logPaymentDiagnostic({
      provider: "phonepe",
      scope: "driver",
      stage: "auth-cache-hit",
      ...summarizePhonePeCredentialMeta({ clientId, clientVersion, environment }),
    });
    return cachedToken.accessToken;
  }

  const requestBody = new URLSearchParams({
    client_id: clientId,
    client_version: clientVersion,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  logPaymentDiagnostic({
    provider: "phonepe",
    scope: "driver",
    stage: "auth-request",
    ...summarizePhonePeCredentialMeta({ clientId, clientVersion, environment }),
  });

  const response = await fetch(getPhonePeAuthUrl(environment), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: requestBody.toString(),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    logPaymentDiagnostic({
      provider: "phonepe",
      scope: "driver",
      stage: "auth-failed",
      level: "error",
      statusCode: response.status || 502,
      ...summarizePhonePeCredentialMeta({ clientId, clientVersion, environment }),
      response: summarizePhonePePayload(payload || {}),
    });
    throw new ApiError(
      response.status || 502,
      payload?.message || payload?.error_description || payload?.error || "PhonePe authorization failed",
    );
  }

  logPaymentDiagnostic({
    provider: "phonepe",
    scope: "driver",
    stage: "auth-success",
    statusCode: response.status || 200,
    expiresAt: Number(payload.expires_at || nowEpochSeconds + 300),
    ...summarizePhonePeCredentialMeta({ clientId, clientVersion, environment }),
  });

  phonePeAccessTokenCache.set(cacheKey, {
    accessToken: String(payload.access_token),
    expiresAt: Number(payload.expires_at || nowEpochSeconds + 300),
  });

  return String(payload.access_token);
};

const phonePeRequest = async ({
  method,
  path,
  body,
  clientId,
  clientSecret,
  clientVersion,
  environment,
}) => {
  const normalizedMethod = String(method || "GET").trim().toUpperCase();
  logPaymentDiagnostic({
    provider: "phonepe",
    scope: "driver",
    stage: "api-request",
    method: normalizedMethod,
    path,
    ...summarizePhonePeCredentialMeta({ clientId, clientVersion, environment }),
    request: summarizePhonePeRequestBody(body || {}),
  });
  const client = getPhonePeCheckoutClient({
    clientId,
    clientSecret,
    clientVersion,
    environment,
  });

  try {
    let payload = null;

    if (normalizedMethod === "POST" && path === "/checkout/v2/pay") {
      const merchantOrderId = String(body?.merchantOrderId || "").trim();
      const amount = Number(body?.amount || 0);
      const redirectUrl = String(body?.paymentFlow?.merchantUrls?.redirectUrl || "").trim();

      if (!merchantOrderId || !amount || !redirectUrl) {
        throw new ApiError(400, "PhonePe merchant order id, amount, and redirect URL are required");
      }

      const builder = StandardCheckoutPayRequest.builder()
        .merchantOrderId(merchantOrderId)
        .amount(amount)
        .redirectUrl(redirectUrl);

      if (body?.paymentFlow?.message) {
        builder.message(String(body.paymentFlow.message));
      }
      if (body?.expireAfter) {
        builder.expireAfter(Number(body.expireAfter));
      }
      if (body?.prefillUserLoginDetails?.phoneNumber) {
        const prefill = PrefillUserLoginDetails.builder()
          .phoneNumber(String(body.prefillUserLoginDetails.phoneNumber))
          .build();
        builder.prefillUserLoginDetails(prefill);
      }
      if (body?.metaInfo) {
        builder.metaInfo(body.metaInfo);
      }

      const request = builder.build();
      payload = await client.pay(request);
    } else if (normalizedMethod === "GET" && path.includes("/checkout/v2/order/")) {
      const orderMatch = path.match(/\/checkout\/v2\/order\/([^/]+)\/status/i);
      const merchantOrderId = decodeURIComponent(orderMatch?.[1] || "").trim();

      if (!merchantOrderId) {
        throw new ApiError(400, "PhonePe merchant order id is required");
      }

      payload = await client.getOrderStatus(merchantOrderId);
    } else {
      throw new ApiError(400, `Unsupported PhonePe operation: ${normalizedMethod} ${path}`);
    }

    logPaymentDiagnostic({
      provider: "phonepe",
      scope: "driver",
      stage: "api-success",
      method: normalizedMethod,
      path,
      statusCode: 200,
      ...summarizePhonePeCredentialMeta({ clientId, clientVersion, environment }),
      response: summarizePhonePePayload(payload || {}),
    });

    return payload;
  } catch (error) {
    const payload = error?.response || error?.payload || error?.data || null;
    const statusCode = Number(error?.statusCode || error?.status || 502);

    logPaymentDiagnostic({
      provider: "phonepe",
      scope: "driver",
      stage: "api-failed",
      level: "error",
      method: normalizedMethod,
      path,
      statusCode,
      ...summarizePhonePeCredentialMeta({ clientId, clientVersion, environment }),
      response: summarizePhonePePayload(payload || {}),
      providerMessage:
        error?.message ||
        payload?.message ||
        payload?.responseCodeDescription ||
        payload?.detailedErrorCode ||
        "",
    });
    throw new ApiError(
      statusCode,
      error?.message || payload?.message || payload?.code || "PhonePe request failed",
    );
  }
};

const buildWalletTopupMockRedirectUrl = (mockOrderId, { isOwner = false } = {}) => {
  const origin = (env.publicFrontendUrl || "http://localhost:5173").replace(/\/$/, "");
  const path = isOwner ? "/taxi/owner/wallet" : "/taxi/driver/wallet";
  return `${origin}${path}?topup_test_success=true&order_id=${mockOrderId}`;
};

const buildMockRazorpayOrder = (body, redirectOptions) => {
  const mockOrderId = `order_test_${Date.now().toString(36)}`;
  const mockAmount = body?.amount || 50000;
  const redirectUrl = buildWalletTopupMockRedirectUrl(mockOrderId, redirectOptions);
  return {
    id: mockOrderId,
    entity: "order",
    amount: mockAmount,
    currency: "INR",
    status: "created",
    short_url: redirectUrl,
    shortUrl: redirectUrl,
    url: redirectUrl,
  };
};

const fetchRazorpay = async ({ method, path, body, keyId, keySecret, isOwner = false }) => {
  if (isRazorpayTestModeAllowed() && (keyId?.includes('DemoKey') || keyId?.includes('demo'))) {
    return buildMockRazorpayOrder(body, { isOwner });
  }

  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  try {
    const response = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (isRazorpayTestModeAllowed()) {
        return buildMockRazorpayOrder(body, { isOwner });
      }

      throw new ApiError(
        response.status || 502,
        payload?.error?.description ||
          payload?.error?.message ||
          "Razorpay request failed",
      );
    }

    return payload;
  } catch (err) {
    if (isRazorpayTestModeAllowed()) {
      return buildMockRazorpayOrder(body, { isOwner });
    }
    throw err;
  }
};

export const createDriverWalletTopupOrder = async (req, res) => {
  const settings = await getWalletSettings();
  const minTopUp = Number(settings.minimum_amount_added_to_wallet || 0);
  const amount = Math.round(Number(req.body.amount) * 100) / 100;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, "Invalid top-up amount");
  }

  if (amount < minTopUp) {
    throw new ApiError(400, `Minimum top-up amount is Rs ${minTopUp}`);
  }

  const { keyId, keySecret } = await resolveRazorpayCredentials();

  const isOwner = String(req.auth?.role || "").toLowerCase() === "owner";
  const amountPaise = Math.round(amount * 100);
  const driverId = String(req.auth?.sub || "");
  const compactDriverId = driverId.replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "drv";
  const receipt = `dwal_${compactDriverId}_${Date.now().toString(36)}`;

  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:5000';
  const backendOrigin = `${proto}://${host}`;
  const callbackUrl = `${backendOrigin}/api/v1/drivers/wallet/top-up/razorpay/callback`;

  const userAgent = String(req.headers["user-agent"] || "");
  const isWebView = /; wv\)/i.test(userAgent) || /Version\/[\d.]+/i.test(userAgent) || req.body.usePaymentLink === true;

  if (isWebView) {
    const account = driverId
      ? isOwner
        ? await Owner.findById(driverId).select("name phone email").lean()
        : await Driver.findById(driverId).select("name phone email").lean()
      : null;
    const cleanedPhone = String(account?.phone || "").replace(/\D/g, "");
    const customerPhone = cleanedPhone.length === 10 ? `+91${cleanedPhone}` : (cleanedPhone.length === 12 && cleanedPhone.startsWith("91")) ? `+${cleanedPhone}` : "";

    const paymentLink = await razorpayRequest({
      method: "POST",
      path: "/payment_links",
      body: {
        amount: amountPaise,
        currency: "INR",
        accept_partial: false,
        expire_by: Math.floor(Date.now() / 1000) + 20 * 60,
        reference_id: receipt,
        description: isOwner ? "Owner Wallet Topup" : "Driver Wallet Topup",
        callback_url: callbackUrl,
        callback_method: "get",
        customer: {
          name: account?.name || (isOwner ? "Owner" : "Driver"),
          email: account?.email || "",
          contact: customerPhone || undefined,
        },
        notes: {
          driverId,
          role: isOwner ? "owner" : "driver",
          source: "driver_wallet_topup",
        },
      },
      keyId,
      keySecret,
    });

    const checkoutUrl = paymentLink.short_url || paymentLink.shortUrl || paymentLink.url;

    res.status(201).json({
      success: true,
      data: {
        keyId,
        checkoutUrl,
        amount: amountPaise,
        currency: "INR",
        callbackUrl,
      },
    });
    return;
  }

  const order = await fetchRazorpay({
    method: "POST",
    path: "/orders",
    body: {
      amount: amountPaise,
      currency: "INR",
      receipt,
      notes: { driverId, role: isOwner ? "owner" : "driver" },
    },
    keyId,
    keySecret,
    isOwner,
  });

  res.status(201).json({
    success: true,
    data: {
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency || "INR",
      callbackUrl,
    },
  });
};

const DRIVER_RAZORPAY_PAYMENT_SUCCESS_STATUSES = new Set(["authorized", "captured", "paid"]);
const DRIVER_RAZORPAY_LINK_SUCCESS_STATUSES = new Set(["paid"]);

const verifyAndApplyDriverRazorpayWalletTopup = async ({
  orderId,
  paymentId,
  signature,
  paymentLinkId = "",
  paymentLinkReferenceId = "",
  paymentLinkStatus = "",
  driverId: requestedDriverId = "",
  role: requestedRole = "driver",
  amount: requestedAmountPaise = 0,
} = {}) => {
  const isOwner = String(requestedRole || "driver").toLowerCase() === "owner";
  const normalizedOrderId = String(orderId || "").trim();
  const normalizedPaymentId = String(paymentId || "").trim();
  const normalizedSignature = String(signature || "").trim();
  const normalizedPaymentLinkId = String(paymentLinkId || "").trim();
  const normalizedPaymentLinkReferenceId = String(paymentLinkReferenceId || "").trim();
  const normalizedPaymentLinkStatus = String(paymentLinkStatus || "").trim().toLowerCase();

  if (!normalizedPaymentId) {
    throw new ApiError(400, "Payment verification fields are required");
  }

  if (!normalizedOrderId && !normalizedPaymentLinkId) {
    throw new ApiError(400, "Payment verification fields are required");
  }

  const { keyId, keySecret } = await resolveRazorpayCredentials();

  let effectiveOrderId = normalizedOrderId;
  let amountPaise = 0;
  let resolvedDriverId = "";
  let resolvedRole = "";

  if (effectiveOrderId) {
    if (isRazorpayTestPayment(effectiveOrderId, normalizedPaymentId)) {
      // Test Mode Auto-Verification: no real Razorpay order exists to look up,
      // so trust the amount the client paid against (the exact figure it just
      // showed the user in the "Simulate Success" modal) instead of a fixed
      // stand-in — otherwise every top-up silently gets credited as Rs 500.
      amountPaise = Number(requestedAmountPaise) > 0 ? Math.round(Number(requestedAmountPaise)) : 50000;
      resolvedDriverId = requestedDriverId || "";
      resolvedRole = requestedRole || "";
    } else {
      if (!normalizedSignature) {
        throw new ApiError(400, "Payment verification signature is required");
      }

      const expectedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(`${effectiveOrderId}|${normalizedPaymentId}`)
        .digest("hex");

      if (!safeEqualHex(expectedSignature, normalizedSignature)) {
        throw new ApiError(400, "Invalid payment signature");
      }

      const order = await fetchRazorpay({
        method: "GET",
        path: `/orders/${encodeURIComponent(effectiveOrderId)}`,
        keyId,
        keySecret,
      });

      amountPaise = Number(order?.amount);
      resolvedDriverId = String(order?.notes?.driverId || "").trim();
      resolvedRole = String(order?.notes?.role || "").trim();
    }
  } else {
    const [payment, paymentLink] = await Promise.all([
      fetchRazorpay({
        method: "GET",
        path: `/payments/${encodeURIComponent(normalizedPaymentId)}`,
        keyId,
        keySecret,
      }),
      fetchRazorpay({
        method: "GET",
        path: `/payment_links/${encodeURIComponent(normalizedPaymentLinkId)}`,
        keyId,
        keySecret,
      }),
    ]);

    const paymentStatus = String(payment?.status || "").trim().toLowerCase();
    const linkStatus = String(paymentLink?.status || normalizedPaymentLinkStatus || "").trim().toLowerCase();
    const linkPaymentId = String(
      paymentLink?.payments?.[0]?.payment_id ||
      paymentLink?.payment_id ||
      payment?.id ||
      "",
    ).trim();

    if (!DRIVER_RAZORPAY_PAYMENT_SUCCESS_STATUSES.has(paymentStatus)) {
      throw new ApiError(400, "Razorpay payment is not successful yet");
    }

    if (linkStatus && !DRIVER_RAZORPAY_LINK_SUCCESS_STATUSES.has(linkStatus)) {
      throw new ApiError(400, "Razorpay payment link is not marked as paid");
    }

    if (linkPaymentId && linkPaymentId !== normalizedPaymentId) {
      throw new ApiError(400, "Payment link callback does not match the payment id");
    }

    if (
      normalizedPaymentLinkReferenceId &&
      paymentLink?.reference_id &&
      String(paymentLink.reference_id).trim() !== normalizedPaymentLinkReferenceId
    ) {
      throw new ApiError(400, "Payment link callback reference did not match");
    }

    effectiveOrderId = String(payment?.order_id || "").trim();
    amountPaise = Number(payment?.amount || paymentLink?.amount_paid || paymentLink?.amount || 0);
    resolvedDriverId = String(paymentLink?.notes?.driverId || payment?.notes?.driverId || "").trim();
    resolvedRole = String(paymentLink?.notes?.role || payment?.notes?.role || "").trim();
  }

  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    throw new ApiError(400, "Invalid order amount");
  }

  const effectiveDriverId = String(requestedDriverId || resolvedDriverId).trim();
  const effectiveIsOwner = isOwner || String(resolvedRole || "").toLowerCase() === "owner";

  if (!effectiveDriverId) {
    throw new ApiError(400, "Driver reference is missing from this Razorpay order");
  }

  if (requestedDriverId && resolvedDriverId && requestedDriverId !== resolvedDriverId) {
    throw new ApiError(403, "This Razorpay order does not belong to the authenticated driver");
  }

  const amount = Math.round(amountPaise) / 100;

  if (effectiveIsOwner) {
    const alreadyCredited = await OwnerWalletTransaction.findOne({
      ownerId: effectiveDriverId,
      "metadata.providerPaymentId": normalizedPaymentId,
    })
      .select("_id")
      .lean();

    if (alreadyCredited) {
      const owner = await Owner.findById(effectiveDriverId).lean();
      return {
        driverId: effectiveDriverId,
        wallet: owner ? { balance: Number(owner.wallet?.balance || 0), currency: "INR" } : null,
        transaction: null,
        alreadyCredited: true,
      };
    }

    const result = await adjustOwnerWallet(effectiveDriverId, {
      amount,
      operation: "credit",
      description: "Wallet top-up",
      metadata: {
        source: "razorpay",
        provider: "razorpay",
        providerOrderId: effectiveOrderId,
        providerPaymentId: normalizedPaymentId,
        providerPaymentLinkId: normalizedPaymentLinkId,
      },
    });

    const payload = {
      wallet: { balance: result.balance, currency: "INR" },
      transaction: normalizeOwnerWalletTransaction(result.transaction),
    };

    emitToDriver(effectiveDriverId, "driver:wallet:updated", payload);

    return {
      driverId: effectiveDriverId,
      ...payload,
      alreadyCredited: false,
    };
  }

  const alreadyCredited = await WalletTransaction.findOne({
    driverId: effectiveDriverId,
    "metadata.providerPaymentId": normalizedPaymentId,
  })
    .select("_id")
    .lean();

  if (alreadyCredited) {
    const driver = await Driver.findById(effectiveDriverId);
    return {
      driverId: effectiveDriverId,
      wallet: driver ? await serializeDriverWallet(driver) : null,
      transaction: null,
      alreadyCredited: true,
    };
  }

  const result = await topUpDriverWallet({
    driverId: effectiveDriverId,
    amount,
    metadata: {
      source: "razorpay",
      provider: "razorpay",
      providerOrderId: effectiveOrderId,
      providerPaymentId: normalizedPaymentId,
      providerPaymentLinkId: normalizedPaymentLinkId,
    },
  });

  const payload = {
    wallet: result.wallet,
    transaction: result.transaction,
  };

  emitToDriver(effectiveDriverId, "driver:wallet:updated", payload);

  return {
    driverId: effectiveDriverId,
    ...payload,
    alreadyCredited: false,
  };
};

export const handleDriverRazorpayWalletTopupCallback = async (req, res) => {
  const frontendBaseUrl = getFrontendBaseUrl(req);
  const redirectUrl = new URL(`${frontendBaseUrl}/razorpay/status`);
  redirectUrl.searchParams.set("flow", "driver-wallet");
  const callbackPayload = {
    razorpay_order_id: req.body?.razorpay_order_id || req.query?.razorpay_order_id,
    razorpay_payment_id: req.body?.razorpay_payment_id || req.query?.razorpay_payment_id,
    razorpay_signature: req.body?.razorpay_signature || req.query?.razorpay_signature,
    razorpay_payment_link_id: req.body?.razorpay_payment_link_id || req.query?.razorpay_payment_link_id,
    razorpay_payment_link_reference_id:
      req.body?.razorpay_payment_link_reference_id || req.query?.razorpay_payment_link_reference_id,
    razorpay_payment_link_status:
      req.body?.razorpay_payment_link_status || req.query?.razorpay_payment_link_status,
  };

  try {
    const errorCode = String(
      req.body?.error?.code || req.body?.error?.reason || req.query?.error_code || "",
    ).trim();
    const errorDescription = String(
      req.body?.error?.description || req.query?.error_description || "",
    ).trim();

    if (errorCode || errorDescription) {
      redirectUrl.searchParams.set("status", "failure");
      if (errorCode) {
        redirectUrl.searchParams.set("error_code", errorCode);
      }
      if (errorDescription) {
        redirectUrl.searchParams.set("error_description", errorDescription);
      }
      res.redirect(302, redirectUrl.toString());
      return;
    }

    await verifyAndApplyDriverRazorpayWalletTopup({
      orderId: callbackPayload.razorpay_order_id,
      paymentId: callbackPayload.razorpay_payment_id,
      signature: callbackPayload.razorpay_signature,
      paymentLinkId: callbackPayload.razorpay_payment_link_id,
      paymentLinkReferenceId: callbackPayload.razorpay_payment_link_reference_id,
      paymentLinkStatus: callbackPayload.razorpay_payment_link_status,
    });

    redirectUrl.searchParams.set("status", "success");
  } catch (error) {
    redirectUrl.searchParams.set("status", "failure");
    redirectUrl.searchParams.set(
      "error_description",
      String(error?.message || "Payment verification failed."),
    );
  }

  res.redirect(302, redirectUrl.toString());
};

export const createDriverPhonePeWalletTopupOrder = async (req, res) => {
  const settings = await getWalletSettings();
  const minTopUp = Number(settings.minimum_amount_added_to_wallet || 0);
  const amount = Math.round(Number(req.body.amount) * 100) / 100;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, "Invalid top-up amount");
  }

  if (amount < minTopUp) {
    throw new ApiError(400, `Minimum top-up amount is Rs ${minTopUp}`);
  }

  const { clientId, clientSecret, clientVersion, environment } = await resolvePhonePeCredentials();
  const driverId = String(req.auth?.sub || "");
  const compactDriverId = driverId.replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "drv";
  const merchantTransactionId = `DWAL${Date.now()}${compactDriverId}`.slice(0, 34);
  const frontendBaseUrl = getFrontendBaseUrl(req);
  const redirectUrl = `${frontendBaseUrl}/phonepe/status?flow=driver-wallet&phonepe_txn=${encodeURIComponent(merchantTransactionId)}`;
  const driver = driverId ? await Driver.findById(driverId).select("phone").lean() : null;
  logPaymentDiagnostic({
    provider: "phonepe",
    scope: "driver-wallet",
    stage: "create-order-start",
    merchantTransactionId,
    amountRupees: amount,
    request: buildPaymentRequestContext(req),
    metadata: {
      redirectUrl: summarizeCheckoutUrl(redirectUrl),
    },
  });
  const payload = await phonePeRequest({
    method: "POST",
    path: "/checkout/v2/pay",
    body: {
      merchantOrderId: merchantTransactionId,
      amount: Math.round(amount * 100),
      expireAfter: 1200,
      paymentFlow: {
        type: "PG_CHECKOUT",
        merchantUrls: {
          redirectUrl,
        },
        message: "Wallet top-up",
      },
      prefillUserLoginDetails: (() => {
        const cleaned = String(driver?.phone || "").replace(/\D/g, "");
        const finalPhone = (cleaned.length === 12 && cleaned.startsWith("91")) ? cleaned.slice(2) : cleaned;
        return finalPhone.length === 10 ? { phoneNumber: finalPhone } : undefined;
      })(),
    },
    clientId,
    clientSecret,
    clientVersion,
    environment,
  });

  const checkoutUrl = payload?.redirectUrl || "";
  if (!checkoutUrl) {
    logPaymentDiagnostic({
      provider: "phonepe",
      scope: "driver-wallet",
      stage: "create-order-missing-checkout-url",
      level: "error",
      merchantTransactionId,
      response: summarizePhonePePayload(payload || {}),
    });
    throw new ApiError(502, "PhonePe payment URL was not returned");
  }

  logPaymentDiagnostic({
    provider: "phonepe",
    scope: "driver-wallet",
    stage: "create-order-success",
    merchantTransactionId,
    amountPaise: Math.round(amount * 100),
    checkoutUrl: summarizeCheckoutUrl(checkoutUrl),
    response: summarizePhonePePayload(payload || {}),
  });

  res.status(201).json({
    success: true,
    data: {
      gateway: "phonepe",
      merchantTransactionId,
      amount: Math.round(amount * 100),
      currency: "INR",
      checkoutUrl,
    },
  });
};

export const verifyDriverWalletTopup = async (req, res) => {
  const payload = await verifyAndApplyDriverRazorpayWalletTopup({
    orderId: req.body?.razorpay_order_id || req.body?.orderId,
    paymentId: req.body?.razorpay_payment_id || req.body?.paymentId,
    signature: req.body?.razorpay_signature || req.body?.signature,
    driverId: req.auth?.sub,
    role: req.auth?.role,
    amount: req.body?.amount,
  });

  res.json({
    success: true,
    data: {
      wallet: payload.wallet,
      ...(payload.transaction ? { transaction: payload.transaction } : {}),
    },
  });
};

export const verifyDriverPhonePeWalletTopup = async (req, res) => {
  const merchantTransactionId = toCleanString(
    req.params?.merchantTransactionId || req.query?.merchantTransactionId || req.query?.transactionId,
  );

  if (!merchantTransactionId) {
    throw new ApiError(400, "merchantTransactionId is required");
  }

  logPaymentDiagnostic({
    provider: "phonepe",
    scope: "driver-wallet",
    stage: "verify-start",
    merchantTransactionId,
    request: buildPaymentRequestContext(req),
  });

  const { clientId, clientSecret, clientVersion, environment } = await resolvePhonePeCredentials();
  const payload = await phonePeRequest({
    method: "GET",
    path: `/checkout/v2/order/${encodeURIComponent(merchantTransactionId)}/status?details=false`,
    clientId,
    clientSecret,
    clientVersion,
    environment,
  });

  const paymentDetails = Array.isArray(payload?.paymentDetails) ? payload.paymentDetails : [];
  const latestPayment = paymentDetails[0] || {};
  const paymentState = String(payload?.state || latestPayment?.state || "").trim().toUpperCase();
  const paymentId = toCleanString(latestPayment?.transactionId || latestPayment?.paymentTransactionId || merchantTransactionId);
  const amount = Math.round(Number(payload?.amount || latestPayment?.amount || 0)) / 100;
  const driverId = req.auth?.sub;

  logPaymentDiagnostic({
    provider: "phonepe",
    scope: "driver-wallet",
    stage: "verify-response",
    merchantTransactionId,
    driverId,
    paymentState,
    paymentId,
    amountRupees: amount,
    response: summarizePhonePePayload(payload || {}),
  });

  if (paymentState === "COMPLETED") {
    const alreadyCredited = await WalletTransaction.findOne({
      driverId,
      $or: [
        { "metadata.providerPaymentId": paymentId },
        { "metadata.providerOrderId": merchantTransactionId },
      ],
    })
      .select("_id")
      .lean();

    let result = null;
    if (!alreadyCredited) {
      result = await topUpDriverWallet({
        driverId,
        amount,
        metadata: {
          source: "phonepe",
          provider: "phonepe",
          providerOrderId: merchantTransactionId,
          providerPaymentId: paymentId,
        },
      });
    }

    const driver = await Driver.findById(driverId);
    logPaymentDiagnostic({
      provider: "phonepe",
      scope: "driver-wallet",
      stage: "verify-paid",
      merchantTransactionId,
      driverId,
      paymentId,
      amountRupees: amount,
      alreadyCredited: Boolean(alreadyCredited),
    });
    res.json({
      success: true,
      data: {
        status: "paid",
        gateway: "phonepe",
        merchantTransactionId,
        transactionId: paymentId,
        wallet: result?.wallet || await serializeDriverWallet(driver),
        transaction: result?.transaction || null,
      },
    });
    return;
  }

  if (paymentState === "PENDING") {
    logPaymentDiagnostic({
      provider: "phonepe",
      scope: "driver-wallet",
      stage: "verify-pending",
      merchantTransactionId,
      driverId,
      paymentId,
      amountRupees: amount,
    });
    res.json({
      success: true,
      data: {
        status: "pending",
        gateway: "phonepe",
        merchantTransactionId,
        transactionId: paymentId,
      },
      message: payload?.message || "PhonePe payment is still pending",
    });
    return;
  }

  logPaymentDiagnostic({
    provider: "phonepe",
    scope: "driver-wallet",
    stage: "verify-failed",
    level: "warn",
    merchantTransactionId,
    driverId,
    paymentId,
    paymentState,
    amountRupees: amount,
    code: payload?.code || latestPayment?.responseCode || "",
    providerMessage:
      payload?.message ||
      latestPayment?.responseCodeDescription ||
      latestPayment?.detailedErrorCode ||
      "",
    response: summarizePhonePePayload(payload || {}),
  });
  const driverProviderCode = payload?.code || latestPayment?.responseCode || "";
  const driverProviderMessage =
    payload?.message ||
    latestPayment?.responseCodeDescription ||
    latestPayment?.detailedErrorCode ||
    "PhonePe payment was not completed";
  res.json({
    success: true,
    data: {
      status: "failed",
      gateway: "phonepe",
      merchantTransactionId,
      transactionId: paymentId,
      code: driverProviderCode,
      state: paymentState,
      providerMessage: driverProviderMessage,
    },
    message: driverProviderMessage,
  });
};


export const getDriverPaymentQrStatus = async (req, res) => {
  const rideId = String(req.query.rideId || req.params.rideId || "").trim();

  if (!rideId) {
    throw new ApiError(400, "rideId is required");
  }

  const ride = await Ride.findOne({
    _id: rideId,
    driverId: req.auth.sub,
  }).select("_id driverPaymentCollection");

  if (!ride) {
    throw new ApiError(404, "Ride not found for this driver");
  }

  if (!ride.driverPaymentCollection?.providerId) {
    res.json({
      success: true,
      data: serializeDriverPaymentCollection(ride.driverPaymentCollection),
    });
    return;
  }

  const collection = await refreshDriverPaymentCollection(ride);

  res.json({
    success: true,
    data: collection,
  });
};

const getGenericVehicleType = (vehicle = {}) => {
  const value = String(vehicle.icon_types || vehicle.name || "").toLowerCase();

  if (value.includes("bike")) {
    return "bike";
  }

  if (value.includes("auto")) {
    return "auto";
  }

  return "car";
};

export const updateDriverVehicle = async (req, res) => {
  const {
    vehicleTypeId,
    vehicleNumber,
    vehicleColor,
    vehicleMake,
    vehicleModel,
    vehicleImage,
  } = req.body;

  let selectedVehicle = null;

  if (vehicleTypeId) {
    selectedVehicle = await Vehicle.findById(vehicleTypeId);

    if (
      !selectedVehicle ||
      selectedVehicle.active === false ||
      Number(selectedVehicle.status) === 0
    ) {
      throw new ApiError(404, "Active vehicle type not found");
    }
  }

  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const update = {};
  let vehicleChanged = false;

  if (selectedVehicle) {
    const nextVehicleType = getGenericVehicleType(selectedVehicle);
    const nextVehicleIconType = selectedVehicle.icon_types || nextVehicleType;

    update.vehicleTypeId = selectedVehicle._id;
    update.vehicleType = nextVehicleType;
    update.vehicleIconType = nextVehicleIconType;

    if (
      String(driver.vehicleTypeId || "") !== String(selectedVehicle._id || "") ||
      String(driver.vehicleType || "") !== String(nextVehicleType) ||
      String(driver.vehicleIconType || "") !== String(nextVehicleIconType)
    ) {
      vehicleChanged = true;
    }
  }

  if (vehicleNumber !== undefined) {
    const normalizedVehicleNumber = String(vehicleNumber || "")
      .trim()
      .toUpperCase();
    update.vehicleNumber = normalizedVehicleNumber;
    if (String(driver.vehicleNumber || "") !== normalizedVehicleNumber) {
      vehicleChanged = true;
    }
  }
  if (vehicleColor !== undefined) {
    const normalizedVehicleColor = String(vehicleColor || "").trim();
    update.vehicleColor = normalizedVehicleColor;
    if (String(driver.vehicleColor || "") !== normalizedVehicleColor) {
      vehicleChanged = true;
    }
  }
  if (vehicleMake !== undefined) {
    const normalizedVehicleMake = String(vehicleMake || "").trim();
    update.vehicleMake = normalizedVehicleMake;
    if (String(driver.vehicleMake || "") !== normalizedVehicleMake) {
      vehicleChanged = true;
    }
  }
  if (vehicleModel !== undefined) {
    const normalizedVehicleModel = String(vehicleModel || "").trim();
    update.vehicleModel = normalizedVehicleModel;
    if (String(driver.vehicleModel || "") !== normalizedVehicleModel) {
      vehicleChanged = true;
    }
  }
  if (vehicleImage !== undefined) {
    const normalizedVehicleImage = String(vehicleImage || "").trim();
    update.vehicleImage = normalizedVehicleImage;
    if (String(driver.vehicleImage || "") !== normalizedVehicleImage) {
      vehicleChanged = true;
    }
  }

  if (vehicleChanged) {
    update.approve = false;
    update.status = "pending";
    update.isOnline = false;
  }

  const updatedDriver = await Driver.findByIdAndUpdate(req.auth.sub, update, {
    returnDocument: 'after',
  });

  const vehicleIconUrl = await resolveVehicleMapIcon(updatedDriver.vehicleTypeId);

  res.json({
    success: true,
    message: vehicleChanged
      ? "Vehicle updated and sent to admin for approval"
      : "Vehicle updated successfully",
    data: {
      id: updatedDriver._id,
      name: updatedDriver.name,
      phone: updatedDriver.phone,
      vehicleType: updatedDriver.vehicleType,
      vehicleTypeId: updatedDriver.vehicleTypeId,
      vehicleIconType: updatedDriver.vehicleIconType,
      vehicleIconUrl,
      vehicleMake: updatedDriver.vehicleMake,
      vehicleModel: updatedDriver.vehicleModel,
      vehicleNumber: updatedDriver.vehicleNumber,
      vehicleColor: updatedDriver.vehicleColor,
      vehicleImage: updatedDriver.vehicleImage || "",
      registerFor: updatedDriver.registerFor,
      approve: updatedDriver.approve,
      status: updatedDriver.status,
      isOnline: updatedDriver.isOnline,
      isOnRide: updatedDriver.isOnRide,
      vehicleApprovalRequested: vehicleChanged,
    },
  });
};

export const getDriverApprovalStatus = async (req, res) => {
  const authorization = req.headers.authorization || "";
  const [, token] = authorization.split(" ");

  if (!token) {
    throw new ApiError(401, "Authorization token is required");
  }

  const payload = verifyAccessToken(token);

  if (!["driver", "owner"].includes(String(payload.role || "").toLowerCase())) {
    throw new ApiError(403, "Insufficient permissions for this resource");
  }

  if (String(payload.role || "").toLowerCase() === "owner") {
    const owner = await Owner.findById(payload.sub);

    if (!owner) {
      throw new ApiError(404, "Owner not found");
    }

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    res.json({
      success: true,
      data: {
        id: owner._id,
        name: owner.owner_name || owner.name || owner.company_name || "",
        phone: owner.mobile || owner.phone || "",
        approve: owner.approve,
        status: owner.status,
        documents: owner.documents || {},
        onboarding: owner.onboarding || {},
        isOnline: false,
        isOnRide: false,
      },
    });
    return;
  }

  const driver = await Driver.findById(payload.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  res.json({
    success: true,
    data: {
      id: driver._id,
      name: driver.name,
      phone: driver.phone,
      approve: driver.approve,
      status: driver.status,
      rejectionReason: driver.rejectionReason || '',
      documents: driver.documents || {},
      onboarding: driver.onboarding || {},
      isOnline: driver.isOnline,
      isOnRide: driver.isOnRide,
    },
  });
};

export const getServiceLocations = async (_req, res) => {
  const results = await listDriverServiceLocations();

  res.json({
    success: true,
    data: { results },
  });
};

export const getDriverDocumentTemplates = async (_req, res) => {
  const requestedRole = String(_req.query?.role || "driver").trim().toLowerCase();
  const isOwnerRequest = requestedRole === "owner";
  const isFleetRequest =
    requestedRole === "fleet" ||
    requestedRole === "owner_vehicle" ||
    requestedRole === "owner-vehicle";
  const isFleetDriverRequest =
    requestedRole === "fleet_driver" || requestedRole === "fleet-driver";
  const requestedUsageType = String(_req.query?.usage_type || "").trim().toLowerCase();
  let results = isFleetDriverRequest
    ? await listFleetDriverDocumentTemplates()
    : isFleetRequest
    ? await listDriverNeededDocuments({
        activeOnly: true,
        includeFields: true,
      })
    : isOwnerRequest
    ? await listOwnerNeededDocuments()
    : await listDriverNeededDocuments({
        activeOnly: true,
        includeFields: true,
      });

  // The Commercial Permit template (and any other document scoped the same
  // way) previously showed up for every driver at registration regardless of
  // which vehicle type they picked — meaningless, and confusing, for someone
  // registering a private vehicle. `?usage_type=commercial|private` filters
  // it; omitted, nothing changes (every template still shows, same as
  // before) so existing callers that don't send it are unaffected.
  if (!isOwnerRequest && (requestedUsageType === "commercial" || requestedUsageType === "private")) {
    results = results.filter(
      (item) => !item.applies_when_usage_type || item.applies_when_usage_type === requestedUsageType,
    );
  }

  res.json({
    success: true,
    data: {
      results: isOwnerRequest ? results.filter((item) => item.active !== false).map((item) => ({
        ...item,
        fields:
          item.image_type === "front_back"
            ? [
                {
                  key: `${String(item.name || "owner_document").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "owner_document"}_${String(item._id || "").replace(/[^a-zA-Z0-9]/g, "")}_front`,
                  label: `${item.name} Front`,
                  side: "front",
                  required: item.is_required !== false,
                },
                {
                  key: `${String(item.name || "owner_document").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "owner_document"}_${String(item._id || "").replace(/[^a-zA-Z0-9]/g, "")}_back`,
                  label: `${item.name} Back`,
                  side: "back",
                  required: item.is_required !== false,
                },
              ]
            : [
                {
                  key: `${String(item.name || "owner_document").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "owner_document"}_${String(item._id || "").replace(/[^a-zA-Z0-9]/g, "")}`,
                  label:
                    item.image_type === "front"
                      ? `${item.name} Front`
                      : item.image_type === "back"
                        ? `${item.name} Back`
                        : item.name,
                  side: item.image_type === "front" ? "front" : item.image_type === "back" ? "back" : "single",
                  required: item.is_required !== false,
                },
              ],
      }))
      : isFleetRequest
        ? results
      : results,
    },
  });
};

export const getDriverVehicleFieldTemplates = async (req, res) => {
  const requestedRole = String(req.query?.role || "driver").trim().toLowerCase();
  const results = await listDriverVehicleFieldTemplates({ activeOnly: true });
  const matchesAccountType = (accountType) => {
    const normalizedAccountType = String(accountType || "individual").trim().toLowerCase();

    if (normalizedAccountType === "both") {
      return true;
    }

    if (requestedRole === "owner") {
      return normalizedAccountType === "fleet_drivers" || normalizedAccountType === "fleet drivers";
    }

    return normalizedAccountType === "individual";
  };

  res.json({
    success: true,
    data: {
      results: results.filter((item) => matchesAccountType(item.account_type)),
    },
  });
};

export const recalculateOwnerVehicleCount = async (ownerId) => {
  if (!ownerId) return 0;
  const count = await FleetVehicle.countDocuments({ owner_id: ownerId, active: true });
  await Owner.findByIdAndUpdate(ownerId, { vehicle_count: count, no_of_vehicles: count });
  return count;
};

/**
 * Enforces the fleet-size cap that the Prime plan sells.
 *
 * Only applies when the caller is a *driver* acting as their own organisation —
 * an owner-portal login has no subscription tier behind it, and gating that path
 * would lock existing owners out of their own fleet.
 */
const assertFleetDriverCapacity = async ({ req, owner }) => {
  if (req.auth?.role !== "driver") return;

  const { getDriverPermissions } = await import(
    "../../services/driverCategoryService.js"
  );
  const permissions = await getDriverPermissions(req.auth.sub);

  if (!permissions.can_manage_fleet) {
    throw new ApiError(
      403,
      "Your current plan does not allow adding drivers",
      { category: permissions.category },
      "CATEGORY_NOT_ALLOWED",
    );
  }

  const limit = permissions.max_fleet_drivers;
  if (!limit) return;

  const used = await Driver.countDocuments({
    owner_id: owner._id,
    deletedAt: null,
    _id: { $ne: req.auth.sub },
  });

  if (used >= limit) {
    throw new ApiError(
      403,
      `Your plan allows up to ${limit} drivers`,
      { limit, used },
      "FLEET_DRIVER_LIMIT_REACHED",
    );
  }
};

/**
 * Re-evaluates the commercial+private rule for every driver who sits under this
 * organisation after its vehicle list changes. Adding a vehicle can clear a
 * running grace period; removing one can start it.
 */
const recheckOwnerFleetCategoryRule = async (ownerId) => {
  if (!ownerId) return;

  const { recheckCategoryVehicleRule } = await import(
    "../../services/driverCategoryService.js"
  );
  const drivers = await Driver.find({ owner_id: ownerId, deletedAt: null })
    .select("_id")
    .lean();

  for (const driver of drivers) {
    try {
      await recheckCategoryVehicleRule(driver._id);
    } catch (error) {
      console.error("[driverController] category vehicle recheck failed:", error.message);
    }
  }
};

// Document slug that proves a vehicle may legally operate commercially. Seeded
// into `DriverNeededDocument` by `seed_driver_network_tiers.js`.
const COMMERCIAL_PERMIT_KEY = "commercial_permit";

/**
 * Commercial vs private decides whether a driver can hold a Prime/Middle
 * category, so an unrecognised value must not quietly become "private" — a
 * driver would then pay for a plan the rule silently blocks.
 */
const normalizeVehicleUsageType = (value, { required = true } = {}) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized) {
    if (required) {
      throw new ApiError(
        400,
        "Vehicle usage type is required (commercial or private)",
        null,
        "USAGE_TYPE_REQUIRED",
      );
    }
    return null;
  }

  if (normalized !== "commercial" && normalized !== "private") {
    throw new ApiError(
      400,
      "Vehicle usage type must be either 'commercial' or 'private'",
      null,
      "INVALID_USAGE_TYPE",
    );
  }

  return normalized;
};

// Fleet-driver documents (Driving Licence, Aadhaar, PAN, ...) are admin-managed
// templates, not a hard-coded list — the same reasoning as the vehicle
// document rule just above, but scoped to the driver rather than the vehicle:
// `applies_to: 'driver'` and `account_type` covering a fleet-hired driver.
// Kept as one function so the required-document check (create) and the
// `?role=fleet_driver` template listing can never drift from each other.
const FLEET_DRIVER_ACCOUNT_TYPES = new Set(["fleet_drivers", "fleet drivers", "both"]);

const listFleetDriverDocumentTemplates = async () => {
  const templates = await listDriverNeededDocuments({
    activeOnly: true,
    includeFields: true,
  });

  return templates.filter(
    (template) =>
      template.applies_to === "driver" &&
      FLEET_DRIVER_ACCOUNT_TYPES.has(
        String(template.account_type || "").trim().toLowerCase(),
      ),
  );
};

// Same rule as listFleetDriverDocumentTemplates, but for the vehicle side,
// and additionally scoped to the vehicle's own usage type — a template
// flagged applies_when_usage_type: 'commercial' has no business being
// demanded from a private vehicle (the app never even shows that upload
// slot for one).
const listVehicleDocumentTemplates = async (usageType) => {
  const templates = await listDriverNeededDocuments({
    activeOnly: true,
    includeFields: true,
  });

  return templates
    .filter((template) => template.applies_to === "vehicle")
    .filter(
      (template) =>
        !template.applies_when_usage_type || template.applies_when_usage_type === usageType,
    );
};

// A vehicle's number plate must be unique across every owner's active fleet,
// not just this one — two different organisations claiming the same plate is
// always a mistake, never a coincidence worth allowing.
const assertPlateAvailable = async ({ plate, excludeId = null }) => {
  const clash = await FleetVehicle.findOne({
    license_plate_number: plate,
    active: true,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select("owner_id")
    .lean();

  if (clash) {
    throw new ApiError(
      409,
      "This number plate is already registered",
      null,
      "PLATE_ALREADY_REGISTERED",
    );
  }
};

// The same mapping createOwnerFleetDriver/updateOwnerFleetDriver already use
// when assigning a vehicle to a driver — reused here so editing the vehicle
// (a new plate, a different type) doesn't leave the driver's copy stale.
const syncAssignedDriverVehicle = async (vehicle) => {
  const kind = normalizeOwnerFleetVehicleKind(vehicle.vehicle_type_id);
  await Driver.updateMany(
    { assignedFleetVehicleId: vehicle._id, deletedAt: null },
    {
      $set: {
        vehicleTypeId: vehicle.vehicle_type_id?._id || null,
        vehicleType: kind,
        vehicleIconType: vehicle.vehicle_type_id?.icon_types || kind,
        vehicleMake: vehicle.car_brand,
        vehicleModel: vehicle.car_model,
        vehicleNumber: vehicle.license_plate_number,
        vehicleColor: vehicle.car_color,
      },
    },
  );
};

const findAssignedDriver = (ownerId, vehicleId) =>
  Driver.findOne({ owner_id: ownerId, assignedFleetVehicleId: vehicleId, deletedAt: null })
    .select("name phone isOnRide")
    .lean();

// Same rules as the driver app's vehicle form, enforced here so no client can
// skip them. On edit (`existing` given) a field is only checked when it
// actually changed, so a vehicle saved before these rules can still be edited.
const VEHICLE_PLATE_RE = /^([A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/;
const assertFleetVehicleFields = ({ make, model, number, color }, existing = null) => {
  const rules = [
    ["car_brand", make, existing?.car_brand, (s) => /^[A-Za-z .-]{2,30}$/.test(s), "Enter a valid car brand (letters only)"],
    ["car_model", model, existing?.car_model, (s) => /^[A-Za-z0-9 .-]{1,30}$/.test(s) && /[A-Za-z0-9]/.test(s), "Enter a valid car model"],
    [
      "license_plate_number",
      number,
      existing?.license_plate_number,
      (s) => VEHICLE_PLATE_RE.test(s.toUpperCase().replace(/[^A-Z0-9]/g, "")),
      "Enter a valid number plate, e.g. MP09AB1234",
    ],
    ["car_color", color, existing?.car_color, (s) => /^[A-Za-z ]{3,20}$/.test(s), "Enter a valid car colour (letters only)"],
  ];
  for (const [field, value, current, isValid, message] of rules) {
    if (existing && String(value).trim() === String(current || "").trim()) continue;
    if (!isValid(String(value).trim())) {
      throw new ApiError(422, message, { field }, "INVALID_VEHICLE_FIELD");
    }
  }
};

export const addOwnerVehicle = async (req, res) => {
  let owner = await resolveAuthenticatedOwner(req);
  let driverPermissions = null;

  if (req.auth?.role === "driver") {
    const { getDriverPermissions } = await import(
      "../../services/driverCategoryService.js"
    );
    driverPermissions = await getDriverPermissions(req.auth.sub);

    // Any approved driver may register a second vehicle under their own
    // organisation — not only Middle/Prime. Buying Middle/Prime requires a
    // vehicle mix a single onboarding vehicle can never satisfy, so without
    // this a Lower driver could never become eligible in the first place.
    // This does not hand Lower a free fleet: `max_vehicles` below still caps
    // how many they may hold before actually upgrading.
    if (!owner?._id) {
      if (driverPermissions.driver.approve !== true) {
        throw new ApiError(
          403,
          "Your account is not approved yet",
          null,
          "DRIVER_NOT_APPROVED",
        );
      }

      const { ensureOrganizationForPrime } = await import(
        "../services/networkRideService.js"
      );
      owner = await ensureOrganizationForPrime(req.auth.sub);
    }
  }

  if (!owner?._id) {
    throw new ApiError(
      403,
      "Vehicle addition is only available for owner accounts",
    );
  }

  if (driverPermissions) {
    const maxVehicles = Math.max(0, Number(driverPermissions.max_vehicles ?? 0));
    if (maxVehicles > 0) {
      // The vehicle the driver registered with counts too: it lives on the driver,
      // not in the fleet list, unless it was also added there.
      const fleetPlates = (
        await FleetVehicle.find({ owner_id: owner._id, active: true }).select('license_plate_number').lean()
      ).map((item) => String(item.license_plate_number || '').toUpperCase().replace(/\s+/g, ''));
      const primaryPlate = String(driverPermissions.driver?.vehicleNumber || '').toUpperCase().replace(/\s+/g, '');
      const usedVehicles = fleetPlates.length + (primaryPlate && !fleetPlates.includes(primaryPlate) ? 1 : 0);
      if (usedVehicles >= maxVehicles) {
        throw new ApiError(
          403,
          `Your plan allows up to ${maxVehicles} vehicle(s)`,
          { limit: maxVehicles, used: usedVehicles },
          "VEHICLE_LIMIT_REACHED",
        );
      }
    }
  }

  const { vehicleTypeId, make, model, number, color, rcFile, documents, usage_type: usageType } =
    req.body;
  // Validated before any document is uploaded, so a bad year wastes nothing.
  const vehicleSpecs = readFleetVehicleSpecs(req.body);

  if (!vehicleTypeId || !mongoose.isValidObjectId(vehicleTypeId)) {
    throw new ApiError(400, "A valid vehicle type is required", null, "FIELD_REQUIRED");
  }

  if (!make?.trim()) {
    throw new ApiError(400, "Car brand/make is required", null, "FIELD_REQUIRED");
  }

  const normalizedUsageType = normalizeVehicleUsageType(usageType);

  if (!model?.trim()) {
    throw new ApiError(400, "Car model is required", null, "FIELD_REQUIRED");
  }

  if (!number?.trim()) {
    throw new ApiError(400, "License plate number is required", null, "FIELD_REQUIRED");
  }

  if (!color?.trim()) {
    throw new ApiError(400, "Car color is required", null, "FIELD_REQUIRED");
  }

  const normalizedPlate = String(number).trim().toUpperCase();

  assertFleetVehicleFields({ make, model, number: normalizedPlate, color });
  await assertPlateAvailable({ plate: normalizedPlate });

  // Checked against the raw, not-yet-uploaded documents map — a request
  // that's missing a required document must fail before anything reaches
  // Cloudinary, not after leaving an orphaned upload behind.
  const requiredVehicleTemplates = await listVehicleDocumentTemplates(normalizedUsageType);
  const missingFleetDocuments = findMissingDocuments(requiredVehicleTemplates, documents);

  if (missingFleetDocuments.length > 0) {
    throw new ApiError(
      400,
      `Missing required documents: ${missingFleetDocuments.join(", ")}`,
      { missing: missingFleetDocuments },
      "DOCUMENTS_REQUIRED",
    );
  }

  const missingDocumentDetails = findMissingDocumentDetails(requiredVehicleTemplates, documents);

  if (missingDocumentDetails.length > 0) {
    throw new ApiError(
      400,
      `Missing required document details: ${missingDocumentDetails.join(", ")}`,
      { missing: missingDocumentDetails },
      "DOCUMENT_DETAILS_REQUIRED",
    );
  }

  // Also pre-upload, same reasoning: a document with a garbled or
  // already-expired date is worse than no date at all.
  validateAndStampDocumentExpiry(documents);

  // A commercial vehicle is what unlocks the Prime/Middle categories, so the
  // permit that proves it is commercial has to be supplied up front — admin
  // still verifies it before `usage_type_verified` is set.
  if (normalizedUsageType === "commercial" && !documents?.[COMMERCIAL_PERMIT_KEY]) {
    throw new ApiError(
      400,
      "A commercial permit document is required for a commercial vehicle",
      { required_document: COMMERCIAL_PERMIT_KEY },
      "COMMERCIAL_PERMIT_REQUIRED",
    );
  }

  const normalizedDocuments = await normalizeFleetVehicleDocuments(documents, rcFile);

  // Get service location from owner or use first available
  let serviceLocationId = owner.service_location_id;
  if (!serviceLocationId) {
    const defaultLocation = await ServiceLocation.findOne({ active: true })
      .select("_id")
      .lean();
    if (!defaultLocation) {
      throw new ApiError(400, "No service location available");
    }
    serviceLocationId = defaultLocation._id;
  }

  const vehicle = await FleetVehicle.create({
    owner_id: owner._id,
    service_location_id: serviceLocationId,
    transport_type: "taxi",
    vehicle_type_id:
      vehicleTypeId && String(vehicleTypeId).trim() ? vehicleTypeId : null,
    car_brand: String(make).trim(),
    car_model: String(model).trim(),
    license_plate_number: normalizedPlate,
    car_color: String(color).trim(),
    ...vehicleSpecs,
    usage_type: normalizedUsageType,
    status: "pending",
    active: true,
    documents: normalizedDocuments,
  });
  await recalculateOwnerVehicleCount(owner._id);
  await recheckOwnerFleetCategoryRule(owner._id);

  const populated = await FleetVehicle.findById(vehicle._id)
    .populate("owner_id", "company_name owner_name name email mobile")
    .populate("service_location_id", "service_location_name name country")
    .populate("vehicle_type_id", "name type_name transport_type icon_types")
    .lean();

  res.status(201).json({
    success: true,
    message: "Vehicle added successfully and is pending approval",
    data: {
      id: String(populated._id),
      owner_id: String(populated.owner_id?._id || ""),
      owner_name:
        populated.owner_id?.company_name ||
        populated.owner_id?.owner_name ||
        populated.owner_id?.name ||
        "",
      service_location_id: String(populated.service_location_id?._id || ""),
      service_location_name:
        populated.service_location_id?.service_location_name ||
        populated.service_location_id?.name ||
        "",
      transport_type: populated.transport_type,
      vehicle_type_id: String(populated.vehicle_type_id?._id || ""),
      vehicle_type_name:
        populated.vehicle_type_id?.name ||
        populated.vehicle_type_id?.type_name ||
        "",
      car_brand: populated.car_brand,
      car_model: populated.car_model,
      license_plate_number: populated.license_plate_number,
      car_color: populated.car_color,
      ...serializeFleetVehicleSpecs(populated),
      status: populated.status,
      active: populated.active,
      createdAt: populated.createdAt,
    },
  });
};

const FLEET_VEHICLE_FUEL_TYPES = ["petrol", "diesel", "cng", "electric", "hybrid", "lpg"];
const FITNESS_DOCUMENT_KEY = /fitness/i;

const hasBodyField = (body, ...keys) =>
  keys.some((key) => Object.prototype.hasOwnProperty.call(body || {}, key));

/**
 * The optional My Vehicles details (fuel, model year, fitness date), read
 * from snake_case or camelCase keys. Only fields present in the body are
 * returned, so an edit that omits one leaves it unchanged; '' or null clears.
 */
const readFleetVehicleSpecs = (body = {}) => {
  const specs = {};

  if (hasBodyField(body, "fuel_type", "fuelType")) {
    const fuelType = String(body.fuel_type ?? body.fuelType ?? "").trim().toLowerCase();
    if (fuelType && !FLEET_VEHICLE_FUEL_TYPES.includes(fuelType)) {
      throw new ApiError(422, "Unknown fuel type", { options: FLEET_VEHICLE_FUEL_TYPES }, "INVALID_FUEL_TYPE");
    }
    specs.fuel_type = fuelType;
  }

  if (hasBodyField(body, "model_year", "modelYear")) {
    const raw = body.model_year ?? body.modelYear;
    if (raw === null || String(raw).trim() === "") {
      specs.model_year = null;
    } else {
      const year = Number(raw);
      const latestYear = new Date().getFullYear() + 1;
      if (!Number.isInteger(year) || year < 1980 || year > latestYear) {
        throw new ApiError(422, `Model year must be between 1980 and ${latestYear}`, null, "INVALID_MODEL_YEAR");
      }
      specs.model_year = year;
    }
  }

  if (hasBodyField(body, "fitness_valid_till", "fitnessValidTill")) {
    const raw = String(body.fitness_valid_till ?? body.fitnessValidTill ?? "").trim();
    if (!raw) {
      specs.fitness_valid_till = null;
    } else {
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) {
        throw new ApiError(422, "fitness_valid_till must be a valid date", null, "INVALID_DATE");
      }
      specs.fitness_valid_till = date;
    }
  }

  return specs;
};

// A fitness certificate uploaded against an admin document template is the
// better source than a typed date; fall back to the typed one.
const resolveFitnessValidTill = (vehicle = {}) => {
  const documentExpiries = Object.entries(vehicle.documents || {})
    .filter(([key]) => FITNESS_DOCUMENT_KEY.test(key))
    .map(([, value]) => new Date(value?.expiryDate || value?.expiry_date || ""))
    .filter((date) => !Number.isNaN(date.getTime()));

  if (documentExpiries.length) {
    return new Date(Math.max(...documentExpiries.map((date) => date.getTime())));
  }
  return vehicle.fitness_valid_till || null;
};

const serializeFleetVehicleSpecs = (vehicle = {}) => ({
  fuel_type: vehicle.fuel_type || "",
  model_year: vehicle.model_year ?? null,
  fitness_valid_till: resolveFitnessValidTill(vehicle),
});

export const getOwnerFleetVehicles = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);

  // Any approved driver can open an organisation now (addOwnerVehicle no
  // longer gates on Middle/Prime), so "no organisation yet" is a normal,
  // reachable state for a driver who simply hasn't added a vehicle yet — not
  // an access-control failure. An empty list is the correct answer; a 403
  // here reads as "you're not allowed", which stopped being true.
  // The plan's vehicle cap for a driver-run organisation; null means no cap
  // (owner accounts, or a tier whose max_vehicles is 0).
  let maxVehiclesAllowed = null;
  if (req.auth?.role === "driver") {
    const { getDriverPermissions } = await import("../../services/driverCategoryService.js");
    const permissions = await getDriverPermissions(req.auth.sub);
    const maxVehicles = Math.max(0, Number(permissions.max_vehicles ?? 0));
    maxVehiclesAllowed = maxVehicles > 0 ? maxVehicles : null;
  }

  if (!owner?._id) {
    return res.json({
      success: true,
      data: { results: [], max_vehicles_allowed: maxVehiclesAllowed, vehicles_count: 0 },
    });
  }

  const vehicles = await FleetVehicle.find({
    owner_id: owner._id,
    active: true,
  })
    .populate("vehicle_type_id", "name type_name transport_type icon_types")
    .sort({ createdAt: -1 })
    .lean();
  const assignedDrivers = await Driver.find({
    owner_id: owner._id,
    assignedFleetVehicleId: { $ne: null },
    deletedAt: null,
  })
    .select("name phone vehicleNumber assignedFleetVehicleId zoneId isOnRide")
    .populate("zoneId", "name")
    .lean();
  const assignedDriverMap = new Map(
    assignedDrivers.map((driver) => [
      String(driver.assignedFleetVehicleId || ""),
      serializeOwnerFleetAssignedDriver(driver),
    ]),
  );

  res.json({
    success: true,
    data: {
      results: vehicles.map((vehicle) => ({
        _id: String(vehicle._id),
        id: String(vehicle._id),
        vehicle_type_id: vehicle.vehicle_type_id?._id || null,
        vehicle_type_name:
          vehicle.vehicle_type_id?.name ||
          vehicle.vehicle_type_id?.type_name ||
          "",
        car_brand: vehicle.car_brand || "",
        car_model: vehicle.car_model || "",
        license_plate_number: vehicle.license_plate_number || "",
        car_color: vehicle.car_color || "",
        ...serializeFleetVehicleSpecs(vehicle),
        usage_type: vehicle.usage_type || "private",
        usage_type_verified: Boolean(vehicle.usage_type_verified),
        status: vehicle.status || "pending",
        reason: vehicle.reason || "",
        documents: vehicle.documents || {},
        documents_summary: Object.entries(vehicle.documents || {}).map(([key, value]) => ({
          key,
          uploaded: Boolean(value?.uploaded ?? true),
          previewUrl: value?.previewUrl || value?.secureUrl || "",
        })),
        rc_document:
          vehicle.documents?.rc ||
          vehicle.documents?.document ||
          vehicle.documents?.file ||
          "",
        transport_type: vehicle.transport_type || "taxi",
        assignedDriver: assignedDriverMap.get(String(vehicle._id)) || null,
        active: vehicle.active,
        createdAt: vehicle.createdAt,
        updatedAt: vehicle.updatedAt,
      })),
      max_vehicles_allowed: maxVehiclesAllowed,
      vehicles_count: vehicles.length,
    },
  });
};

export const getOwnerFleetZones = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);

  if (!owner?._id) {
    throw new ApiError(
      403,
      "Fleet zone access is only available for owner accounts",
    );
  }

  const zones = await listAvailableOwnerFleetZones(owner);

  res.json({
    success: true,
    data: {
      results: zones.map((zone) => ({
        id: String(zone._id || ""),
        _id: String(zone._id || ""),
        name: String(zone.name || "").trim(),
        service_location_id: String(zone.service_location_id || "").trim(),
      })),
    },
  });
};

export const updateOwnerFleetVehicle = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);

  if (!owner?._id) {
    throw new ApiError(
      403,
      "Fleet vehicle access is only available for owner accounts",
    );
  }

  const vehicleId = String(req.params?.vehicleId || "").trim();
  if (!vehicleId || !mongoose.isValidObjectId(vehicleId)) {
    throw new ApiError(400, "A valid vehicle id is required");
  }

  const vehicle = await FleetVehicle.findOne({
    _id: vehicleId,
    owner_id: owner._id,
    active: true,
  });

  if (!vehicle) {
    throw new ApiError(404, "Fleet vehicle not found");
  }

  // Editing the vehicle a driver is mid-trip in (a plate correction, a type
  // change) is exactly the kind of change that shouldn't land while they're
  // out on the road with it.
  const assignedDriver = await findAssignedDriver(owner._id, vehicle._id);
  if (assignedDriver?.isOnRide) {
    throw new ApiError(
      409,
      "This vehicle is on a trip right now. Edit it after the trip ends.",
      null,
      "VEHICLE_ON_TRIP",
    );
  }

  const vehicleTypeId =
    req.body?.vehicleTypeId || req.body?.vehicle_type_id || null;
  const make = String(
    req.body?.vehicleMake || req.body?.make || req.body?.car_brand || "",
  ).trim();
  const model = String(
    req.body?.vehicleModel || req.body?.model || req.body?.car_model || "",
  ).trim();
  const number = String(
    req.body?.vehicleNumber ||
      req.body?.number ||
      req.body?.license_plate_number ||
      "",
  )
    .trim()
    .toUpperCase();
  const color = String(
    req.body?.vehicleColor || req.body?.color || req.body?.car_color || "",
  ).trim();
  const rcFile = String(req.body?.rcFile || "").trim();
  const rawDocuments = req.body?.documents || {};

  if (!vehicleTypeId || !mongoose.isValidObjectId(vehicleTypeId)) {
    throw new ApiError(400, "A valid vehicle type is required", null, "FIELD_REQUIRED");
  }

  if (!make) {
    throw new ApiError(400, "Car brand/make is required", null, "FIELD_REQUIRED");
  }

  if (!model) {
    throw new ApiError(400, "Car model is required", null, "FIELD_REQUIRED");
  }

  if (!number) {
    throw new ApiError(400, "License plate number is required", null, "FIELD_REQUIRED");
  }

  if (!color) {
    throw new ApiError(400, "Car color is required", null, "FIELD_REQUIRED");
  }

  assertFleetVehicleFields({ make, model, number, color }, vehicle);
  await assertPlateAvailable({ plate: number, excludeId: vehicle._id });

  // Descriptive details only: changing them does not re-open verification.
  const vehicleSpecs = readFleetVehicleSpecs(req.body);

  // Optional on update so existing clients that don't send it keep working;
  // changing it re-opens verification because the permit has to be re-checked.
  const nextUsageType = normalizeVehicleUsageType(req.body?.usage_type, {
    required: false,
  });

  // Checked against the raw documents map (and what's already stored) before
  // anything new gets uploaded — same reasoning as addOwnerVehicle.
  const switchingToCommercial = nextUsageType === "commercial" && nextUsageType !== vehicle.usage_type;
  const hasCommercialPermit = Boolean(
    vehicle.documents?.[COMMERCIAL_PERMIT_KEY] || rawDocuments?.[COMMERCIAL_PERMIT_KEY],
  );
  if (switchingToCommercial && !hasCommercialPermit) {
    throw new ApiError(
      400,
      "A commercial permit document is required for a commercial vehicle",
      { required_document: COMMERCIAL_PERMIT_KEY },
      "COMMERCIAL_PERMIT_REQUIRED",
    );
  }

  // Split this request's `documents` into two kinds of edit:
  //  - a new/replacement photo (has some image candidate) — goes through
  //    normalizeFleetVehicleDocuments (and Cloudinary) once the checks below pass.
  //  - a number/expiry-only correction on a document that already has a photo
  //    on file — normalizeFleetVehicleDocumentValue would otherwise silently
  //    drop it, since it has no image to normalize.
  const imageOnlyRawDocuments = {};
  const detailOnlyUpdates = {};

  if (rawDocuments && typeof rawDocuments === "object" && !Array.isArray(rawDocuments)) {
    for (const [rawKey, value] of Object.entries(rawDocuments)) {
      const key = String(rawKey).trim();
      if (!key) continue;

      const imageCandidate =
        typeof value === "string"
          ? value.trim()
          : String(
              value?.dataUrl ||
                value?.previewUrl ||
                value?.secureUrl ||
                value?.url ||
                value?.imageUrl ||
                value?.image ||
                value?.fileUrl ||
                value?.document ||
                value?.file ||
                "",
            ).trim();

      if (imageCandidate) {
        imageOnlyRawDocuments[key] = value;
        continue;
      }

      if (value && typeof value === "object") {
        const identifyNumber = String(value.identifyNumber ?? value.identify_number ?? "").trim();
        const expiryDate = String(value.expiryDate ?? value.expiry_date ?? "").trim();
        if (identifyNumber || expiryDate) {
          detailOnlyUpdates[key] = { identifyNumber, expiryDate };
        }
      }
    }
  }

  // The legacy top-level `rcFile` field is always an image-type update for `rc`.
  const legacyRcFile = rcFile || req.body?.document || req.body?.file || "";
  if (legacyRcFile && !imageOnlyRawDocuments.rc) {
    imageOnlyRawDocuments.rc = legacyRcFile;
  }

  // Gap 4: validate + stamp expiresAt on everything touched this request,
  // before anything is checked for completeness or uploaded.
  validateAndStampDocumentExpiry(imageOnlyRawDocuments);
  for (const [key, detail] of Object.entries(detailOnlyUpdates)) {
    if (!detail.expiryDate) continue;
    const parsed = new Date(detail.expiryDate);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() < Date.now()) {
      throw new ApiError(
        400,
        `${key} expiry date is invalid or already in the past`,
        { key },
        "DOCUMENT_EXPIRED",
      );
    }
    detail.expiresAt = parsed.toISOString();
  }

  // Gap 2: a number/expiry-only edit must target a document that already has
  // a photo on file — there's nothing to attach the number to otherwise.
  const detailOnlyFinalDocuments = {};
  for (const [key, detail] of Object.entries(detailOnlyUpdates)) {
    const existing = vehicle.documents?.[key];
    if (!existing) {
      throw new ApiError(
        400,
        `No existing ${key} document to update`,
        { missing: [key] },
        "DOCUMENTS_REQUIRED",
      );
    }

    detailOnlyFinalDocuments[key] = {
      ...existing,
      ...(detail.identifyNumber ? { identifyNumber: detail.identifyNumber } : {}),
      ...(detail.expiryDate ? { expiryDate: detail.expiryDate, expiresAt: detail.expiresAt } : {}),
    };
  }

  // Gap 1: the same required-document checks addOwnerVehicle runs, scoped to
  // the vehicle's usage type *after* this request's change — a usage switch
  // can bring new required templates into play. Checked against the raw,
  // not-yet-uploaded documents (merged with what's already stored), before
  // anything reaches Cloudinary, same reasoning as addOwnerVehicle.
  const effectiveUsageType = nextUsageType || vehicle.usage_type;
  const requiredVehicleTemplates = await listVehicleDocumentTemplates(effectiveUsageType);
  const touchedDocuments = { ...imageOnlyRawDocuments, ...detailOnlyFinalDocuments };
  const mergedDocumentsForPresenceCheck = { ...(vehicle.documents || {}), ...touchedDocuments };

  const missingFleetDocuments = findMissingDocuments(requiredVehicleTemplates, mergedDocumentsForPresenceCheck);
  if (missingFleetDocuments.length > 0) {
    throw new ApiError(
      400,
      `Missing required documents: ${missingFleetDocuments.join(", ")}`,
      { missing: missingFleetDocuments },
      "DOCUMENTS_REQUIRED",
    );
  }

  // Only documents actually touched this request are checked for number/expiry
  // — an old document saved before the rule existed must not block an
  // unrelated edit like colour or model.
  const missingDocumentDetails = findMissingDocumentDetails(requiredVehicleTemplates, touchedDocuments);
  if (missingDocumentDetails.length > 0) {
    throw new ApiError(
      400,
      `Missing required document details: ${missingDocumentDetails.join(", ")}`,
      { missing: missingDocumentDetails },
      "DOCUMENT_DETAILS_REQUIRED",
    );
  }

  // Everything checked out — only now does a new/replacement photo actually upload.
  const nextDocuments = await normalizeFleetVehicleDocuments(imageOnlyRawDocuments, "");

  // Snapshot before mutating: a plate/type/usage/document change on an
  // already-approved vehicle means admin approved something that no longer
  // describes this vehicle, so it has to go back through verification. Make,
  // model and colour are cosmetic and don't trigger this. A number/expiry-only
  // correction counts too — admin approved a specific number, so a changed one
  // has to be re-verified the same as a changed photo would be.
  const wasApproved = String(vehicle.status || "").toLowerCase() === "approved";
  const materialChange =
    String(vehicle.vehicle_type_id || "") !== String(vehicleTypeId) ||
    vehicle.license_plate_number !== number ||
    (nextUsageType && nextUsageType !== vehicle.usage_type) ||
    Object.keys(nextDocuments).length > 0 ||
    Object.keys(detailOnlyFinalDocuments).length > 0;

  vehicle.vehicle_type_id = vehicleTypeId;
  vehicle.car_brand = make;
  vehicle.car_model = model;
  vehicle.license_plate_number = number;
  vehicle.car_color = color;
  Object.assign(vehicle, vehicleSpecs);
  if (nextUsageType && nextUsageType !== vehicle.usage_type) {
    vehicle.usage_type = nextUsageType;
    vehicle.usage_type_verified = false;
  }
  if (Object.keys(nextDocuments).length > 0 || Object.keys(detailOnlyFinalDocuments).length > 0) {
    vehicle.documents = {
      ...(vehicle.documents || {}),
      ...nextDocuments,
      ...detailOnlyFinalDocuments,
    };
    vehicle.markModified("documents");
  }
  if (String(vehicle.status || "").toLowerCase() === "rejected") {
    vehicle.status = "pending";
    vehicle.reason = "";
  } else if (wasApproved && materialChange) {
    vehicle.status = "pending";
    vehicle.reason = "";
  }

  await vehicle.save();

  const populated = await FleetVehicle.findById(vehicle._id)
    .populate("vehicle_type_id", "name type_name transport_type icon_types")
    .lean();

  // The driver's own copy of the vehicle (make/model/plate/colour) mustn't go
  // stale the moment the owner edits it here.
  await syncAssignedDriverVehicle(populated);
  // A material change can be exactly what breaks the Prime/Middle
  // commercial+private rule for this fleet (e.g. the vehicle that used to
  // satisfy it just went back to pending) — this starts the grace window
  // rather than downgrading on the spot, same as add/delete.
  await recheckOwnerFleetCategoryRule(owner._id);

  res.json({
    success: true,
    message:
      String(populated.status || "").toLowerCase() === "pending"
        ? "Vehicle updated and resubmitted for verification"
        : "Vehicle updated successfully",
    data: {
      _id: String(populated._id),
      id: String(populated._id),
      vehicle_type_id: populated.vehicle_type_id?._id || null,
      vehicle_type_name:
        populated.vehicle_type_id?.name ||
        populated.vehicle_type_id?.type_name ||
        "",
      car_brand: populated.car_brand || "",
      car_model: populated.car_model || "",
      license_plate_number: populated.license_plate_number || "",
      car_color: populated.car_color || "",
      ...serializeFleetVehicleSpecs(populated),
      usage_type: populated.usage_type || "private",
      usage_type_verified: Boolean(populated.usage_type_verified),
      status: populated.status || "pending",
      reason: populated.reason || "",
      documents: populated.documents || {},
      rc_document:
        populated.documents?.rc ||
        populated.documents?.document ||
        populated.documents?.file ||
        "",
      transport_type: populated.transport_type || "taxi",
      active: populated.active,
      createdAt: populated.createdAt,
      updatedAt: populated.updatedAt,
    },
  });
};

export const deleteOwnerFleetVehicle = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);

  if (!owner?._id) {
    throw new ApiError(
      403,
      "Fleet vehicle access is only available for owner accounts",
    );
  }

  const vehicleId = String(req.params?.vehicleId || "").trim();
  if (!mongoose.isValidObjectId(vehicleId)) {
    throw new ApiError(400, "A valid vehicle id is required", null, "FIELD_REQUIRED");
  }

  const vehicle = await FleetVehicle.findOne({
    _id: vehicleId,
    owner_id: owner._id,
  });

  if (!vehicle) {
    throw new ApiError(404, "Fleet vehicle not found");
  }

  // A driver pointing at a vehicle that no longer exists is worse than
  // refusing the delete — reassign or remove the driver first. This also
  // covers a driver currently on a trip in it, since they're still assigned.
  const assignedDriver = await findAssignedDriver(owner._id, vehicle._id);

  if (assignedDriver) {
    const driverName = assignedDriver.name || assignedDriver.phone || "a driver";
    throw new ApiError(
      409,
      `Vehicle is assigned to ${driverName}. Assign ${driverName} another vehicle or remove the driver first.`,
      { driver_id: String(assignedDriver._id), driver_name: driverName },
      "VEHICLE_ASSIGNED",
    );
  }

  await FleetVehicle.deleteOne({ _id: vehicle._id });
  await recalculateOwnerVehicleCount(owner._id);
  // Losing the only commercial (or only private) vehicle breaks the Prime/Middle
  // rule; that starts a grace window rather than downgrading on the spot.
  await recheckOwnerFleetCategoryRule(owner._id);

  res.json({
    success: true,
    message: "Vehicle deleted successfully",
    data: { deleted: true },
  });
};

export const getOwnerFleetDrivers = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);

  // See getOwnerFleetVehicles just above: no organisation yet is a normal
  // state for any approved driver now, not an access-control failure.
  if (!owner?._id) {
    return res.json({ success: true, data: { results: [] } });
  }

  // `ensureOrganizationForPrime` sets a Pro/Elite driver's own `owner_id` to
  // their organisation, so without this the requester shows up in their own
  // fleet list. `assertFleetDriverCapacity` already excludes them from the
  // count; the list has to agree with that.
  const requesterId =
    req.auth?.role === "driver" ? String(req.auth.sub || "") : null;

  const drivers = await Driver.find({
    owner_id: owner._id,
    deletedAt: null,
    ...(requesterId ? { _id: { $ne: requesterId } } : {}),
  })
    .sort({ createdAt: -1 })
    .select("name phone documents approve status isOnline isOnRide createdAt assignedFleetVehicleId")
    .lean();
  const assignedVehicleIds = drivers
    .map((driver) => String(driver.assignedFleetVehicleId || "").trim())
    .filter(Boolean);
  const assignedVehicles = assignedVehicleIds.length
    ? await FleetVehicle.find({
        _id: { $in: assignedVehicleIds },
        owner_id: owner._id,
        active: true,
      })
        .populate("vehicle_type_id", "name type_name transport_type icon_types")
        .lean()
    : [];
  const assignedVehicleMap = new Map(
    assignedVehicles.map((vehicle) => [String(vehicle._id || ""), vehicle]),
  );

  res.json({
    success: true,
    data: {
      results: drivers.map((driver) =>
        serializeOwnerFleetDriver(
          driver,
          assignedVehicleMap.get(String(driver.assignedFleetVehicleId || "")) ||
            null,
        ),
      ),
    },
  });
};

export const createOwnerFleetDriver = async (req, res) => {
  let owner = await resolveAuthenticatedOwner(req);

  // Mirrors addOwnerVehicle: any approved driver may open an organisation by
  // adding their first fleet driver, not only once they've separately added a
  // vehicle. Owner-portal logins already have one, so this only applies when
  // it's a driver acting as their own fleet owner.
  if (!owner?._id && req.auth?.role === "driver") {
    const { getDriverPermissions } = await import(
      "../../services/driverCategoryService.js"
    );
    const driverPermissions = await getDriverPermissions(req.auth.sub);

    if (driverPermissions.driver.approve !== true) {
      throw new ApiError(
        403,
        "Your account is not approved yet",
        null,
        "DRIVER_NOT_APPROVED",
      );
    }

    const { ensureOrganizationForPrime } = await import(
      "../services/networkRideService.js"
    );
    owner = await ensureOrganizationForPrime(req.auth.sub);
  }

  if (!owner?._id) {
    throw new ApiError(
      403,
      "Fleet driver access is only available for owner accounts",
    );
  }

  await assertFleetDriverCapacity({ req, owner });

  const name = String(req.body?.name || "").trim();
  const phone = normalizePhone(req.body?.phone || req.body?.mobile);

  if (!name) {
    throw new ApiError(400, "name is required");
  }

  if (!/^\d{10}$/.test(phone)) {
    throw new ApiError(400, "A valid 10-digit mobile number is required");
  }

  const existingByPhone = await Driver.findOne({ phone });
  // A driver removed from a fleet keeps their phone on their old record
  // (owner_id: null, status: 'inactive') — that used to make the number
  // permanently unusable for any owner ("already registered", forever).
  // Re-attach that record instead of creating a new one; anything else
  // (self-registered, or attached to a different fleet) is a real conflict.
  const isReattach =
    Boolean(existingByPhone) &&
    existingByPhone.owner_id == null &&
    existingByPhone.status === "inactive";

  if (existingByPhone && !isReattach) {
    throw new ApiError(
      409,
      "This number is already registered with another account",
      null,
      "PHONE_ALREADY_REGISTERED",
    );
  }

  const assignedFleetVehicleId =
    req.body?.assignedFleetVehicleId ?? req.body?.assigned_fleet_vehicle_id;

  if (!String(assignedFleetVehicleId || "").trim()) {
    throw new ApiError(
      400,
      "Assign a vehicle to this driver",
      null,
      "VEHICLE_REQUIRED",
    );
  }

  const assignedFleetVehicle = await resolveOwnerFleetVehicleAssignment({
    owner,
    driverId: isReattach ? existingByPhone._id : null,
    assignedFleetVehicleId,
  });

  if (assignedFleetVehicle.status === "rejected") {
    throw new ApiError(
      409,
      "This vehicle was rejected, fix it before assigning",
      null,
      "VEHICLE_REJECTED",
    );
  }

  const requiredDocumentTemplates = await listFleetDriverDocumentTemplates();
  const missingDocuments = findMissingDocuments(
    requiredDocumentTemplates,
    req.body?.documents,
  );

  if (missingDocuments.length > 0) {
    throw new ApiError(
      400,
      `Missing required documents: ${missingDocuments.join(", ")}`,
      { missing: missingDocuments },
      "DOCUMENTS_REQUIRED",
    );
  }

  const serviceLocationId = owner.service_location_id || null;
  const serviceLocation = serviceLocationId
    ? await ServiceLocation.findById(serviceLocationId).lean()
    : null;
  const coordinates =
    Array.isArray(serviceLocation?.location?.coordinates) &&
    serviceLocation.location.coordinates.length === 2
      ? serviceLocation.location.coordinates
      : typeof serviceLocation?.longitude === "number" &&
          typeof serviceLocation?.latitude === "number"
        ? [serviceLocation.longitude, serviceLocation.latitude]
        : [75.8577, 22.7196];
  const city = String(
    serviceLocation?.service_location_name || serviceLocation?.name || "",
  ).trim();

  const vehicleKind = normalizeOwnerFleetVehicleKind(
    assignedFleetVehicle.vehicle_type_id,
  );
  const uploadedDocuments = await uploadOwnerFleetDriverDocuments(req.body?.documents);
  const vehicleFields = {
    assignedFleetVehicleId: assignedFleetVehicle._id,
    vehicleType: vehicleKind,
    vehicleTypeId: assignedFleetVehicle.vehicle_type_id?._id || null,
    vehicleIconType: assignedFleetVehicle.vehicle_type_id?.icon_types || vehicleKind,
    vehicleMake: assignedFleetVehicle.car_brand || "",
    vehicleModel: assignedFleetVehicle.car_model || "",
    vehicleNumber: assignedFleetVehicle.license_plate_number || "",
    vehicleColor: assignedFleetVehicle.car_color || "",
  };

  let driver;
  if (isReattach) {
    Object.assign(existingByPhone, {
      owner_id: owner._id,
      service_location_id: serviceLocationId,
      documents: uploadedDocuments,
      name,
      city,
      approve: false,
      status: "pending",
      registerFor: "taxi",
      ...vehicleFields,
    });
    existingByPhone.markModified("documents");
    await existingByPhone.save();
    driver = existingByPhone;
  } else {
    const tempPassword = crypto.randomUUID().slice(0, 12);
    driver = await Driver.create({
      owner_id: owner._id,
      service_location_id: serviceLocationId,
      documents: uploadedDocuments,
      name,
      phone,
      gender: "",
      password: await hashPassword(tempPassword),
      registerFor: "taxi",
      city,
      approve: false,
      status: "pending",
      location: toPoint(coordinates, "location"),
      ...vehicleFields,
    });
  }

  res.status(201).json({
    success: true,
    data: {
      ...serializeOwnerFleetDriver(driver, assignedFleetVehicle),
      message: "Fleet driver request created",
    },
  });
};

export const getOwnerFleetDashboard = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);

  if (!owner?._id) {
    throw new ApiError(
      403,
      "Owner dashboard is only available for owner accounts",
    );
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [serviceLocation, drivers, vehicles] = await Promise.all([
    owner.service_location_id
      ? ServiceLocation.findById(owner.service_location_id)
          .select(
            "name service_location_name address city status active latitude longitude location currency_symbol currency_code timezone",
          )
          .lean()
      : null,
    Driver.find({ owner_id: owner._id, deletedAt: null })
      .select("name phone email city approve status isOnline isOnRide createdAt")
      .sort({ createdAt: -1 })
      .lean(),
    FleetVehicle.find({ owner_id: owner._id, active: true })
      .populate("vehicle_type_id", "name type_name transport_type")
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const driverIds = drivers.map((driver) => driver._id);

  const emptyMetrics = {
    totalBookings: 0,
    completedBookings: 0,
    cancelledBookings: 0,
    activeBookings: 0,
    grossRevenue: 0,
    ownerEarnings: 0,
    cashTrips: 0,
    onlineTrips: 0,
  };

  let rideMetrics = emptyMetrics;
  let todayMetrics = emptyMetrics;
  let transportBreakdown = [];
  let recentRides = [];

  if (driverIds.length > 0) {
    const [rideMetricsResult, todayMetricsResult, transportBreakdownResult, recentRideDocs] =
      await Promise.all([
        Ride.aggregate([
          { $match: { driverId: { $in: driverIds } } },
          {
            $group: {
              _id: null,
              totalBookings: { $sum: 1 },
              completedBookings: {
                $sum: {
                  $cond: [{ $eq: ["$status", RIDE_STATUS.COMPLETED] }, 1, 0],
                },
              },
              cancelledBookings: {
                $sum: {
                  $cond: [{ $eq: ["$status", RIDE_STATUS.CANCELLED] }, 1, 0],
                },
              },
              activeBookings: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        "$status",
                        [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              grossRevenue: {
                $sum: {
                  $cond: [
                    { $eq: ["$status", RIDE_STATUS.COMPLETED] },
                    { $ifNull: ["$fare", 0] },
                    0,
                  ],
                },
              },
              ownerEarnings: {
                $sum: {
                  $cond: [
                    { $eq: ["$status", RIDE_STATUS.COMPLETED] },
                    { $ifNull: ["$driverEarnings", 0] },
                    0,
                  ],
                },
              },
              cashTrips: {
                $sum: {
                  $cond: [{ $eq: ["$paymentMethod", "cash"] }, 1, 0],
                },
              },
              onlineTrips: {
                $sum: {
                  $cond: [{ $eq: ["$paymentMethod", "online"] }, 1, 0],
                },
              },
            },
          },
        ]),
        Ride.aggregate([
          {
            $match: {
              driverId: { $in: driverIds },
              createdAt: { $gte: startOfToday },
            },
          },
          {
            $group: {
              _id: null,
              totalBookings: { $sum: 1 },
              completedBookings: {
                $sum: {
                  $cond: [{ $eq: ["$status", RIDE_STATUS.COMPLETED] }, 1, 0],
                },
              },
              cancelledBookings: {
                $sum: {
                  $cond: [{ $eq: ["$status", RIDE_STATUS.CANCELLED] }, 1, 0],
                },
              },
              activeBookings: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        "$status",
                        [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              grossRevenue: {
                $sum: {
                  $cond: [
                    { $eq: ["$status", RIDE_STATUS.COMPLETED] },
                    { $ifNull: ["$fare", 0] },
                    0,
                  ],
                },
              },
              ownerEarnings: {
                $sum: {
                  $cond: [
                    { $eq: ["$status", RIDE_STATUS.COMPLETED] },
                    { $ifNull: ["$driverEarnings", 0] },
                    0,
                  ],
                },
              },
              cashTrips: {
                $sum: {
                  $cond: [{ $eq: ["$paymentMethod", "cash"] }, 1, 0],
                },
              },
              onlineTrips: {
                $sum: {
                  $cond: [{ $eq: ["$paymentMethod", "online"] }, 1, 0],
                },
              },
            },
          },
        ]),
        Ride.aggregate([
          { $match: { driverId: { $in: driverIds } } },
          {
            $group: {
              _id: { $ifNull: ["$transport_type", "taxi"] },
              trips: { $sum: 1 },
              completedTrips: {
                $sum: {
                  $cond: [{ $eq: ["$status", RIDE_STATUS.COMPLETED] }, 1, 0],
                },
              },
              earnings: {
                $sum: {
                  $cond: [
                    { $eq: ["$status", RIDE_STATUS.COMPLETED] },
                    { $ifNull: ["$driverEarnings", 0] },
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { trips: -1, _id: 1 } },
        ]),
        Ride.find({ driverId: { $in: driverIds } })
          .select(
            "pickupAddress dropAddress status fare driverEarnings paymentMethod transport_type createdAt driverId",
          )
          .populate("driverId", "name phone")
          .sort({ createdAt: -1 })
          .limit(6)
          .lean(),
      ]);

    const normalizeMetrics = (value = {}) => ({
      totalBookings: Number(value.totalBookings || 0),
      completedBookings: Number(value.completedBookings || 0),
      cancelledBookings: Number(value.cancelledBookings || 0),
      activeBookings: Number(value.activeBookings || 0),
      grossRevenue: Number(value.grossRevenue || 0),
      ownerEarnings: Number(value.ownerEarnings || 0),
      cashTrips: Number(value.cashTrips || 0),
      onlineTrips: Number(value.onlineTrips || 0),
    });

    rideMetrics = normalizeMetrics(rideMetricsResult[0] || emptyMetrics);
    todayMetrics = normalizeMetrics(todayMetricsResult[0] || emptyMetrics);
    transportBreakdown = transportBreakdownResult.map((item) => ({
      transportType: String(item._id || "taxi"),
      trips: Number(item.trips || 0),
      completedTrips: Number(item.completedTrips || 0),
      earnings: Number(item.earnings || 0),
    }));
    recentRides = recentRideDocs.map((ride) => ({
      id: String(ride._id),
      pickupAddress: ride.pickupAddress || "",
      dropAddress: ride.dropAddress || "",
      status: ride.status || "",
      fare: Number(ride.fare || 0),
      earnings: Number(ride.driverEarnings || 0),
      paymentMethod: ride.paymentMethod || "cash",
      transportType: ride.transport_type || "taxi",
      createdAt: ride.createdAt,
      driver: {
        id: String(ride.driverId?._id || ""),
        name: ride.driverId?.name || "",
        phone: ride.driverId?.phone || "",
      },
    }));
  }

  const approvedDrivers = drivers.filter(
    (driver) =>
      driver.approve === true ||
      String(driver.status || "").toLowerCase() === "approved",
  );
  const onlineDrivers = approvedDrivers.filter((driver) => driver.isOnline);
  const busyDrivers = approvedDrivers.filter((driver) => driver.isOnRide);
  const availableDrivers = approvedDrivers.filter(
    (driver) => driver.isOnline && !driver.isOnRide,
  );

  const approvedVehicles = vehicles.filter(
    (vehicle) => String(vehicle.status || "").toLowerCase() === "approved",
  );
  const pendingVehicles = vehicles.filter(
    (vehicle) => String(vehicle.status || "").toLowerCase() === "pending",
  );
  const rejectedVehicles = vehicles.filter(
    (vehicle) => String(vehicle.status || "").toLowerCase() === "rejected",
  );

  res.json({
    success: true,
    data: {
      profile: {
        id: String(owner._id),
        companyName: owner.company_name || owner.name || "",
        ownerName: owner.owner_name || owner.name || "",
        phone: owner.mobile || owner.phone || "",
        email: owner.email || "",
        city: owner.city || "",
        address: owner.address || "",
        transportType: owner.transport_type || "taxi",
        status: owner.status || "approved",
        walletBalance: Number(owner.wallet?.balance || 0),
        noOfVehicles: Number(owner.no_of_vehicles || 0),
      },
      serviceLocation: serviceLocation
        ? {
            id: String(serviceLocation._id),
            name:
              serviceLocation.service_location_name ||
              serviceLocation.name ||
              "",
            address: serviceLocation.address || "",
            status: serviceLocation.status || "active",
            active: serviceLocation.active !== false,
            latitude: Number(serviceLocation.latitude || 0),
            longitude: Number(serviceLocation.longitude || 0),
            currencySymbol:
              serviceLocation.currency_symbol &&
              serviceLocation.currency_symbol !== "â‚¹"
                ? serviceLocation.currency_symbol
                : "₹",
            currencyCode: serviceLocation.currency_code || "INR",
            timezone: serviceLocation.timezone || "Asia/Kolkata",
          }
        : null,
      fleet: {
        totalDrivers: drivers.length,
        approvedDrivers: approvedDrivers.length,
        onlineDrivers: onlineDrivers.length,
        busyDrivers: busyDrivers.length,
        availableDrivers: availableDrivers.length,
        pendingDrivers: Math.max(0, drivers.length - approvedDrivers.length),
        totalVehicles: vehicles.length,
        approvedVehicles: approvedVehicles.length,
        pendingVehicles: pendingVehicles.length,
        rejectedVehicles: rejectedVehicles.length,
      },
      bookings: {
        total: rideMetrics.totalBookings,
        active: rideMetrics.activeBookings,
        completed: rideMetrics.completedBookings,
        cancelled: rideMetrics.cancelledBookings,
        todayTotal: todayMetrics.totalBookings,
        todayCompleted: todayMetrics.completedBookings,
        todayCancelled: todayMetrics.cancelledBookings,
      },
      earnings: {
        walletBalance: Number(owner.wallet?.balance || 0),
        grossRevenue: rideMetrics.grossRevenue,
        ownerEarnings: rideMetrics.ownerEarnings,
        todayGrossRevenue: todayMetrics.grossRevenue,
        todayOwnerEarnings: todayMetrics.ownerEarnings,
        onlineTrips: rideMetrics.onlineTrips,
        cashTrips: rideMetrics.cashTrips,
      },
      transportBreakdown,
      recentDrivers: drivers.slice(0, 5).map((driver) => ({
        id: String(driver._id),
        name: driver.name || "",
        phone: driver.phone || "",
        city: driver.city || "",
        status: driver.status || "pending",
        isOnline: Boolean(driver.isOnline),
        isOnRide: Boolean(driver.isOnRide),
        createdAt: driver.createdAt,
      })),
      recentVehicles: vehicles.slice(0, 5).map((vehicle) => ({
        id: String(vehicle._id),
        brand: vehicle.car_brand || "",
        model: vehicle.car_model || "",
        color: vehicle.car_color || "",
        number: vehicle.license_plate_number || "",
        status: vehicle.status || "pending",
        transportType: vehicle.transport_type || "taxi",
        vehicleTypeName:
          vehicle.vehicle_type_id?.name ||
          vehicle.vehicle_type_id?.type_name ||
          "",
        createdAt: vehicle.createdAt,
      })),
      recentRides,
    },
  });
};

export const updateOwnerFleetDriver = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);

  if (!owner?._id) {
    throw new ApiError(
      403,
      "Fleet driver access is only available for owner accounts",
    );
  }

  const driverId = String(req.params?.driverId || "").trim();
  if (!driverId || !mongoose.isValidObjectId(driverId)) {
    throw new ApiError(400, "A valid driver id is required");
  }

  const driver = await Driver.findOne({
    _id: driverId,
    owner_id: owner._id,
    deletedAt: null,
  });

  if (!driver) {
    throw new ApiError(404, "Fleet driver not found");
  }

  const body = req.body || {};
  const wasApproved = driver.approve === true;
  let phoneChanged = false;
  let documentsUploaded = false;

  // Partial update: only fields present in the body are validated and
  // written. This is a targeted edit (rename, swap vehicle, add a document),
  // not a full-record replace.
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = String(body.name || "").trim();
    if (!name) {
      throw new ApiError(400, "name is required");
    }
    driver.name = name;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "phone") ||
    Object.prototype.hasOwnProperty.call(body, "mobile")
  ) {
    const phone = normalizePhone(body.phone || body.mobile);
    if (!/^\d{10}$/.test(phone)) {
      throw new ApiError(400, "A valid 10-digit mobile number is required");
    }

    if (phone !== driver.phone) {
      const existingPhone = await Driver.findOne({
        phone,
        _id: { $ne: driver._id },
      }).lean();
      if (existingPhone) {
        throw new ApiError(
          409,
          "This number is already registered with another account",
          null,
          "PHONE_ALREADY_REGISTERED",
        );
      }
      driver.phone = phone;
      phoneChanged = true;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "assignedFleetVehicleId") ||
    Object.prototype.hasOwnProperty.call(body, "assigned_fleet_vehicle_id")
  ) {
    const assignedFleetVehicleId =
      body.assignedFleetVehicleId ?? body.assigned_fleet_vehicle_id;

    if (!String(assignedFleetVehicleId || "").trim()) {
      throw new ApiError(
        400,
        "A fleet driver must always have a vehicle assigned",
        null,
        "VEHICLE_REQUIRED",
      );
    }

    const assignedFleetVehicle = await resolveOwnerFleetVehicleAssignment({
      owner,
      driverId: driver._id,
      assignedFleetVehicleId,
    });

    const vehicleChanged =
      String(assignedFleetVehicle._id) !==
      String(driver.assignedFleetVehicleId || "");

    // The current vehicle stays assigned until the trip ends; only a change
    // is blocked, so a no-op PATCH (re-sending the same vehicle) never fails.
    if (vehicleChanged && driver.isOnRide) {
      throw new ApiError(
        409,
        "Driver is on a trip, change the vehicle after it ends",
        null,
        "DRIVER_ON_TRIP",
      );
    }

    if (assignedFleetVehicle.status === "rejected") {
      throw new ApiError(
        409,
        "This vehicle was rejected, fix it before assigning",
        null,
        "VEHICLE_REJECTED",
      );
    }

    const vehicleKind = normalizeOwnerFleetVehicleKind(
      assignedFleetVehicle.vehicle_type_id,
    );
    driver.assignedFleetVehicleId = assignedFleetVehicle._id;
    driver.vehicleType = vehicleKind;
    driver.vehicleTypeId = assignedFleetVehicle.vehicle_type_id?._id || null;
    driver.vehicleIconType =
      assignedFleetVehicle.vehicle_type_id?.icon_types || vehicleKind;
    driver.vehicleMake = assignedFleetVehicle.car_brand || "";
    driver.vehicleModel = assignedFleetVehicle.car_model || "";
    driver.vehicleNumber = assignedFleetVehicle.license_plate_number || "";
    driver.vehicleColor = assignedFleetVehicle.car_color || "";
  }

  // Merged rather than replaced so re-uploading one document does not wipe the other.
  if (body.documents && Object.keys(body.documents).length > 0) {
    driver.documents = {
      ...(driver.documents || {}),
      ...(await uploadOwnerFleetDriverDocuments(body.documents)),
    };
    driver.markModified("documents");
    documentsUploaded = true;
  }

  // A vehicle swap alone doesn't need re-verification; a new phone number or
  // a new document does — send the driver back through admin review rather
  // than keeping an approval that no longer reflects what was reviewed.
  if (wasApproved && (phoneChanged || documentsUploaded)) {
    driver.approve = false;
    driver.status = "pending";
    driver.isOnline = false;
  }

  await driver.save();

  const assignedVehicle = driver.assignedFleetVehicleId
    ? await FleetVehicle.findById(driver.assignedFleetVehicleId)
        .populate("vehicle_type_id", "name type_name transport_type icon_types")
        .lean()
    : null;

  res.json({
    success: true,
    message: "Fleet driver updated successfully",
    data: serializeOwnerFleetDriver(driver, assignedVehicle),
  });
};

// Removes a hired driver from the owner's fleet. Deliberately not an account
// deletion: the driver has their own rides, wallet and history, and an owner must
// not be able to erase all of that from a fleet screen. They are detached from the
// fleet and deactivated, so re-activating them is an admin decision.
export const removeOwnerFleetDriver = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);

  if (!owner?._id) {
    throw new ApiError(
      403,
      "Fleet driver access is only available for owner accounts",
    );
  }

  const driverId = String(req.params?.driverId || "").trim();

  if (!mongoose.isValidObjectId(driverId)) {
    throw new ApiError(400, "A valid driver id is required");
  }

  const driver = await Driver.findOne({
    _id: driverId,
    owner_id: owner._id,
    deletedAt: null,
  });

  if (!driver) {
    throw new ApiError(404, "Fleet driver not found");
  }

  // Detaching mid-trip would strand the rider and leave the trip without a fleet.
  if (driver.isOnRide) {
    throw new ApiError(
      409,
      "This driver is on a trip right now. Try again once the trip is complete.",
    );
  }

  driver.owner_id = null;
  driver.assignedFleetVehicleId = null;
  // Clear the denormalized vehicle copy too, not just the reference — otherwise
  // a removed driver keeps showing the old fleet vehicle's make/model/plate
  // anywhere those fields are read directly off the driver.
  driver.vehicleMake = "";
  driver.vehicleModel = "";
  driver.vehicleNumber = "";
  driver.vehicleColor = "";
  driver.vehicleTypeId = null;
  driver.isOnline = false;
  driver.socketId = null;
  driver.approve = false;
  driver.status = "inactive";
  await driver.save();

  res.json({
    success: true,
    data: {
      id: String(driver._id),
      removed: true,
      message: "Driver removed from your fleet",
    },
  });
};

export const startDriverLoginOtpRequest = async (req, res) => {
  const result = await startDriverLoginOtp(req.body);
  res.status(201).json({ success: true, data: result });
};

export const verifyDriverLoginOtpRequest = async (req, res) => {
  const result = await verifyDriverLoginOtp(req.body);
  res.json({ success: true, data: result });
};

export const startOnboarding = async (req, res) => {
  const result = await startDriverOnboarding(req.body);
  res.status(201).json({ success: true, data: result });
};

export const verifyOnboardingOtp = async (req, res) => {
  const result = await verifyDriverOtp(req.body);
  res.json({ success: true, data: result });
};

export const saveOnboardingPersonal = async (req, res) => {
  const result = await saveDriverPersonalDetails(req.body);
  res.json({ success: true, data: result });
};

export const saveOnboardingReferral = async (req, res) => {
  const result = await saveDriverReferral(req.body);
  res.json({ success: true, data: result });
};

export const getOnboardingReferralProgram = async (req, res) => {
  const settings = await getDriverReferralProgramSettings();
  res.json({ success: true, data: settings });
};

export const saveOnboardingVehicle = async (req, res) => {
  const result = await saveDriverVehicle(req.body);
  res.json({ success: true, data: result });
};

export const saveOnboardingDocuments = async (req, res) => {
  const result = await saveDriverDocuments(req.body);
  res.json({ success: true, data: result });
};

export const completeOnboarding = async (req, res) => {
  const result = await completeDriverOnboarding(req.body);
  res.status(201).json({ success: true, data: result });
};

export const getOnboardingSession = async (req, res) => {
  const result = await getDriverOnboardingSession({
    registrationId: req.params.registrationId,
    phone: req.query.phone,
  });
  res.json({ success: true, data: result });
};

export const goOffline = async (req, res) => {
  const existingDriver = await Driver.findById(req.auth.sub);

  if (!existingDriver) {
    throw new ApiError(404, "Driver not found");
  }

  const finalizedTracking = mergeOnlineSessionIntoTracking(
    existingDriver.incentiveTracking || {},
    existingDriver.incentiveTracking?.currentOnlineStartedAt,
    new Date(),
  );
  const finalizedTodaySummary = buildDriverTodaySummaryFromDocument(existingDriver);

  const driver = await Driver.findByIdAndUpdate(
    req.auth.sub,
    {
      isOnline: false,
      socketId: null,
      incentiveTracking: {
        ...finalizedTracking,
        currentOnlineStartedAt: null,
        claimedRewards: pruneClaimedRewards(finalizedTracking?.claimedRewards),
      },
      todaySummary: finalizedTodaySummary,
    },
    { returnDocument: 'after' },
  );

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  res.json({
    success: true,
    data: driver,
  });
};

export const getDriverIncentives = async (req, res) => {
  const driver = await Driver.findById(req.auth.sub).lean();

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const liveDriver = {
    ...driver,
    incentiveTracking: {
      ...(driver.incentiveTracking || {}),
      ...mergeOnlineSessionIntoTracking(
        driver.incentiveTracking || {},
        driver.incentiveTracking?.currentOnlineStartedAt,
        new Date(),
      ),
    },
  };

  const settingsDoc = await AdminBusinessSetting.findOne({ scope: "default" }).lean();
  const driverSettings = settingsDoc?.referral?.driver || {};
  const rides = await Ride.find({ driverId: driver._id }).select("status liveStatus createdAt updatedAt completedAt").lean();

  const snapshot = buildDriverIncentiveSnapshot({
    driver: liveDriver,
    settings: driverSettings,
    rides,
  });

  res.json({
    success: true,
    data: snapshot,
  });
};

export const claimDriverIncentiveReward = async (req, res) => {
  const { rewardType, rewardKey } = req.body || {};
  const normalizedRewardType = String(rewardType || "").trim().toLowerCase();
  const normalizedRewardKey = String(rewardKey || "").trim();

  if (!["milestone", "feature"].includes(normalizedRewardType) || !normalizedRewardKey) {
    throw new ApiError(400, "Valid reward type and reward key are required");
  }

  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const settingsDoc = await AdminBusinessSetting.findOne({ scope: "default" }).lean();
  const driverSettings = settingsDoc?.referral?.driver || {};
  const rides = await Ride.find({ driverId: driver._id }).select("status liveStatus createdAt updatedAt completedAt").lean();
  const liveDriver = {
    ...driver.toObject(),
    incentiveTracking: {
      ...(driver.incentiveTracking || {}),
      ...mergeOnlineSessionIntoTracking(
        driver.incentiveTracking || {},
        driver.incentiveTracking?.currentOnlineStartedAt,
        new Date(),
      ),
    },
  };
  const snapshot = buildDriverIncentiveSnapshot({
    driver: liveDriver,
    settings: driverSettings,
    rides,
  });

  const targetReward =
    normalizedRewardType === "milestone"
      ? snapshot.milestones.find((item) => String(item.id) === normalizedRewardKey)
      : snapshot.features.find((item) => String(item.key) === normalizedRewardKey);

  if (!targetReward) {
    throw new ApiError(404, "Reward not found");
  }

  if (!targetReward.isEligible) {
    throw new ApiError(400, "Reward is not eligible yet");
  }

  if (targetReward.isClaimed) {
    throw new ApiError(400, "Reward already claimed");
  }

  const claimRewardKey = normalizedRewardType === "milestone" ? String(targetReward.id) : String(targetReward.key);
  const claimEntry = {
    rewardType: normalizedRewardType,
    rewardKey: claimRewardKey,
    periodKey: targetReward.periodKey,
    amount: Number(targetReward.payout_amount ?? targetReward.reward_amount ?? 0),
    claimedAt: new Date(),
    metadata: {
      label: targetReward.name || targetReward.label || "",
      targetValue: targetReward.targetValue ?? targetReward.progress?.targetWeeks ?? 0,
    },
  };

  // Atomic claim lock: the update only applies if no existing claimedRewards entry
  // already matches this reward+period, closing the check-then-act race where two
  // concurrent claim requests could otherwise both pass the isClaimed check above.
  const claimLockResult = await Driver.findOneAndUpdate(
    {
      _id: driver._id,
      'incentiveTracking.claimedRewards': {
        $not: {
          $elemMatch: {
            rewardType: claimEntry.rewardType,
            rewardKey: claimEntry.rewardKey,
            periodKey: claimEntry.periodKey,
          },
        },
      },
    },
    {
      $push: { 'incentiveTracking.claimedRewards': { $each: [claimEntry], $slice: -200 } },
      $set: { 'incentiveTracking.dailyActivity': pruneDailyActivity(liveDriver.incentiveTracking?.dailyActivity) },
    },
    { new: true },
  );

  if (!claimLockResult) {
    throw new ApiError(400, "Reward already claimed");
  }

  const rewardAmount = claimEntry.amount;

  const walletResult = await applyDriverWalletAdjustment({
    driverId: driver._id,
    amount: rewardAmount,
    type: "adjustment",
    description: `Incentive reward credited for ${targetReward.name || targetReward.label || "milestone"}`,
    metadata: {
      category: "driver_incentive",
      rewardType: normalizedRewardType,
      rewardKey: normalizedRewardType === "milestone" ? String(targetReward.id) : String(targetReward.key),
      periodKey: targetReward.periodKey,
    },
  });

  res.json({
    success: true,
    data: {
      wallet: walletResult.wallet,
      transaction: walletResult.transaction,
      claimedReward: {
        rewardType: normalizedRewardType,
        rewardKey: normalizedRewardKey,
        amount: rewardAmount,
        periodKey: targetReward.periodKey,
      },
    },
  });
};

const serializePoolingDriverBooking = (booking = {}) => ({
  id: String(booking._id || ""),
  bookingId: String(booking.bookingId || ""),
  seatsBooked: Number(booking.seatsBooked || 0),
  fare: Number(booking.fare || 0),
  currency: String(booking.currency || "INR"),
  paymentStatus: String(booking.paymentStatus || booking.payment?.status || "pending"),
  bookingStatus: String(booking.bookingStatus || "confirmed"),
  selectedSeats: Array.isArray(booking.selectedSeats) ? booking.selectedSeats : [],
  pickupLabel: String(booking.pickupLabel || ""),
  dropLabel: String(booking.dropLabel || ""),
  scheduleId: String(booking.scheduleId || ""),
  otp: String(booking.otp || ""),
  travelDate: booking.travelDate || null,
  createdAt: booking.createdAt || null,
  updatedAt: booking.updatedAt || null,
  user: booking.user
    ? {
        id: String(booking.user._id || booking.user),
        name: String(booking.user.name || ""),
        phone: String(booking.user.phone || ""),
        email: String(booking.user.email || ""),
      }
    : null,
  route: booking.route
    ? {
        id: String(booking.route._id || booking.route),
        routeName: String(booking.route.routeName || ""),
        originLabel: String(booking.route.originLabel || ""),
        destinationLabel: String(booking.route.destinationLabel || ""),
      }
    : null,
});

export const getPoolingDriverBookings = async (req, res) => {
  if (String(req.auth?.role || "").toLowerCase() !== "pooling_driver") {
    throw new ApiError(403, "Pooling driver access is required");
  }

  const bookings = await PoolingBooking.find({ vehicle: req.auth.sub })
    .populate("user", "name phone email")
    .populate("route", "routeName originLabel destinationLabel")
    .sort({ travelDate: -1, createdAt: -1 })
    .lean();

  res.json({
    success: true,
    data: bookings.map(serializePoolingDriverBooking),
  });
};

export const getOwnerPoolingVehicles = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);

  if (!owner?._id) {
    throw new ApiError(
      403,
      "Pooling vehicle access is only available for owner accounts",
    );
  }

  const vehicles = await PoolingVehicle.find({ ownerId: owner._id })
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    data: vehicles,
    message: "Owner pooling vehicles fetched successfully",
  });
};

export const createOwnerPoolingVehicle = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);

  if (!owner?._id) {
    throw new ApiError(
      403,
      "Pooling vehicle access is only available for owner accounts",
    );
  }

  const vehicle = await PoolingVehicle.create({
    ...(req.body || {}),
    ownerId: owner._id,
  });

  res.status(201).json({
    success: true,
    data: vehicle,
    message: "Pooling vehicle created successfully",
  });
};

export const updateOwnerPoolingVehicle = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);

  if (!owner?._id) {
    throw new ApiError(
      403,
      "Pooling vehicle access is only available for owner accounts",
    );
  }

  const vehicle = await PoolingVehicle.findOneAndUpdate(
    { _id: req.params.vehicleId, ownerId: owner._id },
    { ...(req.body || {}), ownerId: owner._id },
    { new: true, runValidators: true },
  );

  if (!vehicle) {
    throw new ApiError(404, "Pooling vehicle not found");
  }

  res.json({
    success: true,
    data: vehicle,
    message: "Pooling vehicle updated successfully",
  });
};

export const deleteOwnerPoolingVehicle = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);

  if (!owner?._id) {
    throw new ApiError(
      403,
      "Pooling vehicle access is only available for owner accounts",
    );
  }

  const vehicle = await PoolingVehicle.findOneAndDelete({
    _id: req.params.vehicleId,
    ownerId: owner._id,
  });

  if (!vehicle) {
    throw new ApiError(404, "Pooling vehicle not found");
  }

  res.json({
    success: true,
    data: { deleted: true },
    message: "Pooling vehicle deleted successfully",
  });
};

export const startPoolingOnboardingRequest = async (req, res) => {
  const result = await startPoolingDriverOnboarding(req.body);
  res.status(201).json({ success: true, data: result });
};

export const verifyPoolingOnboardingOtpRequest = async (req, res) => {
  const result = await verifyPoolingDriverOnboardingOtp(req.body);
  res.json({ success: true, data: result });
};

export const getPoolingOnboardingSessionRequest = async (req, res) => {
  const result = await getPoolingDriverOnboardingSession({
    registrationId: req.params.registrationId,
    phone: req.query.phone,
  });
  res.json({ success: true, data: result });
};

export const savePoolingOnboardingDetailsRequest = async (req, res) => {
  const result = await savePoolingDriverOnboardingDetails(req.body);
  res.json({ success: true, data: result });
};

export const completePoolingOnboardingRequest = async (req, res) => {
  const result = await completePoolingDriverOnboarding(req.body);
  res.status(201).json({ success: true, data: result });
};

export const uploadPoolingOnboardingImageRequest = async (req, res) => {
  const image = String(req.body?.image || "").trim();
  const registrationId = String(req.body?.registrationId || "").trim();
  const phone = String(req.body?.phone || "").trim();

  if (!image) {
    throw new ApiError(400, "Image data is required");
  }

  await requireVerifiedPoolingDriverOnboardingSession({ registrationId, phone });

  const result = await uploadDataUrlToCloudinary({
    dataUrl: image,
    publicIdPrefix: "pooling-driver-onboarding",
  });

  res.status(201).json({
    success: true,
    data: {
      url: result.secureUrl,
    },
  });
};

import { subscriptionTierService } from '../../services/subscriptionTierService.js';

export const getDriverSubscriptionTiersController = asyncHandler(async (req, res) => {
  // The route is public (the app shows plans before login too), so eligibility
  // is only annotated when a driver token happens to be present.
  const tiers = req.auth?.sub
    ? await subscriptionTierService.listTiersForDriver(req.auth.sub)
    : await subscriptionTierService.getAllTiers(false);
  res.json({ success: true, data: { results: tiers } });
});

export const getCurrentDriverSubscriptionController = asyncHandler(async (req, res) => {
  const driverId = req.auth?.sub || req.params.driverId;
  const effectiveTier = await subscriptionTierService.getEffectiveDriverTier(driverId);
  res.json({ success: true, data: effectiveTier });
});

export const createDriverSubscriptionCheckoutController = asyncHandler(async (req, res) => {
  const driverId = req.auth?.sub;
  const { tierId, billingCycle } = req.body;
  const checkoutData = await subscriptionTierService.createSubscriptionCheckout({ driverId, tierId, billingCycle });
  res.json({ success: true, data: checkoutData });
});

export const verifyDriverSubscriptionPaymentController = asyncHandler(async (req, res) => {
  const driverId = req.auth?.sub;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const result = await subscriptionTierService.verifySubscriptionPayment({
    driverId,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  });
  res.json({ success: true, data: result });
});

export const toggleDriverRenewalRemindersController = asyncHandler(async (req, res) => {
  const driverId = req.auth?.sub;
  const result = await subscriptionTierService.toggleRenewalReminders(driverId);
  res.json({ success: true, data: result });
});

export const razorpayWebhookController = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'] || '';
  const result = await subscriptionTierService.handleRazorpayWebhook(req.body, signature, req.rawBody);
  res.json({ success: true, ...result });
});

import { getAccountTypeSettings, setAccountTypeAndRecalculateGracePeriod } from '../../services/accountTypeReconciliationService.js';

export const updateDriverCapabilitiesController = asyncHandler(async (req, res) => {
  const driverId = req.auth?.sub;
  const driver = await Driver.findById(driverId);
  if (!driver) throw new ApiError(404, 'Driver not found');

  const { pooling_enabled } = req.body;
  const settings = await getAccountTypeSettings();
  const effectiveTier = await subscriptionTierService.getEffectiveDriverTier(driverId);

  const allowedModules = (effectiveTier?.ride_module_ids || []).map((m) => String(m.code || m._id || m).toLowerCase());

  if (pooling_enabled !== undefined) {
    if (pooling_enabled) {
      if (!settings.pooling_module_globally_enabled) {
        throw new ApiError(400, 'Pooling rides are currently disabled platform-wide by admin.');
      }
      if (!allowedModules.includes('carpool') && !allowedModules.includes('pooling')) {
        throw new ApiError(400, 'Your active subscription tier does not include Pooling/Carpool capability.');
      }
    }
    driver.pooling_enabled = Boolean(pooling_enabled);
  }

  await driver.save();
  res.json({
    success: true,
    data: {
      pooling_enabled: driver.pooling_enabled,
    },
  });
});

export const checkAndPromoteVendorAccount = async (ownerId) => {
  if (!ownerId) return;
  const driver = await Driver.findOne({ $or: [{ _id: ownerId }, { owner_id: ownerId }] });
  if (!driver || driver.account_type !== 'vendor') return;

  const actualCount = await Vehicle.countDocuments({ owner_id: ownerId });
  const settings = await getAccountTypeSettings();

  if (actualCount >= settings.super_fleet_min_vehicles) {
    await setAccountTypeAndRecalculateGracePeriod({
      driver,
      newAccountType: 'super_fleet_owner',
      reason: 'instant_vehicle_promotion',
      performedBy: 'system',
      details: `Instantly promoted to Super Fleet Owner upon adding 5th vehicle (Count: ${actualCount}).`,
    });
  }
};

export const getOwnerFleetAnalytics = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);
  if (!owner?._id) {
    throw new ApiError(403, "Fleet analytics are only available for owner accounts");
  }

  const drivers = await Driver.find({ owner_id: owner._id, deletedAt: null }).lean();
  const driverIds = drivers.map((d) => d._id);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const rideAgg = await Ride.aggregate([
    { $match: { driverId: { $in: driverIds } } },
    {
      $group: {
        _id: "$driverId",
        totalRides: { $sum: 1 },
        completedRides: { $sum: { $cond: [{ $eq: ["$status", RIDE_STATUS.COMPLETED] }, 1, 0] } },
        totalEarnings: { $sum: { $cond: [{ $eq: ["$status", RIDE_STATUS.COMPLETED] }, { $ifNull: ["$driverEarnings", 0] }, 0] } },
        todayEarnings: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ["$status", RIDE_STATUS.COMPLETED] }, { $gte: ["$createdAt", startOfToday] }] },
              { $ifNull: ["$driverEarnings", 0] },
              0
            ]
          }
        },
        todayRides: {
          $sum: {
            $cond: [{ $gte: ["$createdAt", startOfToday] }, 1, 0]
          }
        }
      }
    }
  ]);

  const statsMap = new Map();
  rideAgg.forEach((item) => statsMap.set(String(item._id), item));

  const driverAnalytics = drivers.map((driver) => {
    const stats = statsMap.get(String(driver._id)) || {};
    return {
      driverId: String(driver._id),
      name: driver.name || "",
      phone: driver.phone || "",
      isOnline: Boolean(driver.isOnline),
      isOnRide: Boolean(driver.isOnRide),
      isSelfDriveOwner: Boolean(driver.is_self_drive_owner),
      todayEarnings: Number(stats.todayEarnings || 0),
      todayRides: Number(stats.todayRides || 0),
      totalEarnings: Number(stats.totalEarnings || 0),
      completedRides: Number(stats.completedRides || 0),
      totalRides: Number(stats.totalRides || 0),
      lastOnlineAt: driver.lastOnlineAt || driver.updatedAt,
    };
  });

  res.json({
    success: true,
    data: {
      accountType: owner.account_type || 'vendor',
      totalDrivers: drivers.length,
      driverAnalytics,
    }
  });
};

export const addOwnerHiredDriver = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);
  if (!owner?._id) {
    throw new ApiError(403, "Only owner accounts can add hired drivers");
  }

  const phone = normalizePhone(req.body?.phone);
  const name = String(req.body?.name || "").trim();

  if (!phone || phone.length !== 10) {
    throw new ApiError(400, "Valid 10-digit mobile number is required");
  }

  let driver = await Driver.findOne({ phone });
  if (driver) {
    if (driver.owner_id && String(driver.owner_id) !== String(owner._id)) {
      throw new ApiError(409, "Driver is already registered under another fleet owner");
    }
    driver.owner_id = owner._id;
    await driver.save();
    return res.json({
      success: true,
      message: "Existing driver linked to your fleet successfully",
      data: { driverId: String(driver._id), isNewInvite: false }
    });
  }

  const passwordHash = await hashPassword(req.body?.password || "DriverPassword123!");
  driver = await Driver.create({
    name: name || `Hired Driver ${phone.slice(-4)}`,
    phone,
    email: req.body?.email || "",
    password: passwordHash,
    owner_id: owner._id,
    approve: false,
    status: 'pending',
  });

  res.json({
    success: true,
    message: "Driver invite created and linked to your fleet",
    data: { driverId: String(driver._id), isNewInvite: true }
  });
};

export const assignOwnerVehicleToDriver = async (req, res) => {
  const owner = await resolveAuthenticatedOwner(req);
  if (!owner?._id) {
    throw new ApiError(403, "Only owner accounts can assign vehicles");
  }

  const { driverId, vehicleId } = req.body;
  if (!driverId) {
    throw new ApiError(400, "Driver ID is required");
  }

  const driver = await Driver.findOne({ _id: driverId, owner_id: owner._id });
  if (!driver) {
    throw new ApiError(404, "Driver not found under your fleet");
  }

  if (!vehicleId) {
    driver.assignedFleetVehicleId = null;
    await driver.save();
    return res.json({ success: true, message: "Vehicle unassigned from driver" });
  }

  const vehicle = await FleetVehicle.findOne({ _id: vehicleId, owner_id: owner._id });
  if (!vehicle) {
    throw new ApiError(404, "Vehicle not found in your fleet");
  }

  driver.assignedFleetVehicleId = vehicle._id;
  await driver.save();

  res.json({
    success: true,
    message: "Vehicle assigned to driver successfully",
    data: { driverId: String(driver._id), vehicleId: String(vehicle._id) }
  });
};

export const enableOwnerSelfDrive = async (req, res) => {
  const authorizedOwner = await resolveAuthenticatedOwner(req);
  if (!authorizedOwner?._id) {
    throw new ApiError(403, "Only owner accounts can enable self-drive mode");
  }

  // `resolveAuthenticatedOwner` returns a lean projection, which neither carries
  // `self_drive_driver_id` nor can be saved. This handler needs a real document.
  const owner = await Owner.findById(authorizedOwner._id);
  if (!owner) {
    throw new ApiError(404, "Owner not found");
  }

  if (owner.self_drive_driver_id) {
    const existingDriver = await Driver.findById(owner.self_drive_driver_id);
    if (existingDriver) {
      return res.json({
        success: true,
        message: "Self-drive driver account already exists",
        data: { selfDriveDriverId: String(existingDriver._id) },
      });
    }
  }

  const selfDrivePhone = normalizePhone(owner.mobile || owner.phone || "");

  if (!/^\d{10}$/.test(selfDrivePhone)) {
    throw new ApiError(400, "A valid 10-digit owner mobile number is required for self-drive mode");
  }

  // The owner's own number may already exist as a driver (they registered as a
  // driver first, or self-drive was half-enabled before). Adopt that record
  // instead of failing on a second account for the same phone.
  const existingByPhone = await Driver.findOne({ phone: selfDrivePhone, deletedAt: null });
  const selfDriveDriver = existingByPhone
    || (await Driver.create({
      name: owner.owner_name || owner.name || owner.company_name || "Self-Drive Owner",
      phone: selfDrivePhone,
      email: owner.email || "",
      password: await hashPassword(crypto.randomUUID().slice(0, 12)),
      owner_id: owner._id,
      is_self_drive_owner: true,
      service_location_id: owner.service_location_id,
      // Required by the Driver schema; the owner picks a real vehicle later.
      vehicleType: "car",
      approve: true,
      status: "approved",
    }));

  if (existingByPhone) {
    selfDriveDriver.owner_id = owner._id;
    selfDriveDriver.is_self_drive_owner = true;
    await selfDriveDriver.save();
  }

  owner.self_drive_driver_id = selfDriveDriver._id;
  await owner.save();

  res.json({
    success: true,
    message: "Self-drive mode enabled successfully",
    data: { selfDriveDriverId: String(selfDriveDriver._id) },
  });
};

export const switchOwnerToSelfDriveSession = async (req, res) => {
  const authorizedOwner = await resolveAuthenticatedOwner(req);
  if (!authorizedOwner?._id) {
    throw new ApiError(403, "Only owner accounts can switch to self-drive session");
  }

  // The lean projection above omits `self_drive_driver_id`, so read it directly.
  const owner = await Owner.findById(authorizedOwner._id).select("self_drive_driver_id").lean();

  if (!owner?.self_drive_driver_id) {
    throw new ApiError(400, "Self-drive mode is not enabled for this owner yet. Call enableOwnerSelfDrive first.");
  }

  const driver = await Driver.findById(owner.self_drive_driver_id);
  if (!driver) {
    throw new ApiError(404, "Linked self-drive driver record not found");
  }

  // `signAccessToken` reads `sub`; passing `id` produced a token with no subject,
  // so every request made with it resolved to no account and failed auth.
  const token = signAccessToken({ sub: String(driver._id), role: "driver" });

  res.json({
    success: true,
    data: {
      token,
      driver: {
        id: String(driver._id),
        name: driver.name,
        phone: driver.phone,
        isSelfDriveOwner: true,
      }
    }
  });
};
