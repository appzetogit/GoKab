import { asyncHandler } from "../../../../utils/asyncHandler.js";
import * as adminService from "../services/adminService.js";
import ExcelJS from 'exceljs';
import { getPublicActivePaymentGateway } from '../../services/paymentGatewayService.js';

const ok = (res, data, extra = {}) =>
  res.json({ success: true, data, ...extra });

const toCleanString = (value = '') => String(value || '').trim();

const normalizePhone = (value) => {
  const digits = toCleanString(value).replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
};

const normalizeEmail = (value) => toCleanString(value).toLowerCase();

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
  ok(res, await subscriptionTierService.createTier(req.body, { admin_id: req.auth?.admin?.id || null, admin_email: req.auth?.admin?.email || 'admin', ip_address: req.ip })),
);
export const updateSubscriptionPlan = asyncHandler(async (req, res) =>
  ok(res, await subscriptionTierService.updateTier(req.params.id, req.body, { admin_id: req.auth?.admin?.id || null, admin_email: req.auth?.admin?.email || 'admin', ip_address: req.ip })),
);
export const deleteSubscriptionPlan = asyncHandler(async (req, res) =>
  ok(res, await subscriptionTierService.deleteTier(req.params.id, { admin_id: req.auth?.admin?.id || null, admin_email: req.auth?.admin?.email || 'admin', ip_address: req.ip })),
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
    performedBy: req.auth?.admin?.email || 'admin',
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
export const getCountries = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listCountries() }),
);
export const createServiceLocation = asyncHandler(async (req, res) =>
  ok(res, await adminService.createServiceLocation(req.body, req.auth?.admin)),
);
export const updateServiceLocation = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateServiceLocation(req.params.id, req.body, req.auth?.admin)),
);
export const deleteServiceLocation = asyncHandler(async (req, res) => {
  await adminService.deleteServiceLocation(req.params.id, req.auth?.admin);
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
export const getPublicVehicleTypeCatalog = asyncHandler(async (req, res) =>
  ok(res, await adminService.listPublicVehicleCatalog(req.query)),
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
  // Deleting a type still referenced by a driver, fleet vehicle or ride
  // deactivates it instead — the admin panel should say so, not claim a
  // deletion that didn't happen.
  const result = await adminService.deleteVehicleType(req.params.id);
  ok(res, result);
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

const PUBLIC_TARIFF_FIELDS = [
  'base_price', 'base_distance', 'price_per_distance', 'time_price', 'waiting_charge',
  'free_waiting_before', 'free_waiting_after', 'service_tax',
  'enable_outstation_ride', 'support_outstation', 'outstation_base_price', 'outstation_base_distance',
  'outstation_price_per_distance', 'outstation_time_price',
  'enable_airport_ride', 'airport_surge', 'support_airport_fee',
];
const idOf = (ref) => (ref ? String(ref._id || ref.id || ref) : null);

/**
 * Public (rider app): the active fare tariffs, no admin scoping. `results` of
 * listSetPrices has no rates, so they come from the raw rows (`paginator.data`,
 * which also carries heavy populated vehicle art that is deliberately left out).
 */
export const getPublicSetPrices = asyncHandler(async (req, res) => {
  const { results, paginator } = await adminService.listSetPrices({ scope: String(req.query?.scope || 'ride') });
  const raw = new Map(paginator.data.map((item) => [String(item.id), item]));
  const rows = results
    .filter((item) => Number(item.active) === 1)
    .map(({ icon: _icon, ...item }) => {
      const source = raw.get(String(item.id)) || {};
      return {
        ...item,
        zone_id: idOf(source.zone_id),
        service_location_id: idOf(source.service_location_id),
        ...Object.fromEntries(PUBLIC_TARIFF_FIELDS.map((key) => [key, source[key]])),
      };
    });
  res.json({ success: true, data: { results: rows } });
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

export const getRailwayStations = asyncHandler(async (req, res) =>
  ok(res, { railway_stations: await adminService.listRailwayStations(req.auth?.admin) }),
);
export const createRailwayStation = asyncHandler(async (req, res) =>
  ok(res, await adminService.createRailwayStation(req.body, req.auth?.admin)),
);
export const updateRailwayStation = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateRailwayStation(req.params.id, req.body, req.auth?.admin)),
);
export const deleteRailwayStation = asyncHandler(async (req, res) => {
  await adminService.deleteRailwayStation(req.params.id, req.auth?.admin);
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
