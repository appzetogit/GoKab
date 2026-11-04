import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../constants/index.js';
import { Ride } from '../user/models/Ride.js';
import { User } from '../user/models/User.js';
import { CarpoolGroup } from '../user/models/CarpoolGroup.js';
import { Driver } from '../driver/models/Driver.js';
import { Vehicle } from '../admin/models/Vehicle.js';
import { haversineMeters } from '../../../utils/geo.js';
import { ApiError } from '../../../utils/ApiError.js';
import { getTransportRideSettings } from './transportSettingsService.js';
import { sendPushNotificationToEntities } from './pushNotificationService.js';

/**
 * Carpool for airport and railway rides. See CarpoolGroup for the model.
 *
 * Flow: the first rider's ride goes to drivers at once as the group's lead. A
 * rider who books later to the same station is attached to the group, silently
 * while no driver has it yet, or by the driver's say-so once one has.
 *
 * dispatchService and rideService call into this file, so they reach it through
 * a dynamic import rather than a static one.
 */

const STATION_MATCH_METERS = 300;
// A group that was just accepted for a ride wanted now can still take a rider.
const NOW_JOIN_WINDOW_MS = 5 * 60 * 1000;

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const getCarpoolSettings = async () => {
  const s = await getTransportRideSettings();
  const solo = Number(s.carpool_solo_commission_percent);
  return {
    enabledAirport: String(s.carpool_enabled_airport ?? '1') === '1',
    enabledRailway: String(s.carpool_enabled_railway ?? '1') === '1',
    seatFarePercent: Math.min(num(s.carpool_seat_fare_percent, 65), 100),
    radiusMeters: num(s.carpool_match_radius_km, 3) * 1000,
    windowMs: num(s.carpool_time_window_minutes, 15) * 60 * 1000,
    joinCutoffMs: num(s.carpool_join_cutoff_minutes, 30) * 60 * 1000,
    addRiderTimeoutMs: num(s.carpool_add_rider_timeout_minutes, 3) * 60 * 1000,
    // Share of the usual commission kept when the driver ends up with one rider only.
    soloCommissionPercent: Number.isFinite(solo) && solo >= 0 ? Math.min(solo, 100) : 0,
  };
};

const dispatch = () => import('./dispatchService.js');

const seatsOf = (ride) =>
  Math.max(1, Math.trunc(Number(ride.carpool?.seats || ride.bookingPreferences?.passengers || 1)));
const effectiveAtOf = (ride) => new Date(ride.scheduledAt || ride.createdAt || Date.now()).getTime();
const isActiveStatus = (ride) =>
  ![RIDE_STATUS.COMPLETED, RIDE_STATUS.CANCELLED].includes(ride.status) &&
  ![RIDE_LIVE_STATUS.COMPLETED, RIDE_LIVE_STATUS.CANCELLED].includes(ride.liveStatus);

const vehicleSeats = async (vehicleTypeId) => {
  if (!vehicleTypeId) return 4;
  const vehicle = await Vehicle.findById(vehicleTypeId).select('capacity').lean().catch(() => null);
  return Math.max(2, Math.trunc(Number(vehicle?.capacity) || 4));
};

/** What the app needs to know about a ride's carpool. Null for a normal ride. */
export const carpoolSummary = (ride, group = null) =>
  ride?.carpool?.enabled
    ? {
        enabled: true,
        groupId: ride.carpool.groupId ? String(ride.carpool.groupId) : '',
        role: ride.carpool.role || '',
        seats: Number(ride.carpool.seats || 1),
        fullFare: Number(ride.carpool.fullFare || 0),
        pendingApproval: Boolean(ride.carpool.pendingApproval),
        riders: group ? group.rideIds.length : undefined,
      }
    : null;

const pushUser = (userId, title, body, data = {}) =>
  sendPushNotificationToEntities({ userIds: [String(userId)], title, body, data }).catch(() => {});

