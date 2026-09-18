import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { haversineMeters } from '../../../../utils/geo.js';
import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../../constants/index.js';
import { Owner } from '../../admin/models/Owner.js';
import { Vehicle } from '../../admin/models/Vehicle.js';
import { Ride } from '../../user/models/Ride.js';
import { Driver } from '../models/Driver.js';
import { DriverRoute } from '../models/DriverRoute.js';
import { LeadContact } from '../models/LeadContact.js';
import { getDriverNetworkSettings } from '../../services/appSettingsService.js';
import { getDriverPermissions } from '../../services/driverCategoryService.js';
import { matchRideToRoute } from '../../services/routeMatchService.js';
import {
  emitToRoom,
  getFeedRoom,
  getPublisherRoom,
  stopDispatchFlow,
  notifyRideAccepted,
} from '../../services/dispatchService.js';
import { acceptRideAssignment, isRideScheduledForFuture } from '../../services/rideService.js';
import { holdForPublishedRide } from './escrowService.js';
import { notifyNetworkAssignment } from '../../services/networkNotificationService.js';
import { applyDriverWalletAdjustment, getWalletSnapshot } from './walletService.js';

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

// Customer leads go stale fast: a rider who booked 30 minutes ago has almost
// certainly been matched or given up.
const CUSTOMER_LEAD_MAX_AGE_MS = 30 * 60 * 1000;

// The first comma-separated part of an address is the locality, which is what a
// driver actually scans for when skimming a feed.
const areaOf = (address = '') => String(address || '').split(',')[0].trim();

const maskName = (name = '') => {
  const trimmed = String(name || '').trim();
  if (trimmed.length <= 2) return trimmed ? `${trimmed[0]}***` : '';
  return `${trimmed[0]}***${trimmed[trimmed.length - 1]}`;
};

/**
 * Publishes a ride the creating driver cannot cover themselves.
 *
 * The split is fixed at publish time so everyone sees the same numbers: the
 * acceptor knows exactly what they earn, and the publisher knows exactly what
 * their cut is. No money is frozen yet — that happens when someone accepts.
 */
