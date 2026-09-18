import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { normalizePoint } from '../../../../utils/geo.js';
import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../../constants/index.js';
import { Owner } from '../../admin/models/Owner.js';
import { ServiceLocation } from '../../admin/models/ServiceLocation.js';
import { Ride } from '../../user/models/Ride.js';
import { User } from '../../user/models/User.js';
import { Driver } from '../models/Driver.js';
import {
  createRideRecord,
  findDriverConflictingScheduledRide,
  isRideScheduledForFuture,
} from '../../services/rideService.js';
import {
  notifyAssignmentRejected,
  notifyAssignmentRemoved,
  notifyNetworkAssignment,
  notifyNetworkRideCancelled,
} from '../../services/networkNotificationService.js';
import { getDriverPermissions } from '../../services/driverCategoryService.js';

const ASSIGNABLE_STATUSES = new Set([RIDE_STATUS.SEARCHING]);

const toObjectId = (value, field) => {
  if (!value || !mongoose.isValidObjectId(value)) {
    throw new ApiError(400, `${field} is invalid`, null, 'INVALID_ID');
  }
  return new mongoose.Types.ObjectId(String(value));
};

/**
 * Every Prime driver operates under an organisation, because that is the name
 * the customer sees ("Ram Travels"). Reuses the `Owner` record they already
 * have — from the self-drive owner flow, say — rather than creating a second
 * identity for the same person.
 */
export const ensureOrganizationForPrime = async (driverOrId, { companyName = '' } = {}) => {
  const driver =
    typeof driverOrId === 'object' && driverOrId?.save
      ? driverOrId
      : await Driver.findById(driverOrId);

  if (!driver) throw new ApiError(404, 'Driver not found', null, 'DRIVER_NOT_FOUND');
  if (driver.owner_id) {
    const existing = await Owner.findById(driver.owner_id);
    if (existing) return existing;
  }

  // An owner account may already exist for this phone (created through the
  // owner portal); adopting it avoids a duplicate-key failure on `mobile`.
  const adopted = await Owner.findOne({ mobile: driver.phone });
  if (adopted) {
    driver.owner_id = adopted._id;
    driver.is_self_drive_owner = true;
    await driver.save();
    return adopted;
  }

  const serviceLocationId =
    driver.service_location_id || (await ServiceLocation.findOne({ active: true }).select('_id').lean())?._id || null;

  const owner = await Owner.create({
    company_name: String(companyName || '').trim() || `${driver.name} Travels`,
    owner_name: driver.name,
    name: driver.name,
    mobile: driver.phone,
    email: `driver-${driver._id}@gokab.local`,
    service_location_id: serviceLocationId,
    transport_type: 'taxi',
    approve: true,
    active: true,
  });

  driver.owner_id = owner._id;
  driver.is_self_drive_owner = true;
  await driver.save();

  return owner;
};

export const updateOrganization = async ({ driverId, companyName }) => {
  const owner = await ensureOrganizationForPrime(driverId, { companyName });

  if (companyName !== undefined) {
    const name = String(companyName || '').trim();
    if (!name) throw new ApiError(422, 'Organisation name cannot be empty', null, 'INVALID_ORG_NAME');
    owner.company_name = name;
  }

  await owner.save();

  return {
    id: String(owner._id),
    company_name: owner.company_name,
    owner_name: owner.owner_name || owner.name,
  };
};

