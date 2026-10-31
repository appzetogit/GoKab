import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { RIDE_STATUS } from '../../constants/index.js';
import { Owner } from '../../admin/models/Owner.js';
import { Ride } from '../../user/models/Ride.js';
import { Driver } from '../models/Driver.js';
import { RideRequest } from '../models/RideRequest.js';
import { emitToRoom, getFeedRoom } from '../../services/dispatchService.js';
import { findDriverConflictingScheduledRide, isRideScheduledForFuture } from '../../services/rideService.js';
import {
  notifyNetworkAssignment,
  notifyPublishedRideTaken,
  notifyRideRequestApproved,
  notifyRideRequestReceived,
  notifyRideRequestsRejected,
  notifyRideRequestWithdrawn,
} from '../../services/networkNotificationService.js';
import { holdForPublishedRide } from './escrowService.js';
import { claimPublishedRide, closeLeadConversationsForRide, isSecureRide } from './feedService.js';
import { toPublicImageUrl } from './publisherCardService.js';
import { driverDefaultVehicle } from './rideVehicleService.js';
import { getWalletSnapshot } from './walletService.js';

/**
 * Request → approve for published rides.
 *
 * A driver can no longer take a published ride outright: they ask for it
 * (optionally with a note), the publisher sees every applicant and approves
 * one. Approval runs the same guarded claim + escrow hold the old instant
 * accept did, for the approved driver. Approving one rejects the rest.
 */

export const MAX_PENDING_REQUESTS_PER_RIDE = 20;
export const MAX_REQUESTS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

const cleanText = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

const toObjectId = (value, field, code = 'RIDE_NOT_FOUND') => {
  if (!value || !mongoose.isValidObjectId(value)) {
    throw new ApiError(404, `${field} not found`, null, code);
  }
  return new mongoose.Types.ObjectId(String(value));
};

/** Requests belong to one publish of the ride; a republish starts a new list. */
const publishKey = (ride) => ride?.publish?.published_at || null;

const countPending = (ride, session = null) =>
  RideRequest.countDocuments({ ride_id: ride._id, published_at: publishKey(ride), status: 'pending' }).session(session);

const loadPublishedRide = async (rideId) => {
  const ride = await Ride.findById(toObjectId(rideId, 'Ride')).lean();
  if (!ride) throw new ApiError(404, 'Ride not found', null, 'RIDE_NOT_FOUND');
  return ride;
};

/** The publisher's own ride; anyone else gets a plain 404, not a 403 that confirms it exists. */
const loadOwnPublishedRide = async (rideId, publisherId) => {
  const ride = await loadPublishedRide(rideId);
  if (String(ride.created_by_driver_id || '') !== String(publisherId)) {
    throw new ApiError(404, 'Ride not found', null, 'RIDE_NOT_FOUND');
  }
  return ride;
};

const holdRequiredFor = (ride) => (isSecureRide(ride) ? Number(ride.publish?.owner_commission || 0) : 0);

const buildSnapshot = async (driver) => {
  // Counted once, when the request is made, not per listing.
  const trips = await Ride.countDocuments({ driverId: driver._id, status: RIDE_STATUS.COMPLETED });
  const vehicle = driverDefaultVehicle(driver);
  return {
    name: driver.name || '',
    phone: driver.phone || '',
    avatar: toPublicImageUrl(driver.profileImage),
    rating: Number(driver.ratingCount || 0) > 0 || Number(driver.rating || 0) > 0 ? Number(driver.rating || 0) : null,
    trips,
    vehicle: { number: vehicle.number, model: vehicle.model, type: vehicle.type },
  };
};

const SNAPSHOT_DRIVER_FIELDS =
  'name phone profileImage rating ratingCount vehicleNumber vehicleMake vehicleModel vehicleType vehicleColor assignedFleetVehicleId approve deletedAt wallet owner_id';

const serializeApplicant = (request) => ({
  driverId: String(request.driver_id),
  name: request.snapshot?.name || '',
  phone: request.snapshot?.phone || '',
  avatar: request.snapshot?.avatar || '',
  rating: request.snapshot?.rating ?? null,
  trips: request.snapshot?.trips || 0,
  vehicleModel: request.snapshot?.vehicle?.model || '',
  vehicleNumber: request.snapshot?.vehicle?.number || '',
  vehicleType: request.snapshot?.vehicle?.type || '',
  status: request.status,
  reason: request.reason || null,
  note: request.note || '',
  requestedAt: request.requested_at,
  reviewedAt: request.reviewed_at || null,
});

