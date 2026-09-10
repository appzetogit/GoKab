import { asyncHandler } from "../../../../utils/asyncHandler.js";
import * as adminService from "../services/adminService.js";
import ExcelJS from 'exceljs';
import { BusBooking } from '../../user/models/BusBooking.js';
import { BusService } from '../models/BusService.js';
import { BusSeatHold } from '../../user/models/BusSeatHold.js';
import { getPublicActivePaymentGateway } from '../../services/paymentGatewayService.js';

const ok = (res, data, extra = {}) =>
  res.json({ success: true, data, ...extra });

const toCleanString = (value = '') => String(value || '').trim();

const normalizeBusTravelDate = (value) => {
  const rawValue = toCleanString(value);
  if (!rawValue) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return rawValue;
  }

  const leadingDateMatch = rawValue.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (leadingDateMatch) {
    return leadingDateMatch[1];
  }

  const parsed = new Date(rawValue);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return '';
};

const flattenBusBlueprintSeats = (blueprint = {}) =>
  ['lowerDeck', 'upperDeck']
    .flatMap((deckKey) => (Array.isArray(blueprint?.[deckKey]) ? blueprint[deckKey] : []))
    .flatMap((row) => (Array.isArray(row) ? row : []))
    .filter((cell) => cell?.kind === 'seat' && cell?.id);

const resolveBusSeatPrice = (busService = {}, seat = {}) => {
  const variantPricing = busService?.variantPricing || {};
  const defaultPrice = Number(busService?.seatPrice || 0);
  const variantKey = String(seat?.variant || 'seat').trim().toLowerCase();
  const resolvedPrice = variantPricing?.[variantKey] ?? variantPricing?.seat ?? defaultPrice;

  return Number.isFinite(Number(resolvedPrice)) ? Number(resolvedPrice) : defaultPrice;
};

const normalizePhone = (value) => {
  const digits = toCleanString(value).replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
};

const normalizeEmail = (value) => toCleanString(value).toLowerCase();

const validateBusPassengerName = (name) => {
  if (!name || name.length < 2 || name.length > 80) {
    throw new Error('Passenger name must be between 2 and 80 characters');
  }
};

const validateBusPassengerPhone = (phone) => {
  if (!/^\d{10}$/.test(phone)) {
    throw new Error('Passenger phone must be a valid 10-digit number');
  }
};

const validateBusPassengerEmail = (email) => {
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Passenger email must be a valid email address');
  }
};