export const publishRide = async ({ driverId, rideId, totalFare, ownerCommission, driverPayout, expiresInMinutes }) => {
  const permissions = await getDriverPermissions(driverId);
  const settings = await getDriverNetworkSettings();

  const ride = await Ride.findById(rideId);
  if (!ride) throw new ApiError(404, 'Ride not found', null, 'RIDE_NOT_FOUND');
  if (String(ride.created_by_driver_id || '') !== String(driverId)) {
    throw new ApiError(403, 'This ride belongs to another driver', null, 'NOT_RIDE_OWNER');
  }
  if (ride.status !== RIDE_STATUS.SEARCHING || ride.driverId) {
    throw new ApiError(409, 'Only an unassigned ride can be published', null, 'RIDE_NOT_OPEN');
  }
  if (ride.publish?.status === 'open') {
    throw new ApiError(409, 'This ride is already published', null, 'RIDE_NOT_OPEN');
  }

  const total = round2(totalFare ?? ride.fare);
  const commission = round2(ownerCommission);
  const payout = round2(driverPayout);

  if (commission < 0 || payout <= 0) {
    throw new ApiError(422, 'Driver payout must be greater than zero', null, 'INVALID_SPLIT');
  }
  if (round2(commission + payout) !== total) {
    throw new ApiError(
      422,
      'Commission plus driver payout must equal the total fare',
      { total, commission, payout },
      'INVALID_SPLIT',
    );
  }

  // Fail fast if the publisher plainly cannot back the payout. The binding
  // check is the atomic freeze at accept time; this one just avoids advertising
  // a ride that would collapse the moment someone takes it.
  const wallet = await getWalletSnapshot(permissions.driver);
  if (wallet.available < payout) {
    throw new ApiError(
      402,
      `You need ₹${payout} available to publish this ride (you have ₹${wallet.available})`,
      { required: payout, available: wallet.available },
      'INSUFFICIENT_WALLET_FOR_PUBLISH',
    );
  }

  // A ride starting in ten minutes is not something the network can usefully
  // pick up; the admin sets how much notice a published lead must carry.
  const minLeadMinutes = Math.max(0, Number(settings.publish_min_lead_minutes ?? 0));
  if (minLeadMinutes > 0 && ride.scheduledAt) {
    const leadMinutes = (new Date(ride.scheduledAt).getTime() - Date.now()) / 60000;
    if (leadMinutes < minLeadMinutes) {
      throw new ApiError(
        422,
        `Rides must be published at least ${minLeadMinutes} minutes before pickup`,
        { required_minutes: minLeadMinutes, actual_minutes: Math.round(leadMinutes) },
        'PUBLISH_TOO_LATE',
      );
    }
  }

  const minutes = Math.max(1, Number(expiresInMinutes ?? settings.publish_expiry_minutes ?? 60));
  let expiresAt = new Date(Date.now() + minutes * 60 * 1000);
  // A lead must not outlive the trip it is advertising.
  if (ride.scheduledAt && ride.scheduledAt < expiresAt) expiresAt = ride.scheduledAt;

  const now = new Date();
  const updated = await Ride.findOneAndUpdate(
    { _id: ride._id, driverId: null, status: RIDE_STATUS.SEARCHING },
    {
      $set: {
        fare: total,
        'assignment.mode': 'published',
        'publish.is_published': true,
        'publish.published_at': now,
        'publish.expires_at': expiresAt,
        'publish.total_fare': total,
        'publish.owner_commission': commission,
        'publish.driver_payout': payout,
        'publish.status': 'open',
        'publish.taken_by_driver_id': null,
        'publish.taken_at': null,
      },
    },
    { new: true },
  );

  if (!updated) {
    throw new ApiError(409, 'This ride is no longer available to publish', null, 'RIDE_NOT_OPEN');
  }

  await broadcastNewDriverLead(updated);

  return serializeFeedItem(updated, { lead_type: 'driver' });
};

export const unpublishRide = async ({ driverId, rideId }) => {
  const ride = await Ride.findById(rideId);
  if (!ride) throw new ApiError(404, 'Ride not found', null, 'RIDE_NOT_FOUND');
  if (String(ride.created_by_driver_id || '') !== String(driverId)) {
    throw new ApiError(403, 'This ride belongs to another driver', null, 'NOT_RIDE_OWNER');
  }

  const updated = await Ride.findOneAndUpdate(
    { _id: ride._id, 'publish.status': 'open' },
    { $set: { 'publish.status': 'cancelled', 'publish.is_published': false, 'assignment.mode': 'dispatch' } },
    { new: true },
  );

  if (!updated) {
    throw new ApiError(409, 'This ride is not currently published', null, 'RIDE_NOT_OPEN');
  }

  emitToRoom(getFeedRoom(updated.service_location_id), 'feed:driver:removed', {
    rideId: String(updated._id),
    reason: 'UNPUBLISHED',
  });
  await closeLeadConversationsForRide(updated._id, 'UNPUBLISHED');

  return { unpublished: true };
};

// A city can hold thousands of drivers; a publish must not turn into an
// unbounded push fan-out.
const MAX_LEAD_PUSHES = 200;