// ---------------------------------------------------------------------------
// Driver B: request / withdraw
// ---------------------------------------------------------------------------

/** POST /drivers/feed/rides/:rideId/request */
export const requestPublishedRide = async ({ driverId, rideId, note = '' }) => {
  const ride = await loadPublishedRide(rideId);
  const now = new Date();

  if (ride.origin !== 'driver_created') {
    throw new ApiError(409, 'Customer bookings are taken with Accept, not requested', null, 'NOT_A_PUBLISHED_RIDE');
  }
  if (String(ride.created_by_driver_id) === String(driverId)) {
    throw new ApiError(409, 'You published this ride', null, 'RIDE_NOT_OPEN');
  }
  if (ride.driverId || ride.publish?.status === 'taken') {
    throw new ApiError(409, 'Another driver already has this ride', null, 'RIDE_ALREADY_TAKEN');
  }
  if (
    ride.publish?.status !== 'open' ||
    ride.status !== RIDE_STATUS.SEARCHING ||
    !ride.publish?.expires_at ||
    new Date(ride.publish.expires_at) <= now
  ) {
    throw new ApiError(409, 'This ride is no longer open', null, 'RIDE_NOT_OPEN');
  }

  const driver = await Driver.findById(driverId).select(SNAPSHOT_DRIVER_FIELDS).lean();
  if (!driver || driver.deletedAt || driver.approve === false) {
    throw new ApiError(403, 'Your account cannot take rides right now', null, 'DRIVER_NOT_AVAILABLE');
  }

  const existing = await RideRequest.findOne({ ride_id: ride._id, driver_id: driverId, published_at: publishKey(ride) }).lean();
  if (existing && existing.status !== 'withdrawn') {
    throw new ApiError(
      409,
      existing.status === 'pending' ? 'You have already requested this ride' : 'You cannot request this ride again',
      { status: existing.status },
      'ALREADY_REQUESTED',
    );
  }

  const [pending, recent] = await Promise.all([
    countPending(ride),
    RideRequest.countDocuments({ driver_id: driverId, requested_at: { $gt: new Date(now.getTime() - HOUR_MS) } }),
  ]);
  if (pending >= MAX_PENDING_REQUESTS_PER_RIDE) {
    throw new ApiError(
      409,
      'This ride already has the maximum number of requests',
      { limit: MAX_PENDING_REQUESTS_PER_RIDE },
      'REQUEST_LIMIT_REACHED',
    );
  }
  if (recent >= MAX_REQUESTS_PER_HOUR) {
    throw new ApiError(429, 'Too many ride requests. Try again later.', { limit: MAX_REQUESTS_PER_HOUR }, 'RATE_LIMITED');
  }

  // Soft check only: the binding hold happens when the publisher approves.
  const holdRequired = holdRequiredFor(ride);
  if (holdRequired > 0) {
    const wallet = await getWalletSnapshot(driver);
    if (wallet.available < holdRequired) {
      throw new ApiError(
        402,
        `You need ₹${holdRequired} available to request this ride`,
        { required: holdRequired, available: wallet.available },
        'INSUFFICIENT_WALLET',
      );
    }
  }

  const fields = {
    publisher_driver_id: ride.created_by_driver_id,
    status: 'pending',
    reason: '',
    reason_text: '',
    note: cleanText(note, 300),
    requested_at: now,
    reviewed_at: null,
    snapshot: await buildSnapshot(driver),
  };

  let request;
  if (existing) {
    request = await RideRequest.findOneAndUpdate(
      { _id: existing._id, status: 'withdrawn' },
      { $set: fields },
      { returnDocument: 'after' },
    ).lean();
    if (!request) throw new ApiError(409, 'You have already requested this ride', null, 'ALREADY_REQUESTED');
  } else {
    try {
      request = (
        await RideRequest.create({ ride_id: ride._id, driver_id: driverId, published_at: publishKey(ride), ...fields })
      ).toObject();
    } catch (error) {
      if (error?.code === 11000) {
        throw new ApiError(409, 'You have already requested this ride', null, 'ALREADY_REQUESTED');
      }
      throw error;
    }
  }

  const applicantsCount = await countPending(ride);
  await notifyRideRequestReceived({ ride, request, applicantsCount }).catch((error) =>
    console.error('[rideRequest] publisher notification failed:', error.message),
  );

  return { requested: true, rideId: String(ride._id), status: 'pending', applicants_count: applicantsCount };
};