export const serializeNetworkRide = (ride, { assignedDriver = null } = {}) => ({
  id: String(ride._id),
  status: ride.status,
  liveStatus: ride.liveStatus,
  origin: ride.origin,
  customer: {
    name: ride.offline_customer?.name || '',
    phone: ride.offline_customer?.phone || '',
    is_app_user: Boolean(ride.userId),
    user_id: ride.userId ? String(ride.userId) : null,
  },
  pickup: {
    address: ride.pickupAddress || '',
    coordinates: ride.pickupLocation?.coordinates || [],
  },
  drop: {
    address: ride.dropAddress || '',
    coordinates: ride.dropLocation?.coordinates || [],
  },
  fare: ride.fare,
  paymentMethod: ride.paymentMethod,
  scheduledAt: ride.scheduledAt,
  serviceType: ride.serviceType,
  notes: ride.network_notes || '',
  // Never expose the pickup OTP on a list endpoint — it is the customer's proof
  // that the right driver turned up.
  otp_masked: ride.otp ? '****' : '',
  assignment: {
    mode: ride.assignment?.mode || 'dispatch',
    assigned_at: ride.assignment?.assigned_at || null,
    driver: assignedDriver
      ? {
          id: String(assignedDriver._id),
          name: assignedDriver.name,
          phone: assignedDriver.phone,
          vehicleNumber: assignedDriver.vehicleNumber || '',
          isOnline: Boolean(assignedDriver.isOnline),
          isOnRide: Boolean(assignedDriver.isOnRide),
        }
      : null,
  },
  publish: {
    status: ride.publish?.status || 'none',
    total_fare: ride.publish?.total_fare || 0,
    owner_commission: ride.publish?.owner_commission || 0,
    driver_payout: ride.publish?.driver_payout || 0,
    expires_at: ride.publish?.expires_at || null,
    taken_by_driver_id: ride.publish?.taken_by_driver_id
      ? String(ride.publish.taken_by_driver_id)
      : null,
  },
  escrow: {
    state: ride.escrow?.state || 'none',
    publisher_hold: ride.escrow?.publisher_hold || 0,
    acceptor_hold: ride.escrow?.acceptor_hold || 0,
    collected_by: ride.escrow?.collected_by || null,
  },
  createdAt: ride.createdAt,
});

/**
 * Books a ride on behalf of a customer who called the driver directly.
 *
 * Dispatch is deliberately *not* started: the whole point is that the creating
 * driver decides who runs it — themselves, one of their own drivers, or the
 * wider network via publish.
 */
export const createDriverRide = async ({ driverId, payload }) => {
  const permissions = await getDriverPermissions(driverId);
  const driver = permissions.driver;

  const customerName = String(payload?.customer?.name || '').trim();
  const customerPhone = String(payload?.customer?.phone || '').trim();
  if (!customerName) {
    throw new ApiError(422, 'Customer name is required', null, 'CUSTOMER_REQUIRED');
  }
  if (!/^\d{10}$/.test(customerPhone)) {
    throw new ApiError(422, 'A valid 10-digit customer phone is required', null, 'CUSTOMER_REQUIRED');
  }

  const pickupCoords = normalizePoint(payload?.pickup?.coordinates, 'pickup.coordinates');
  const dropCoords = normalizePoint(payload?.drop?.coordinates, 'drop.coordinates');

  const fare = Number(payload?.fare);
  if (!Number.isFinite(fare) || fare <= 0) {
    throw new ApiError(422, 'fare must be greater than zero', null, 'INVALID_FARE');
  }

  // If the customer happens to have an app account, link the ride to it so they
  // get in-app tracking instead of an SMS.
  const appUser = await User.findOne({ phone: customerPhone }).select('_id').lean();

  const organization = permissions.can_manage_fleet
    ? await ensureOrganizationForPrime(driver)
    : driver.owner_id
      ? await Owner.findById(driver.owner_id)
      : null;

  const ride = await createRideRecord({
    userId: appUser?._id || null,
    origin: 'driver_created',
    offlineCustomer: appUser ? null : { name: customerName, phone: customerPhone },
    createdByDriverId: driver._id,
    organizationOwnerId: organization?._id || null,
    networkNotes: payload?.notes || '',
    pickupCoords,
    dropCoords,
    pickupAddress: payload?.pickup?.address || '',
    dropAddress: payload?.drop?.address || '',
    fare,
    estimatedDistanceMeters: payload?.estimatedDistanceMeters,
    estimatedDurationMinutes: payload?.estimatedDurationMinutes,
    vehicleTypeId: payload?.vehicleTypeId || driver.vehicleTypeId,
    paymentMethod: payload?.paymentMethod || 'cash',
    serviceType: payload?.serviceType || 'ride',
    service_location_id: driver.service_location_id,
    scheduledAt: payload?.scheduledAt,
  });

  // A walk-in customer's name is not part of `createRideRecord`'s rider model,
  // so store it after creation rather than threading it through the promo path.
  if (appUser) {
    await Ride.updateOne(
      { _id: ride._id },
      { $set: { 'offline_customer.name': customerName, 'offline_customer.phone': customerPhone } },
    );
    ride.offline_customer = { name: customerName, phone: customerPhone };
  }

  return serializeNetworkRide(ride);
};

