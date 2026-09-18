import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { RIDE_STATUS } from '../../constants/index.js';
import { Driver } from '../../driver/models/Driver.js';
import { DriverRoute } from '../../driver/models/DriverRoute.js';
import { LeadContact } from '../../driver/models/LeadContact.js';
import { Ride } from '../../user/models/Ride.js';
import { AdminBusinessSetting } from '../models/AdminBusinessSetting.js';
import { FleetVehicle } from '../models/FleetVehicle.js';
import { PrimeCitySlot } from '../models/PrimeCitySlot.js';
import { ServiceLocation } from '../models/ServiceLocation.js';
import { SubscriptionTier } from '../models/SubscriptionTier.js';
import {
  DEFAULT_DRIVER_NETWORK_SETTINGS,
  getDriverNetworkSettings,
} from '../../services/appSettingsService.js';
import { DriverSubscription } from '../../driver/models/DriverSubscription.js';
import {
  applyCategoryFromSubscription,
  downgradeToLower,
  getPrimeSlotUsage,
} from '../../services/driverCategoryService.js';
import {
  releasePublishedRide,
  resolveEscrowDispute,
} from '../../driver/services/escrowService.js';

/**
 * Network administration is its own permission rather than folding into
 * `settings.view`: it can move money between drivers and revoke a plan somebody
 * paid for, so it should be grantable on its own.
 */
const assertNetworkAdmin = (req) => {
  const permissions = req.auth?.admin?.permissions || [];
  if (permissions.includes('*') || permissions.includes('driver_network.view')) return;
  throw new ApiError(403, 'You do not have permission to manage the driver network', null, 'FORBIDDEN');
};

const objectId = (value, field) => {
  if (!value || !mongoose.isValidObjectId(value)) {
    throw new ApiError(400, `${field} is invalid`, null, 'INVALID_ID');
  }
  return new mongoose.Types.ObjectId(String(value));
};

export const getNetworkSettingsController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);
  res.json({
    success: true,
    data: { settings: await getDriverNetworkSettings(), defaults: DEFAULT_DRIVER_NETWORK_SETTINGS },
  });
});

export const updateNetworkSettingsController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);

  const current = await getDriverNetworkSettings();
  const next = { ...current };

  // Only keys the defaults declare are accepted, so a typo cannot silently
  // create a setting nothing reads.
  for (const [key, value] of Object.entries(req.body || {})) {
    if (!(key in DEFAULT_DRIVER_NETWORK_SETTINGS)) continue;
    next[key] = typeof DEFAULT_DRIVER_NETWORK_SETTINGS[key] === 'number' ? Number(value) : value;
  }

  await AdminBusinessSetting.updateOne(
    { scope: 'default' },
    { $set: { driver_network: next } },
    { upsert: true },
  );

  res.json({ success: true, data: { settings: next } });
});

export const listPrimeSlotsController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);

  const filter = req.query.cityId ? { service_location_id: objectId(req.query.cityId, 'cityId') } : {};
  const slots = await PrimeCitySlot.find(filter).sort({ service_location_id: 1, slot_no: 1 }).lean();

  const [drivers, cities] = await Promise.all([
    Driver.find({ _id: { $in: slots.map((slot) => slot.driver_id) } })
      .select('name phone driver_category')
      .lean(),
    ServiceLocation.find({ _id: { $in: slots.map((slot) => slot.service_location_id) } })
      .select('name prime_limit')
      .lean(),
  ]);
  const driverMap = new Map(drivers.map((driver) => [String(driver._id), driver]));
  const cityMap = new Map(cities.map((city) => [String(city._id), city]));

  res.json({
    success: true,
    data: {
      results: slots.map((slot) => ({
        id: String(slot._id),
        slot_no: slot.slot_no,
        status: slot.status,
        reserved_until: slot.reserved_until,
        city: cityMap.get(String(slot.service_location_id))?.name || '',
        city_id: String(slot.service_location_id),
        driver: driverMap.get(String(slot.driver_id))
          ? {
              id: String(slot.driver_id),
              name: driverMap.get(String(slot.driver_id)).name,
              phone: driverMap.get(String(slot.driver_id)).phone,
            }
          : { id: String(slot.driver_id), name: '(deleted driver)', phone: '' },
        since: slot.createdAt,
      })),
    },
  });
});