const getBusTravelDayLabel = (travelDate) => {
  const parsed = new Date(`${travelDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parsed.getUTCDay()];
};

const findBusSchedule = (busService, scheduleId) =>
  (Array.isArray(busService?.schedules) ? busService.schedules : []).find(
    (item) => String(item?.id || '') === String(scheduleId || ''),
  );

const isScheduleAvailableOnDate = (schedule, travelDate) => {
  if (!schedule || String(schedule.status || 'active') !== 'active') {
    return false;
  }

  const activeDays = Array.isArray(schedule.activeDays) ? schedule.activeDays : [];
  if (activeDays.length === 0) {
    return true;
  }

  return activeDays.includes(getBusTravelDayLabel(travelDate));
};

const buildAdminBusSeatLayout = async ({ busService, scheduleId, travelDate }) => {
  const seatLayout = JSON.parse(JSON.stringify(busService?.blueprint || { lowerDeck: [], upperDeck: [] }));
  const holds = await BusSeatHold.find({
    busServiceId: busService._id,
    scheduleId,
    travelDate,
    status: { $in: ['held', 'booked'] },
  }).lean();

  const holdMap = new Map();
  holds.forEach((hold) => {
    holdMap.set(String(hold.seatId || ''), hold);
  });

  ['lowerDeck', 'upperDeck'].forEach((deckKey) => {
    seatLayout[deckKey] = (Array.isArray(seatLayout[deckKey]) ? seatLayout[deckKey] : []).map((row) =>
      (Array.isArray(row) ? row : []).map((cell) => {
        if (cell?.kind !== 'seat') {
          return cell;
        }

        const hold = holdMap.get(String(cell.id || ''));
        if (hold) {
          return {
            ...cell,
            status: 'booked',
          };
        }

        return cell;
      }),
    );
  });

  return seatLayout;
};

const resolveAdminBusBookingUser = async (passenger = {}) => {
  const name = toCleanString(passenger.name);
  const phone = normalizePhone(passenger.phone);
  const email = normalizeEmail(passenger.email);
  const gender = toCleanString(passenger.gender).toLowerCase();

  validateBusPassengerName(name);
  validateBusPassengerPhone(phone);
  validateBusPassengerEmail(email);

  const allowedGenders = new Set(['male', 'female', 'other', 'prefer-not-to-say', '']);
  const normalizedGender = allowedGenders.has(gender) ? gender : 'prefer-not-to-say';

  let user = await User.findOne({ phone });
  if (!user && email) {
    user = await User.findOne({ email });
  }

  if (user) {
    let dirty = false;
    if (!toCleanString(user.name) && name) {
      user.name = name;
      dirty = true;
    }
    if (!toCleanString(user.email) && email) {
      user.email = email;
      dirty = true;
    }
    if (!toCleanString(user.gender) && normalizedGender) {
      user.gender = normalizedGender;
      dirty = true;
    }
    if (dirty) {
      await user.save();
    }
    return user;
  }

  return User.create({
    name,
    phone,
    email,
    gender: normalizedGender,
    countryCode: '+91',
    isVerified: true,
    active: true,
  });
};

const serializeAdminBusBooking = (booking = {}) => {
  const cancelledSeats = Array.isArray(booking.cancelledSeats) ? booking.cancelledSeats : [];
  const cancelledSeatIdSet = new Set(
    cancelledSeats.map((item) => toCleanString(item?.seatId)).filter(Boolean),
  );
  const originalSeatIds = Array.isArray(booking.seatIds) ? booking.seatIds : [];
  const originalSeatLabels = Array.isArray(booking.seatLabels) ? booking.seatLabels : [];
  const activeSeats = originalSeatIds
    .map((seatId, index) => ({
      seatId,
      seatLabel: originalSeatLabels[index] || seatId,
    }))
    .filter((item) => !cancelledSeatIdSet.has(toCleanString(item.seatId)));

  return {
    id: String(booking._id || ''),
    bookingCode: booking.bookingCode || '',
    status: booking.status || 'pending',
    bookingSource: booking.bookingSource || 'user',
    travelDate: booking.travelDate || '',
    scheduleId: booking.scheduleId || '',
    amount: Number(booking.amount || 0),
    currency: booking.currency || 'INR',
    createdAt: booking.createdAt || null,
    updatedAt: booking.updatedAt || null,
    passenger: booking.passenger || {},
    payment: {
      provider: booking.payment?.provider || '',
      orderId: booking.payment?.orderId || '',
      paymentId: booking.payment?.paymentId || '',
      status: booking.payment?.status || 'pending',
      paidAt: booking.payment?.paidAt || null,
    },
    routeSnapshot: booking.routeSnapshot || {},
    user: booking.userId
      ? {
          id: String(booking.userId?._id || booking.userId),
          name: booking.userId?.name || '',
          phone: booking.userId?.phone || '',
          email: booking.userId?.email || '',
        }
      : null,
    busService: booking.busServiceId
      ? {
          id: String(booking.busServiceId?._id || booking.busServiceId),
          busName: booking.busServiceId?.busName || booking.routeSnapshot?.busName || '',
          operatorName: booking.busServiceId?.operatorName || booking.routeSnapshot?.operatorName || '',
          serviceNumber: booking.busServiceId?.serviceNumber || '',
          coachType: booking.busServiceId?.coachType || booking.routeSnapshot?.coachType || '',
          busCategory: booking.busServiceId?.busCategory || booking.routeSnapshot?.busCategory || '',
          route: booking.busServiceId?.route || null,
        }
      : null,
    seatSummary: {
      total: originalSeatIds.length,
      active: activeSeats.length,
      cancelled: cancelledSeats.length,
    },
    activeSeats,
    cancelledSeats: cancelledSeats.map((item) => ({
      seatId: item?.seatId || '',
      seatLabel: item?.seatLabel || '',
      cancelledAt: item?.cancelledAt || null,
      refundAmount: Number(item?.refundAmount || 0),
      chargeAmount: Number(item?.chargeAmount || 0),
      refundStatus: item?.refundStatus || '',
      notes: item?.notes || '',
    })),
  };
};

const buildAdminBusMonthWindow = (value) => {
  const normalizedMonth = toCleanString(value);
  if (/^\d{4}-\d{2}$/.test(normalizedMonth)) {
    const [year, month] = normalizedMonth.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return {
      month: normalizedMonth,
      startDate: start.toISOString().slice(0, 10),
      endDateExclusive: end.toISOString().slice(0, 10),
    };
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));

  return {
    month: `${year}-${String(month + 1).padStart(2, '0')}`,
    startDate: start.toISOString().slice(0, 10),
    endDateExclusive: end.toISOString().slice(0, 10),
  };
};

const sendFile = async (res, filename, reportData, format) => {
  const { headers, rows } = reportData;

  if (format === 'csv') {
    const content = adminService.csvFromRows(headers, rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(content);
  } else {
    // Generate real Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report');

    // Add headers
    worksheet.addRow(headers.map(h => String(h).toUpperCase()));
    
    // Add rows
    rows.forEach(row => {
      worksheet.addRow(headers.map(h => row[h]));
    });

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    
    await workbook.xlsx.write(res);
    res.end();
  }
};

export const getAdminStatus = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getAdminModuleInfo()),
);
export const loginAdmin = asyncHandler(async (req, res) =>
  ok(res, await adminService.loginAdmin(req.body)),
);
export const forgotPassword = asyncHandler(async (req, res) =>
  ok(res, await adminService.forgotPassword(req.body.email)),
);
export const verifyResetOtp = asyncHandler(async (req, res) =>
  ok(res, await adminService.verifyResetOtp(req.body)),
);
export const resetPassword = asyncHandler(async (req, res) =>
  ok(res, await adminService.resetPassword(req.body)),
);
export const getAdmins = asyncHandler(async (req, res) =>
  ok(res, { results: await adminService.listAdmins(req.auth?.admin) }),
);
export const getAdminPermissions = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listAdminPermissions() }),
);
export const createAdminAccount = asyncHandler(async (req, res) =>
  ok(res, await adminService.createAdminAccount(req.auth?.admin, req.body)),
);
export const updateAdminAccount = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateAdminAccount(req.auth?.admin, req.params.id, req.body)),
);
export const deleteAdminAccount = asyncHandler(async (req, res) => {
  await adminService.deleteAdminAccount(req.auth?.admin, req.params.id);
  ok(res, { deleted: true });
});

export const getUsers = asyncHandler(async (req, res) =>
  ok(res, await adminService.listUsers(req.query)),
);
export const bulkImportUsers = asyncHandler(async (req, res) =>
  ok(res, await adminService.bulkImportUsers(req.body)),
);
export const bulkImportDrivers = asyncHandler(async (req, res) =>
  ok(res, await adminService.bulkImportDrivers(req.body)),
);
export const createUser = asyncHandler(async (req, res) =>
  ok(res, await adminService.createUser(req.body)),
);
export const updateUser = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateUser(req.params.id, req.body)),
);
export const getUser = asyncHandler(async (req, res) =>
  ok(res, await adminService.getUserById(req.params.id)),
);
export const deleteUser = asyncHandler(async (req, res) => {
  await adminService.deleteUser(req.params.id);
  ok(res, { deleted: true });
});

export const getDeletedUsers = asyncHandler(async (req, res) =>
  ok(res, await adminService.listDeletedUsers(req.query)),
);

export const restoreDeletedUser = asyncHandler(async (req, res) =>
  ok(res, await adminService.restoreDeletedUser(req.params.id)),
);

export const permanentlyDeleteDeletedUser = asyncHandler(async (req, res) => {
  await adminService.permanentlyDeleteDeletedUser(req.params.id);
  ok(res, { deleted: true });
});

export const getUserDeletionRequests = asyncHandler(async (req, res) =>
  ok(res, await adminService.listUserDeletionRequests(req.query)),
);

export const approveUserDeletionRequest = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.approveUserDeletionRequest(req.params.id, req.auth?.sub),
  ),
);

export const rejectUserDeletionRequest = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.rejectUserDeletionRequest(
      req.params.id,
      req.body,
      req.auth?.sub,
    ),
  ),
);

export const getUserRequests = asyncHandler(async (req, res) =>
  ok(res, await adminService.listUserRequests(req.params.id)),
);

export const getUserWalletHistory = asyncHandler(async (req, res) =>
  ok(res, await adminService.listUserWalletHistory(req.params.id)),
);

export const adjustUserWallet = asyncHandler(async (req, res) =>
  ok(res, await adminService.adjustUserWallet(req.params.id, req.body)),
);

export const getDrivers = asyncHandler(async (req, res) => {
  ok(res, await adminService.listDrivers(req.query, req.auth?.admin));
});

export const getDriverRatings = asyncHandler(async (req, res) =>
  ok(res, await adminService.listDriverRatings(req.query)),
);

export const getDriverRatingDetail = asyncHandler(async (req, res) =>
  ok(res, await adminService.getDriverRatingDetail(req.params.id)),
);

export const getDriverWalletLedger = asyncHandler(async (req, res) =>
  ok(res, await adminService.getDriverWalletLedger(req.query)),
);
export const listDriverWalletHistory = asyncHandler(async (req, res) =>
  ok(res, await adminService.listDriverWalletHistory(req.params.id)),
);

export const adjustOwnerWallet = asyncHandler(async (req, res) =>
  ok(res, await adminService.adjustOwnerWallet(req.params.id, req.body)),
);

export const listOwnerWalletHistory = asyncHandler(async (req, res) =>
  ok(res, await adminService.listOwnerWalletHistory(req.params.id)),
);

export const getNegativeBalanceDrivers = asyncHandler(async (req, res) =>
  ok(res, await adminService.listNegativeBalanceDrivers(req.query)),
);

export const getDriverWithdrawalSummaries = asyncHandler(async (req, res) =>
  ok(res, await adminService.listDriverWithdrawalSummaries(req.query)),
);

export const getDriverWithdrawals = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.listDriverWithdrawals({
      driverId: req.params.id,
      page: req.query.page,
      limit: req.query.limit,
    }),
  ),
);

export const getDriverWithdrawalContextByRequestId = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.getDriverWithdrawalContextByRequestId({
      requestId: req.params.requestId,
      page: req.query.page,
      limit: req.query.limit,
    }),
  ),
);

export const approveDriverWithdrawalRequest = asyncHandler(async (req, res) =>
  ok(res, await adminService.approveDriverWithdrawalRequest(req.params.requestId, req.auth?.sub)),
);

export const rejectDriverWithdrawalRequest = asyncHandler(async (req, res) =>
  ok(res, await adminService.rejectDriverWithdrawalRequest(req.params.requestId)),
);

export const getUserReferralRedemptionRequests = asyncHandler(async (req, res) =>
  ok(res, await adminService.listUserReferralRedemptionRequests(req.query)),
);

export const approveUserReferralRedemptionRequest = asyncHandler(async (req, res) =>
  ok(res, await adminService.approveUserReferralRedemptionRequest(req.params.requestId, req.auth?.sub)),
);

export const rejectUserReferralRedemptionRequest = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.rejectUserReferralRedemptionRequest(req.params.requestId, req.body, req.auth?.sub),
  ),
);


export const getDeletedDrivers = asyncHandler(async (req, res) =>
  ok(res, await adminService.listDeletedDrivers(req.query)),
);

export const restoreDeletedDriver = asyncHandler(async (req, res) =>
  ok(res, await adminService.restoreDeletedDriver(req.params.id)),
);

export const permanentlyDeleteDeletedDriver = asyncHandler(async (req, res) => {
  await adminService.permanentlyDeleteDeletedDriver(req.params.id);
  ok(res, { deleted: true });
});

export const getDriverDeletionRequests = asyncHandler(async (req, res) =>
  ok(res, await adminService.listDriverDeletionRequests(req.query)),
);

export const approveDriverDeletionRequest = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.approveDriverDeletionRequest(req.params.id, req.auth?.sub),
  ),
);

export const rejectDriverDeletionRequest = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.rejectDriverDeletionRequest(
      req.params.id,
      req.body,
      req.auth?.sub,
    ),
  ),
);

export const createDriver = asyncHandler(async (req, res) =>
  ok(res, await adminService.createDriver(req.body, req.auth?.admin)),
);
export const getDriver = asyncHandler(async (req, res) =>
  ok(res, await adminService.getDriverById(req.params.id, req.auth?.admin)),
);
export const getDriverProfile = asyncHandler(async (req, res) =>
  ok(res, await adminService.getDriverProfile(req.params.id)),
);
export const updateDriver = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateDriver(req.params.id, req.body, req.auth?.admin)),
);
export const updateDriverPassword = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.updateDriverPassword(req.params.id, req.body.password),
  ),
);
export const deleteDriver = asyncHandler(async (req, res) => {
  await adminService.deleteDriver(req.params.id);
  ok(res, { deleted: true });
});

export const adjustDriverWallet = asyncHandler(async (req, res) =>
  ok(res, await adminService.adjustDriverWallet(req.params.id, req.body)),
);

import { subscriptionTierService } from "../../services/subscriptionTierService.js";
import { TierAuditLog } from "../models/TierAuditLog.js";

export const getSubscriptionPlans = asyncHandler(async (_req, res) =>
  ok(res, { results: await subscriptionTierService.getAllTiers(true) }),
);
export const createSubscriptionPlan = asyncHandler(async (req, res) =>
  ok(res, await subscriptionTierService.createTier(req.body, { admin_id: req.user?._id, admin_email: req.user?.email, ip_address: req.ip })),
);
export const updateSubscriptionPlan = asyncHandler(async (req, res) =>
  ok(res, await subscriptionTierService.updateTier(req.params.id, req.body, { admin_id: req.user?._id, admin_email: req.user?.email, ip_address: req.ip })),
);
export const deleteSubscriptionPlan = asyncHandler(async (req, res) =>
  ok(res, await subscriptionTierService.deleteTier(req.params.id, { admin_id: req.user?._id, admin_email: req.user?.email, ip_address: req.ip })),
);

export const getRideModulesController = asyncHandler(async (_req, res) =>
  ok(res, { results: await subscriptionTierService.getRideModules() }),
);
export const createRideModuleController = asyncHandler(async (req, res) =>
  ok(res, await subscriptionTierService.createRideModule(req.body)),
);
export const updateRideModuleController = asyncHandler(async (req, res) =>
  ok(res, await subscriptionTierService.updateRideModule(req.params.id, req.body)),
);
export const deleteRideModuleController = asyncHandler(async (req, res) =>
  ok(res, await subscriptionTierService.deleteRideModule(req.params.id)),
);

export const getSupportChannelsController = asyncHandler(async (_req, res) =>
  ok(res, { results: await subscriptionTierService.getSupportChannelTypes() }),
);
export const createSupportChannelController = asyncHandler(async (req, res) =>
  ok(res, await subscriptionTierService.createSupportChannelType(req.body)),
);
export const updateSupportChannelController = asyncHandler(async (req, res) =>
  ok(res, await subscriptionTierService.updateSupportChannelType(req.params.id, req.body)),
);
export const deleteSupportChannelController = asyncHandler(async (req, res) =>
  ok(res, await subscriptionTierService.deleteSupportChannelType(req.params.id)),
);

export const getTierAuditLogsController = asyncHandler(async (_req, res) =>
  ok(res, { results: await TierAuditLog.find().sort({ createdAt: -1 }).limit(100).lean() }),
);

import { getAccountTypeSettings, updateAccountTypeSettings, setAccountTypeAndRecalculateGracePeriod } from "../../services/accountTypeReconciliationService.js";
import { AccountTypeAuditLog } from "../models/AccountTypeAuditLog.js";

export const getAccountTypeSettingsController = asyncHandler(async (_req, res) =>
  ok(res, await getAccountTypeSettings()),
);

export const updateAccountTypeSettingsController = asyncHandler(async (req, res) =>
  ok(res, await updateAccountTypeSettings(req.body)),
);

export const overrideDriverAccountTypeController = asyncHandler(async (req, res) => {
  const { newAccountType, reason = 'admin_manual_override' } = req.body;
  if (!['individual', 'vendor', 'super_fleet_owner'].includes(newAccountType)) {
    throw new ApiError(400, 'Invalid account type');
  }
  const driver = await Driver.findById(req.params.id);
  if (!driver) throw new ApiError(404, 'Driver not found');

  const updatedDriver = await setAccountTypeAndRecalculateGracePeriod({
    driver,
    newAccountType,
    reason,
    performedBy: req.user?.email || 'admin',
    details: `Admin manually reclassified account to ${newAccountType}`,
  });

  ok(res, updatedDriver);
});

export const getAccountTypeMigrationReportController = asyncHandler(async (_req, res) =>
  ok(res, { results: await AccountTypeAuditLog.find().sort({ createdAt: -1 }).populate('driver_id', 'name phone email').limit(200).lean() }),
);

import { Ride } from '../../user/models/Ride.js';
import { Driver } from '../../driver/models/Driver.js';

export const getGodsEyeFleetController = asyncHandler(async (req, res) => {
  const { driverMode = 'all', vehicleType = 'all' } = req.query;

  let driverFilter = {};
  if (driverMode === 'online') {
    driverFilter = { isOnline: true, isOnRide: false };
  } else if (driverMode === 'on_ride' || driverMode === 'onride') {
    driverFilter = { isOnRide: true };
  } else if (driverMode === 'offline') {
    driverFilter = { isOnline: false };
  }

  if (vehicleType && vehicleType !== 'all') {
    driverFilter.vehicleType = new RegExp(vehicleType, 'i');
  }

  const drivers = await Driver.find(driverFilter)
    .select('_id name phone isOnline isOnRide location vehicleType vehicleNumber account_type profile_picture updatedAt')
    .limit(500)
    .lean();

  const activeRides = await Ride.find({ status: { $in: ['SEARCHING', 'ACCEPTED', 'IN_PROGRESS'] } })
    .select('_id requestId pickupLocation pickupAddress dropAddress status vehicleType fare userId')
    .populate('userId', 'name phone')
    .limit(200)
    .lean();

  const totalDrivers = await Driver.countDocuments({});
  const onlineCount = await Driver.countDocuments({ isOnline: true });
  const onRideCount = await Driver.countDocuments({ isOnRide: true });

  const driverMarkers = drivers.map((d) => {
    const coords = d.location?.coordinates || [75.8577, 22.7196];
    return {
      id: `driver-${d._id}`,
      type: 'driver',
      driverId: d._id,
      name: d.name || 'Driver',
      phone: d.phone || '--',
      accountType: d.account_type || 'individual',
      vehicleType: d.vehicleType || 'car',
      vehicleNumber: d.vehicleNumber || 'MP-09-XX-0000',
      isOnline: Boolean(d.isOnline),
      isOnRide: Boolean(d.isOnRide),
      status: d.isOnRide ? 'On Ride' : d.isOnline ? 'Online' : 'Offline',
      pos: { lat: Number(coords[1]), lng: Number(coords[0]) },
      updatedAt: d.updatedAt,
    };
  });

  const rideMarkers = activeRides.map((r) => {
    const coords = r.pickupLocation?.coordinates || [75.8577, 22.7196];
    return {
      id: `ride-${r._id}`,
      type: 'demand',
      rideId: r._id,
      requestId: r.requestId || r._id,
      userName: r.userId?.name || 'Passenger',
      userPhone: r.userId?.phone || '--',
      pickupAddress: r.pickupAddress || '--',
      status: r.status,
      pos: { lat: Number(coords[1]), lng: Number(coords[0]) },
    };
  });

  ok(res, {
    markers: [...driverMarkers, ...rideMarkers],
    summary: {
      totalDrivers,
      onlineDrivers: onlineCount,
      onRideDrivers: onRideCount,
      offlineDrivers: Math.max(0, totalDrivers - onlineCount),
      pendingRequests: activeRides.length,
    },
  });
});

export const getHeatmapAnalyticsController = asyncHandler(async (req, res) => {
  const { state, district, timeframe = 'all' } = req.query;

  let timeFilter = {};
  if (timeframe === 'today') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    timeFilter = { createdAt: { $gte: today } };
  } else if (timeframe === '7days') {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    timeFilter = { createdAt: { $gte: sevenDaysAgo } };
  }

  const rides = await Ride.find(timeFilter)
    .select('_id pickupLocation pickupAddress status createdAt vehicleType')
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  const onlineDrivers = await Driver.find({ isOnline: true })
    .select('_id name location vehicleType isOnline')
    .lean();

  const points = [];
  const cityCountMap = {};

  rides.forEach((ride) => {
    const coords = ride.pickupLocation?.coordinates;
    if (coords && Array.isArray(coords) && coords.length === 2) {
      const lng = coords[0];
      const lat = coords[1];
      points.push({
        id: ride._id,
        lat,
        lng,
        weight: ride.status === 'SEARCHING' ? 8 : ride.status === 'ACCEPTED' ? 6 : 4,
        address: ride.pickupAddress || 'Pickup Location',
        status: ride.status,
        type: 'ride',
        createdAt: ride.createdAt,
      });

      const addr = (ride.pickupAddress || '').toLowerCase();
      let detectedCity = 'Other Cities';
      if (addr.includes('indore')) detectedCity = 'Indore';
      else if (addr.includes('mumbai')) detectedCity = 'Mumbai';
      else if (addr.includes('delhi') || addr.includes('noida') || addr.includes('gurugram')) detectedCity = 'Delhi NCR';
      else if (addr.includes('bengaluru') || addr.includes('bangalore')) detectedCity = 'Bengaluru';
      else if (addr.includes('bhopal')) detectedCity = 'Bhopal';
      else if (addr.includes('pune')) detectedCity = 'Pune';
      else if (addr.includes('hyderabad')) detectedCity = 'Hyderabad';
      else if (addr.includes('chennai')) detectedCity = 'Chennai';

      cityCountMap[detectedCity] = (cityCountMap[detectedCity] || 0) + 1;
    }
  });

  onlineDrivers.forEach((drv) => {
    const coords = drv.location?.coordinates;
    if (coords && Array.isArray(coords) && coords.length === 2) {
      points.push({
        id: `driver-${drv._id}`,
        lat: coords[1],
        lng: coords[0],
        weight: 3,
        address: `Driver: ${drv.name}`,
        status: 'ONLINE',
        type: 'driver',
        createdAt: new Date(),
      });
    }
  });

  const cityRankings = Object.entries(cityCountMap)
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count);

  ok(res, {
    points,
    cityRankings,
    summary: {
      totalBookings: rides.length,
      activeHotspots: points.length,
      onlineDrivers: onlineDrivers.length,
      topCity: cityRankings[0]?.city || 'N/A',
    },
  });
});
export const getCustomerSubscriptionPlans = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listCustomerSubscriptionPlans() }),
);
export const createCustomerSubscriptionPlan = asyncHandler(async (req, res) =>
  ok(res, await adminService.createCustomerSubscriptionPlan(req.body)),
);
export const getUserSubscriptions = asyncHandler(async (req, res) =>
  ok(res, await adminService.listUserSubscriptionsByUserId(req.params.id)),
);

export const getSubscriptionSettings = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getSubscriptionSettings()),
);
export const updateSubscriptionSettings = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateSubscriptionSettings(req.body)),
);

export const getReferralSettings = asyncHandler(async (req, res) =>
  ok(res, await adminService.getReferralSettings(req.params.type)),
);

export const updateReferralSettings = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateReferralSettings(req.params.type, req.body)),
);

export const getReferralDashboard = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getReferralDashboard()),
);

export const getServiceLocations = asyncHandler(async (req, res) =>
  ok(res, await adminService.listServiceLocations(req.auth?.admin)),
);
export const getServiceStores = asyncHandler(async (req, res) =>
  ok(res, { results: await adminService.listServiceStores(req.auth?.admin) }),
);
export const getCountries = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listCountries() }),
);
export const createServiceLocation = asyncHandler(async (req, res) =>
  ok(res, await adminService.createServiceLocation(req.body, req.auth?.admin)),
);
export const createServiceStore = asyncHandler(async (req, res) =>
  ok(res, await adminService.createServiceStore(req.body, req.auth?.admin)),
);
export const updateServiceLocation = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateServiceLocation(req.params.id, req.body, req.auth?.admin)),
);
export const updateServiceStore = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateServiceStore(req.params.id, req.body, req.auth?.admin)),
);
export const createServiceStoreStaff = asyncHandler(async (req, res) =>
  ok(res, await adminService.createServiceStoreStaff(req.params.id, req.body, req.auth?.admin)),
);
export const deleteServiceLocation = asyncHandler(async (req, res) => {
  await adminService.deleteServiceLocation(req.params.id, req.auth?.admin);
  ok(res, { deleted: true });
});
export const deleteServiceStore = asyncHandler(async (req, res) => {
  await adminService.deleteServiceStore(req.params.id, req.auth?.admin);
  ok(res, { deleted: true });
});
export const getNearbyServiceLocations = asyncHandler(async (req, res) =>
  ok(res, {
    results: await adminService.listNearbyServiceLocations(req.query),
  }),
);
export const getRideModules = asyncHandler(async (_req, res) =>
  ok(res, await adminService.listRideModules()),
);
export const getOngoingRides = asyncHandler(async (req, res) =>
  ok(res, await adminService.listOngoingRides(req.query)),
);
export const getRideRequests = asyncHandler(async (req, res) =>
  ok(res, await adminService.listRideRequests(req.query)),
);
export const getDeliveries = asyncHandler(async (req, res) =>
  ok(res, await adminService.listDeliveries(req.query)),
);
export const getIntercityTrips = asyncHandler(async (req, res) =>
  ok(res, await adminService.listIntercityTrips(req.query)),
);
export const deleteOngoingRide = asyncHandler(async (req, res) =>
  ok(res, await adminService.deleteOngoingRide(req.params.id)),
);
export const getVehicleTypes = asyncHandler(async (req, res) =>
  ok(res, await adminService.listVehicleTypes(req.query)),
);
export const getVehicleTypeCatalog = asyncHandler(async (_req, res) =>
  ok(res, await adminService.listVehicleCatalog()),
);
export const getPublicVehicleTypeCatalog = asyncHandler(async (_req, res) =>
  ok(res, await adminService.listPublicVehicleCatalog()),
);
export const getPublicRentalVehicleCatalog = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listPublicRentalVehicleCatalog() }),
);
export const getVehiclePreferenceOptions = asyncHandler(async (_req, res) =>
  ok(res, await adminService.listVehiclePreferences()),
);
export const createVehicleType = asyncHandler(async (req, res) =>
  ok(res, await adminService.createVehicleType(req.body)),
);
export const updateVehicleType = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateVehicleType(req.params.id, req.body)),
);
export const deleteVehicleType = asyncHandler(async (req, res) => {
  await adminService.deleteVehicleType(req.params.id);
  ok(res, { deleted: true });
});

export const getOwners = asyncHandler(async (req, res) =>
  ok(res, { results: await adminService.listOwners(req.query, req.auth?.admin) }),
);
export const getOwner = asyncHandler(async (req, res) =>
  ok(res, await adminService.getOwnerById(req.params.id, req.auth?.admin)),
);
export const createOwner = asyncHandler(async (req, res) =>
  ok(res, await adminService.createOwner(req.body)),
);
export const updateOwner = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateOwner(req.params.id, req.body)),
);
export const approveOwner = asyncHandler(async (req, res) =>
  ok(res, await adminService.approveOwner(req.params.id, req.body)),
);
export const approveOwnerSignupFromDriver = asyncHandler(async (req, res) =>
  ok(res, await adminService.approveOwnerSignupFromDriver(req.params.driverId)),
);
export const deleteOwner = asyncHandler(async (req, res) => {
  await adminService.deleteOwner(req.params.id);
  ok(res, { deleted: true });
});

export const getFleetVehicles = asyncHandler(async (_req, res) =>
  ok(res, await adminService.listFleetVehicles()),
);
export const createFleetVehicle = asyncHandler(async (req, res) =>
  ok(res, await adminService.createFleetVehicle(req.body)),
);
export const updateFleetVehicle = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateFleetVehicle(req.params.id, req.body)),
);
export const deleteFleetVehicle = asyncHandler(async (req, res) => {
  await adminService.deleteFleetVehicle(req.params.id);
  ok(res, { deleted: true });
});

export const getOwnerBookings = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listOwnerBookings() }),
);
export const createOwnerBooking = asyncHandler(async (req, res) =>
  ok(res, await adminService.createOwnerBooking(req.body)),
);
export const updateOwnerBooking = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateOwnerBooking(req.params.id, req.body)),
);
export const deleteOwnerBooking = asyncHandler(async (req, res) => {
  await adminService.deleteOwnerBooking(req.params.id);
  ok(res, { deleted: true });
});

export const getDashboardData = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getDashboardData()),
);
export const getOwnerDashboardData = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getOwnerDashboardData()),
);
export const getOverallEarnings = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getOverallEarnings()),
);
export const getAdminEarnings = asyncHandler(async (req, res) =>
  ok(res, await adminService.getAdminEarnings(req.query)),
);
export const getTodayEarnings = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getTodayEarnings()),
);
export const getCancelChart = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getCancelChart()),
);
export const getWithdrawals = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listWithdrawals() }),
);

export const getZones = asyncHandler(async (req, res) =>
  ok(res, { results: await adminService.listZones(req.auth?.admin) }),
);
export const createZone = asyncHandler(async (req, res) =>
  ok(res, await adminService.createZone(req.body, req.auth?.admin)),
);
export const updateZone = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateZone(req.params.id, req.body, req.auth?.admin)),
);
export const deleteZone = asyncHandler(async (req, res) => {
  await adminService.deleteZone(req.params.id, req.auth?.admin);
  ok(res, { deleted: true });
});
export const toggleZoneStatus = asyncHandler(async (req, res) =>
  ok(res, await adminService.toggleZoneStatus(req.params.id, req.auth?.admin)),
);

export const getSetPrices = asyncHandler(async (req, res) => {
  const data = await adminService.listSetPrices(req.query || {}, req.auth?.admin);
  res.json({ success: true, ...data });
});
export const createSetPrice = asyncHandler(async (req, res) =>
  ok(res, await adminService.createSetPrice(req.body, req.auth?.admin)),
);
export const updateSetPrice = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateSetPrice(req.params.id, req.body, req.auth?.admin)),
);
export const deleteSetPrice = asyncHandler(async (req, res) => {
  await adminService.deleteSetPrice(req.params.id, req.auth?.admin);
  ok(res, { deleted: true });
});

export const getAirports = asyncHandler(async (req, res) =>
  ok(res, { airports: await adminService.listAirports(req.auth?.admin) }),
);
export const createAirport = asyncHandler(async (req, res) =>
  ok(res, await adminService.createAirport(req.body, req.auth?.admin)),
);
export const updateAirport = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateAirport(req.params.id, req.body, req.auth?.admin)),
);
export const deleteAirport = asyncHandler(async (req, res) => {
  await adminService.deleteAirport(req.params.id, req.auth?.admin);
  ok(res, { deleted: true });
});

export const getBusServices = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listBusServices() }),
);
export const createBusService = asyncHandler(async (req, res) =>
  ok(res, await adminService.createBusService(req.body)),
);
export const updateBusService = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateBusService(req.params.id, req.body)),
);
export const deleteBusService = asyncHandler(async (req, res) => {
  await adminService.deleteBusService(req.params.id);
  ok(res, { deleted: true });
});

export const getAdminBusBookings = asyncHandler(async (req, res) => {
  const busServiceId = toCleanString(req.query?.busServiceId);
  const travelDate = normalizeBusTravelDate(req.query?.travelDate || req.query?.date);
  const scheduleId = toCleanString(req.query?.scheduleId);
  const status = toCleanString(req.query?.status).toLowerCase();
  const search = toCleanString(req.query?.search).toLowerCase();

  const query = {};
  if (busServiceId) {
    query.busServiceId = busServiceId;
  }
  if (travelDate) {
    query.travelDate = travelDate;
  }
  if (scheduleId) {
    query.scheduleId = scheduleId;
  }
  if (status && status !== 'all') {
    query.status = status;
  }

  const [buses, rawBookings] = await Promise.all([
    BusService.find()
      .sort({ operatorName: 1, busName: 1 })
      .select('_id busName operatorName serviceNumber coachType busCategory status route schedules blueprint seatPrice variantPricing fareCurrency')
      .lean(),
    BusBooking.find(query)
      .populate('userId', 'name phone email')
      .populate('busServiceId', 'busName operatorName serviceNumber coachType busCategory route schedules blueprint')
      .sort({ travelDate: 1, createdAt: -1 })
      .lean(),
  ]);

  const bookings = rawBookings
    .filter((booking) => {
      if (!search) return true;
      const haystack = [
        booking.bookingCode,
        booking.passenger?.name,
        booking.passenger?.phone,
        booking.userId?.name,
        booking.userId?.phone,
        booking.userId?.email,
        booking.routeSnapshot?.busName,
        booking.routeSnapshot?.operatorName,
        booking.travelDate,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(search);
    })
    .map(serializeAdminBusBooking);

  const selectedBus =
    (busServiceId
      ? buses.find((item) => String(item._id) === String(busServiceId))
      : rawBookings[0]?.busServiceId) || null;

  const selectedSchedules = Array.isArray(selectedBus?.schedules) ? selectedBus.schedules : [];
  const filteredSeatBookings = bookings.filter(
    (item) =>
      (!busServiceId || item.busService?.id === String(busServiceId)) &&
      (!travelDate || item.travelDate === travelDate) &&
      (!scheduleId || item.scheduleId === scheduleId) &&
      item.status !== 'failed' &&
      item.status !== 'expired' &&
      item.status !== 'cancelled',
  );

  const seatBookingMap = new Map();
  filteredSeatBookings.forEach((booking) => {
    booking.activeSeats.forEach((seat) => {
      seatBookingMap.set(seat.seatId, {
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        status: booking.status,
        passengerName: booking.passenger?.name || booking.user?.name || '',
        seatLabel: seat.seatLabel || seat.seatId,
      });
    });
  });

  const seatLayout = selectedBus
    ? flattenBusBlueprintSeats(selectedBus.blueprint).map((seat) => {
        const booked = seatBookingMap.get(String(seat.id || ''));
        return {
          seatId: seat.id || '',
          seatLabel: seat.label || seat.id || '',
          variant: seat.variant || 'seat',
          price: resolveBusSeatPrice(selectedBus, seat),
          baseStatus: seat.status || 'available',
          liveStatus: booked ? 'booked' : seat.status === 'blocked' ? 'blocked' : 'available',
          booking: booked || null,
        };
      })
    : [];

  const summary = bookings.reduce(
    (acc, booking) => {
      acc.totalBookings += 1;
      acc.totalAmount += Number(booking.amount || 0);
      acc.totalSeats += Number(booking.seatSummary?.active || 0);

      const bucketKey = `${booking.status || 'pending'}Bookings`;
      if (Object.prototype.hasOwnProperty.call(acc, bucketKey)) {
        acc[bucketKey] += 1;
      }

      return acc;
    },
    {
      totalBookings: 0,
      totalAmount: 0,
      totalSeats: 0,
      confirmedBookings: 0,
      pendingBookings: 0,
      cancelledBookings: 0,
      failedBookings: 0,
      expiredBookings: 0,
    },
  );

  ok(res, {
    filters: {
      busServiceId,
      travelDate,
      scheduleId,
      status: status || 'all',
      search,
    },
    buses: buses.map((bus) => ({
      id: String(bus._id),
      busName: bus.busName || '',
      operatorName: bus.operatorName || '',
      serviceNumber: bus.serviceNumber || '',
      coachType: bus.coachType || '',
      busCategory: bus.busCategory || '',
      status: bus.status || 'draft',
      route: bus.route || {},
      seatPrice: Number(bus.seatPrice || 0),
      variantPricing: bus.variantPricing || null,
      fareCurrency: bus.fareCurrency || 'INR',
      schedules: Array.isArray(bus.schedules) ? bus.schedules : [],
    })),
    selectedBus: selectedBus
      ? {
          id: String(selectedBus._id),
          busName: selectedBus.busName || '',
          operatorName: selectedBus.operatorName || '',
          serviceNumber: selectedBus.serviceNumber || '',
          route: selectedBus.route || {},
          schedules: selectedSchedules,
        }
      : null,
    schedules: selectedSchedules,
    summary,
    seatLayout,
    bookings,
  });
});

export const getAdminBusBookingCalendar = asyncHandler(async (req, res) => {
  const busServiceId = toCleanString(req.query?.busServiceId);
  const scheduleId = toCleanString(req.query?.scheduleId);
  const monthWindow = buildAdminBusMonthWindow(req.query?.month);

  const query = {
    travelDate: {
      $gte: monthWindow.startDate,
      $lt: monthWindow.endDateExclusive,
    },
  };

  if (busServiceId) {
    query.busServiceId = busServiceId;
  }

  if (scheduleId) {
    query.scheduleId = scheduleId;
  }

  const items = await BusBooking.find(query)
    .select('travelDate status seatIds cancelledSeats amount scheduleId busServiceId')
    .sort({ travelDate: 1, createdAt: -1 })
    .lean();

  const calendarMap = new Map();
  items.forEach((item) => {
    const dateKey = item.travelDate || '';
    if (!dateKey) return;

    if (!calendarMap.has(dateKey)) {
      calendarMap.set(dateKey, {
        date: dateKey,
        totalBookings: 0,
        totalSeats: 0,
        totalAmount: 0,
        confirmedBookings: 0,
        pendingBookings: 0,
        cancelledBookings: 0,
        failedBookings: 0,
        expiredBookings: 0,
      });
    }

    const day = calendarMap.get(dateKey);
    const cancelledSeatIdSet = new Set(
      (Array.isArray(item.cancelledSeats) ? item.cancelledSeats : [])
        .map((seat) => toCleanString(seat?.seatId))
        .filter(Boolean),
    );
    const totalActiveSeats = (Array.isArray(item.seatIds) ? item.seatIds : []).filter(
      (seatId) => !cancelledSeatIdSet.has(toCleanString(seatId)),
    ).length;

    day.totalBookings += 1;
    day.totalSeats += totalActiveSeats;
    day.totalAmount += Number(item.amount || 0);

    const bucketKey = `${item.status || 'pending'}Bookings`;
    if (Object.prototype.hasOwnProperty.call(day, bucketKey)) {
      day[bucketKey] += 1;
    }
  });

  ok(res, {
    month: monthWindow.month,
    startDate: monthWindow.startDate,
    endDateExclusive: monthWindow.endDateExclusive,
    days: Array.from(calendarMap.values()),
  });
});

export const createAdminBusBooking = asyncHandler(async (req, res) => {
  const busServiceId = toCleanString(req.body?.busServiceId);
  const scheduleId = toCleanString(req.body?.scheduleId);
  const travelDate = normalizeBusTravelDate(req.body?.travelDate || req.body?.date);
  const seatIds = Array.isArray(req.body?.seatIds)
    ? [...new Set(req.body.seatIds.map((item) => toCleanString(item)).filter(Boolean))]
    : [];
  const ageNumber = Number(req.body?.passenger?.age || 0);
  const notes = toCleanString(req.body?.notes);

  if (!mongoose.Types.ObjectId.isValid(busServiceId)) {
    throw new ApiError(400, 'Valid bus service is required');
  }
  if (!scheduleId || seatIds.length === 0) {
    throw new ApiError(400, 'scheduleId and seatIds are required');
  }
  if (!travelDate) {
    throw new ApiError(400, 'travelDate is required');
  }

  const busService = await BusService.findById(busServiceId).lean();
  if (!busService || String(busService.status || '') !== 'active') {
    throw new ApiError(404, 'Active bus service not found');
  }

  const schedule = findBusSchedule(busService, scheduleId);
  if (!isScheduleAvailableOnDate(schedule, travelDate)) {
    throw new ApiError(404, 'Bus schedule not found for the selected date');
  }

  const user = await resolveAdminBusBookingUser(req.body?.passenger || {});
  const passenger = {
    name: toCleanString(req.body?.passenger?.name),
    age: Number.isFinite(ageNumber) && ageNumber > 0 ? ageNumber : null,
    gender: toCleanString(req.body?.passenger?.gender),
    phone: normalizePhone(req.body?.passenger?.phone),
    email: normalizeEmail(req.body?.passenger?.email),
  };

  const seatLayout = await buildAdminBusSeatLayout({ busService, scheduleId, travelDate });
  const availableSeatMap = new Map(
    flattenBusBlueprintSeats(seatLayout)
      .filter((seat) => String(seat.status || 'available') === 'available')
      .map((seat) => [String(seat.id || ''), seat]),
  );

  const invalidSeat = seatIds.find((seatId) => !availableSeatMap.has(seatId));
  if (invalidSeat) {
    throw new ApiError(409, `Seat ${invalidSeat} is not available`);
  }

  const amount = Math.round(
    seatIds.reduce((sum, seatId) => sum + resolveBusSeatPrice(busService, availableSeatMap.get(seatId)), 0) * 100,
  ) / 100;
  const booking = await BusBooking.create({
    userId: user._id,
    busServiceId: busService._id,
    bookingCode: `BAD${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
    scheduleId,
    travelDate,
    seatIds,
    seatLabels: seatIds.map((seatId) => availableSeatMap.get(seatId)?.label || seatId),
    passenger,
    amount,
    bookingSource: 'admin',
    currency: busService.fareCurrency || 'INR',
    status: 'confirmed',
    expiresAt: null,
    routeSnapshot: {
      originCity: busService.route?.originCity || '',
      destinationCity: busService.route?.destinationCity || '',
      departureTime: schedule?.departureTime || '',
      arrivalTime: schedule?.arrivalTime || '',
      durationHours: busService.route?.durationHours || '',
      busName: busService.busName || '',
      operatorName: busService.operatorName || '',
      coachType: busService.coachType || '',
      busCategory: busService.busCategory || '',
    },
    payment: {
      provider: 'manual',
      orderId: '',
      paymentId: '',
      signature: '',
      status: 'manual_reserved',
      paidAt: new Date(),
    },
    notes,
  });

  try {
    await BusSeatHold.insertMany(
      seatIds.map((seatId) => ({
        busServiceId: busService._id,
        bookingId: booking._id,
        userId: user._id,
        scheduleId,
        travelDate,
        seatId,
        holdToken: booking.bookingCode,
        status: 'booked',
        expiresAt: null,
      })),
      { ordered: true },
    );
  } catch (error) {
    await BusBooking.deleteOne({ _id: booking._id });
    if (error?.code === 11000) {
      throw new ApiError(409, 'One or more selected seats were just booked');
    }
    throw error;
  }

  const hydratedBooking = await BusBooking.findById(booking._id)
    .populate('userId', 'name phone email')
    .populate('busServiceId', 'busName operatorName serviceNumber coachType busCategory route schedules blueprint')
    .lean();

  res.status(201).json({
    success: true,
    data: serializeAdminBusBooking(hydratedBooking),
    message: 'Seat booked successfully from admin panel',
  });
});