const loadOwnedRide = async (rideId, driverId, { session = null } = {}) => {
  const ride = await Ride.findById(toObjectId(rideId, 'rideId')).session(session);
  if (!ride) throw new ApiError(404, 'Ride not found', null, 'RIDE_NOT_FOUND');

  if (String(ride.created_by_driver_id || '') !== String(driverId)) {
    throw new ApiError(403, 'This ride belongs to another driver', null, 'NOT_RIDE_OWNER');
  }

  return ride;
};

/**
 * Hands a ride to one of the organisation's own drivers (or to the creator
 * themselves). No escrow is involved — the fare belongs to the organisation
 * either way, so there is nothing to hold between two parties.
 */
export const assignRide = async ({ driverId, rideId, targetDriverId }) => {
  const permissions = await getDriverPermissions(driverId);
  const ride = await loadOwnedRide(rideId, driverId);

  if (!ASSIGNABLE_STATUSES.has(ride.status) || ride.driverId) {
    throw new ApiError(409, 'This ride already has a driver', null, 'RIDE_NOT_OPEN');
  }
  if (!['none', 'cancelled', 'expired'].includes(ride.publish?.status || 'none')) {
    throw new ApiError(409, 'Unpublish this ride before assigning it', null, 'RIDE_NOT_OPEN');
  }

  const isSelfAssign = String(targetDriverId) === String(driverId);
  if (!isSelfAssign && !permissions.can_manage_fleet) {
    throw new ApiError(
      403,
      'Your plan only allows taking the ride yourself or publishing it',
      { category: permissions.category },
      'CATEGORY_NOT_ALLOWED',
    );
  }

  const target = await Driver.findOne({
    _id: toObjectId(targetDriverId, 'driverId'),
    deletedAt: null,
    approve: true,
  });
  if (!target) throw new ApiError(404, 'Driver not found', null, 'DRIVER_NOT_FOUND');

  if (
    !isSelfAssign &&
    String(target.owner_id || '') !== String(permissions.driver.owner_id || 'none')
  ) {
    throw new ApiError(403, 'That driver is not in your fleet', null, 'DRIVER_NOT_IN_FLEET');
  }

  const scheduledForLater = isRideScheduledForFuture(ride);
  if (!scheduledForLater && target.isOnRide) {
    throw new ApiError(409, 'That driver is already on a ride', null, 'DRIVER_BUSY');
  }

  const conflict = await findDriverConflictingScheduledRide({
    driverId: target._id,
    ride,
    excludeRideId: ride._id,
  });
  if (conflict) {
    throw new ApiError(
      409,
      'That driver already has another trip in this time range',
      { conflictingRideId: String(conflict._id) },
      'DRIVER_BUSY',
    );
  }

  // Guarded update rather than save(): two tabs assigning at once must not both
  // win, and `driverId: null` in the filter is what makes the second one fail.
  const assignedAt = new Date();
  const updated = await Ride.findOneAndUpdate(
    { _id: ride._id, driverId: null, status: RIDE_STATUS.SEARCHING },
    {
      $set: {
        driverId: target._id,
        status: RIDE_STATUS.ACCEPTED,
        liveStatus: RIDE_LIVE_STATUS.ACCEPTED,
        acceptedAt: assignedAt,
        'assignment.mode': 'direct_assign',
        'assignment.assigned_by_driver_id': driverId,
        'assignment.assigned_at': assignedAt,
      },
      $push: {
        'assignment.history': {
          driver_id: target._id,
          action: 'assigned',
          by_driver_id: driverId,
          at: assignedAt,
        },
      },
    },
    { new: true },
  );

  if (!updated) {
    throw new ApiError(409, 'This ride already has a driver', null, 'RIDE_NOT_OPEN');
  }

  if (!scheduledForLater) {
    await Driver.updateOne({ _id: target._id }, { $set: { isOnRide: true } });
  }

  await notifyNetworkAssignment(updated);

  return serializeNetworkRide(updated, { assignedDriver: target });
};