/** DELETE /drivers/feed/rides/:rideId/request */
export const withdrawRideRequest = async ({ driverId, rideId }) => {
  const ride = await loadPublishedRide(rideId);

  const withdrawn = await RideRequest.findOneAndUpdate(
    { ride_id: ride._id, driver_id: driverId, status: 'pending' },
    { $set: { status: 'withdrawn', reviewed_at: new Date() } },
    { returnDocument: 'after' },
  ).lean();
  if (!withdrawn) {
    throw new ApiError(404, 'You have no pending request for this ride', null, 'REQUEST_NOT_FOUND');
  }

  const applicantsCount = await countPending(ride);
  notifyRideRequestWithdrawn({ ride, driverId, applicantsCount });

  return { withdrawn: true, rideId: String(ride._id), applicants_count: applicantsCount };
};

// ---------------------------------------------------------------------------
// Publisher A: list / approve / reject
// ---------------------------------------------------------------------------

/** GET /drivers/network/rides/:rideId/applicants?status=pending|all */
export const listRideApplicants = async ({ driverId, rideId, status = 'pending' }) => {
  const ride = await loadOwnPublishedRide(rideId, driverId);
  if (!publishKey(ride)) return { results: [], total: 0 };

  const showAll = String(status || 'pending').trim().toLowerCase() === 'all';
  const requests = await RideRequest.find({
    ride_id: ride._id,
    published_at: publishKey(ride),
    ...(showAll ? {} : { status: 'pending' }),
  })
    .sort({ requested_at: 1, _id: 1 })
    .lean();

  // Applicants blocked or deleted since they asked are hidden.
  const usable = requests.length
    ? new Set(
        (
          await Driver.find({ _id: { $in: requests.map((request) => request.driver_id) }, deletedAt: null, approve: { $ne: false } })
            .select('_id')
            .lean()
        ).map((driver) => String(driver._id)),
      )
    : new Set();
  const results = requests.filter((request) => usable.has(String(request.driver_id))).map(serializeApplicant);

  return { results, total: results.length };
};

/**
 * Pending-request counts (and, for the publisher, the first few applicants)
 * for a page of rides, keyed by ride id. Counts only the ride's current publish.
 */
export const loadApplicantsForRides = async (rides, { withRequests = 0 } = {}) => {
  const open = (rides || []).filter((ride) => ride?.publish?.published_at);
  const map = new Map();
  if (!open.length) return map;

  const requests = await RideRequest.find({ ride_id: { $in: open.map((ride) => ride._id) }, status: 'pending' })
    .sort({ requested_at: 1, _id: 1 })
    .lean();

  for (const ride of open) {
    const key = new Date(ride.publish.published_at).getTime();
    const mine = requests.filter(
      (request) => String(request.ride_id) === String(ride._id) && new Date(request.published_at).getTime() === key,
    );
    map.set(String(ride._id), {
      count: mine.length,
      requests: withRequests ? mine.slice(0, withRequests).map(serializeApplicant) : undefined,
    });
  }
  return map;
};

/** This driver's request state on each of a page of feed rides, keyed by ride id. */
export const loadMyRequestStates = async (driverId, rides) => {
  const map = new Map();
  if (!rides?.length) return map;
  const requests = await RideRequest.find({ driver_id: driverId, ride_id: { $in: rides.map((ride) => ride._id) } })
    .select('ride_id published_at status')
    .lean();
  for (const ride of rides) {
    const key = ride.publish?.published_at ? new Date(ride.publish.published_at).getTime() : null;
    const match = requests.find(
      (request) => String(request.ride_id) === String(ride._id) && new Date(request.published_at).getTime() === key,
    );
    if (match) map.set(String(ride._id), match.status);
  }
  return map;
};