export const cancelAdminBusBookingSeats = asyncHandler(async (req, res) => {
  const bookingId = toCleanString(req.params?.id);
  const selectedSeatIds = Array.isArray(req.body?.seatIds)
    ? [...new Set(req.body.seatIds.map((item) => toCleanString(item)).filter(Boolean))]
    : [];
  const adminNote = toCleanString(req.body?.notes || req.body?.adminNote || 'Cancelled by admin panel');

  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new ApiError(400, 'Valid booking id is required');
  }

  const booking = await BusBooking.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Bus booking not found');
  }

  if (String(booking.status || '') !== 'confirmed') {
    throw new ApiError(409, 'Only confirmed bus bookings can be unbooked from admin');
  }

  const originalSeatIds = Array.isArray(booking.seatIds) ? booking.seatIds : [];
  const originalSeatLabels = Array.isArray(booking.seatLabels) ? booking.seatLabels : [];
  const cancelledSeats = Array.isArray(booking.cancelledSeats) ? booking.cancelledSeats : [];
  const cancelledSeatIds = new Set(
    cancelledSeats.map((item) => toCleanString(item?.seatId)).filter(Boolean),
  );
  const activeSeats = originalSeatIds
    .map((seatId, index) => ({
      seatId: toCleanString(seatId),
      seatLabel: originalSeatLabels[index] || seatId,
    }))
    .filter((item) => item.seatId && !cancelledSeatIds.has(item.seatId));

  const seatsToCancel = selectedSeatIds.length > 0
    ? activeSeats.filter((item) => selectedSeatIds.includes(item.seatId))
    : activeSeats;

  if (seatsToCancel.length === 0) {
    throw new ApiError(400, 'Select at least one active seat to unbook');
  }

  if (selectedSeatIds.length > 0 && seatsToCancel.length !== selectedSeatIds.length) {
    throw new ApiError(409, 'Some selected seats are already cancelled or not part of this booking');
  }

  const cancelledAt = new Date();
  booking.cancelledSeats = [
    ...cancelledSeats,
    ...seatsToCancel.map((item) => ({
      seatId: item.seatId,
      seatLabel: item.seatLabel,
      cancelledAt,
      refundAmount: 0,
      chargeAmount: 0,
      refundStatus: 'admin_cancelled',
      refundId: '',
      refundProcessedAt: cancelledAt,
      notes: adminNote,
    })),
  ];

  const remainingActiveSeatCount = activeSeats.length - seatsToCancel.length;
  booking.status = remainingActiveSeatCount <= 0 ? 'cancelled' : 'confirmed';
  booking.cancelledAt = remainingActiveSeatCount <= 0 ? cancelledAt : null;
  booking.cancellation = {
    allowed: remainingActiveSeatCount > 0,
    appliedRuleId: '',
    appliedRuleLabel: 'Admin seat release',
    refundType: 'none',
    refundValue: 0,
    hoursBeforeDeparture: 0,
    refundAmount: 0,
    chargeAmount: 0,
    notes: adminNote,
  };
  if (!booking.notes?.includes(adminNote)) {
    booking.notes = [booking.notes, adminNote].filter(Boolean).join(' | ');
  }
  await booking.save();

  await BusSeatHold.deleteMany({
    bookingId: booking._id,
    status: { $in: ['held', 'booked'] },
    seatId: { $in: seatsToCancel.map((item) => item.seatId) },
  });

  const hydratedBooking = await BusBooking.findById(booking._id)
    .populate('userId', 'name phone email')
    .populate('busServiceId', 'busName operatorName serviceNumber coachType busCategory route schedules blueprint')
    .lean();

  res.status(200).json({
    success: true,
    data: serializeAdminBusBooking(hydratedBooking),
    message:
      remainingActiveSeatCount <= 0
        ? 'Booking cancelled and seats released successfully'
        : 'Selected seats unbooked successfully',
  });
});