export const revokePrimeSlotController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);

  const slot = await PrimeCitySlot.findById(objectId(req.params.slotId, 'slotId'));
  if (!slot) throw new ApiError(404, 'Slot not found', null, 'SLOT_NOT_FOUND');

  // Taking the seat away must also take the category, otherwise the driver
  // keeps Prime powers with no seat backing them.
  await downgradeToLower({ driverId: slot.driver_id, reason: 'prime_slot_revoked_by_admin' });

  res.json({ success: true, data: { revoked: true, driverId: String(slot.driver_id) } });
});

export const updateCityPrimeLimitController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);

  const cityId = objectId(req.params.cityId, 'cityId');
  const raw = req.body?.prime_limit;
  const limit = raw === null || raw === '' ? null : Number(raw);

  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
    throw new ApiError(422, 'prime_limit must be a non-negative whole number or null', null, 'INVALID_LIMIT');
  }

  // Lowering below the seats already taken would leave drivers holding seats
  // that no longer exist, so refuse rather than silently over-allocating.
  const used = await PrimeCitySlot.countDocuments({ service_location_id: cityId });
  if (limit !== null && limit < used) {
    throw new ApiError(
      409,
      `${used} Prime drivers already hold a slot in this city`,
      { used, requested: limit },
      'LIMIT_BELOW_CURRENT_USAGE',
    );
  }

  // An admin who mistypes a city id should be told, not shown a success that
  // updated nothing.
  const updated = await ServiceLocation.updateOne({ _id: cityId }, { $set: { prime_limit: limit } });
  if (!updated.matchedCount) {
    throw new ApiError(404, 'City not found', null, 'CITY_NOT_FOUND');
  }

  res.json({ success: true, data: await getPrimeSlotUsage(cityId) });
});

export const overrideDriverCategoryController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);

  const driverId = objectId(req.params.driverId, 'driverId');
  const category = String(req.body?.category || '').trim().toLowerCase();

  if (!['prime', 'middle', 'lower'].includes(category)) {
    throw new ApiError(422, 'category must be prime, middle or lower', null, 'INVALID_CATEGORY');
  }

  if (category === 'lower') {
    await DriverSubscription.updateMany(
      { driver_id: driverId, status: 'active' },
      { $set: { status: 'cancelled' } },
    );
    await downgradeToLower({ driverId, reason: req.body?.reason || 'admin_override' });

    res.json({ success: true, data: { driverId: String(driverId), category } });
    return;
  }

  const driver = await Driver.findById(driverId).select('service_location_id').lean();
  if (!driver) throw new ApiError(404, 'Driver not found', null, 'DRIVER_NOT_FOUND');

  const tier = await SubscriptionTier.findOne({ driver_category: category, is_active: true })
    .sort({ display_order: 1 })
    .lean();
  if (!tier) {
    throw new ApiError(
      422,
      `No active ${category} plan exists to grant`,
      { category },
      'TIER_NOT_FOUND',
    );
  }

  // The override grants the *plan*, not just the badge. Every permission check
  // resolves through the active subscription's tier, so setting
  // `driver_category` alone would hand the driver a label with none of the
  // powers behind it — and the expiry cron would never clean it up either.
  const validUntil = req.body?.valid_until
    ? new Date(req.body.valid_until)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(validUntil.getTime()) || validUntil <= new Date()) {
    throw new ApiError(422, 'valid_until must be a future date', null, 'INVALID_VALID_UNTIL');
  }

  await DriverSubscription.updateMany(
    { driver_id: driverId, status: 'active' },
    { $set: { status: 'cancelled' } },
  );

  const granted = await DriverSubscription.create({
    driver_id: driverId,
    tier_id: tier._id,
    billing_cycle: 'monthly',
    start_date: new Date(),
    end_date: validUntil,
    status: 'active',
  });

  // Reuses the normal activation path, so the Prime slot, the denormalised
  // category, the audit log and the driver notification all behave exactly as
  // they do for a paid upgrade.
  await applyCategoryFromSubscription({ subscription: granted });

  res.json({
    success: true,
    data: {
      driverId: String(driverId),
      category,
      tier: tier.name,
      valid_until: validUntil,
      subscription_id: String(granted._id),
    },
  });
});

export const updateDriverRouteLimitController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);

  const raw = req.body?.max_routes_override;
  const override = raw === null || raw === '' ? null : Number(raw);

  if (override !== null && (!Number.isInteger(override) || override < 0)) {
    throw new ApiError(422, 'max_routes_override must be a non-negative whole number or null', null, 'INVALID_LIMIT');
  }

  const updated = await Driver.updateOne(
    { _id: objectId(req.params.driverId, 'driverId') },
    { $set: { max_routes_override: override } },
  );
  if (!updated.matchedCount) {
    throw new ApiError(404, 'Driver not found', null, 'DRIVER_NOT_FOUND');
  }

  res.json({ success: true, data: { max_routes_override: override } });
});