const markRequestRejected = async (requestId, reason, reasonText = '') =>
  RideRequest.updateOne(
    { _id: requestId, status: 'pending' },
    { $set: { status: 'rejected', reason, reason_text: cleanText(reasonText, 200), reviewed_at: new Date() } },
  );

/** POST /drivers/network/rides/:rideId/applicants/:driverId/approve */
export const approveRideApplicant = async ({ driverId, rideId, applicantId }) => {
  const ride = await loadOwnPublishedRide(rideId, driverId);
  const applicantObjectId = toObjectId(applicantId, 'Request', 'REQUEST_NOT_FOUND');

  const request = await RideRequest.findOne({
    ride_id: ride._id,
    driver_id: applicantObjectId,
    published_at: publishKey(ride),
  }).lean();
  if (!request) throw new ApiError(404, 'This driver has not requested the ride', null, 'REQUEST_NOT_FOUND');
  if (request.status !== 'pending') {
    throw new ApiError(409, 'This request is no longer pending', { status: request.status }, 'APPLICANT_NOT_PENDING');
  }

  const applicant = await Driver.findById(applicantObjectId).select(SNAPSHOT_DRIVER_FIELDS).lean();
  if (!applicant || applicant.deletedAt || applicant.approve === false) {
    await markRequestRejected(request._id, 'driver_unavailable');
    throw new ApiError(409, 'This driver can no longer take rides', null, 'APPLICANT_UNAVAILABLE');
  }

  // Approval can come hours after the request; the applicant may have taken
  // another trip in that window since.
  const conflict = await findDriverConflictingScheduledRide({ driverId: applicant._id, ride, excludeRideId: ride._id });
  if (conflict) {
    throw new ApiError(
      409,
      'This driver now has another trip in this time range',
      { conflictingRideId: String(conflict._id) },
      'APPLICANT_BUSY',
    );
  }

  const otherRequestIds = (
    await RideRequest.find({
      ride_id: ride._id,
      published_at: publishKey(ride),
      status: 'pending',
      _id: { $ne: request._id },
    })
      .select('_id driver_id')
      .lean()
  );

  const session = await mongoose.startSession();
  let claimed = null;
  let secure = false;
  let applicantWalletLow = false;
  try {
    session.startTransaction();

    // The applicant's own vehicle goes on the ride, like any other assignment.
    claimed = await claimPublishedRide({
      ride,
      driverId: applicant._id,
      approvedByDriverId: driverId,
      session,
      vehicle: driverDefaultVehicle(applicant),
    });
    if (!claimed) {
      throw new ApiError(409, 'This ride is no longer open', null, 'RIDE_ALREADY_TAKEN');
    }

    const approved = await RideRequest.updateOne(
      { _id: request._id, status: 'pending' },
      { $set: { status: 'approved', reviewed_at: new Date() } },
      { session },
    );
    if (!approved.modifiedCount) {
      // Withdrawn a moment ago: nothing was given to anyone.
      throw new ApiError(409, 'This driver just withdrew their request', null, 'APPLICANT_NOT_PENDING');
    }

    if (otherRequestIds.length) {
      await RideRequest.updateMany(
        { _id: { $in: otherRequestIds.map((item) => item._id) }, status: 'pending' },
        { $set: { status: 'rejected', reason: 'ride_taken', reviewed_at: new Date() } },
        { session },
      );
    }

    secure = isSecureRide(claimed);
    if (secure) {
      try {
        await holdForPublishedRide({ ride: claimed, session });
      } catch (error) {
        // Only the applicant's side failing is the applicant's problem; a short
        // publisher wallet is the publisher's to fix and rejects nobody.
        if (error?.code === 'INSUFFICIENT_WALLET') applicantWalletLow = true;
        throw error;
      }
    }

    if (!isRideScheduledForFuture(claimed)) {
      const busy = await Driver.findOneAndUpdate(
        { _id: applicant._id, isOnRide: { $ne: true } },
        { $set: { isOnRide: true } },
        { session },
      );
      if (!busy) {
        throw new ApiError(409, 'This driver is on another trip right now', null, 'APPLICANT_BUSY');
      }
    }

    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();

    if (applicantWalletLow) {
      // The whole approval rolled back; the ride stays open and the other
      // requests stay pending. Only this applicant is turned away.
      await markRequestRejected(request._id, 'insufficient_wallet');
      await notifyRideRequestsRejected({ ride, driverIds: [applicant._id], reason: 'insufficient_wallet' }).catch(() => {});
      throw new ApiError(
        402,
        "This driver doesn't have enough wallet balance for the escrow hold. Choose another driver.",
        { driverId: String(applicant._id) },
        'APPLICANT_WALLET_LOW',
      );
    }
    throw error;
  } finally {
    session.endSession();
  }

  // The ride is given from here on: nothing below may turn that into an error.
  const afterCommit = async (label, step) => {
    try {
      await step();
    } catch (error) {
      console.error(`[rideRequest] approve ${claimed._id}: ${label} failed:`, error?.message || error);
    }
  };

  emitToRoom(getFeedRoom(claimed.service_location_id), 'feed:driver:removed', {
    rideId: String(claimed._id),
    reason: 'TAKEN',
  });

  const publisher = await Driver.findById(driverId).select('name owner_id').lean();
  const organization = claimed.organization_owner_id
    ? await Owner.findById(claimed.organization_owner_id).select('company_name').lean()
    : null;

  await afterCommit('approved notification', () =>
    notifyRideRequestApproved({
      ride: claimed,
      driverId: applicant._id,
      publisherName: organization?.company_name || publisher?.name,
    }),
  );
  await afterCommit('rejected notifications', () =>
    notifyRideRequestsRejected({ ride: claimed, driverIds: otherRequestIds.map((item) => item.driver_id), reason: 'ride_taken' }),
  );
  await afterCommit('publisher notification', () =>
    notifyPublishedRideTaken({
      ride: claimed,
      acceptorDriverId: applicant._id,
      held: secure ? claimed.publish?.driver_payout || 0 : 0,
      isSecure: secure,
    }),
  );
  await afterCommit('closing lead conversations', () => closeLeadConversationsForRide(claimed._id, 'RIDE_TAKEN'));
  await afterCommit('assignment notification', () => notifyNetworkAssignment(claimed));

  const { serializeNetworkRide } = await import('./networkRideService.js');
  return {
    ...serializeNetworkRide(claimed, { assignedDriver: applicant, applicants: { count: 0, requests: [] } }),
    escrow_result: secure ? 'held' : 'none',
    is_secure: secure,
  };
};