export const getRentalVehicleTypes = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listRentalVehicleTypes() }),
);
export const createRentalVehicleType = asyncHandler(async (req, res) =>
  ok(res, await adminService.createRentalVehicleType(req.body)),
);
export const updateRentalVehicleType = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateRentalVehicleType(req.params.id, req.body)),
);
export const deleteRentalVehicleType = asyncHandler(async (req, res) => {
  await adminService.deleteRentalVehicleType(req.params.id);
  ok(res, { deleted: true });
});

export const getPoolingRoutes = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listPoolingRoutes() }),
);
export const createPoolingRoute = asyncHandler(async (req, res) =>
  ok(res, await adminService.createPoolingRoute(req.body)),
);
export const updatePoolingRoute = asyncHandler(async (req, res) =>
  ok(res, await adminService.updatePoolingRoute(req.params.id, req.body)),
);
export const deletePoolingRoute = asyncHandler(async (req, res) => {
  await adminService.deletePoolingRoute(req.params.id);
  ok(res, { deleted: true });
});
export const getRentalQuoteRequests = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listRentalQuoteRequests() }),
);
export const updateRentalQuoteRequest = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateRentalQuoteRequest(req.params.id, req.body, req.auth?.sub)),
);
export const getRentalBookingRequests = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listRentalBookingRequests() }),
);
export const getRentalTrackingDashboard = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getRentalTrackingDashboard()),
);
export const updateRentalBookingRequest = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateRentalBookingRequest(req.params.id, req.body, req.auth?.sub)),
);