export const listDriverRoutesForAdminController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);

  const driverId = objectId(req.params.driverId, 'driverId');
  if (!(await Driver.exists({ _id: driverId }))) {
    throw new ApiError(404, 'Driver not found', null, 'DRIVER_NOT_FOUND');
  }

  const routes = await DriverRoute.find({ driver_id: driverId, deletedAt: null })
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    data: {
      results: routes.map((route) => ({
        id: String(route._id),
        name: route.name,
        stops: (route.stops || []).map((stop) => stop.name),
        corridor_km: route.corridor_km,
        bidirectional: route.bidirectional,
        distance_meters: route.distance_meters,
      })),
    },
  });
});

export const listNetworkRidesForAdminController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  const filter = {};
  if (req.query.origin) filter.origin = String(req.query.origin);
  if (req.query.publish_status) filter['publish.status'] = String(req.query.publish_status);
  if (req.query.city) filter.service_location_id = objectId(req.query.city, 'city');
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }

  const [rides, total] = await Promise.all([
    Ride.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Ride.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      results: rides.map((ride) => ({
        id: String(ride._id),
        origin: ride.origin,
        status: ride.status,
        fare: ride.fare,
        pickup: ride.pickupAddress || '',
        drop: ride.dropAddress || '',
        publish_status: ride.publish?.status || 'none',
        escrow_state: ride.escrow?.state || 'none',
        created_by_driver_id: ride.created_by_driver_id ? String(ride.created_by_driver_id) : null,
        driver_id: ride.driverId ? String(ride.driverId) : null,
        createdAt: ride.createdAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    },
  });
});

export const listEscrowController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);

  const state = String(req.query.state || 'held');
  const rides = await Ride.find({ 'escrow.state': state })
    .select('_id fare escrow publish created_by_driver_id driverId status createdAt')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const driverIds = rides.flatMap((ride) => [
    ride.escrow?.publisher_driver_id,
    ride.escrow?.acceptor_driver_id,
  ]).filter(Boolean);
  const drivers = await Driver.find({ _id: { $in: driverIds } }).select('name phone').lean();
  const driverMap = new Map(drivers.map((driver) => [String(driver._id), driver]));

  res.json({
    success: true,
    data: {
      results: rides.map((ride) => ({
        rideId: String(ride._id),
        state: ride.escrow.state,
        publisher: driverMap.get(String(ride.escrow.publisher_driver_id)) || null,
        acceptor: driverMap.get(String(ride.escrow.acceptor_driver_id)) || null,
        publisher_hold: ride.escrow.publisher_hold,
        acceptor_hold: ride.escrow.acceptor_hold,
        collected_by: ride.escrow.collected_by,
        dispute_until: ride.escrow.dispute_until,
        ride_status: ride.status,
        createdAt: ride.createdAt,
      })),
      total_frozen: rides.reduce(
        (sum, ride) => sum + Number(ride.escrow.publisher_hold || 0) + Number(ride.escrow.acceptor_hold || 0),
        0,
      ),
    },
  });
});

export const resolveEscrowController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);
  res.json({
    success: true,
    data: await resolveEscrowDispute({
      rideId: req.params.rideId,
      correctCollectedBy: String(req.body?.collected_by || req.body?.collectedBy || ''),
      adminId: req.auth?.admin?.id || null,
    }),
  });
});

export const forceReleaseEscrowController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);

  const rideId = objectId(req.params.rideId, 'rideId');
  const ride = await Ride.findById(rideId).select('escrow.state').lean();
  if (!ride) {
    throw new ApiError(404, 'Ride not found', null, 'RIDE_NOT_FOUND');
  }
  if (ride.escrow?.state !== 'held') {
    throw new ApiError(
      409,
      `This ride has no held escrow to release (state: ${ride.escrow?.state || 'none'})`,
      { state: ride.escrow?.state || 'none' },
      'ESCROW_STATE_INVALID',
    );
  }

  res.json({
    success: true,
    data: await releasePublishedRide({
      rideId,
      reason: req.body?.reason || 'admin_force_release',
    }),
  });
});