const createGroupFor = async (ride, seatsTotal) => {
  const group = await CarpoolGroup.create({
    leadRideId: ride._id,
    rideIds: [ride._id],
    vehicleTypeId: ride.vehicleTypeId || null,
    status: 'searching',
    kind: ride.carpool.kind === 'railway' ? 'railway' : 'airport',
    direction: 'to_station',
    stationName: ride.carpool.stationName || '',
    stationCoordinates: ride.carpool.stationCoordinates || [],
    pickupCoordinates: ride.pickupLocation?.coordinates || [],
    scheduledAt: ride.scheduledAt || null,
    effectiveAt: new Date(effectiveAtOf(ride)),
    seatsTotal,
    seatsUsed: seatsOf(ride),
  });
  await Ride.updateOne(
    { _id: ride._id },
    { $set: { 'carpool.groupId': group._id, 'carpool.role': 'lead', 'carpool.pendingApproval': false } },
  );
  ride.carpool.groupId = group._id;
  ride.carpool.role = 'lead';
  return group;
};

const canJoinAcceptedGroup = async (group, cfg) => {
  const rides = await Ride.find({ _id: { $in: group.rideIds } }).select('liveStatus status').lean();
  const untouched = rides.every(
    (r) =>
      !isActiveStatus(r) || [RIDE_LIVE_STATUS.SEARCHING, RIDE_LIVE_STATUS.ACCEPTED].includes(r.liveStatus),
  );
  if (!untouched) return false;
  if (group.scheduledAt) return new Date(group.scheduledAt).getTime() - Date.now() >= cfg.joinCutoffMs;
  return Date.now() - new Date(group.acceptedAt || 0).getTime() <= NOW_JOIN_WINDOW_MS;
};

const findAndClaimGroup = async (ride, cfg) => {
  const seats = seatsOf(ride);
  const candidates = await CarpoolGroup.find({
    status: { $in: ['searching', 'accepted'] },
    vehicleTypeId: ride.vehicleTypeId || null,
    direction: 'to_station',
    kind: ride.carpool.kind === 'railway' ? 'railway' : 'airport',
  })
    .sort({ createdAt: 1 })
    .limit(60)
    .lean();

  const pickup = ride.pickupLocation?.coordinates || [];
  const ranked = candidates
    .filter((g) => {
      if (g.seatsUsed + seats > g.seatsTotal) return false;
      if (haversineMeters(g.stationCoordinates, ride.carpool.stationCoordinates) > STATION_MATCH_METERS) return false;
      if (g.pickupCoordinates.length !== 2 || pickup.length !== 2) return false;
      if (haversineMeters(g.pickupCoordinates, pickup) > cfg.radiusMeters) return false;
      return Math.abs(new Date(g.effectiveAt).getTime() - effectiveAtOf(ride)) <= cfg.windowMs;
    })
    .sort((a, b) => haversineMeters(a.pickupCoordinates, pickup) - haversineMeters(b.pickupCoordinates, pickup));

  for (const g of ranked) {
    if (g.status === 'accepted' && !(await canJoinAcceptedGroup(g, cfg))) continue;
    // Claim the seats in one step so two riders cannot both take the last one.
    const claimed = await CarpoolGroup.findOneAndUpdate(
      {
        _id: g._id,
        status: g.status,
        $expr: { $lte: [{ $add: ['$seatsUsed', seats] }, '$seatsTotal'] },
      },
      { $inc: { seatsUsed: seats }, $push: { rideIds: ride._id } },
      { new: true },
    );
    if (claimed) return claimed;
  }
  return null;
};

/**
 * Called right after a ride is created. Returns `{ dispatch }`: false when the
 * ride joined a group and must not be offered to drivers on its own.
 */