const broadcastNewDriverLead = async (ride) => {
  emitToRoom(getFeedRoom(ride.service_location_id), 'feed:driver:new', {
    rideId: String(ride._id),
    pickup: ride.pickupAddress || '',
    drop: ride.dropAddress || '',
    amount_for_you: ride.publish?.driver_payout || 0,
    expires_at: ride.publish?.expires_at || null,
  });

  // Drivers running a matching corridor get an actual notification, not just a
  // feed row — they are the ones most likely to take the trip, and they may be
  // nowhere near the pickup.
  try {
    const { findDriversWhoseActiveRouteMatches } = await import('../../services/routeMatchService.js');
    const matched = await findDriversWhoseActiveRouteMatches({
      pickup: ride.pickupLocation?.coordinates,
      drop: ride.dropLocation?.coordinates,
      serviceLocationId: ride.service_location_id,
      limit: MAX_LEAD_PUSHES,
    });

    const driverIds = matched
      .map((driver) => String(driver._id))
      .filter((id) => id !== String(ride.created_by_driver_id))
      .slice(0, MAX_LEAD_PUSHES);

    if (!driverIds.length) return;

    const { sendPushNotificationToEntities } = await import('../../services/pushNotificationService.js');
    await sendPushNotificationToEntities({
      driverIds,
      title: `New ride on your route · ₹${ride.publish?.driver_payout || 0}`,
      body: `${ride.pickupAddress || 'Pickup'} → ${ride.dropAddress || 'Drop'}`,
      data: { type: 'feed_driver_lead', rideId: String(ride._id) },
    });
  } catch (error) {
    // A push failure must never stop the ride from being published.
    console.error('[feedService] route-matched lead push failed:', error.message);
  }
};

export const closeLeadConversationsForRide = async (rideId, reason = 'RIDE_TAKEN') => {
  const { LeadConversation } = await import('../models/LeadConversation.js');
  const conversations = await LeadConversation.find({ ride_id: rideId, closed: false }).select('_id').lean();
  if (!conversations.length) return;

  await LeadConversation.updateMany({ ride_id: rideId, closed: false }, { $set: { closed: true } });
  for (const conversation of conversations) {
    emitToRoom(`lead_${conversation._id}`, 'lead:closed', {
      conversationId: String(conversation._id),
      reason,
    });
  }
};

export const serializeFeedItem = (ride, { lead_type, publisher = null, distanceFromMeKm = null, routeMatch = null, contact = null, accept = null, vehicle = null, vehicle_mismatch = false } = {}) => ({
  id: String(ride._id),
  lead_type,
  pickup: {
    address: ride.pickupAddress || '',
    area: areaOf(ride.pickupAddress),
    coordinates: ride.pickupLocation?.coordinates || [],
  },
  drop: {
    address: ride.dropAddress || '',
    area: areaOf(ride.dropAddress),
    coordinates: ride.dropLocation?.coordinates || [],
  },
  scheduledAt: ride.scheduledAt,
  serviceType: ride.serviceType,
  distance_km: ride.estimatedDistanceMeters
    ? Math.round((ride.estimatedDistanceMeters / 1000) * 10) / 10
    : null,
  vehicle_type: vehicle ? { id: String(vehicle._id), name: vehicle.name } : null,
  total_fare: lead_type === 'driver' ? ride.publish?.total_fare || ride.fare : ride.fare,
  amount_for_you:
    lead_type === 'driver' ? ride.publish?.driver_payout || 0 : ride.estimatedEarnings ?? null,
  publisher,
  // Deliberately masked: the customer's identity is what the contact fee buys.
  customer: { name_masked: maskName(ride.offline_customer?.name) },
  distance_from_me_km: distanceFromMeKm,
  route_match: routeMatch,
  contact,
  accept,
  vehicle_mismatch,
  expires_at: ride.publish?.expires_at || null,
  createdAt: ride.createdAt,
});

/**
 * The driver home feed.
 *
 * `driver` tab = rides published by other Prime/Middle drivers.
 * `customer` tab = app bookings still looking for a driver.
 * Both are visible to every category; what differs is the contact/accept fee.
 */
