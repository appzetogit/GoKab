import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../constants/index.js';
import { Ride } from '../user/models/Ride.js';
import { User } from '../user/models/User.js';
import { sendPushNotificationToEntities } from './pushNotificationService.js';
import { haversineMeters } from '../../../utils/geo.js';

const MINUTE_MS = 60 * 1000;
const REMINDER_LEAD_MINUTES = [30, 10];
// Past the return time with the driver still not on the way.
const LATE_AFTER_MS = 10 * MINUTE_MS;
// The return has to leave room for the drive itself plus a short break.
const RETURN_GAP_MINUTES = 15;

const timeLabel = (date) =>
  new Date(date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });


const legView = (leg, ride) => {
  const status = ride.status === RIDE_STATUS.ONGOING ? 'ongoing' : ride.status;
  const cancelled = ride.status === RIDE_STATUS.CANCELLED;
  return {
    leg,
    id: String(ride._id),
    status,
    scheduled_at: ride.scheduledAt || null,
    completed_at: ride.completedAt || null,
    pickup_address: ride.pickupAddress || '',
    drop_address: ride.dropAddress || '',
    // Why a leg did not finish, in words the driver can act on.
    reason: cancelled
      ? [ride.cancellation?.by && `Cancelled by ${ride.cancellation.by}`, ride.cancellation?.reason].filter(Boolean).join(' · ') ||
        'Cancelled'
      : '',
  };
};

/**
 * One round trip = two rides (onward + return). Lists show one card for the pair;
 * this describes both legs and the whole trip's state for that card and the detail.
 * Pass any rides; returns a Map of rideId -> summary for the onward legs and, by
 * return leg id, the same summary.
 */
export const loadRoundTripSummaries = async (rides) => {
  const trips = rides.filter((ride) => ride?.roundTrip?.isRoundTrip);
  const out = new Map();
  if (!trips.length) return out;

  const ids = new Set();
  for (const ride of trips) {
    const trip = ride.roundTrip;
    if (trip.legType === 'return' && trip.parentRideId) ids.add(String(trip.parentRideId));
    if (trip.legType === 'outbound' && trip.returnRideId && String(trip.returnRideId) !== String(ride._id)) {
      ids.add(String(trip.returnRideId));
    }
  }
  const known = new Map(trips.map((ride) => [String(ride._id), ride]));
  const missing = [...ids].filter((id) => !known.has(id));
  const extra = missing.length
    ? await Ride.find({ _id: { $in: missing } })
        .select('status scheduledAt completedAt pickupAddress dropAddress cancellation roundTrip')
        .lean()
    : [];
  for (const ride of extra) known.set(String(ride._id), ride);

  for (const ride of trips) {
    const trip = ride.roundTrip;
    const outbound = trip.legType === 'return' ? known.get(String(trip.parentRideId)) : ride;
    if (!outbound) continue;
    const returnId = outbound.roundTrip?.returnRideId;
    const returnRide =
      returnId && String(returnId) !== String(outbound._id) ? known.get(String(returnId)) : null;

    const onward = legView('outbound', outbound);
    const back = returnRide
      ? legView('return', returnRide)
      : {
          leg: 'return',
          id: null,
          // Not created yet: it is booked automatically when the onward trip ends.
          status: outbound.status === RIDE_STATUS.CANCELLED ? 'cancelled' : 'pending',
          scheduled_at: outbound.roundTrip?.returnAt || null,
          completed_at: null,
          pickup_address: outbound.roundTrip?.returnPickupAddress || outbound.dropAddress || '',
          drop_address: outbound.roundTrip?.returnDropAddress || outbound.pickupAddress || '',
          reason:
            outbound.status === RIDE_STATUS.CANCELLED
              ? 'Onward trip was cancelled, so there is no return trip'
              : 'Return trip is booked automatically once the onward trip is completed',
        };

    const done = (leg) => leg.status === 'completed';
    const summary = {
      is_round_trip: true,
      return_at: outbound.roundTrip?.returnAt || null,
      legs: [onward, back],
      completed_legs: [onward, back].filter(done).length,
      state:
        done(onward) && done(back)
          ? 'completed'
          : onward.status === 'cancelled' || back.status === 'cancelled'
            ? 'incomplete'
            : done(onward) || back.status === 'ongoing' || onward.status === 'ongoing'
              ? 'in_progress'
              : 'upcoming',
    };
    out.set(String(outbound._id), summary);
    if (returnRide) out.set(String(returnRide._id), summary);
  }
  return out;
};

/**
 * Validates the return time of a round trip booking and returns it as a Date.
 * The return cannot be before the outbound drive is over.
 */