export const attachRideToCarpool = async (ride) => {
  if (!ride?.carpool?.enabled) return { dispatch: true };

  const cfg = await getCarpoolSettings();
  const kindEnabled = ride.carpool.kind === 'railway' ? cfg.enabledRailway : cfg.enabledAirport;
  if (!kindEnabled) {
    // Switched off by the admin: it is simply a normal ride.
    await Ride.updateOne({ _id: ride._id }, { $set: { 'carpool.enabled': false } });
    ride.carpool.enabled = false;
    return { dispatch: true };
  }

  const group = await findAndClaimGroup(ride, cfg);
  if (!group) {
    await createGroupFor(ride, await vehicleSeats(ride.vehicleTypeId));
    return { dispatch: true };
  }

  const pending = group.status === 'accepted';
  const pendingUntil = pending ? new Date(Date.now() + cfg.addRiderTimeoutMs) : null;
  await Ride.updateOne(
    { _id: ride._id },
    {
      $set: {
        'carpool.groupId': group._id,
        'carpool.role': 'member',
        'carpool.pendingApproval': pending,
        'carpool.pendingUntil': pendingUntil,
      },
    },
  );
  ride.carpool.groupId = group._id;
  ride.carpool.role = 'member';
  ride.carpool.pendingApproval = pending;

  if (!pending) {
    // The lead is still on dispatch; the driver who takes it takes everyone.
    const lead = await Ride.findById(group.leadRideId).select('userId').lean();
    if (lead?.userId) {
      pushUser(
        lead.userId,
        'A co-rider joined your carpool',
        'Another rider is sharing your cab. Your fare stays the same.',
        { type: 'carpool_rider_joined', rideId: String(group.leadRideId) },
      );
    }
    pushUser(
      ride.userId,
      'Carpool: looking for your driver',
      'You are sharing a cab with another rider. We are finding the driver.',
      { type: 'carpool_matched', rideId: String(ride._id) },
    );
    return { dispatch: false };
  }

  await askDriverToAddRider(ride, group, pendingUntil);
  pushUser(
    ride.userId,
    'Carpool: waiting for the driver',
    'Your driver is being asked to add you to this shared ride.',
    { type: 'carpool_pending', rideId: String(ride._id) },
  );
  return { dispatch: false };
};

const askDriverToAddRider = async (ride, group, expiresAt) => {
  const rider = await User.findById(ride.userId).select('name').lean();
  const d = await dispatch();
  const payload = {
    groupId: String(group._id),
    rideId: String(ride._id),
    riderName: rider?.name || 'Rider',
    pickupAddress: ride.pickupAddress || '',
    dropAddress: ride.dropAddress || '',
    passengers: seatsOf(ride),
    luggageCount: Number(ride.bookingPreferences?.luggageCount || 0),
    fare: Number(ride.fare || 0),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  };
  d.emitToDriver(group.driverId, 'carpool:add_rider_request', payload);
  sendPushNotificationToEntities({
    driverIds: [String(group.driverId)],
    title: 'Add a rider to your carpool?',
    body: `${payload.riderName} wants to share your ride. Extra earning ₹${Math.round(payload.fare)}.`,
    data: {
      type: 'carpool_add_rider',
      groupId: payload.groupId,
      rideId: payload.rideId,
      fare: String(Math.round(payload.fare)),
    },
  }).catch(() => {});
};

/** A driver took the lead ride: everyone waiting in the group is theirs too. */
export const onLeadAccepted = async (lead) => {
  if (!lead?.carpool?.groupId) return;
  const group = await CarpoolGroup.findOneAndUpdate(
    { _id: lead.carpool.groupId, status: 'searching' },
    { $set: { status: 'accepted', driverId: lead.driverId, acceptedAt: new Date() } },
    { new: true },
  );
  if (!group) return;

  const members = await Ride.find({
    _id: { $in: group.rideIds, $ne: lead._id },
    status: RIDE_STATUS.SEARCHING,
    driverId: null,
  });
  const d = await dispatch();
  for (const member of members) {
    member.driverId = lead.driverId;
    member.status = RIDE_STATUS.ACCEPTED;
    member.liveStatus = RIDE_LIVE_STATUS.ACCEPTED;
    member.acceptedAt = new Date();
    if (member.carpool) member.carpool.pendingApproval = false;
    await member.save();
    await d.notifyRideAccepted(member);
  }
};