export const getFeed = async ({ driverId, tab = 'driver', page = 1, limit = 20, lat, lng }) => {
  const permissions = await getDriverPermissions(driverId);
  const driver = permissions.driver;
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const now = new Date();

  const baseFilter =
    tab === 'customer'
      ? {
          origin: 'customer_app',
          status: RIDE_STATUS.SEARCHING,
          driverId: null,
          bookingMode: 'normal',
          $or: [
            { createdAt: { $gt: new Date(now.getTime() - CUSTOMER_LEAD_MAX_AGE_MS) } },
            { scheduledAt: { $gt: now } },
          ],
        }
      : {
          origin: 'driver_created',
          'publish.status': 'open',
          'publish.expires_at': { $gt: now },
          created_by_driver_id: { $ne: new mongoose.Types.ObjectId(String(driverId)) },
        };

  if (driver.service_location_id) {
    baseFilter.service_location_id = driver.service_location_id;
  }

  // Over-fetch, because the corridor filter below runs in JS and can reject a
  // large share of a page.
  const candidates = await Ride.find(baseFilter)
    .sort({ createdAt: -1 })
    .limit(safeLimit * safePage * 3)
    .lean();

  const activeRoute =
    driver.route_mode === 'route' && driver.active_route_id
      ? await DriverRoute.findOne({ _id: driver.active_route_id, deletedAt: null }).lean()
      : null;

  const myCoordinates =
    Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
      ? [Number(lng), Number(lat)]
      : driver.location?.coordinates?.length === 2
        ? driver.location.coordinates
        : null;

  const filtered = [];
  for (const ride of candidates) {
    const pickup = ride.pickupLocation?.coordinates;
    const drop = ride.dropLocation?.coordinates;

    let routeMatch = null;
    if (activeRoute) {
      const result = matchRideToRoute({ route: activeRoute, pickup, drop });
      if (!result.match) continue;
      routeMatch = { route_id: String(activeRoute._id), route_name: activeRoute.name };
    }

    filtered.push({
      ride,
      routeMatch,
      distanceFromMeKm:
        myCoordinates && pickup
          ? Math.round((haversineMeters(myCoordinates, pickup) / 1000) * 10) / 10
          : null,
    });
  }

  filtered.sort((a, b) => {
    if (a.distanceFromMeKm === null || b.distanceFromMeKm === null) return 0;
    return a.distanceFromMeKm - b.distanceFromMeKm;
  });

  const paged = filtered.slice((safePage - 1) * safeLimit, safePage * safeLimit);

  const publisherIds = paged.map((item) => item.ride.created_by_driver_id).filter(Boolean);
  const [publishers, owners, vehicles, contacts, wallet] = await Promise.all([
    publisherIds.length
      ? Driver.find({ _id: { $in: publisherIds } }).select('name rating owner_id driver_category').lean()
      : [],
    Owner.find({ _id: { $in: paged.map((item) => item.ride.organization_owner_id).filter(Boolean) } })
      .select('company_name owner_name name')
      .lean(),
    Vehicle.find({ _id: { $in: paged.map((item) => item.ride.vehicleTypeId).filter(Boolean) } })
      .select('name')
      .lean(),
    LeadContact.find({ ride_id: { $in: paged.map((item) => item.ride._id) }, requester_driver_id: driverId })
      .select('ride_id')
      .lean(),
    getWalletSnapshot(driver),
  ]);

  const publisherMap = new Map(publishers.map((item) => [String(item._id), item]));
  const ownerMap = new Map(owners.map((item) => [String(item._id), item]));
  const vehicleMap = new Map(vehicles.map((item) => [String(item._id), item]));
  const contactedRideIds = new Set(contacts.map((item) => String(item.ride_id)));

  const contactFee =
    tab === 'customer' ? permissions.customer_lead_contact_fee : permissions.driver_lead_contact_fee;
  const acceptFee = tab === 'customer' ? permissions.customer_ride_accept_fee : 0;

  // A customer lead's value to the driver is their post-commission share, which
  // only exists once a driver is attached — so it has to be previewed here
  // rather than read off the ride.
  if (tab === 'customer') {
    const { previewRideCommission } = await import('./walletService.js');
    await Promise.all(
      paged.map(async (item) => {
        const preview = await previewRideCommission({ ...item.ride, driverId });
        item.ride.estimatedEarnings = preview?.driverEarnings ?? null;
      }),
    );
  }

  // Spec leaves this configurable; showing the lead with a flag is the less
  // destructive default — a driver who owns more than one vehicle, or whose
  // catalogue entry is simply mismatched, still sees the work.
  const myVehicleTypeId = String(driver.vehicleTypeId || '');

  const results = paged.map(({ ride, routeMatch, distanceFromMeKm }) => {
    const publisherDriver = publisherMap.get(String(ride.created_by_driver_id));
    const organization = ownerMap.get(String(ride.organization_owner_id));
    const alreadyContacted = contactedRideIds.has(String(ride._id));
    const holdRequired = tab === 'driver' ? ride.publish?.owner_commission || 0 : 0;

    return serializeFeedItem(ride, {
      lead_type: tab === 'customer' ? 'customer' : 'driver',
      vehicle: vehicleMap.get(String(ride.vehicleTypeId)) || null,
      distanceFromMeKm,
      routeMatch,
      publisher: publisherDriver
        ? {
            id: String(publisherDriver._id),
            name: publisherDriver.name,
            org_name: organization?.company_name || '',
            category: publisherDriver.driver_category || 'lower',
            rating: publisherDriver.rating || 0,
          }
        : null,
      contact: {
        fee: alreadyContacted ? 0 : contactFee,
        already_contacted: alreadyContacted,
        can_chat: true,
        can_call: true,
      },
      accept: {
        allowed: wallet.available >= holdRequired + (alreadyContacted ? 0 : acceptFee),
        fee: alreadyContacted ? 0 : acceptFee,
        hold_required: holdRequired,
        wallet_available: wallet.available,
      },
      vehicle_mismatch: Boolean(
        ride.vehicleTypeId && myVehicleTypeId && String(ride.vehicleTypeId) !== myVehicleTypeId,
      ),
    });
  });

  return {
    tab: tab === 'customer' ? 'customer' : 'driver',
    route_mode: driver.route_mode || 'all_locations',
    results,
    pagination: { page: safePage, limit: safeLimit, total: filtered.length },
  };
};