export const unassignRide = async ({ driverId, rideId, reason = '' }) => {
  const ride = await loadOwnedRide(rideId, driverId);

  if (!ride.driverId) {
    throw new ApiError(409, 'This ride has no driver to remove', null, 'RIDE_NOT_OPEN');
  }
  // Once the OTP is in and the trip is running, pulling the driver would strand
  // the customer mid-journey.
  if ([RIDE_LIVE_STATUS.STARTED, RIDE_LIVE_STATUS.COMPLETED].includes(ride.liveStatus)) {
    throw new ApiError(409, 'The trip has already started', null, 'RIDE_ALREADY_STARTED');
  }
  if (ride.escrow?.state === 'held') {
    throw new ApiError(
      409,
      'Money is held in escrow for this ride — cancel it instead',
      null,
      'ESCROW_STATE_INVALID',
    );
  }

  const removedDriverId = ride.driverId;
  const now = new Date();

  const updated = await Ride.findOneAndUpdate(
    { _id: ride._id, driverId: removedDriverId },
    {
      $set: {
        driverId: null,
        status: RIDE_STATUS.SEARCHING,
        liveStatus: RIDE_LIVE_STATUS.SEARCHING,
        acceptedAt: null,
        'assignment.mode': 'dispatch',
        'assignment.assigned_by_driver_id': null,
        'assignment.assigned_at': null,
      },
      $push: {
        'assignment.history': {
          driver_id: removedDriverId,
          action: 'unassigned',
          by_driver_id: driverId,
          at: now,
          reason: String(reason || '').trim(),
        },
      },
    },
    { new: true },
  );

  if (!updated) {
    throw new ApiError(409, 'This ride changed while you were removing the driver', null, 'RIDE_NOT_OPEN');
  }

  await releaseDriverIfIdle(removedDriverId);
  await notifyAssignmentRemoved({ ride: updated, removedDriverId, reason });

  return serializeNetworkRide(updated);
};

/**
 * A driver is only "free" once they have no other live ride — clearing the flag
 * unconditionally would mark a driver available while they are mid-trip on a
 * different booking.
 */
const releaseDriverIfIdle = async (driverId) => {
  const stillBusy = await Ride.exists({
    driverId,
    status: { $in: [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] },
    scheduledAt: null,
  });

  if (!stillBusy) {
    await Driver.updateOne({ _id: driverId }, { $set: { isOnRide: false } });
  }
};

export const reassignRide = async ({ driverId, rideId, targetDriverId, reason = '' }) => {
  await unassignRide({ driverId, rideId, reason: reason || 'Reassigned' });
  return assignRide({ driverId, rideId, targetDriverId });
};

/** The assigned fleet driver declines the job. */
export const rejectAssignment = async ({ driverId, rideId, reason = '' }) => {
  const ride = await Ride.findById(toObjectId(rideId, 'rideId'));
  if (!ride) throw new ApiError(404, 'Ride not found', null, 'RIDE_NOT_FOUND');

  if (String(ride.driverId || '') !== String(driverId)) {
    throw new ApiError(403, 'This ride is not assigned to you', null, 'NOT_RIDE_DRIVER');
  }
  if ([RIDE_LIVE_STATUS.STARTED, RIDE_LIVE_STATUS.COMPLETED].includes(ride.liveStatus)) {
    throw new ApiError(409, 'The trip has already started', null, 'RIDE_ALREADY_STARTED');
  }

  const now = new Date();
  const updated = await Ride.findOneAndUpdate(
    { _id: ride._id, driverId },
    {
      $set: {
        driverId: null,
        status: RIDE_STATUS.SEARCHING,
        liveStatus: RIDE_LIVE_STATUS.SEARCHING,
        acceptedAt: null,
        'assignment.mode': 'dispatch',
      },
      $push: {
        'assignment.history': {
          driver_id: driverId,
          action: 'unassigned',
          by_driver_id: driverId,
          at: now,
          reason: String(reason || '').trim(),
        },
      },
    },
    { new: true },
  );

  if (!updated) {
    throw new ApiError(409, 'This ride changed while you were declining it', null, 'RIDE_NOT_OPEN');
  }

  await releaseDriverIfIdle(driverId);
  await notifyAssignmentRejected({ ride: updated, driverId, reason });

  return serializeNetworkRide(updated);
};