export const normalizeReturnAt = ({ returnAt, outboundAt, estimatedDurationMinutes }) => {
  const when = new Date(returnAt);
  if (!returnAt || Number.isNaN(when.getTime())) return { error: 'returnAt is invalid' };
  const start = outboundAt ? new Date(outboundAt).getTime() : Date.now();
  const earliest = start + (Number(estimatedDurationMinutes || 0) + RETURN_GAP_MINUTES) * MINUTE_MS;
  if (when.getTime() < earliest) {
    return { error: 'The return time must be after the outbound trip ends' };
  }
  return { value: when };
};

/**
 * Once the outbound leg is over, books the way back as a scheduled ride for the
 * same driver and rider. The driver is free in between and the existing
 * scheduled-ride rules keep the return window clear for them.
 *
 * The outbound leg already settled the whole round trip fare, so the return leg
 * starts at 0; only waiting time at the return pickup is added to it later.
 */
export const createReturnLegIfNeeded = async (outbound) => {
  const trip = outbound.roundTrip;
  if (!trip?.isRoundTrip || trip.legType !== 'outbound' || trip.returnRideId || !trip.returnAt) return null;
  if (!outbound.driverId || !outbound.userId) return null;

  const claimed = await Ride.findOneAndUpdate(
    { _id: outbound._id, 'roundTrip.returnRideId': null },
    { $set: { 'roundTrip.returnRideId': outbound._id } },
  );
  if (!claimed) return null;

  // The rider's own return places, else the onward route reversed.
  const custom =
    trip.returnPickupCoordinates?.length === 2 && trip.returnDropCoordinates?.length === 2;
  const returnPickupPoint = custom
    ? { type: 'Point', coordinates: trip.returnPickupCoordinates }
    : outbound.dropLocation;
  const returnPickupAddress = custom ? trip.returnPickupAddress : outbound.dropAddress;
  const returnDropPoint = custom
    ? { type: 'Point', coordinates: trip.returnDropCoordinates }
    : outbound.pickupLocation;
  const returnDropAddress = custom ? trip.returnDropAddress : outbound.pickupAddress;
  // Straight-line length of the new route, with the onward trip's pace for the time.
  const customMeters = custom
    ? haversineMeters(trip.returnPickupCoordinates, trip.returnDropCoordinates)
    : 0;
  const onwardMeters = Number(outbound.estimatedDistanceMeters || 0);
  const returnMeters = custom ? customMeters : onwardMeters;
  const returnMinutes =
    custom && onwardMeters > 0
      ? (Number(outbound.estimatedDurationMinutes || 0) * customMeters) / onwardMeters
      : Number(outbound.estimatedDurationMinutes || 0);

  const now = new Date();
  const returnLeg = await Ride.create({
    userId: outbound.userId,
    driverId: outbound.driverId,
    vehicleTypeId: outbound.vehicleTypeId,
    dispatchVehicleTypeIds: outbound.dispatchVehicleTypeIds,
    vehicleIconType: outbound.vehicleIconType,
    vehicleIconUrl: outbound.vehicleIconUrl,
    serviceType: outbound.serviceType,
    pickupLocation: returnPickupPoint,
    pickupAddress: returnPickupAddress,
    dropLocation: returnDropPoint,
    dropAddress: returnDropAddress,
    fare: 0,
    baseFare: 0,
    estimatedDistanceMeters: returnMeters,
    estimatedDurationMinutes: Math.round(returnMinutes),
    paymentMethod: outbound.paymentMethod,
    service_location_id: outbound.service_location_id,
    transport_type: outbound.transport_type,
    pricingSnapshot: outbound.pricingSnapshot,
    scheduledAt: trip.returnAt,
    status: RIDE_STATUS.ACCEPTED,
    liveStatus: RIDE_LIVE_STATUS.ACCEPTED,
    acceptedAt: now,
    roundTrip: { isRoundTrip: true, legType: 'return', returnAt: trip.returnAt, parentRideId: outbound._id },
  });

  await Ride.updateOne({ _id: outbound._id }, { $set: { 'roundTrip.returnRideId': returnLeg._id } });

  sendPushNotificationToEntities({
    userIds: [String(outbound.userId)],
    title: 'Return trip booked',
    body: `Your driver will pick you up again at ${timeLabel(trip.returnAt)}.`,
    data: { type: 'return_trip_booked', rideId: String(returnLeg._id) },
  }).catch(() => {});
  sendPushNotificationToEntities({
    driverIds: [String(outbound.driverId)],
    title: 'Return trip scheduled',
    body: `Pickup again at ${timeLabel(trip.returnAt)} · ${returnPickupAddress || 'see app'}`,
    data: { type: 'return_trip_booked', rideId: String(returnLeg._id) },
  }).catch(() => {});

  return returnLeg;
};

/**
 * Adds the rider's waiting time at the return pickup to that leg's fare, using
 * the waiting rate and free minutes the admin set for the vehicle. Runs when the
 * return trip starts.
 */