export const respondToAddRider = async ({ rideId, driverId, accept, timedOut = false }) => {
  const ride = await Ride.findOne({ _id: rideId, 'carpool.pendingApproval': true });
  if (!ride) throw new ApiError(404, 'This request is no longer open');
  const group = await CarpoolGroup.findById(ride.carpool.groupId);
  if (!group) throw new ApiError(404, 'Carpool not found');
  if (!timedOut && String(group.driverId) !== String(driverId)) {
    throw new ApiError(403, 'This carpool is not yours');
  }

  const d = await dispatch();

  if (accept) {
    ride.driverId = group.driverId;
    ride.status = RIDE_STATUS.ACCEPTED;
    ride.liveStatus = RIDE_LIVE_STATUS.ACCEPTED;
    ride.acceptedAt = new Date();
    ride.carpool.pendingApproval = false;
    ride.carpool.pendingUntil = null;
    await ride.save();
    await d.notifyRideAccepted(ride);

    const others = await Ride.find({ _id: { $in: group.rideIds, $ne: ride._id } }).select('userId status').lean();
    for (const other of others.filter((r) => r.status !== RIDE_STATUS.CANCELLED)) {
      pushUser(
        other.userId,
        'A co-rider joined your carpool',
        'Another rider is sharing your cab. Your fare stays the same.',
        { type: 'carpool_rider_joined', rideId: String(other._id) },
      );
    }
    return ride;
  }

  // Declined or nobody answered: the rider goes on their own, with a group of their own.
  await CarpoolGroup.updateOne({ _id: group._id }, { $pull: { rideIds: ride._id }, $inc: { seatsUsed: -seatsOf(ride) } });
  ride.carpool.pendingApproval = false;
  ride.carpool.pendingUntil = null;
  ride.carpool.groupId = null;
  await ride.save();
  await createGroupFor(ride, await vehicleSeats(ride.vehicleTypeId));
  pushUser(
    ride.userId,
    'Finding your driver',
    'We are finding a driver for your carpool seat.',
    { type: 'carpool_own_search', rideId: String(ride._id) },
  );
  await d.startDispatchFlow(await Ride.findById(ride._id));
  return ride;
};

/** Run every minute: riders the driver never answered for go on their own. */
export const releaseExpiredAddRiderRequests = async () => {
  const stale = await Ride.find({
    'carpool.pendingApproval': true,
    'carpool.pendingUntil': { $lte: new Date() },
  })
    .select('_id')
    .lean();
  for (const { _id } of stale) {
    await respondToAddRider({ rideId: _id, accept: false, timedOut: true }).catch((error) =>
      console.error('[carpool] could not release a pending rider:', error.message),
    );
  }
};

const activeRidesOf = async (group) =>
  (await Ride.find({ _id: { $in: group.rideIds } })).filter(isActiveStatus);

/** A rider cancelled: free their seat and keep the rest of the group going. */
export const onRideCancelled = async (ride) => {
  if (!ride?.carpool?.groupId) return;
  const group = await CarpoolGroup.findById(ride.carpool.groupId);
  if (!group || ['completed', 'cancelled'].includes(group.status)) return;

  await CarpoolGroup.updateOne({ _id: group._id }, { $pull: { rideIds: ride._id }, $inc: { seatsUsed: -seatsOf(ride) } });
  const fresh = await CarpoolGroup.findById(group._id);
  const remaining = (await activeRidesOf(fresh)).filter((r) => String(r._id) !== String(ride._id));

  if (!remaining.length) {
    await CarpoolGroup.updateOne({ _id: group._id }, { $set: { status: 'cancelled' } });
    return;
  }

  const d = await dispatch();

  if (fresh.status === 'searching' && String(fresh.leadRideId) === String(ride._id)) {
    // The ride that was on dispatch is gone: the next rider takes over as lead.
    const next = remaining[0];
    await CarpoolGroup.updateOne({ _id: group._id }, { $set: { leadRideId: next._id } });
    await Ride.updateOne({ _id: next._id }, { $set: { 'carpool.role': 'lead' } });
    await d.startDispatchFlow(await Ride.findById(next._id));
    return;
  }

  if (fresh.status === 'accepted') {
    // The driver still has the others, so they are still on a ride.
    if (fresh.driverId) await Driver.updateOne({ _id: fresh.driverId }, { $set: { isOnRide: true } });
    for (const other of remaining) {
      pushUser(
        other.userId,
        'Your co-rider cancelled',
        'Your trip is unchanged and your fare stays the same.',
        { type: 'carpool_rider_left', rideId: String(other._id) },
      );
    }
  }
};

/** After a ride completes: close the group once everyone is done. */
export const onRideCompleted = async (ride) => {
  if (!ride?.carpool?.groupId) return;
  const group = await CarpoolGroup.findById(ride.carpool.groupId);
  if (!group) return;
  const remaining = (await activeRidesOf(group)).filter((r) => String(r._id) !== String(ride._id));
  if (!remaining.length) {
    await CarpoolGroup.updateOne({ _id: group._id }, { $set: { status: 'completed' } });
    return;
  }
  // The driver still has riders in the car.
  if (group.driverId) await Driver.updateOne({ _id: group.driverId }, { $set: { isOnRide: true } });
};

