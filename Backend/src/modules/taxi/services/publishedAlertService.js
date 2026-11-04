import { RIDE_STATUS } from '../constants/index.js';
import { Ride } from '../user/models/Ride.js';
import { Driver } from '../driver/models/Driver.js';
import { getTierPhases } from './tierPhaseService.js';
import { sendPushNotificationToEntities } from './pushNotificationService.js';

/**
 * Rides a driver publishes to the network follow the same plan phases as customer
 * rides: Elite first, then Elite + Pro, then everyone (admin setting
 * `transport_ride.tier_phases`, 3 + 2 + 5 minutes by default).
 *
 *  - Feed: a published ride shows only to the plans of its current phase, and past
 *    the phases to everyone, until it is taken or expires.
 *  - Alert (ring card, push, sound): sent to the plans of each phase as it starts,
 *    and not at all once the phases are over. After that only the feed shows it.
 *
 * The phase comes from the time since publishing, so it needs no timer and survives
 * a server restart. A published ride is requested, not accepted, so the card's
 * Accept button sends a request (see `requestInsteadOfAccept`).
 */

const ALL_CATEGORIES = ['lower', 'middle', 'prime'];
const MAX_ALERTS_PER_PHASE = 200;
const CARD_SECONDS = 60;

const dispatch = () => import('./dispatchService.js');

/** Index of the phase a published ride is in; `phases.length` = past them all. Null when phases are off. */
export const publishedPhaseIndex = (ride, phases, now = Date.now()) => {
  if (!phases) return null;
  const start = new Date(ride.publish?.published_at || ride.createdAt || now).getTime();
  const elapsed = Math.max(0, now - start);
  let end = 0;
  for (let i = 0; i < phases.length; i += 1) {
    end += phases[i].minutes * 60 * 1000;
    if (elapsed < end) return i;
  }
  return phases.length;
};

export const publishedAllowedCategories = (ride, phases) => {
  const index = publishedPhaseIndex(ride, phases);
  return index == null ? ALL_CATEGORIES : phases[index]?.categories || ALL_CATEGORIES;
};

export const isPublishedOpenToCategory = (ride, category, phases) =>
  publishedAllowedCategories(ride, phases).includes(category);

const maskName = (name = '') => {
  const text = String(name || '').trim();
  return text.length <= 2 ? (text ? `${text[0]}***` : '') : `${text[0]}***${text[text.length - 1]}`;
};

const buildPayload = async (ride, now = Date.now()) => {
  const { loadPublisherInfo } = await import('./networkTripService.js');
  const publisher = await loadPublisherInfo(ride);
  const payout = Number(ride.publish?.driver_payout || 0);
  return {
    publisher,
    payout,
    secure: ride.publish?.is_secure !== false,
    expiresAt: new Date(now + CARD_SECONDS * 1000).toISOString(),
  };
};

const socketPayload = (ride, built) => ({
  rideId: String(ride._id),
  type: ride.serviceType || 'ride',
  serviceType: ride.serviceType || 'ride',
  // A ride published by another driver: the card sends a request, not an accept.
  published: true,
  isSecure: built.secure,
  amountForYou: built.payout,
  totalFare: Number(ride.publish?.total_fare || ride.fare || 0),
  publisher: { name: built.publisher.businessName },
  userId: '',
  user: { id: '', name: maskName(ride.offline_customer?.name) || 'Customer', phone: '', countryCode: '' },
  pickupLocation: ride.pickupLocation,
  pickupAddress: ride.pickupAddress || '',
  dropLocation: ride.dropLocation,
  dropAddress: ride.dropAddress || '',
  scheduledAt: ride.scheduledAt || null,
  roundTrip: null,
  estimatedDistanceMeters: ride.estimatedDistanceMeters || 0,
  estimatedDurationMinutes: ride.estimatedDurationMinutes || 0,
  vehicleTypeId: ride.vehicleTypeId ? String(ride.vehicleTypeId) : null,
  vehicleTypeIds: [],
  vehicleIconType: ride.vehicleIconType,
  vehicleIconUrl: ride.vehicleIconUrl || '',
  // What the driver would earn, since that is what the card shows as the fare.
  fare: built.payout,
  baseFare: built.payout,
  bookingMode: 'normal',
  pricingNegotiationMode: 'none',
  biddingStatus: 'none',
  bidding: { enabled: false },
  paymentMethod: ride.paymentMethod,
  intercity: ride.intercity || null,
  stopCount: ride.stopCount || 0,
  carpool: null,
  radius: 0,
  attempt: 1,
  maxAttempts: 1,
  acceptRejectDurationSeconds: CARD_SECONDS,
  expiresInSeconds: CARD_SECONDS,
  requestExpiresAt: built.expiresAt,
  zoneId: null,
});

/**
 * Alerts the plans of the ride's current phase that have not been alerted yet.
 * Safe to call any time: a phase is alerted once.
 */