export const listLeadContactsController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);

  const filter = {};
  if (req.query.driverId) filter.requester_driver_id = objectId(req.query.driverId, 'driverId');
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }

  const contacts = await LeadContact.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  const drivers = await Driver.find({ _id: { $in: contacts.map((item) => item.requester_driver_id) } })
    .select('name phone')
    .lean();
  const driverMap = new Map(drivers.map((driver) => [String(driver._id), driver]));

  res.json({
    success: true,
    data: {
      results: contacts.map((contact) => ({
        id: String(contact._id),
        rideId: String(contact.ride_id),
        driver: driverMap.get(String(contact.requester_driver_id)) || null,
        lead_type: contact.lead_type,
        channels: contact.channels_used,
        fee_charged: contact.fee_charged,
        createdAt: contact.createdAt,
      })),
      revenue: contacts.reduce((sum, contact) => sum + Number(contact.fee_charged || 0), 0),
    },
  });
});

export const networkSummaryController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);

  const match = {};
  if (req.query.from || req.query.to) {
    match.createdAt = {};
    if (req.query.from) match.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) match.createdAt.$lte = new Date(req.query.to);
  }
  if (req.query.city) match.service_location_id = objectId(req.query.city, 'city');

  const [categoryCounts, publishedStats, leadRevenue, frozenTotal, tiers] = await Promise.all([
    Driver.aggregate([
      { $match: { deletedAt: null } },
      { $group: { _id: '$driver_category', count: { $sum: 1 } } },
    ]),
    Ride.aggregate([
      { $match: { ...match, origin: 'driver_created' } },
      {
        $group: {
          _id: '$publish.status',
          count: { $sum: 1 },
          value: { $sum: '$publish.total_fare' },
        },
      },
    ]),
    LeadContact.aggregate([
      { $match: match.createdAt ? { createdAt: match.createdAt } : {} },
      { $group: { _id: null, total: { $sum: '$fee_charged' }, count: { $sum: 1 } } },
    ]),
    Driver.aggregate([
      { $group: { _id: null, frozen: { $sum: '$wallet.frozenBalance' } } },
    ]),
    SubscriptionTier.find({ driver_category: { $exists: true } }).select('name driver_category price_monthly').lean(),
  ]);

  const completedNetworkRides = await Ride.countDocuments({
    ...match,
    origin: 'driver_created',
    status: RIDE_STATUS.COMPLETED,
  });

  res.json({
    success: true,
    data: {
      drivers_by_category: categoryCounts.reduce(
        (acc, row) => ({ ...acc, [row._id || 'lower']: row.count }),
        { prime: 0, middle: 0, lower: 0 },
      ),
      published: publishedStats.reduce(
        (acc, row) => ({ ...acc, [row._id || 'none']: { count: row.count, value: row.value } }),
        {},
      ),
      completed_network_rides: completedNetworkRides,
      lead_contact_revenue: leadRevenue[0]?.total || 0,
      lead_contact_count: leadRevenue[0]?.count || 0,
      total_frozen_in_escrow: frozenTotal[0]?.frozen || 0,
      tiers,
    },
  });
});

export const updateVehicleUsageTypeController = asyncHandler(async (req, res) => {
  assertNetworkAdmin(req);

  const usageType = String(req.body?.usage_type || '').trim().toLowerCase();
  if (!['commercial', 'private'].includes(usageType)) {
    throw new ApiError(422, "usage_type must be 'commercial' or 'private'", null, 'INVALID_USAGE_TYPE');
  }

  const vehicle = await FleetVehicle.findById(objectId(req.params.vehicleId, 'vehicleId'));
  if (!vehicle) throw new ApiError(404, 'Vehicle not found', null, 'VEHICLE_NOT_FOUND');

  vehicle.usage_type = usageType;
  vehicle.usage_type_verified = req.body?.verified !== false;
  await vehicle.save();

  // Verifying a commercial permit can be exactly what a driver was waiting on
  // to keep their category, so re-run the rule for everyone in that fleet.
  const { recheckCategoryVehicleRule } = await import('../../services/driverCategoryService.js');
  const fleetDrivers = await Driver.find({ owner_id: vehicle.owner_id, deletedAt: null })
    .select('_id')
    .lean();
  for (const driver of fleetDrivers) {
    await recheckCategoryVehicleRule(driver._id).catch(() => {});
  }

  res.json({
    success: true,
    data: {
      id: String(vehicle._id),
      usage_type: vehicle.usage_type,
      usage_type_verified: vehicle.usage_type_verified,
    },
  });
});