/**
 * Share of the commission to take on a carpool ride. A driver left with one rider
 * keeps most of it (admin setting); everything else is charged as usual.
 */
export const carpoolCommissionFactor = async (ride) => {
  if (!ride?.carpool?.groupId) return 1;
  const group = await CarpoolGroup.findById(ride.carpool.groupId).lean();
  if (!group) return 1;
  const rides = await Ride.find({ _id: { $in: group.rideIds } }).select('status').lean();
  const carried = rides.filter((r) => r.status !== RIDE_STATUS.CANCELLED);
  if (carried.length > 1) return 1;
  return (await getCarpoolSettings()).soloCommissionPercent / 100;
};

/** The driver gives the whole carpool back; everyone goes to find another driver. */
export const cancelCarpoolByDriver = async ({ groupId, driverId }) => {
  const group = await CarpoolGroup.findOne({ _id: groupId, driverId, status: 'accepted' });
  if (!group) throw new ApiError(404, 'Carpool not found');

  const rides = await activeRidesOf(group);
  if (rides.some((r) => [RIDE_LIVE_STATUS.STARTED, RIDE_LIVE_STATUS.ARRIVING].includes(r.liveStatus))) {
    throw new ApiError(409, 'A rider is already on board or has been reached. Finish this trip.');
  }

  for (const ride of rides) {
    ride.driverId = null;
    ride.status = RIDE_STATUS.SEARCHING;
    ride.liveStatus = RIDE_LIVE_STATUS.SEARCHING;
    ride.acceptedAt = null;
    if (ride.carpool) ride.carpool.pendingApproval = false;
    await ride.save();
    pushUser(
      ride.userId,
      'Your driver cancelled',
      'We are finding another driver for your carpool ride.',
      { type: 'carpool_driver_cancelled', rideId: String(ride._id) },
    );
  }
  await Driver.updateOne({ _id: driverId }, { $set: { isOnRide: false } });
  await CarpoolGroup.updateOne({ _id: group._id }, { $set: { status: 'searching', driverId: null, acceptedAt: null } });

  const d = await dispatch();
  await d.redispatchRide(group.leadRideId, driverId);
};

/** The driver gives up on a rider who did not turn up. The rest of the trip goes on. */
export const skipRider = async ({ rideId, driverId }) => {
  const ride = await Ride.findOne({ _id: rideId, driverId, 'carpool.enabled': true });
  if (!ride) throw new ApiError(404, 'Ride not found');
  if (![RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING].includes(ride.liveStatus)) {
    throw new ApiError(409, 'This rider is already on board');
  }

  ride.status = RIDE_STATUS.CANCELLED;
  ride.liveStatus = RIDE_LIVE_STATUS.CANCELLED;
  await ride.save();
  await User.updateOne({ _id: ride.userId, currentRideId: ride._id }, { currentRideId: null });
  pushUser(
    ride.userId,
    'Carpool ride cancelled',
    'Your driver could not meet you at the pickup, so this carpool ride was cancelled.',
    { type: 'carpool_no_show', rideId: String(ride._id) },
  );

  await onRideCancelled(ride);
  const group = ride.carpool.groupId ? await CarpoolGroup.findById(ride.carpool.groupId) : null;
  if (!group || !(await activeRidesOf(group)).length) {
    await Driver.updateOne({ _id: driverId }, { $set: { isOnRide: false } });
  }
  return ride;
};

const riderView = (ride, userMap) => {
  const user = userMap.get(String(ride.userId)) || {};
  return {
    rideId: String(ride._id),
    name: user.name || 'Rider',
    phone: user.phone || '',
    countryCode: user.countryCode || '',
    passengers: seatsOf(ride),
    luggageCount: Number(ride.bookingPreferences?.luggageCount || 0),
    pickupAddress: ride.pickupAddress || '',
    pickupLocation: ride.pickupLocation,
    dropAddress: ride.dropAddress || '',
    dropLocation: ride.dropLocation,
    fare: Number(ride.fare || 0),
    paymentMethod: ride.paymentMethod,
    status: ride.status,
    liveStatus: ride.liveStatus,
    pendingApproval: Boolean(ride.carpool?.pendingApproval),
    scheduledAt: ride.scheduledAt || null,
  };
};