export const getGoodsTypes = asyncHandler(async (_req, res) =>
  res.json(await adminService.listGoodsTypes()),
);
export const createGoodsType = asyncHandler(async (req, res) =>
  ok(res, await adminService.createGoodsType(req.body)),
);
export const updateGoodsType = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateGoodsType(req.params.id, req.body)),
);
export const deleteGoodsType = asyncHandler(async (req, res) => {
  await adminService.deleteGoodsType(req.params.id);
  ok(res, { deleted: true });
});

export const getRentalPackageTypes = asyncHandler(async (_req, res) =>
  ok(res, { rental_packages: await adminService.listRentalPackageTypes() }),
);
export const createRentalPackageType = asyncHandler(async (req, res) =>
  ok(res, await adminService.createRentalPackageType(req.body)),
);
export const updateRentalPackageType = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateRentalPackageType(req.params.id, req.body)),
);
export const deleteRentalPackageType = asyncHandler(async (req, res) => {
  await adminService.deleteRentalPackageType(req.params.id);
  ok(res, { deleted: true });
});

export const getOwnerNeededDocuments = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listOwnerNeededDocuments() }),
);
export const getDriverNeededDocuments = asyncHandler(async (req, res) =>
  ok(res, {
    results: await adminService.listDriverNeededDocuments({
      templateType: req.query?.template_type || 'document',
      includeFields: String(req.query?.template_type || 'document').trim().toLowerCase() !== 'vehicle_field',
    }),
  }),
);
export const getDriverNeededDocument = asyncHandler(async (req, res) =>
  ok(res, await adminService.getDriverNeededDocumentById(req.params.id)),
);
export const createDriverNeededDocument = asyncHandler(async (req, res) =>
  ok(res, await adminService.createDriverNeededDocument(req.body)),
);
export const updateDriverNeededDocument = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateDriverNeededDocument(req.params.id, req.body)),
);
export const deleteDriverNeededDocument = asyncHandler(async (req, res) => {
  await adminService.deleteDriverNeededDocument(req.params.id);
  ok(res, { deleted: true });
});
export const getReferralTranslations = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listReferralTranslations() }),
);
export const updateReferralTranslation = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateReferralTranslation(req.params.languageCode, req.body)),
);
export const createOwnerNeededDocument = asyncHandler(async (req, res) =>
  ok(res, await adminService.createOwnerNeededDocument(req.body)),
);
export const updateOwnerNeededDocument = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.updateOwnerNeededDocument(req.params.id, req.body),
  ),
);
export const deleteOwnerNeededDocument = asyncHandler(async (req, res) => {
  await adminService.deleteOwnerNeededDocument(req.params.id);
  ok(res, { deleted: true });
});