/**
 * Takes a lead from the feed.
 *
 * A published (driver) lead is claimed with one conditional update so only one
 * driver can win the race, and the escrow holds are taken inside the same
 * transaction — if either side cannot fund their hold, the claim is rolled back
 * and the ride goes straight back on the feed.
 */
export const acceptFeedRide = async ({ driverId, rideId }) => {
  const ride = await Ride.findById(rideId).lean();
  if (!ride) throw new ApiError(404, 'Ride not found', null, 'RIDE_NOT_FOUND');

  return ride.origin === 'driver_created'
    ? acceptPublishedRide({ driverId, ride })
    : acceptCustomerLead({ driverId, ride });
};

const acceptPublishedRide = async ({ driverId, ride }) => {
  if (String(ride.created_by_driver_id) === String(driverId)) {
    throw new ApiError(409, 'You published this ride', null, 'RIDE_NOT_OPEN');
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const now = new Date();
    const claimed = await Ride.findOneAndUpdate(
      {
        _id: ride._id,
        'publish.status': 'open',
        driverId: null,
        'publish.expires_at': { $gt: now },
      },
      {
        $set: {
          'publish.status': 'taken',
          'publish.taken_by_driver_id': driverId,
          'publish.taken_at': now,
          driverId,
          status: RIDE_STATUS.ACCEPTED,
          liveStatus: RIDE_LIVE_STATUS.ACCEPTED,
          acceptedAt: now,
          'assignment.mode': 'published',
          'assignment.assigned_by_driver_id': ride.created_by_driver_id,
          'assignment.assigned_at': now,
        },
        $push: {
          'assignment.history': {
            driver_id: driverId,
            action: 'assigned',
            by_driver_id: ride.created_by_driver_id,
            at: now,
          },
        },
      },
      { new: true, session },
    );

    if (!claimed) {
      throw new ApiError(409, 'Another driver just took this ride', null, 'RIDE_ALREADY_TAKEN');
    }

    await holdForPublishedRide({ ride: claimed, session });

    if (!isRideScheduledForFuture(claimed)) {
      await Driver.updateOne({ _id: driverId }, { $set: { isOnRide: true } }, { session });
    }

    await session.commitTransaction();

    emitToRoom(getFeedRoom(claimed.service_location_id), 'feed:driver:removed', {
      rideId: String(claimed._id),
      reason: 'TAKEN',
    });
    emitToRoom(getPublisherRoom(claimed.created_by_driver_id), 'network:ride:taken', {
      rideId: String(claimed._id),
      driverId: String(driverId),
      held: claimed.publish?.driver_payout || 0,
    });
    await closeLeadConversationsForRide(claimed._id, 'RIDE_TAKEN');
    await notifyNetworkAssignment(claimed);

    return { accepted: true, rideId: String(claimed._id), escrow: 'held' };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const acceptCustomerLead = async ({ driverId, ride }) => {
  const permissions = await getDriverPermissions(driverId);
  const fee = permissions.customer_ride_accept_fee;

  // Charged before the claim: `acceptRideAssignment` runs its own transaction,
  // and a fee taken after a failed claim would have to be refunded.
  const alreadyPaid = await LeadContact.findOne({
    ride_id: ride._id,
    requester_driver_id: driverId,
  }).lean();

  let feeTransactionId = null;
  if (fee > 0 && !alreadyPaid) {
    const wallet = await getWalletSnapshot(permissions.driver);
    if (wallet.available < fee) {
      throw new ApiError(
        402,
        `You need ₹${fee} available to take this ride`,
        { required: fee, available: wallet.available },
        'INSUFFICIENT_WALLET',
      );
    }
  }

  const accepted = await acceptRideAssignment({ rideId: ride._id, driverId });

  if (fee > 0 && !alreadyPaid) {
    const charge = await applyDriverWalletAdjustment({
      driverId,
      amount: -fee,
      type: 'feed_accept_fee',
      rideId: ride._id,
      description: 'Fee for taking a customer lead from the feed',
    });
    feeTransactionId = charge.transaction._id;

    await Ride.updateOne(
      { _id: ride._id },
      {
        $set: {
          'feed_fee.amount': fee,
          'feed_fee.charged_driver_id': driverId,
          'feed_fee.txn_id': feeTransactionId,
        },
      },
    );
  }

  await Ride.updateOne({ _id: ride._id }, { $set: { 'assignment.mode': 'feed_accept' } });

  stopDispatchFlow(ride._id);
  await notifyRideAccepted(accepted);

  return {
    accepted: true,
    rideId: String(ride._id),
    fee_charged: feeTransactionId ? fee : 0,
  };
};

/** Sweeps leads whose window has closed so the feed never shows a dead ride. */
export const expirePublishedRides = async () => {
  const now = new Date();
  const expired = await Ride.find({
    'publish.status': 'open',
    'publish.expires_at': { $lte: now },
  })
    .select('_id service_location_id created_by_driver_id')
    .lean();

  if (!expired.length) return { expired: 0 };

  await Ride.updateMany(
    { _id: { $in: expired.map((ride) => ride._id) } },
    { $set: { 'publish.status': 'expired', 'publish.is_published': false, 'assignment.mode': 'dispatch' } },
  );

  for (const ride of expired) {
    emitToRoom(getFeedRoom(ride.service_location_id), 'feed:driver:removed', {
      rideId: String(ride._id),
      reason: 'EXPIRED',
    });
    emitToRoom(getPublisherRoom(ride.created_by_driver_id), 'network:ride:expired', {
      rideId: String(ride._id),
    });
    await closeLeadConversationsForRide(ride._id, 'EXPIRED');
  }

  return { expired: expired.length };
};