/** The driver's view of a whole carpool: every rider, in the order they joined. */
export const getGroupForDriver = async ({ groupId, driverId }) => {
  const group = await CarpoolGroup.findOne({ _id: groupId, driverId }).lean();
  if (!group) return null;
  const rides = await Ride.find({ _id: { $in: group.rideIds } }).sort({ createdAt: 1 });
  const users = await User.find({ _id: { $in: rides.map((r) => r.userId) } })
    .select('name phone countryCode')
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const riders = rides.map((r) => riderView(r, userMap));
  const live = riders.filter((r) => r.status !== RIDE_STATUS.CANCELLED);
  return {
    groupId: String(group._id),
    status: group.status,
    stationName: group.stationName,
    stationLocation: group.stationCoordinates.length === 2 ? { type: 'Point', coordinates: group.stationCoordinates } : null,
    seatsTotal: group.seatsTotal,
    seatsUsed: group.seatsUsed,
    scheduledAt: group.scheduledAt,
    totalFare: live.filter((r) => !r.pendingApproval).reduce((sum, r) => sum + r.fare, 0),
    riders,
  };
};

/** The carpool a driver is currently running, if any. */
export const getActiveGroupForDriver = async (driverId) => {
  const groups = await CarpoolGroup.find({ driverId, status: 'accepted' }).sort({ createdAt: 1 }).lean();
  for (const g of groups) {
    const view = await getGroupForDriver({ groupId: g._id, driverId });
    if (view?.riders.some((r) => r.status !== RIDE_STATUS.CANCELLED && r.status !== RIDE_STATUS.COMPLETED)) return view;
  }
  return null;
};

/** What a request card needs to show for a carpool ride that is being offered. */
export const requestCardInfo = async (ride) => {
  if (!ride?.carpool?.enabled) return null;
  const group = ride.carpool.groupId ? await CarpoolGroup.findById(ride.carpool.groupId).lean() : null;
  const seatFare = Number(ride.fare || 0);
  const seatsTotal = group?.seatsTotal || 4;
  const riders = group ? group.rideIds.length : 1;
  return {
    enabled: true,
    groupId: group ? String(group._id) : '',
    riders,
    seatsUsed: group?.seatsUsed || seatsOf(ride),
    seatsTotal,
    seatFare,
    // What the trip pays with every seat taken, counting this fare for each.
    maxFare: Math.round(seatFare * seatsTotal),
  };
};

export const listGroupsForAdmin = async ({ status, limit = 100 } = {}) => {
  const filter = status ? { status } : {};
  const groups = await CarpoolGroup.find(filter).sort({ createdAt: -1 }).limit(Math.min(limit, 300)).lean();
  const rides = await Ride.find({ _id: { $in: groups.flatMap((g) => g.rideIds) } })
    .select('userId fare status pickupAddress dropAddress paymentMethod bookingPreferences')
    .lean();
  const users = await User.find({ _id: { $in: rides.map((r) => r.userId) } }).select('name phone').lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const rideMap = new Map(rides.map((r) => [String(r._id), r]));
  const drivers = await Driver.find({ _id: { $in: groups.map((g) => g.driverId).filter(Boolean) } })
    .select('name phone')
    .lean();
  const driverMap = new Map(drivers.map((x) => [String(x._id), x]));
  return groups.map((g) => ({
    id: String(g._id),
    status: g.status,
    kind: g.kind,
    stationName: g.stationName,
    scheduledAt: g.scheduledAt,
    createdAt: g.createdAt,
    seatsUsed: g.seatsUsed,
    seatsTotal: g.seatsTotal,
    driver: g.driverId ? { name: driverMap.get(String(g.driverId))?.name || '', phone: driverMap.get(String(g.driverId))?.phone || '' } : null,
    riders: g.rideIds
      .map((id) => rideMap.get(String(id)))
      .filter(Boolean)
      .map((r) => ({
        rideId: String(r._id),
        name: userMap.get(String(r.userId))?.name || 'Rider',
        phone: userMap.get(String(r.userId))?.phone || '',
        fare: Number(r.fare || 0),
        status: r.status,
        pickupAddress: r.pickupAddress || '',
        passengers: Number(r.bookingPreferences?.passengers || 1),
      })),
  }));
};