export const getLanguages = asyncHandler(async (_req, res) => {
  const items = await adminService.listLanguages();
  res.json({ success: true, paginator: { data: items }, results: items });
});
export const updateLanguageStatus = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateLanguageStatus(req.params.id, req.body)),
);
export const deleteLanguage = asyncHandler(async (req, res) => {
  await adminService.deleteLanguage(req.params.id);
  ok(res, { deleted: true });
});

export const getPreferences = asyncHandler(async (_req, res) => {
  const items = await adminService.listPreferences();
  res.json({ success: true, paginator: { data: items }, results: items });
});
export const createPreference = asyncHandler(async (req, res) =>
  ok(res, await adminService.createPreference(req.body)),
);
export const updatePreferenceStatus = asyncHandler(async (req, res) =>
  ok(res, await adminService.updatePreferenceStatus(req.params.id, req.body)),
);
export const deletePreference = asyncHandler(async (req, res) => {
  await adminService.deletePreference(req.params.id);
  ok(res, { deleted: true });
});

export const getRoles = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listRoles() }),
);
export const createRole = asyncHandler(async (req, res) =>
  ok(res, await adminService.createRole(req.body)),
);
export const deleteRole = asyncHandler(async (req, res) => {
  await adminService.deleteRole(req.params.id);
  ok(res, { deleted: true });
});