export const alertPublishedRide = async (rideId) => {
  const phases = await getTierPhases();
  const ride = await Ride.findById(rideId);
  if (
    !ride ||
    ride.origin !== 'driver_created' ||
    ride.publish?.status !== 'open' ||
    ride.driverId ||
    ride.status !== RIDE_STATUS.SEARCHING ||
    !ride.publish?.expires_at ||
    new Date(ride.publish.expires_at) <= new Date()
  ) {
    return 0;
  }

  const index = publishedPhaseIndex(ride, phases);
  // Past the phases: no more alerts, the feed keeps showing it.
  if (phases && index >= phases.length) return 0;
  const phaseNumber = index ?? 0;
  if ((ride.publish?.alerted_phase ?? -1) >= phaseNumber) return 0;

  const allowed = phases ? phases[index].categories : ALL_CATEGORIES;
  const already = (ride.publish?.alerted_driver_ids || []).map(String);
  const categoryFilter = allowed.includes('lower')
    ? { $or: [{ driver_category: { $in: allowed } }, { driver_category: { $exists: false } }, { driver_category: null }] }
    : { driver_category: { $in: allowed } };

  const drivers = await Driver.find({
    isOnline: true,
    isOnRide: { $ne: true },
    approve: true,
    deletedAt: null,
    _id: { $nin: [ride.created_by_driver_id, ...already].filter(Boolean) },
    ...(ride.service_location_id ? { service_location_id: ride.service_location_id } : {}),
    ...categoryFilter,
  })
    .select('_id')
    .limit(MAX_ALERTS_PER_PHASE)
    .lean();

  await Ride.updateOne(
    { _id: ride._id },
    {
      $set: { 'publish.alerted_phase': phaseNumber },
      $addToSet: { 'publish.alerted_driver_ids': { $each: drivers.map((d) => d._id) } },
    },
  );
  if (!drivers.length) return 0;

  const built = await buildPayload(ride);
  const payload = socketPayload(ride, built);
  const { emitToDriver } = await dispatch();
  for (const driver of drivers) emitToDriver(driver._id, 'rideRequest', payload);

  // One data-only push per driver so the native ring card shows with the app closed.
  for (const driver of drivers) {
    sendPushNotificationToEntities({
      driverIds: [String(driver._id)],
      title: 'New ride on the network',
      body: ride.pickupAddress ? `Pickup: ${ride.pickupAddress}` : 'A ride was published for you.',
      dataOnly: true,
      data: {
        type: 'ride_request',
        rideId: String(ride._id),
        published: '1',
        isSecure: String(built.secure),
        serviceType: ride.serviceType || 'ride',
        userId: '',
        riderName: built.publisher.businessName,
        fare: String(Math.round(built.payout)),
        pickupAddress: ride.pickupAddress || '',
        dropAddress: ride.dropAddress || '',
        pickupDistanceKm: '',
        tripDistanceKm: ride.estimatedDistanceMeters ? (Number(ride.estimatedDistanceMeters) / 1000).toFixed(1) : '',
        vehicleLabel: ride.vehicleIconType || 'Ride',
        stopCount: String(ride.stopCount || 0),
        returnAt: '',
        expiresInSeconds: String(CARD_SECONDS),
      },
    }).catch(() => {});
  }
  return drivers.length;
};

/** Run every minute: starts the next phase's alerts for rides still inside the alert window. */
export const advancePublishedAlerts = async () => {
  const phases = await getTierPhases();
  const windowMs = phases ? phases.reduce((sum, phase) => sum + phase.minutes * 60 * 1000, 0) : 0;
  if (!windowMs) return;
  const now = Date.now();
  const rides = await Ride.find({
    origin: 'driver_created',
    'publish.status': 'open',
    'publish.is_published': true,
    'publish.published_at': { $gte: new Date(now - windowMs) },
    'publish.expires_at': { $gt: new Date(now) },
  })
    .select('_id')
    .limit(100)
    .lean();
  for (const { _id } of rides) {
    await alertPublishedRide(_id).catch((error) => console.error('[publishedAlert] phase alert failed:', error.message));
  }
};

/** The ride was taken, unpublished, cancelled or expired: close the open cards. */
export const closePublishedAlerts = async (ride, reason = 'closed') => {
  const ids = (ride?.publish?.alerted_driver_ids || []).map(String);
  if (!ids.length) return;
  const { emitToDriver, sendRideOfferClosedPush } = await dispatch();
  for (const id of ids) {
    emitToDriver(id, 'rideRequestClosed', { rideId: String(ride._id), reason });
    sendRideOfferClosedPush(id, ride._id);
  }
};

/**
 * Accept on a published ride's card means "send a request" (the publisher approves).
 * Returns true when it handled the ride that way.
 */
export const requestInsteadOfAccept = async ({ rideId, driverId }) => {
  const ride = await Ride.findById(rideId).select('origin publish.status').lean();
  if (!ride || ride.origin !== 'driver_created' || ride.publish?.status !== 'open') return false;
  const { requestPublishedRide } = await import('../driver/services/rideRequestService.js');
  await requestPublishedRide({ driverId, rideId });
  const { emitToDriver } = await dispatch();
  emitToDriver(driverId, 'feed:request:sent', { rideId: String(rideId) });
  return true;
};