export const cancelDriverRide = async ({ driverId, rideId, reason = '' }) => {
  const ride = await loadOwnedRide(rideId, driverId);

  if (ride.status === RIDE_STATUS.COMPLETED) {
    throw new ApiError(409, 'Completed rides cannot be cancelled', null, 'RIDE_ALREADY_COMPLETED');
  }
  if (ride.status === RIDE_STATUS.CANCELLED) {
    return serializeNetworkRide(ride);
  }

  const previousDriverId = ride.driverId;

  // Whatever is frozen for a published ride has to go back before the ride is
  // closed, otherwise both parties keep money locked against a dead booking.
  if (ride.escrow?.state === 'held') {
    const { releasePublishedRide } = await import('./escrowService.js');
    await releasePublishedRide({ rideId: ride._id, reason: 'ride_cancelled' });
  }

  const updated = await Ride.findOneAndUpdate(
    { _id: ride._id, status: { $ne: RIDE_STATUS.COMPLETED } },
    {
      $set: {
        status: RIDE_STATUS.CANCELLED,
        liveStatus: RIDE_LIVE_STATUS.CANCELLED,
        driverId: null,
        'publish.status': ride.publish?.is_published ? 'cancelled' : 'none',
        'publish.is_published': false,
        network_notes: String(reason || ride.network_notes || '').trim(),
      },
    },
    { new: true },
  );

  if (previousDriverId) await releaseDriverIfIdle(previousDriverId);
  await notifyNetworkRideCancelled({ ride: updated, reason });

  return serializeNetworkRide(updated);
};

export const listNetworkRides = async ({ driverId, scope = 'created', status = 'all', page = 1, limit = 20 }) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));

  const base =
    scope === 'assigned_to_me'
      ? { driverId, origin: 'driver_created' }
      : { created_by_driver_id: driverId };

  const statusFilters = {
    unassigned: { status: RIDE_STATUS.SEARCHING, driverId: null, 'publish.status': { $ne: 'open' } },
    assigned: { status: RIDE_STATUS.ACCEPTED, driverId: { $ne: null } },
    published: { 'publish.status': 'open' },
    ongoing: { status: RIDE_STATUS.ONGOING },
    completed: { status: RIDE_STATUS.COMPLETED },
    cancelled: { status: RIDE_STATUS.CANCELLED },
  };

  const filter = { ...base, ...(statusFilters[status] || {}) };

  const [rides, total] = await Promise.all([
    Ride.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    Ride.countDocuments(filter),
  ]);

  const driverIds = rides.map((ride) => ride.driverId).filter(Boolean);
  const drivers = driverIds.length
    ? await Driver.find({ _id: { $in: driverIds } })
        .select('name phone vehicleNumber isOnline isOnRide')
        .lean()
    : [];
  const driverMap = new Map(drivers.map((driver) => [String(driver._id), driver]));

  return {
    results: rides.map((ride) =>
      serializeNetworkRide(ride, { assignedDriver: driverMap.get(String(ride.driverId)) || null }),
    ),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

/** Who in the organisation could take a ride right now. */
export const getFleetAvailability = async (driverId) => {
  const permissions = await getDriverPermissions(driverId);
  const ownerId = permissions.driver.owner_id;

  if (!ownerId) return { results: [] };

  const drivers = await Driver.find({ owner_id: ownerId, deletedAt: null, approve: true })
    .select('name phone vehicleNumber vehicleType isOnline isOnRide location assignedFleetVehicleId')
    .lean();

  const upcoming = await Ride.aggregate([
    {
      $match: {
        driverId: { $in: drivers.map((driver) => driver._id) },
        status: { $in: [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] },
      },
    },
    { $group: { _id: '$driverId', count: { $sum: 1 } } },
  ]);
  const upcomingMap = new Map(upcoming.map((row) => [String(row._id), row.count]));

  return {
    results: drivers.map((driver) => ({
      driverId: String(driver._id),
      name: driver.name,
      phone: driver.phone,
      isOnline: Boolean(driver.isOnline),
      isOnRide: Boolean(driver.isOnRide),
      vehicle: { number: driver.vehicleNumber || '', type: driver.vehicleType || '' },
      location: driver.location?.coordinates || [],
      activeRides: upcomingMap.get(String(driver._id)) || 0,
    })),
  };
};