export const applyReturnWaitingCharge = (ride, startedAt = new Date()) => {
  if (ride.roundTrip?.legType !== 'return' || !ride.arrivedAt) return 0;
  const rate = Number(ride.pricingSnapshot?.waiting_charge || 0);
  const free = Number(ride.pricingSnapshot?.free_waiting_before || 0);
  if (rate <= 0) return 0;
  const waited = (startedAt.getTime() - new Date(ride.arrivedAt).getTime()) / MINUTE_MS;
  const billable = Math.max(Math.ceil(waited - free), 0);
  const charge = Math.round(billable * rate * 100) / 100;
  if (charge > 0) {
    ride.roundTrip.waitingMinutes = billable;
    ride.roundTrip.waitingCharge = charge;
    ride.fare = Math.round((Number(ride.fare || 0) + charge) * 100) / 100;
    ride.baseFare = ride.fare;
  }
  return charge;
};

/**
 * Reminders for return legs: 30 and 10 minutes before for the driver and the
 * rider, and a heads-up when the driver is late. The rider's tracking screen
 * opens with the first reminder. Each send is claimed first so a restart or an
 * overlapping pass never repeats it.
 */
export const sendReturnLegReminders = async (now = new Date()) => {
  const horizon = new Date(now.getTime() + Math.max(...REMINDER_LEAD_MINUTES) * MINUTE_MS);
  const legs = await Ride.find({
    'roundTrip.legType': 'return',
    status: RIDE_STATUS.ACCEPTED,
    liveStatus: RIDE_LIVE_STATUS.ACCEPTED,
    driverId: { $ne: null },
    scheduledAt: { $lte: horizon, $gte: new Date(now.getTime() - 2 * 60 * MINUTE_MS) },
  })
    .select('userId driverId scheduledAt pickupAddress roundTrip')
    .limit(200)
    .lean();

  let sent = 0;
  for (const leg of legs) {
    try {
      const minutesLeft = (new Date(leg.scheduledAt).getTime() - now.getTime()) / MINUTE_MS;
      const rideId = String(leg._id);
      const label = timeLabel(leg.scheduledAt);

      if (minutesLeft <= 30 && minutesLeft > 10) {
        const claim = await Ride.findOneAndUpdate({ _id: leg._id, 'roundTrip.reminder30At': null }, { $set: { 'roundTrip.reminder30At': now } });
        if (claim) {
          // Opens the rider's live tracking for this leg.
          await User.updateOne({ _id: leg.userId }, { currentRideId: leg._id });
          sendPushNotificationToEntities({
            driverIds: [String(leg.driverId)],
            title: 'Return trip in 30 min',
            body: `Pickup at ${label} · ${leg.pickupAddress || 'see app'}. Finish your current ride in time.`,
            data: { type: 'return_trip_reminder', rideId },
          }).catch(() => {});
          sendPushNotificationToEntities({
            userIds: [String(leg.userId)],
            title: 'Your return trip is soon',
            body: `Your driver will pick you up at ${label}.`,
            data: { type: 'return_trip_reminder', rideId },
          }).catch(() => {});
          sent += 1;
        }
      }

      if (minutesLeft <= 10 && minutesLeft > -LATE_AFTER_MS / MINUTE_MS) {
        const claim = await Ride.findOneAndUpdate({ _id: leg._id, 'roundTrip.reminder10At': null }, { $set: { 'roundTrip.reminder10At': now } });
        if (claim) {
          await User.updateOne({ _id: leg.userId }, { currentRideId: leg._id });
          sendPushNotificationToEntities({
            driverIds: [String(leg.driverId)],
            title: 'Start your return trip',
            body: `Rider is waiting for ${label}. Open the app and head to the pickup.`,
            data: { type: 'return_trip_reminder', rideId },
          }).catch(() => {});
          sent += 1;
        }
      }

      if (minutesLeft <= -LATE_AFTER_MS / MINUTE_MS) {
        const claim = await Ride.findOneAndUpdate({ _id: leg._id, 'roundTrip.lateAlertAt': null }, { $set: { 'roundTrip.lateAlertAt': now } });
        if (claim) {
          sendPushNotificationToEntities({
            driverIds: [String(leg.driverId)],
            title: 'Return trip is late',
            body: 'Your rider is waiting. Slide to go to the pickup now.',
            data: { type: 'return_trip_late', rideId },
          }).catch(() => {});
          sendPushNotificationToEntities({
            userIds: [String(leg.userId)],
            title: 'Driver is running late',
            body: 'We have reminded your driver. Contact support if this takes long.',
            data: { type: 'return_trip_late', rideId },
          }).catch(() => {});
          sent += 1;
        }
      }
    } catch (error) {
      console.error(`[roundTrip] Reminder failed for ride ${leg._id}:`, error.message);
    }
  }
  return { returnLegReminders: sent };
};