export const getAppModules = asyncHandler(async (req, res) =>
  ok(res, await adminService.listAppModules(req.query)),
);
export const createAppModule = asyncHandler(async (req, res) =>
  ok(res, await adminService.createAppModule(req.body)),
);
export const updateAppModule = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateAppModule(req.params.id, req.body)),
);
export const deleteAppModule = asyncHandler(async (req, res) => {
  await adminService.deleteAppModule(req.params.id);
  ok(res, { deleted: true });
});

export const getNotificationChannels = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listNotificationChannels() }),
);
export const toggleChannelPush = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.updateNotificationChannelField(
      req.params.id,
      "push_notification",
      req.body.push_notification,
    ),
  ),
);
export const toggleChannelMail = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.updateNotificationChannelField(
      req.params.id,
      "mail",
      req.body.mail,
    ),
  ),
);

export const getPaymentGateways = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listPaymentGateways() }),
);
export const getPaymentMethods = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listPaymentMethods() }),
);
export const createPaymentMethod = asyncHandler(async (req, res) =>
  ok(res, await adminService.createPaymentMethod(req.body)),
);
export const updatePaymentMethod = asyncHandler(async (req, res) =>
  ok(res, await adminService.updatePaymentMethod(req.params.id, req.body)),
);
export const deletePaymentMethod = asyncHandler(async (req, res) => {
  await adminService.deletePaymentMethod(req.params.id);
  ok(res, { deleted: true });
});
export const getPaymentSettings = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getPaymentSettings()),
);
export const updatePaymentSettings = asyncHandler(async (req, res) =>
  ok(res, await adminService.updatePaymentSettings(req.body)),
);