/** POST /drivers/network/rides/:rideId/applicants/:driverId/reject */
export const rejectRideApplicant = async ({ driverId, rideId, applicantId, reason = '' }) => {
  const ride = await loadOwnPublishedRide(rideId, driverId);
  const applicantObjectId = toObjectId(applicantId, 'Request', 'REQUEST_NOT_FOUND');

  const request = await RideRequest.findOne({
    ride_id: ride._id,
    driver_id: applicantObjectId,
    published_at: publishKey(ride),
  }).lean();
  if (!request) throw new ApiError(404, 'This driver has not requested the ride', null, 'REQUEST_NOT_FOUND');

  const reasonText = cleanText(reason, 200);
  const result = await markRequestRejected(request._id, 'publisher_rejected', reasonText);
  if (!result.modifiedCount) {
    throw new ApiError(409, 'This request is no longer pending', { status: request.status }, 'APPLICANT_NOT_PENDING');
  }

  await notifyRideRequestsRejected({
    ride,
    driverIds: [request.driver_id],
    reason: 'publisher_rejected',
    reasonText,
  }).catch(() => {});

  return { rejected: true, rideId: String(ride._id), applicants_count: await countPending(ride) };
};

/**
 * Ends every pending request on a ride (unpublished, expired, cancelled,
 * taken) and tells the applicants why. Safe to call when there are none.
 */
export const rejectPendingRequestsForRide = async ({ ride, reason }) => {
  if (!ride?._id) return { rejected: 0 };
  const pending = await RideRequest.find({ ride_id: ride._id, status: 'pending' }).select('_id driver_id').lean();
  if (!pending.length) return { rejected: 0 };

  await RideRequest.updateMany(
    { _id: { $in: pending.map((item) => item._id) }, status: 'pending' },
    { $set: { status: 'rejected', reason, reviewed_at: new Date() } },
  );
  await notifyRideRequestsRejected({ ride, driverIds: pending.map((item) => item.driver_id), reason }).catch(() => {});
  return { rejected: pending.length };
};