export const getSmsSettings = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getSMSSettings()),
);
export const updateSmsSettings = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateSMSSettings(req.body)),
);

export const getFirebaseSettings = asyncHandler(async (_req, res) =>
  ok(res, { settings: await adminService.getFirebaseSettings() }),
);
export const updateFirebaseSettings = asyncHandler(async (req, res) =>
  ok(res, { settings: await adminService.updateFirebaseSettings(req.body) }),
);

export const getMapSettings = asyncHandler(async (_req, res) =>
  ok(res, { settings: await adminService.getMapSettings() }),
);
export const updateMapSettings = asyncHandler(async (req, res) =>
  ok(res, { settings: await adminService.updateMapSettings(req.body) }),
);

export const getMailSettings = asyncHandler(async (_req, res) =>
  ok(res, { settings: await adminService.getMailSettings() }),
);
export const updateMailSettings = asyncHandler(async (req, res) =>
  ok(res, { settings: await adminService.updateMailSettings(req.body) }),
);

export const getUserOnboarding = asyncHandler(async (_req, res) =>
  res.json({
    success: true,
    results: await adminService.listOnboardingScreens("user"),
  }),
);
export const getDriverOnboarding = asyncHandler(async (_req, res) =>
  res.json({
    success: true,
    results: await adminService.listOnboardingScreens("driver"),
  }),
);
export const getOwnerOnboarding = asyncHandler(async (_req, res) =>
  res.json({
    success: true,
    results: await adminService.listOnboardingScreens("owner"),
  }),
);
export const createOnboardingScreen = asyncHandler(async (req, res) =>
  ok(res, await adminService.createOnboardingScreen(req.body)),
);
export const updateOnboardingScreen = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateOnboardingScreen(req.params.id, req.body)),
);
export const deleteOnboardingScreen = asyncHandler(async (req, res) =>
  ok(res, await adminService.deleteOnboardingScreen(req.params.id)),
);

export const downloadUserReport = asyncHandler(async (req, res) => {
  const format = req.query.file_format || 'csv';
  const data = await adminService.buildUserReport(req.query);
  await sendFile(res, "user-report", data, format);
});

export const downloadDriverReport = asyncHandler(async (req, res) => {
  const format = req.query.file_format || 'csv';
  const data = await adminService.buildDriverReport(req.query);
  await sendFile(res, "driver-report", data, format);
});

export const downloadDriverDutyReport = asyncHandler(async (req, res) => {
  const format = req.query.file_format || 'csv';
  const data = await adminService.buildDriverDutyReport(req.query);
  await sendFile(res, "driver-duty-report", data, format);
});

export const downloadOwnerReport = asyncHandler(async (req, res) => {
  const format = req.query.file_format || 'csv';
  const data = await adminService.buildOwnerReport(req.query);
  await sendFile(res, "owner-report", data, format);
});

export const downloadFinanceReport = asyncHandler(async (req, res) => {
  const format = req.query.file_format || 'csv';
  const data = await adminService.buildFinanceReport(req.query);
  await sendFile(res, "finance-report", data, format);
});

export const downloadFleetFinanceReport = asyncHandler(async (req, res) => {
  const format = req.query.file_format || 'csv';
  const data = await adminService.buildFleetFinanceReport(req.query);
  await sendFile(res, "fleet-finance-report", data, format);
});
export const getGeneralSettingsCategory = asyncHandler(async (req, res) =>
  ok(res, await adminService.getGeneralSettings(req.params.category)),
);
export const updateGeneralSettingsCategory = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.updateGeneralSettings(req.params.category, req.body),
  ),
);
export const getTransportTypes = asyncHandler(async (_req, res) =>
  ok(res, await adminService.listTransportTypes()),
);

export const getAppBootstrap = asyncHandler(async (_req, res) => {
  const [modules, general, transportRide, customize, paymentGateway] = await Promise.all([
    adminService.listAppModules(),
    adminService.getGeneralSettings('general'),
    adminService.getGeneralSettings('transport-ride'),
    adminService.getGeneralSettings('customize'),
    getPublicActivePaymentGateway(),
  ]);

  ok(res, {
    modules: modules.results || modules,
    settings: {
      general: general.settings || {},
      transportRide: transportRide.settings || {},
      customization: customize.settings || {},
      paymentGateway: paymentGateway?.activeGateway || null,
    }
  });
});
