import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { Ride } from '../user/models/Ride.js';
import { User } from '../user/models/User.js';
import { UserWallet } from '../user/models/UserWallet.js';
import { Driver } from '../driver/models/Driver.js';
import { WalletTransaction } from '../driver/models/WalletTransaction.js';
import { applyDriverWalletAdjustment } from '../driver/services/walletService.js';
import { matchDrivers, findZoneByPickup } from './matchingService.js';
import { categoryOf, getTierPhases, phaseCategories, withoutTeamMembers } from './tierPhaseService.js';
import {
  RIDE_LIVE_STATUS,
  RIDE_STATUS,
} from '../constants/index.js';
import { getRideRoom, getScheduledDispatchLeadMs, resolveSetPriceForRide } from './rideService.js';
import { releasePromoForCancelledRide } from './promoService.js';
import { SOCKET_EVENTS } from '../socket/events.js';
import { resolveTransportDispatchConfig } from './transportSettingsService.js';
import { sendPushNotificationToEntities } from './pushNotificationService.js';
import { Vehicle } from '../admin/models/Vehicle.js';
import { haversineMeters } from '../../../utils/geo.js';

const activeDispatches = new Map();
let ioInstance = null;
const scheduledDispatchTimers = new Map();

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const ensureUserWallet = async (userId, session = null) => {
  if (!userId) {
    return;
  }

  await UserWallet.updateOne(
    { userId },
    { $setOnInsert: { userId, balance: 0, refundWallet: 0, transactions: [] } },
    { upsert: true, session },
  );
};

const normalizeRideTransportType = (ride) => {
  const serviceType = String(ride?.serviceType || '').trim().toLowerCase();
  const transportType = String(ride?.transport_type || '').trim().toLowerCase();

  if (serviceType === 'intercity') {
    return 'intercity';
  }

  if (transportType === 'all' || transportType === 'both' || !transportType) {
    return 'taxi';
  }

  return transportType;
};

const computeCancellationFeeAmount = ({ ride, feeType, feeValue }) => {
  const baseAmount = Math.max(roundMoney(ride?.fare || 0), roundMoney(ride?.baseFare || 0), 0);
  const normalizedValue = Math.max(roundMoney(feeValue || 0), 0);
  const normalizedType = String(feeType || 'percentage').trim().toLowerCase();

  if (normalizedValue <= 0) {
    return 0;
  }

  if (normalizedType === 'fixed') {
    return normalizedValue;
  }

  return Math.min(roundMoney((baseAmount * normalizedValue) / 100), baseAmount);
};

const resolveCancellationPricing = async (ride, session) => {
  if (!ride?.vehicleTypeId) {
    return null;
  }

  const pickupCoords = ride.pickupLocation?.coordinates || null;
  const pickupZone = pickupCoords ? await findZoneByPickup(pickupCoords).catch(() => null) : null;

  return resolveSetPriceForRide({
    serviceLocationId: ride.service_location_id || null,
    transportType: normalizeRideTransportType(ride),
    vehicleTypeId: ride.vehicleTypeId,
    zoneId: pickupZone?._id || null,
  });
};

const applyUserWalletAdjustment = async ({
  userId,
  amount,
  kind,
  title,
  referenceKey,
  walletField = 'balance',
  provider = 'ride_cancellation',
  session = null,
  requireSufficientFunds = false,
}) => {
  const normalizedAmount = roundMoney(amount);
  const normalizedKind = kind === 'debit' ? 'debit' : 'credit';
  const normalizedField = walletField === 'refundWallet' ? 'refundWallet' : 'balance';
  const normalizedReferenceKey = String(referenceKey || '').trim();

  if (!userId || normalizedAmount <= 0 || !normalizedReferenceKey) {
    return { status: 'skipped', amount: 0 };
  }

  await ensureUserWallet(userId, session);

  const existing = await UserWallet.findOne({
    userId,
    'transactions.referenceKey': normalizedReferenceKey,
  })
    .select('_id')
    .session(session)
    .lean();

  if (existing) {
    return { status: 'existing', amount: normalizedAmount };
  }

  const tx = {
    kind: normalizedKind,
    amount: normalizedAmount,
    title: String(title || '').trim(),
    provider,
    referenceKey: normalizedReferenceKey,
  };

  const updateFilter = { userId };
  if (normalizedKind === 'debit' && requireSufficientFunds) {
    updateFilter[normalizedField] = { $gte: normalizedAmount };
  }

  const updateResult = await UserWallet.updateOne(
    updateFilter,
    {
      $inc: { [normalizedField]: normalizedKind === 'credit' ? normalizedAmount : -normalizedAmount },
      $push: { transactions: { $each: [tx], $slice: -50 } },
    },
    { session },
  );

  if (!updateResult?.modifiedCount) {
    return { status: requireSufficientFunds ? 'insufficient_funds' : 'not_modified', amount: normalizedAmount };
  }

  return { status: 'applied', amount: normalizedAmount };
};

const applyDriverWalletAdjustmentByReference = async ({
  driverId,
  amount,
  rideId = null,
  description,
  referenceKey,
  metadata = {},
  session = null,
}) => {
  const normalizedAmount = roundMoney(amount);
  const normalizedReferenceKey = String(referenceKey || '').trim();

  if (!driverId || !normalizedAmount || !normalizedReferenceKey) {
    return { status: 'skipped', amount: normalizedAmount, walletResult: null };
  }

  const existing = await WalletTransaction.findOne({
    driverId,
    'metadata.referenceKey': normalizedReferenceKey,
  })
    .select('_id')
    .session(session)
    .lean();

  if (existing) {
    return { status: 'existing', amount: normalizedAmount, walletResult: null };
  }

  const walletResult = await applyDriverWalletAdjustment({
    driverId,
    amount: normalizedAmount,
    type: 'adjustment',
    rideId,
    description,
    metadata: {
      ...metadata,
      referenceKey: normalizedReferenceKey,
    },
    session,
  });

  return { status: 'applied', amount: normalizedAmount, walletResult };
};

const recordUserDue = async ({ userId, amount, title, rideId, payeeDriverId, referenceKey, session = null }) => {
  const normalizedAmount = roundMoney(amount);
  const normalizedReferenceKey = String(referenceKey || '').trim();

  if (!userId || normalizedAmount <= 0 || !normalizedReferenceKey) {
    return { status: 'skipped' };
  }

  await ensureUserWallet(userId, session);

  // Cancelling the same ride twice must not stack the same fee.
  const result = await UserWallet.updateOne(
    { userId, 'outstandingDues.referenceKey': { $ne: normalizedReferenceKey } },
    {
      $push: {
        outstandingDues: {
          amount: normalizedAmount,
          reason: 'ride_cancellation_fee',
          title: String(title || '').trim(),
          rideId: rideId || null,
          payeeDriverId: payeeDriverId || null,
          referenceKey: normalizedReferenceKey,
        },
      },
    },
    { session },
  );

  return { status: result?.modifiedCount ? 'recorded' : 'existing', amount: normalizedAmount };
};

// Collects everything the rider still owes, oldest first, as far as their
// balance stretches. Called before a new booking so a rider who has since topped
// up settles automatically, and any driver owed a cancellation fee is paid then.
export const settleOutstandingUserDues = async (userId) => {
  if (!userId) {
    return { collected: 0, remainingDues: 0, remainingAmount: 0 };
  }

  const wallet = await UserWallet.findOne({ userId }).select('balance outstandingDues').lean();
  const dues = Array.isArray(wallet?.outstandingDues) ? wallet.outstandingDues : [];

  if (dues.length === 0) {
    return { collected: 0, remainingDues: 0, remainingAmount: 0 };
  }

  let collected = 0;

  for (const due of [...dues].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))) {
    const amount = roundMoney(due.amount);

    if (amount <= 0) {
      await UserWallet.updateOne({ userId }, { $pull: { outstandingDues: { _id: due._id } } });
      continue;
    }

    const debit = await applyUserWalletAdjustment({
      userId,
      amount,
      kind: 'debit',
      title: due.title || 'Outstanding ride cancellation fee',
      referenceKey: `${due.referenceKey}:user-debit`,
      requireSufficientFunds: true,
    });

    if (!['applied', 'existing'].includes(debit.status)) {
      // Balance ran out — leave this and the rest owing.
      break;
    }

    if (due.payeeDriverId) {
      await applyDriverWalletAdjustmentByReference({
        driverId: due.payeeDriverId,
        amount,
        rideId: due.rideId,
        description: due.title || 'Cancellation fee received',
        referenceKey: `${due.referenceKey}:driver-credit`,
        metadata: {
          source: 'ride_cancellation_fee',
          cancelledBy: 'user',
          counterpartyRole: 'user',
          counterpartyId: String(userId),
          settledFromDues: true,
        },
      });
    }

    await UserWallet.updateOne({ userId }, { $pull: { outstandingDues: { _id: due._id } } });
    collected = roundMoney(collected + amount);
  }

  const after = await UserWallet.findOne({ userId }).select('outstandingDues').lean();
  const remaining = Array.isArray(after?.outstandingDues) ? after.outstandingDues : [];

  return {
    collected,
    remainingDues: remaining.length,
    remainingAmount: roundMoney(remaining.reduce((sum, due) => sum + Number(due.amount || 0), 0)),
  };
};

// Single gate for every rider-initiated booking: collect whatever they now can
// pay, and refuse the booking while anything is still owed. Must be called
// before the rider is charged for the new booking, never after — being blocked
// after paying would be worse than not being blocked at all.
export const assertNoOutstandingUserDues = async (userId) => {
  const dues = await settleOutstandingUserDues(userId);

  if (dues.remainingAmount > 0) {
    throw new ApiError(
      402,
      `Please clear your outstanding balance of ${dues.remainingAmount} to book a new ride.`,
      { outstandingAmount: dues.remainingAmount, outstandingDues: dues.remainingDues },
    );
  }

  return dues;
};

const settleUserCancellationFee = async (ride, session) => {
  const pricing = await resolveCancellationPricing(ride, session);
  const feeAmount = computeCancellationFeeAmount({
    ride,
    feeType: pricing?.user_cancellation_fee_type,
    feeValue: pricing?.user_cancellation_fee,
  });

  if (feeAmount <= 0) {
    return { feeAmount: 0, userDebitStatus: 'none', driverCreditStatus: 'none', driverWalletResult: null };
  }

  const feeReferenceBase = `ride-cancel:user:${String(ride._id)}`;
  const userDebit = await applyUserWalletAdjustment({
    userId: ride.userId,
    amount: feeAmount,
    kind: 'debit',
    title: `Ride cancellation fee for booking ${String(ride._id).slice(-6)}`,
    referenceKey: `${feeReferenceBase}:user-debit`,
    session,
    requireSufficientFunds: true,
  });

  const feeGoesToDriver = String(pricing?.cancellation_fee_goes_to || 'admin').trim().toLowerCase() === 'driver';

  // The rider's wallet is deliberately non-negative, so a rider with no balance
  // cannot be debited here. Recording the shortfall as a due keeps the charge on
  // the books — it is collected the next time they book (see
  // `settleOutstandingUserDues`) instead of being written off silently.
  if (userDebit.status === 'insufficient_funds') {
    await recordUserDue({
      userId: ride.userId,
      amount: feeAmount,
      title: `Ride cancellation fee for booking ${String(ride._id).slice(-6)}`,
      rideId: ride._id,
      payeeDriverId: feeGoesToDriver ? ride.driverId : null,
      referenceKey: feeReferenceBase,
      session,
    });

    return {
      feeAmount,
      userDebitStatus: 'deferred_to_dues',
      driverCreditStatus: 'deferred',
      driverWalletResult: null,
    };
  }

  let driverCredit = { status: 'skipped', walletResult: null };
  const shouldCreditDriver =
    ['applied', 'existing'].includes(userDebit.status) &&
    feeGoesToDriver &&
    ride.driverId;

  if (shouldCreditDriver) {
    driverCredit = await applyDriverWalletAdjustmentByReference({
      driverId: ride.driverId,
      amount: feeAmount,
      rideId: ride._id,
      description: `Cancellation fee received for booking ${String(ride._id).slice(-6)}`,
      referenceKey: `${feeReferenceBase}:driver-credit`,
      metadata: {
        source: 'ride_cancellation_fee',
        cancelledBy: 'user',
        counterpartyRole: 'user',
        counterpartyId: String(ride.userId),
      },
      session,
    });
  }

  return {
    feeAmount,
    userDebitStatus: userDebit.status,
    driverCreditStatus: driverCredit.status,
    driverWalletResult: driverCredit.walletResult || null,
  };
};

const settleDriverCancellationFee = async (ride, session) => {
  const pricing = await resolveCancellationPricing(ride, session);
  const feeAmount = computeCancellationFeeAmount({
    ride,
    feeType: pricing?.driver_cancellation_fee_type,
    feeValue: pricing?.driver_cancellation_fee,
  });

  if (feeAmount <= 0 || !ride?.driverId) {
    return { feeAmount: 0, driverDebitStatus: 'none', userCreditStatus: 'none', driverWalletResult: null };
  }

  const feeReferenceBase = `ride-cancel:driver:${String(ride._id)}`;
  const driverDebit = await applyDriverWalletAdjustmentByReference({
    driverId: ride.driverId,
    amount: -feeAmount,
    rideId: ride._id,
    description: `Scheduled ride cancellation fee for booking ${String(ride._id).slice(-6)}`,
    referenceKey: `${feeReferenceBase}:driver-debit`,
    metadata: {
      source: 'ride_cancellation_fee',
      cancelledBy: 'driver',
      counterpartyRole: 'user',
      counterpartyId: String(ride.userId),
    },
    session,
  });

  let userCredit = { status: 'skipped' };
  if (['applied', 'existing'].includes(driverDebit.status) && ride.userId) {
    userCredit = await applyUserWalletAdjustment({
      userId: ride.userId,
      amount: feeAmount,
      kind: 'credit',
      title: `Driver cancellation compensation for booking ${String(ride._id).slice(-6)}`,
      referenceKey: `${feeReferenceBase}:user-credit`,
      walletField: 'refundWallet',
      provider: 'ride_cancellation_refund',
      session,
    });
  }

  return {
    feeAmount,
    driverDebitStatus: driverDebit.status,
    userCreditStatus: userCredit.status,
    driverWalletResult: driverDebit.walletResult || null,
  };
};

// Ride documents reach these helpers both populated and unpopulated. Interpolating
// a populated subdocument yields its inspect dump instead of the id, which silently
// produces a room nobody has joined — the emit then goes nowhere with no error.
const toEntityId = (value) => String(value?._id ?? value ?? '');

export const getUserRoom = (userId) => `user:${toEntityId(userId)}`;
export const getDriverRoom = (driverId) => `driver:${toEntityId(driverId)}`;
export const getAdminRoom = () => 'admin:broadcast';
// Driver-network rooms. `org:` is everyone watching one organisation's fleet,
// `publisher:` is one driver watching the rides they published out to the
// network, and `feed:city:` carries new leads to every driver in a city.
export const getOrgRoom = (ownerId) => `org:${toEntityId(ownerId)}`;
export const getPublisherRoom = (driverId) => `publisher:${toEntityId(driverId)}`;
export const getFeedRoom = (serviceLocationId) => `feed:city:${toEntityId(serviceLocationId)}`;

export const setSocketServer = (io) => {
  ioInstance = io;
};

export const joinRideRoom = (socket, rideId) => {
  socket.join(getRideRoom(rideId));
};

export const addSocketSubscriptions = (socket, { role, entityId }) => {
  if (role === 'admin') {
    socket.join(getAdminRoom());
    return;
  }

  if (role === 'user') {
    socket.join(getUserRoom(entityId));
    return;
  }

  if (role === 'driver') {
    socket.join(getDriverRoom(entityId));
    // Joined asynchronously: the driver is already connected, and failing to
    // resolve their org must not tear down the socket.
    joinDriverNetworkRooms(socket, entityId).catch((error) => {
      console.error('[dispatchService] network room join failed:', error.message);
    });
  }

  if (role === 'owner') {
    socket.join(getOrgRoom(entityId));
  }
};

/**
 * Puts a driver socket into the rooms their network role needs: always their
 * own publisher room, plus the organisation room when they own a fleet, and
 * their city's lead feed.
 */
const joinDriverNetworkRooms = async (socket, driverId) => {
  socket.join(getPublisherRoom(driverId));

  const driver = await Driver.findById(driverId).select('owner_id service_location_id').lean();
  if (!driver) return;

  if (driver.owner_id) socket.join(getOrgRoom(driver.owner_id));
  if (driver.service_location_id) socket.join(getFeedRoom(driver.service_location_id));
};

const getDispatchVehicleTypeIds = (ride) => {
  const ids = [
    ...(Array.isArray(ride.dispatchVehicleTypeIds) ? ride.dispatchVehicleTypeIds : []),
    ride.vehicleTypeId,
  ];

  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
};

// Maps a ride back to the `taxiridemodules` code so matchDrivers can gate
// dispatch by a driver's subscription-tier module access. Ride/serviceType
// doesn't currently distinguish an airport drop from a plain city ride, so
// airport bookings are matched as 'city' until that gets its own field.
const getRideModuleCode = (ride) => {
  const serviceType = String(ride?.serviceType || 'ride').toLowerCase();
  if (serviceType === 'intercity') return 'outstation';
  return 'city';
};

const emitToSocket = (socketId, event, payload) => {
  if (ioInstance && socketId) {
    ioInstance.to(socketId).emit(event, payload);
  }
};

const recentClosedPushes = new Map();

/**
 * Takes a driver's native ride-offer card down. The socket event only reaches an
 * app that is awake, which is exactly when the card is not needed.
 */
export const sendRideOfferClosedPush = (driverId, rideId) => {
  if (!driverId || !rideId) return;
  const key = `${driverId}:${rideId}`;
  const now = Date.now();
  // Several code paths close the same offer; one push is enough.
  if (now - (recentClosedPushes.get(key) || 0) < 10_000) return;
  recentClosedPushes.set(key, now);
  if (recentClosedPushes.size > 500) {
    for (const [k, t] of recentClosedPushes) if (now - t > 10_000) recentClosedPushes.delete(k);
  }
  sendPushNotificationToEntities({
    driverIds: [String(driverId)],
    title: 'Ride request closed',
    body: 'This booking is no longer available.',
    dataOnly: true,
    data: { type: 'ride_request_closed', rideId: String(rideId) },
  }).catch(() => {});
};

export const emitToRoom = (room, event, payload) => {
  if (ioInstance) {
    ioInstance.to(room).emit(event, payload);
  }
  if (event === 'rideRequestClosed' && typeof room === 'string' && room.startsWith('driver:')) {
    sendRideOfferClosedPush(room.slice('driver:'.length), payload?.rideId);
  }
};

export const notifyUserAccountDeleted = (userId) => {
  if (!userId) return;
  emitToRoom(getUserRoom(userId), 'account:deleted', {
    reason: 'delete_request_approved',
  });
};

export const emitToDriver = (driverId, event, payload) => {
  if (driverId) {
    emitToRoom(getDriverRoom(driverId), event, payload);
  }
};

export const emitToAdmins = (event, payload) => {
  emitToRoom(getAdminRoom(), event, payload);
};

const clearDispatchTimer = (rideId) => {
  const state = activeDispatches.get(String(rideId));

  if (state?.timer) {
    clearTimeout(state.timer);
  }
};

const clearScheduledDispatchTimer = (rideId) => {
  const key = String(rideId);
  const timer = scheduledDispatchTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    scheduledDispatchTimers.delete(key);
  }
};

export const stopDispatchFlow = (rideId) => {
  clearDispatchTimer(rideId);
  clearScheduledDispatchTimer(rideId);
  activeDispatches.delete(String(rideId));
};

export const restartRideDispatchWithLatestFare = async (rideId) => {
  if (!rideId) {
    return;
  }

  const state = getDispatchState(rideId);
  closeDriverRequestWindow(rideId, [
    ...state.driverIds,
    ...state.notifiedDriverIds,
    ...state.rejectedDriverIds,
  ]);
  stopDispatchFlow(rideId);

  const ride = await Ride.findById(rideId).populate('userId', 'name phone countryCode');
  if (!ride || ride.status !== RIDE_STATUS.SEARCHING || ride.liveStatus !== RIDE_LIVE_STATUS.SEARCHING) {
    return;
  }

  await startDispatchFlow(ride);
};

const getDispatchState = (rideId) => {
  const rideKey = String(rideId);
  const state = activeDispatches.get(rideKey) || {};

  return {
    radiusIndex: Number.isInteger(state.radiusIndex) ? state.radiusIndex : 0,
    timer: state.timer || null,
    driverIds: Array.isArray(state.driverIds) ? state.driverIds : [],
    notifiedDriverIds: Array.isArray(state.notifiedDriverIds) ? state.notifiedDriverIds : [],
    rejectedDriverIds: Array.isArray(state.rejectedDriverIds) ? state.rejectedDriverIds : [],
  };
};

const saveDispatchState = (rideId, nextState = {}) => {
  const rideKey = String(rideId);
  const currentState = getDispatchState(rideKey);

  activeDispatches.set(rideKey, {
    ...currentState,
    ...nextState,
  });

  return activeDispatches.get(rideKey);
};

const closeDriverRequestWindow = (rideId, driverIds = []) => {
  const safeDriverIds = [...new Set((Array.isArray(driverIds) ? driverIds : []).map((id) => String(id || '')).filter(Boolean))];

  for (const driverId of safeDriverIds) {
    emitToDriver(driverId, 'rideRequestClosed', {
      rideId: String(rideId),
      reason: 'search-window-expired',
    });
  }
};

const emitRideRequestToDrivers = async ({
  ride,
  targetDrivers = [],
  zone = null,
  effectiveRadius = 0,
  dispatchVehicleTypeIds = [],
  dispatchConfig,
  attemptIndex = 0,
}) => {
  if (!ride || !targetDrivers.length) {
    return;
  }

  const requestExpiresAt = new Date(Date.now() + dispatchConfig.retryDelayMs).toISOString();
  // Set for an airport / railway carpool: riders so far, this seat's fare, and the most the trip can pay.
  const carpoolInfo = ride.carpool?.enabled
    ? await import('./carpoolService.js').then((m) => m.requestCardInfo(ride)).catch(() => null)
    : null;

  for (const driver of targetDrivers) {
    emitToDriver(driver._id, 'rideRequest', {
      rideId: String(ride._id),
      type: ride.serviceType || 'ride',
      serviceType: ride.serviceType || 'ride',
      // `ride.userId` is populated on this path, so it must be unwrapped to the id.
      userId: toEntityId(ride.userId),
      user: {
        id: ride.userId?._id ? String(ride.userId._id) : String(ride.userId || ''),
        name: ride.userId?.name || 'Customer',
        phone: ride.userId?.phone || '',
        countryCode: ride.userId?.countryCode || '',
      },
      pickupLocation: ride.pickupLocation,
      pickupAddress: ride.pickupAddress || '',
      dropLocation: ride.dropLocation,
      dropAddress: ride.dropAddress || '',
      scheduledAt: ride.scheduledAt || null,
      roundTrip: ride.roundTrip?.isRoundTrip ? { isRoundTrip: true, legType: ride.roundTrip.legType, returnAt: ride.roundTrip.returnAt } : null,
      estimatedDistanceMeters: ride.estimatedDistanceMeters || 0,
      estimatedDurationMinutes: ride.estimatedDurationMinutes || 0,
      vehicleTypeId: ride.vehicleTypeId ? String(ride.vehicleTypeId) : null,
      vehicleTypeIds: dispatchVehicleTypeIds,
      vehicleIconType: ride.vehicleIconType,
      vehicleIconUrl: ride.vehicleIconUrl || '',
      fare: ride.fare,
      baseFare: Number(ride.baseFare || ride.fare || 0),
      bookingMode: ride.bookingMode || 'normal',
      pricingNegotiationMode: ride.pricingNegotiationMode || 'none',
      biddingStatus: ride.biddingStatus || 'none',
      bidding: ride.pricingNegotiationMode === 'driver_bid'
        ? {
            enabled: true,
            baseFare: Number(ride.baseFare || ride.fare || 0),
            bidFloorFare: Number(ride.bidFloorFare ?? ride.baseFare ?? ride.fare ?? 0),
            userMaxBidFare: Number(ride.userMaxBidFare || ride.fare || 0),
            bidCeilingMaxFare: Number(ride.bidCeilingMaxFare || ride.userMaxBidFare || ride.fare || 0),
            bidStepAmount: Number(ride.bidStepAmount || 10),
          }
        : {
            enabled: false,
          },
      fareIncreaseWaitMinutes: Number(ride.fareIncreaseWaitMinutes || 0),
      nextFareIncreaseAt: ride.nextFareIncreaseAt || null,
      paymentMethod: ride.paymentMethod,
      intercity: ride.intercity || null,
      stopCount: ride.stopCount || 0,
      carpool: carpoolInfo,
      radius: effectiveRadius,
      attempt: attemptIndex + 1,
      maxAttempts: dispatchConfig.maxAttempts,
      acceptRejectDurationSeconds: dispatchConfig.retryWindowSeconds,
      expiresInSeconds: dispatchConfig.retryWindowSeconds,
      requestExpiresAt,
      zoneId: zone?._id ? String(zone._id) : null,
    });
  }

  // One push per driver: the card shows how far *this* driver is from pickup.
  // Data-only, so the app's native service gets it even when the app is killed;
  // everything the card draws has to be in `data` (nothing can be fetched then).
  const vehicle = ride.vehicleTypeId
    ? await Vehicle.findById(ride.vehicleTypeId).select('name').lean().catch(() => null)
    : null;
  const km = (meters) => (Number.isFinite(Number(meters)) && Number(meters) >= 0 ? (Number(meters) / 1000).toFixed(1) : '');
  for (const driver of targetDrivers) {
    sendPushNotificationToEntities({
      driverIds: [String(driver._id)],
      title: 'New ride request',
      body: ride.pickupAddress ? `Pickup: ${ride.pickupAddress}` : 'A new booking is waiting for your response.',
      dataOnly: true,
      data: {
        type: 'ride_request',
        rideId: String(ride._id),
        serviceType: ride.serviceType || 'ride',
        userId: String(ride.userId?._id || ride.userId || ''),
        riderName: ride.userId?.name || 'Customer',
        fare: String(Math.round(Number(ride.fare) || 0)),
        pickupAddress: ride.pickupAddress || '',
        dropAddress: ride.dropAddress || '',
        pickupDistanceKm:
          driver?.location?.coordinates?.length === 2 && ride.pickupLocation?.coordinates?.length === 2
            ? km(haversineMeters(driver.location.coordinates, ride.pickupLocation.coordinates))
            : '',
        tripDistanceKm: km(ride.estimatedDistanceMeters),
        vehicleLabel: vehicle?.name || ride.vehicleIconType || 'Ride',
        stopCount: String(ride.stopCount || 0),
        carpool: carpoolInfo ? '1' : '',
        carpoolRiders: carpoolInfo ? String(carpoolInfo.riders) : '',
        carpoolMaxFare: carpoolInfo ? String(carpoolInfo.maxFare) : '',
        returnAt: ride.roundTrip?.isRoundTrip && ride.roundTrip.returnAt ? new Date(ride.roundTrip.returnAt).toISOString() : '',
        expiresInSeconds: String(dispatchConfig.retryWindowSeconds),
      },
    }).catch((error) => {
      console.error('Failed to send driver ride-request push notification', error);
    });
  }
};

export const markDriverRejectedFromDispatch = (rideId, driverId) => {
  if (!rideId || !driverId) {
    return;
  }

  const state = getDispatchState(rideId);
  const rejectedDriverIds = [...new Set([...state.rejectedDriverIds, String(driverId)])];

  saveDispatchState(rideId, { rejectedDriverIds });
};

const closeRideAsUnmatched = async (rideId) => {
  const dispatchState = getDispatchState(rideId);
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, status: RIDE_STATUS.SEARCHING },
    {
      status: RIDE_STATUS.CANCELLED,
      liveStatus: RIDE_LIVE_STATUS.CANCELLED,
      biddingStatus: 'expired',
    },
    { returnDocument: 'after' },
  );

  if (!ride) {
    return;
  }

  // No driver was ever found, so the rider must not lose their promo use.
  await releasePromoForCancelledRide({ ride });
  emitCustomerFeedEvent(ride, 'feed:customer:removed', { reason: 'UNMATCHED' });

  await User.updateOne({ _id: ride.userId, currentRideId: ride._id }, { currentRideId: null });
  if (ride.carpool?.groupId) {
    const { onRideCancelled } = await import('./carpoolService.js');
    await onRideCancelled(ride).catch((error) => console.error('[dispatch] carpool cancel failed:', error.message));
  }

  emitToRoom(getUserRoom(ride.userId), 'rideCancelled', {
    rideId: String(ride._id),
    room: getRideRoom(ride._id),
    reason: 'No drivers accepted the ride request',
    reasonCode: 'no_drivers',
  });

  sendPushNotificationToEntities({
    userIds: [String(ride.userId)],
    title: 'No driver found',
    body: 'We could not find a driver for your ride. You have not been charged. Please try again.',
    data: { type: 'ride_unmatched', rideId: String(ride._id) },
  }).catch(() => {});

  emitToRoom(getRideRoom(ride._id), 'rideRequestClosed', {
    rideId: String(ride._id),
    reason: 'unmatched',
  });

  for (const driverId of dispatchState.notifiedDriverIds) {
    emitToDriver(driverId, 'rideRequestClosed', {
      rideId: String(ride._id),
      reason: 'unmatched',
    });
  }

  emitToRoom(getRideRoom(ride._id), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
    rideId: String(ride._id),
    status: ride.status,
    liveStatus: ride.liveStatus,
  });
};

/**
 * Returns both escrow holds after a published ride is cancelled.
 *
 * Deliberately run *after* the cancellation commits rather than inside it:
 * `releasePublishedRide` opens its own transaction and Mongo will not nest one.
 * A failure here leaves money frozen against a dead ride, which is what the
 * `escrowOrphanCheck` sweep exists to catch.
 */
const releaseEscrowAfterCancel = async (ride, { penaltyFrom = null, reason = 'ride_cancelled' } = {}) => {
  if (ride?.escrow?.state !== 'held') return;

  try {
    const { releasePublishedRide } = await import('../driver/services/escrowService.js');
    await releasePublishedRide({ rideId: ride._id, reason, penaltyFrom });
  } catch (error) {
    console.error('[dispatchService] escrow release after cancel failed:', error.message);
  }
};

const closeListingAfterCancel = async (ride) => {
  try {
    const { closePublishedListingForCancelledRide } = await import('../driver/services/feedService.js');
    await closePublishedListingForCancelledRide(ride);
  } catch (error) {
    console.error('[dispatchService] closing the published listing failed:', error.message);
  }
};

export const cancelRideByAdmin = async (rideId) => {
  stopDispatchFlow(rideId);

  const ride = await Ride.findById(rideId);

  if (!ride) {
    return null;
  }

  // A completed ride has already settled: commission taken, driver paid, wallet
  // transaction written. Flipping it to cancelled moves none of that back, so it
  // would leave the money moved against a ride that reads as cancelled — and
  // drop it from every earnings report keyed on `completed`. Voiding a finished
  // trip needs a reversal, not a status change, so refuse it here as the rider
  // and driver cancellation paths already do.
  if (ride.status === RIDE_STATUS.COMPLETED || ride.liveStatus === RIDE_LIVE_STATUS.COMPLETED) {
    throw new ApiError(409, 'Completed rides cannot be cancelled');
  }

  if (ride.status === RIDE_STATUS.CANCELLED || ride.liveStatus === RIDE_LIVE_STATUS.CANCELLED) {
    return ride;
  }

  await releasePromoForCancelledRide({ ride });

  ride.status = RIDE_STATUS.CANCELLED;
  ride.liveStatus = RIDE_LIVE_STATUS.CANCELLED;
  if (ride.bookingMode === 'bidding') {
    ride.biddingStatus = 'cancelled';
  }
  await ride.save();

  await Promise.all([
    User.updateOne({ _id: ride.userId, currentRideId: ride._id }, { currentRideId: null }),
    ride.driverId ? Driver.findByIdAndUpdate(ride.driverId, { isOnRide: false }) : Promise.resolve(),
  ]);

  await releaseEscrowAfterCancel(ride, { reason: 'cancelled_by_admin' });
  if (ride.carpool?.groupId) {
    const { onRideCancelled } = await import('./carpoolService.js');
    await onRideCancelled(ride).catch((error) => console.error('[dispatch] carpool cancel failed:', error.message));
  }
  // A published driver-created ride also leaves the feed, and its applicants are told.
  await closeListingAfterCancel(ride);
  emitCustomerFeedEvent(ride, 'feed:customer:removed', { reason: 'CANCELLED' });

  emitToRoom(getUserRoom(ride.userId), 'rideCancelled', {
    rideId: String(ride._id),
    room: getRideRoom(ride._id),
    reason: 'Ride was deleted by admin',
  });

  if (ride.driverId) {
    emitToRoom(getDriverRoom(ride.driverId), 'rideRequestClosed', {
      rideId: String(ride._id),
      reason: 'deleted-by-admin',
    });
  }

  emitToRoom(getRideRoom(ride._id), 'rideRequestClosed', {
    rideId: String(ride._id),
    reason: 'deleted-by-admin',
  });

  emitToRoom(getRideRoom(ride._id), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
    rideId: String(ride._id),
    status: ride.status,
    liveStatus: ride.liveStatus,
  });

  return ride;
};

export const cancelRideByUser = async ({ rideId, userId, reason = '', reasonId = '', note = '' }) => {
  const dispatchState = getDispatchState(rideId);
  stopDispatchFlow(rideId);
  const session = await mongoose.startSession();
  let ride = null;
  let cancellationSettlement = null;

  try {
    session.startTransaction();

    ride = await Ride.findOne({ _id: rideId, userId }).session(session);

    if (!ride) {
      await session.abortTransaction();
      return null;
    }

    if (ride.status === RIDE_STATUS.COMPLETED || ride.liveStatus === RIDE_LIVE_STATUS.COMPLETED) {
      throw new Error('Completed rides cannot be cancelled');
    }

    if (ride.status === RIDE_STATUS.CANCELLED || ride.liveStatus === RIDE_LIVE_STATUS.CANCELLED) {
      await session.commitTransaction();
      return ride;
    }

    if (ride.driverId) {
      cancellationSettlement = await settleUserCancellationFee(ride, session);
    }

    await releasePromoForCancelledRide({ ride, session });

    ride.status = RIDE_STATUS.CANCELLED;
    ride.liveStatus = RIDE_LIVE_STATUS.CANCELLED;
    ride.cancellation = {
      by: 'user',
      reasonId: String(reasonId || '').trim().slice(0, 64),
      reason: String(reason || '').trim().slice(0, 120),
      note: String(note || '').trim().slice(0, 200),
      at: new Date(),
    };
    if (ride.bookingMode === 'bidding') {
      ride.biddingStatus = 'cancelled';
    }
    await ride.save({ session });

    await Promise.all([
      User.updateOne({ _id: ride.userId, currentRideId: ride._id }, { currentRideId: null }, { session }),
      ride.driverId ? Driver.findByIdAndUpdate(ride.driverId, { isOnRide: false }, { session }) : Promise.resolve(),
    ]);

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  await releaseEscrowAfterCancel(ride, { reason: 'cancelled_by_user' });
  if (ride.carpool?.groupId) {
    const { onRideCancelled } = await import('./carpoolService.js');
    await onRideCancelled(ride).catch((error) => console.error('[dispatch] carpool cancel failed:', error.message));
  }
  // A published driver-created ride also leaves the feed, and its applicants are told.
  await closeListingAfterCancel(ride);
  emitCustomerFeedEvent(ride, 'feed:customer:removed', { reason: 'CANCELLED' });

  emitToRoom(getUserRoom(ride.userId), 'rideCancelled', {
    rideId: String(ride._id),
    room: getRideRoom(ride._id),
    reason: 'You cancelled the ride',
  });

  if (ride.driverId) {
    emitToRoom(getDriverRoom(ride.driverId), 'rideRequestClosed', {
      rideId: String(ride._id),
      reason: 'user-cancelled',
      message: 'User cancelled the ride.',
    });
  }

  for (const driverId of dispatchState.notifiedDriverIds) {
    emitToDriver(driverId, 'rideRequestClosed', {
      rideId: String(ride._id),
      reason: 'user-cancelled',
      message: 'User cancelled the ride.',
    });
  }

  emitToRoom(getRideRoom(ride._id), 'rideCancelled', {
    rideId: String(ride._id),
    room: getRideRoom(ride._id),
    reason: 'User cancelled the ride',
  });

  emitToRoom(getRideRoom(ride._id), 'rideRequestClosed', {
    rideId: String(ride._id),
    reason: 'user-cancelled',
    message: 'User cancelled the ride.',
  });

  emitToRoom(getRideRoom(ride._id), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
    rideId: String(ride._id),
    status: ride.status,
    liveStatus: ride.liveStatus,
  });

  if (cancellationSettlement?.driverWalletResult?.transaction) {
    emitToDriver(ride.driverId, 'driver:wallet:updated', {
      wallet: cancellationSettlement.driverWalletResult.wallet,
      transaction: cancellationSettlement.driverWalletResult.transaction,
      notification: {
        id: `ride-cancel-credit-${String(ride._id)}`,
        title: 'Cancellation fee received',
        body: `Rs ${Number(cancellationSettlement.feeAmount || 0).toFixed(2)} credited for rider cancellation.`,
        sentAt: new Date().toISOString(),
      },
    });
  }

  return ride;
};

export const cancelScheduledRideByDriver = async ({ rideId, driverId }) => {
  const dispatchState = getDispatchState(rideId);
  stopDispatchFlow(rideId);
  const session = await mongoose.startSession();
  let ride = null;
  let cancellationSettlement = null;

  try {
    session.startTransaction();

    ride = await Ride.findOne({ _id: rideId, driverId }).session(session);

    if (!ride) {
      await session.abortTransaction();
      return null;
    }

    const scheduledAt = ride?.scheduledAt ? new Date(ride.scheduledAt) : null;
    const isScheduledRide = scheduledAt && Number.isFinite(scheduledAt.getTime()) && scheduledAt.getTime() > Date.now();

    if (!isScheduledRide) {
      throw new Error('Only upcoming scheduled rides can be cancelled by the driver');
    }

    if (ride.status === RIDE_STATUS.COMPLETED || ride.liveStatus === RIDE_LIVE_STATUS.COMPLETED) {
      throw new Error('Completed rides cannot be cancelled');
    }

    if (ride.status === RIDE_STATUS.CANCELLED || ride.liveStatus === RIDE_LIVE_STATUS.CANCELLED) {
      await session.commitTransaction();
      return ride;
    }

    cancellationSettlement = await settleDriverCancellationFee(ride, session);

    // The driver walks away from the way back of a round trip: the rider only got
    // one of the two trips, so half of what they paid for the round trip returns
    // to their wallet.
    if (ride.roundTrip?.legType === 'return' && ride.roundTrip?.parentRideId && ride.userId) {
      const outbound = await Ride.findById(ride.roundTrip.parentRideId).select('fare').session(session);
      const refundAmount = Math.round((Number(outbound?.fare || 0) / 2) * 100) / 100;
      if (refundAmount > 0) {
        const credit = await applyUserWalletAdjustment({
          userId: ride.userId,
          amount: refundAmount,
          kind: 'credit',
          title: `Refund for the cancelled return trip (booking ${String(ride._id).slice(-6)})`,
          referenceKey: `ride-cancel:driver-roundtrip:${String(ride._id)}:user-refund`,
          walletField: 'refundWallet',
          provider: 'ride_cancellation_refund',
          session,
        });
        if (['applied', 'existing'].includes(credit.status)) ride.roundTrip.refundAmount = refundAmount;
      }
    }

    await releasePromoForCancelledRide({ ride, session });

    ride.status = RIDE_STATUS.CANCELLED;
    ride.liveStatus = RIDE_LIVE_STATUS.CANCELLED;
    if (ride.bookingMode === 'bidding') {
      ride.biddingStatus = 'cancelled';
    }
    await ride.save({ session });

    await Promise.all([
      User.updateOne({ _id: ride.userId, currentRideId: ride._id }, { currentRideId: null }, { session }),
      ride.driverId ? Driver.findByIdAndUpdate(ride.driverId, { isOnRide: false }, { session }) : Promise.resolve(),
    ]);

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  // The driver walked away from a ride they had accepted, so any configured
  // penalty is charged to them and paid to the publisher.
  await releaseEscrowAfterCancel(ride, {
    reason: 'cancelled_by_driver',
    penaltyFrom: 'acceptor',
  });
  if (ride.carpool?.groupId) {
    const { onRideCancelled } = await import('./carpoolService.js');
    await onRideCancelled(ride).catch((error) => console.error('[dispatch] carpool cancel failed:', error.message));
  }

  const refunded = Number(ride.roundTrip?.refundAmount || 0);
  const cancelReason = refunded > 0
    ? `Your return trip was cancelled by the driver. ₹${refunded} (half of your round trip fare) was refunded to your wallet.`
    : 'Your scheduled ride was cancelled by the driver.';

  emitToRoom(getUserRoom(ride.userId), 'rideCancelled', {
    rideId: String(ride._id),
    room: getRideRoom(ride._id),
    reason: cancelReason,
  });

  emitToRoom(getRideRoom(ride._id), 'rideRequestClosed', {
    rideId: String(ride._id),
    reason: 'driver-cancelled',
    message: cancelReason,
  });

  if (ride.driverId) {
    emitToRoom(getDriverRoom(ride.driverId), 'rideRequestClosed', {
      rideId: String(ride._id),
      reason: 'driver-cancelled',
      message: 'Scheduled ride cancelled.',
    });
  }

  for (const notifiedDriverId of dispatchState.notifiedDriverIds) {
    emitToDriver(notifiedDriverId, 'rideRequestClosed', {
      rideId: String(ride._id),
      reason: 'driver-cancelled',
      message: cancelReason,
    });
  }

  emitToRoom(getRideRoom(ride._id), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
    rideId: String(ride._id),
    status: ride.status,
    liveStatus: ride.liveStatus,
  });

  if (cancellationSettlement?.driverWalletResult?.transaction) {
    emitToDriver(ride.driverId, 'driver:wallet:updated', {
      wallet: cancellationSettlement.driverWalletResult.wallet,
      transaction: cancellationSettlement.driverWalletResult.transaction,
      notification: {
        id: `ride-cancel-debit-${String(ride._id)}`,
        title: 'Cancellation fee charged',
        body: `Rs ${Number(cancellationSettlement.feeAmount || 0).toFixed(2)} deducted for scheduled ride cancellation.`,
        sentAt: new Date().toISOString(),
      },
    });
  }

  sendPushNotificationToEntities({
    userIds: [String(ride.userId)],
    title: refunded > 0 ? 'Return trip cancelled, refund issued' : 'Scheduled ride cancelled',
    body: cancelReason,
    data: {
      type: 'ride_cancelled_by_driver',
      rideId: String(ride._id),
      serviceType: ride.serviceType || 'ride',
    },
  }).catch((error) => {
    console.error('Failed to send user scheduled-ride cancellation push notification', error);
  });

  return ride;
};

const scheduleNextAttempt = (rideId, nextAttemptIndex, retryDelayMs) => {
  const timer = setTimeout(() => {
    dispatchAttempt(rideId, nextAttemptIndex).catch((error) => {
      console.error('Dispatch retry failed', error);
    });
  }, retryDelayMs);

  saveDispatchState(rideId, { timer });
};

const getAttemptRadiusMeters = (baseDistanceMeters, attemptIndex) => {
  const safeBaseDistance = Math.max(1000, Number(baseDistanceMeters) || 0);
  const growthMultiplier = Math.min(1 + (Math.max(0, attemptIndex) * 0.5), 3);

  return Math.round(safeBaseDistance * growthMultiplier);
};

/**
 * One phase of tiered dispatch. Every driver of the plans allowed in this phase
 * is alerted at once (and the ride shows on their feed); drivers alerted in
 * earlier phases stay free to accept. A phase nobody can serve is skipped at
 * once, so an instant ride never waits minutes for plans that are not around.
 */
const dispatchTierPhase = async ({ ride, rideId, phaseIndex, phases, dispatchConfig }) => {
  const phase = phases[phaseIndex];
  const radius = getAttemptRadiusMeters(
    dispatchConfig.baseDistanceMeters || dispatchConfig.maxDistanceMeters,
    phaseIndex,
  );
  const dispatchVehicleTypeIds = getDispatchVehicleTypeIds(ride);
  const dispatchState = getDispatchState(rideId);

  await Ride.updateOne(
    { _id: rideId, status: RIDE_STATUS.SEARCHING },
    { $set: { tierPhaseIndex: phaseIndex, ...(phaseIndex === 0 ? { dispatchStartedAt: new Date() } : {}) } },
  );

  const { zone, drivers, searchRadiusMeters } = await matchDrivers(ride.pickupLocation.coordinates, {
    maxDistance: radius,
    vehicleTypeId: ride.vehicleTypeId,
    vehicleTypeIds: dispatchVehicleTypeIds,
    rideModuleCode: getRideModuleCode(ride),
    paymentMethod: ride.paymentMethod,
    dropCoords: ride.dropLocation?.coordinates || null,
  });
  const effectiveRadius = Number.isFinite(searchRadiusMeters) && searchRadiusMeters > 0
    ? searchRadiusMeters
    : radius;

  const rejectedDriverIds = new Set(dispatchState.rejectedDriverIds);
  const notifiedDriverIds = new Set(dispatchState.notifiedDriverIds);
  const allowed = phaseCategories(phases, phaseIndex);
  const targetDrivers = (await withoutTeamMembers(drivers)).filter((driver) => {
    const driverId = String(driver._id);
    return allowed.includes(categoryOf(driver)) && !rejectedDriverIds.has(driverId) && !notifiedDriverIds.has(driverId);
  });
  const nextNotifiedDriverIds = [
    ...dispatchState.notifiedDriverIds,
    ...targetDrivers.map((driver) => String(driver._id)),
  ];

  saveDispatchState(rideId, {
    radiusIndex: phaseIndex,
    driverIds: nextNotifiedDriverIds,
    notifiedDriverIds: nextNotifiedDriverIds,
    timer: null,
  });

  if (targetDrivers.length) {
    // The card rings for a minute at most; the ride stays on the feed after that.
    const remainingSeconds = phases.slice(phaseIndex).reduce((sum, item) => sum + item.minutes * 60, 0);
    await emitRideRequestToDrivers({
      ride,
      targetDrivers,
      zone,
      effectiveRadius,
      dispatchVehicleTypeIds,
      dispatchConfig: {
        ...dispatchConfig,
        dispatchType: 'broadcast',
        retryWindowSeconds: Math.min(remainingSeconds, 60),
        maxAttempts: phases.length,
      },
      attemptIndex: phaseIndex,
    });
  }

  emitToRoom(getUserRoom(ride.userId), 'rideSearchUpdate', {
    rideId: String(ride._id),
    status: ride.status,
    radius: effectiveRadius,
    dispatchType: 'broadcast',
    attempt: phaseIndex + 1,
    maxAttempts: phases.length,
    matchedDrivers: targetDrivers.length,
    totalNotifiedDrivers: nextNotifiedDriverIds.length,
    maxSearchSeconds: Math.round(dispatchConfig.searchExpiryMs / 1000),
  });

  const isLast = phaseIndex >= phases.length - 1;
  // The last phase keeps the ride searching (no more alerts, it just stays on the
  // feed) until the admin-set expiry counted from when the rider booked.
  const sinceBookedMs = Date.now() - new Date(ride.createdAt).getTime();
  const waitMs = isLast
    ? Math.max(dispatchConfig.searchExpiryMs - sinceBookedMs, 60 * 1000)
    : targetDrivers.length
      ? phase.minutes * 60 * 1000
      : 0;

  if (isLast) {
    const timer = setTimeout(() => {
      closeRideAsUnmatched(rideId)
        .catch((error) => console.error('Failed to mark ride unmatched', error))
        .finally(() => stopDispatchFlow(rideId));
    }, waitMs);
    saveDispatchState(rideId, { timer });
    return;
  }

  scheduleNextAttempt(rideId, phaseIndex + 1, waitMs);
};

const dispatchAttempt = async (rideId, attemptIndex = 0) => {
  const ride = await Ride.findById(rideId).populate('userId', 'name phone countryCode');

  if (!ride || ride.status !== RIDE_STATUS.SEARCHING) {
    stopDispatchFlow(rideId);
    return;
  }

  try {
    const dispatchConfig = await resolveTransportDispatchConfig();
    const tierPhases = String(ride.bookingMode || 'normal') === 'normal' ? await getTierPhases() : null;
    if (tierPhases) {
      await dispatchTierPhase({ ride, rideId, phaseIndex: attemptIndex, phases: tierPhases, dispatchConfig });
      return;
    }
    const radius = getAttemptRadiusMeters(
      dispatchConfig.baseDistanceMeters || dispatchConfig.maxDistanceMeters,
      attemptIndex,
    );
    const dispatchVehicleTypeIds = getDispatchVehicleTypeIds(ride);
    const dispatchState = getDispatchState(rideId);
    if (dispatchConfig.dispatchType === 'one_by_one' && attemptIndex > 0 && dispatchState.driverIds.length) {
      closeDriverRequestWindow(rideId, dispatchState.driverIds);
    }

    const { zone, drivers, searchRadiusMeters } = await matchDrivers(ride.pickupLocation.coordinates, {
      maxDistance: radius,
      vehicleTypeId: ride.vehicleTypeId,
      vehicleTypeIds: dispatchVehicleTypeIds,
      rideModuleCode: getRideModuleCode(ride),
      paymentMethod: ride.paymentMethod,
      // Route-mode drivers only take trips that run along their corridor, so
      // matching needs the destination, not just the pickup.
      dropCoords: ride.dropLocation?.coordinates || null,
    });
    const effectiveRadius = Number.isFinite(searchRadiusMeters) && searchRadiusMeters > 0
      ? searchRadiusMeters
      : radius;

    const rejectedDriverIds = new Set(dispatchState.rejectedDriverIds);
    const notifiedDriverIds = new Set(dispatchState.notifiedDriverIds);
    const availableDrivers = drivers.filter((driver) => {
      const driverId = String(driver._id);
      return !rejectedDriverIds.has(driverId) && !notifiedDriverIds.has(driverId);
    });
    const targetDrivers = dispatchConfig.dispatchType === 'broadcast'
      ? availableDrivers
      : availableDrivers.slice(0, 1);
    const nextNotifiedDriverIds = [
      ...dispatchState.notifiedDriverIds,
      ...targetDrivers.map((driver) => String(driver._id)),
    ];

    saveDispatchState(rideId, {
      radiusIndex: attemptIndex,
      driverIds: targetDrivers.map((driver) => String(driver._id)),
      notifiedDriverIds: nextNotifiedDriverIds,
      timer: null,
    });

    await emitRideRequestToDrivers({
      ride,
      targetDrivers,
      zone,
      effectiveRadius,
      dispatchVehicleTypeIds,
      dispatchConfig,
      attemptIndex,
    });

    emitToRoom(getUserRoom(ride.userId), 'rideSearchUpdate', {
      rideId: String(ride._id),
      status: ride.status,
      radius: effectiveRadius,
      dispatchType: dispatchConfig.dispatchType,
      attempt: attemptIndex + 1,
      maxAttempts: dispatchConfig.maxAttempts,
      matchedDrivers: targetDrivers.length,
      totalNotifiedDrivers: nextNotifiedDriverIds.length,
    });

    if (attemptIndex >= dispatchConfig.maxAttempts - 1) {
      // Final attempt waits one more cycle before the ride is closed as unmatched.
      const timer = setTimeout(() => {
        closeRideAsUnmatched(rideId)
          .catch((error) => console.error('Failed to mark ride unmatched', error))
          .finally(() => stopDispatchFlow(rideId));
      }, dispatchConfig.retryDelayMs);

        saveDispatchState(rideId, {
          radiusIndex: attemptIndex,
          driverIds: targetDrivers.map((driver) => String(driver._id)),
          notifiedDriverIds: nextNotifiedDriverIds,
          timer,
        });

      return;
    }

    scheduleNextAttempt(rideId, attemptIndex + 1, dispatchConfig.retryDelayMs);
  } catch (error) {
    await closeRideAsUnmatched(rideId);
    stopDispatchFlow(rideId);
    throw error;
  }
};

/**
 * Mirrors a customer booking onto the network feed's Customer tab.
 *
 * The feed query is time-boxed anyway, but pushing the event means a driver
 * watching the tab sees the lead immediately instead of on their next refresh.
 */
export const emitCustomerFeedEvent = (ride, event, extra = {}) => {
  if (!ride?.service_location_id) return;
  if (String(ride.origin || 'customer_app') !== 'customer_app') return;

  emitToRoom(getFeedRoom(ride.service_location_id), event, {
    rideId: String(ride._id),
    pickup: ride.pickupAddress || '',
    drop: ride.dropAddress || '',
    fare: ride.fare,
    scheduledAt: ride.scheduledAt || null,
    ...extra,
  });
};

export const startDispatchFlow = async (ride) => {
  stopDispatchFlow(ride._id);

  emitCustomerFeedEvent(ride, 'feed:customer:new');

  const scheduledAt = ride?.scheduledAt ? new Date(ride.scheduledAt) : null;
  // Offered to drivers ahead of the pickup time (admin lead time, 60 min by default).
  const leadMs = scheduledAt ? await getScheduledDispatchLeadMs() : 0;
  const delayMs = scheduledAt ? scheduledAt.getTime() - leadMs - Date.now() : 0;
  const bookingMode = String(ride?.bookingMode || 'normal').trim().toLowerCase();
  const shouldDispatchImmediately = bookingMode === 'bidding';

  if (!shouldDispatchImmediately && scheduledAt && Number.isFinite(delayMs) && delayMs > 0) {
    const rideId = String(ride._id);
    const timer = setTimeout(() => {
      scheduledDispatchTimers.delete(rideId);
      dispatchAttempt(ride._id, 0).catch((error) => {
        console.error('Scheduled dispatch failed', error);
      });
    }, delayMs);

    scheduledDispatchTimers.set(rideId, timer);
    return;
  }

  await dispatchAttempt(ride._id, 0);
};

/**
 * Sends a ride that lost its driver back to dispatch, skipping that driver.
 * The tier phases start again from the first one.
 */
export const redispatchRide = async (rideId, excludeDriverId = null) => {
  stopDispatchFlow(rideId);
  if (excludeDriverId) saveDispatchState(rideId, { rejectedDriverIds: [String(excludeDriverId)] });
  await dispatchAttempt(rideId, 0);
};

export const restoreScheduledDispatches = async () => {
  const rides = await Ride.find({
    status: RIDE_STATUS.SEARCHING,
    liveStatus: RIDE_LIVE_STATUS.SEARCHING,
    scheduledAt: { $ne: null },
    'carpool.role': { $ne: 'member' },
  }).select('_id scheduledAt');

  for (const ride of rides) {
    await startDispatchFlow(ride);
  }
};

export const notifyLateAvailableDriver = async (driverId) => {
  if (!driverId || activeDispatches.size === 0) {
    return;
  }

  const driver = await Driver.findById(driverId)
    .select('_id isOnline isOnRide wallet location zoneId vehicleTypeId vehicleType vehicleIconType driver_category owner_id is_self_drive_owner');

  if (!driver?.isOnline || driver?.isOnRide || driver?.wallet?.isBlocked || !driver?.location?.coordinates?.length) {
    return;
  }

  const activeRideIds = Array.from(activeDispatches.keys());

  for (const rideId of activeRideIds) {
    const ride = await Ride.findById(rideId).populate('userId', 'name phone countryCode');

    if (!ride || ride.status !== RIDE_STATUS.SEARCHING) {
      continue;
    }

    const dispatchState = getDispatchState(rideId);
    const driverKey = String(driver._id);

    if (
      dispatchState.notifiedDriverIds.includes(driverKey) ||
      dispatchState.rejectedDriverIds.includes(driverKey)
    ) {
      continue;
    }

    // Same rules as the phased dispatch: no team members, and only plans the
    // ride is currently open to.
    if (ride.tierPhaseIndex != null) {
      const phases = await getTierPhases();
      if (phases && !phaseCategories(phases, ride.tierPhaseIndex).includes(categoryOf(driver))) {
        continue;
      }
    }
    if ((await withoutTeamMembers([driver])).length === 0) {
      continue;
    }

    const dispatchConfig = await resolveTransportDispatchConfig();
    const attemptIndex = Number.isInteger(dispatchState.radiusIndex) ? dispatchState.radiusIndex : 0;
    const radius = getAttemptRadiusMeters(
      dispatchConfig.baseDistanceMeters || dispatchConfig.maxDistanceMeters,
      attemptIndex,
    );
    const dispatchVehicleTypeIds = getDispatchVehicleTypeIds(ride);
    const { zone, drivers, searchRadiusMeters } = await matchDrivers(ride.pickupLocation.coordinates, {
      maxDistance: radius,
      vehicleTypeId: ride.vehicleTypeId,
      vehicleTypeIds: dispatchVehicleTypeIds,
      rideModuleCode: getRideModuleCode(ride),
      paymentMethod: ride.paymentMethod,
      // Route-mode drivers only take trips that run along their corridor, so
      // matching needs the destination, not just the pickup.
      dropCoords: ride.dropLocation?.coordinates || null,
    });

    const matchedDriver = drivers.find((item) => String(item._id) === driverKey);
    if (!matchedDriver) {
      continue;
    }

    const effectiveRadius = Number.isFinite(searchRadiusMeters) && searchRadiusMeters > 0
      ? searchRadiusMeters
      : radius;

    const nextNotifiedDriverIds = [...dispatchState.notifiedDriverIds, driverKey];
    const nextDriverIds = dispatchConfig.dispatchType === 'broadcast'
      ? [...new Set([...dispatchState.driverIds, driverKey])]
      : dispatchState.driverIds.length
        ? dispatchState.driverIds
        : [driverKey];

    saveDispatchState(rideId, {
      driverIds: nextDriverIds,
      notifiedDriverIds: nextNotifiedDriverIds,
    });

    await emitRideRequestToDrivers({
      ride,
      targetDrivers: [matchedDriver],
      zone,
      effectiveRadius,
      dispatchVehicleTypeIds,
      dispatchConfig,
      attemptIndex,
    });
  }
};

export const notifyRideAccepted = async (ride) => {
  const state = getDispatchState(ride._id);
  stopDispatchFlow(ride._id);

  // The lead is gone from the Customer tab the moment somebody takes it.
  emitCustomerFeedEvent(ride, 'feed:customer:removed', { reason: 'TAKEN' });

  // Once one driver wins the race, the rider is updated and the rest are told to stop.
  const populatedRide = await Ride.findById(ride._id).populate(
    'driverId',
    'name phone profileImage vehicleTypeId vehicleType vehicleIconType vehicleNumber vehicleColor vehicleMake vehicleModel vehicleImage rating',
  );

  if (!populatedRide) {
    return;
  }

  emitToRoom(getUserRoom(populatedRide.userId), 'rideAccepted', {
    rideId: String(populatedRide._id),
    room: getRideRoom(populatedRide._id),
    type: populatedRide.serviceType || 'ride',
    serviceType: populatedRide.serviceType || 'ride',
    status: populatedRide.status,
    liveStatus: populatedRide.liveStatus,
    otp: populatedRide.otp || '',
    vehicleIconType: populatedRide.vehicleIconType || '',
    vehicleIconUrl: populatedRide.vehicleIconUrl || '',
    driver: populatedRide.driverId,
  });

  emitToRoom(getUserRoom(populatedRide.userId), SOCKET_EVENTS.RIDE_STATE, {
    rideId: String(populatedRide._id),
    room: getRideRoom(populatedRide._id),
    type: populatedRide.serviceType || 'ride',
    serviceType: populatedRide.serviceType || 'ride',
    status: populatedRide.status,
    liveStatus: populatedRide.liveStatus,
    fare: populatedRide.fare,
    estimatedDistanceMeters: populatedRide.estimatedDistanceMeters || 0,
    estimatedDurationMinutes: populatedRide.estimatedDurationMinutes || 0,
    paymentMethod: populatedRide.paymentMethod,
    otp: populatedRide.otp || '',
    vehicleIconType: populatedRide.vehicleIconType || '',
    vehicleIconUrl: populatedRide.vehicleIconUrl || '',
    intercity: populatedRide.intercity || null,
    stopCount: populatedRide.stopCount || 0,
    commissionAmount: populatedRide.commissionAmount,
    driverEarnings: populatedRide.driverEarnings,
    pickupLocation: populatedRide.pickupLocation,
    pickupAddress: populatedRide.pickupAddress || '',
    dropLocation: populatedRide.dropLocation,
    dropAddress: populatedRide.dropAddress || '',
    acceptedAt: populatedRide.acceptedAt,
    startedAt: populatedRide.startedAt,
    completedAt: populatedRide.completedAt,
    lastDriverLocation: populatedRide.lastDriverLocation?.coordinates?.length
      ? {
          type: populatedRide.lastDriverLocation.type,
          coordinates: populatedRide.lastDriverLocation.coordinates,
          heading: populatedRide.lastDriverLocation.heading,
          speed: populatedRide.lastDriverLocation.speed,
          updatedAt: populatedRide.lastDriverLocation.updatedAt,
        }
      : null,
    driver: populatedRide.driverId,
  });

  emitToRoom(getRideRoom(populatedRide._id), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
    rideId: String(populatedRide._id),
    status: populatedRide.status,
    liveStatus: populatedRide.liveStatus,
    acceptedAt: populatedRide.acceptedAt,
  });

  emitToRoom(getDriverRoom(populatedRide.driverId._id), 'rideAccepted', {
    rideId: String(populatedRide._id),
    room: getRideRoom(populatedRide._id),
    status: populatedRide.status,
    liveStatus: populatedRide.liveStatus,
    acceptedAt: populatedRide.acceptedAt,
    otp: populatedRide.otp || '',
  });

  // Only the drivers who lost the race should be told to drop the request. The
  // winner is in the ride room too, so it must be excluded explicitly — telling it
  // "accepted-by-another-driver" about its own ride would dismiss the trip it just won.
  const acceptedDriverId = String(populatedRide.driverId._id);
  const losingDriverIds = state.notifiedDriverIds.filter((driverId) => String(driverId) !== acceptedDriverId);

  for (const driverId of losingDriverIds) {
    emitToDriver(driverId, 'rideRequestClosed', {
      rideId: String(populatedRide._id),
      acceptedDriverId,
      reason: 'accepted-by-another-driver',
    });
  }

  sendPushNotificationToEntities({
    userIds: [String(populatedRide.userId)],
    title: 'Ride accepted',
    body: populatedRide.driverId?.name
      ? `${populatedRide.driverId.name} accepted your request.`
      : 'A driver accepted your request.',
    data: {
      type: 'ride_accepted',
      rideId: String(populatedRide._id),
      serviceType: populatedRide.serviceType || 'ride',
      driverId: String(populatedRide.driverId?._id || ''),
    },
  }).catch((error) => {
    console.error('Failed to send user ride-accepted push notification', error);
  });
};

export const notifyRideBidUpdated = async ({ ride, bid }) => {
  const safeRide = ride?._id ? ride : await Ride.findById(ride?.rideId || ride);

  if (!safeRide) {
    return;
  }

  const payload = {
    rideId: String(safeRide._id),
    bookingMode: safeRide.bookingMode || 'normal',
    pricingNegotiationMode: safeRide.pricingNegotiationMode || 'none',
    biddingStatus: safeRide.biddingStatus || 'none',
    fare: Number(safeRide.fare || 0),
    baseFare: Number(safeRide.baseFare || safeRide.fare || 0),
    bidFloorFare: Number(safeRide.bidFloorFare ?? safeRide.baseFare ?? safeRide.fare ?? 0),
    userMaxBidFare: Number(safeRide.userMaxBidFare || safeRide.fare || 0),
    bidCeilingMaxFare: Number(safeRide.bidCeilingMaxFare || safeRide.userMaxBidFare || safeRide.fare || 0),
    bidStepAmount: Number(safeRide.bidStepAmount || 10),
    fareIncreaseWaitMinutes: Number(safeRide.fareIncreaseWaitMinutes || 0),
    nextFareIncreaseAt: safeRide.nextFareIncreaseAt || null,
    bid,
  };

  emitToRoom(getUserRoom(safeRide.userId), 'rideBidUpdated', payload);
  emitToRoom(getRideRoom(safeRide._id), 'rideBidUpdated', payload);
};

export const notifyRideBiddingUpdated = async (ride) => {
  const safeRide = ride?._id ? ride : await Ride.findById(ride);

  if (!safeRide) {
    return;
  }

  const payload = {
    rideId: String(safeRide._id),
    bookingMode: safeRide.bookingMode || 'normal',
    pricingNegotiationMode: safeRide.pricingNegotiationMode || 'none',
    biddingStatus: safeRide.biddingStatus || 'none',
    fare: Number(safeRide.fare || 0),
    baseFare: Number(safeRide.baseFare || safeRide.fare || 0),
    bidFloorFare: Number(safeRide.bidFloorFare ?? safeRide.baseFare ?? safeRide.fare ?? 0),
    userMaxBidFare: Number(safeRide.userMaxBidFare || safeRide.fare || 0),
    bidCeilingMaxFare: Number(safeRide.bidCeilingMaxFare || safeRide.userMaxBidFare || safeRide.fare || 0),
    bidStepAmount: Number(safeRide.bidStepAmount || 10),
    fareIncreaseWaitMinutes: Number(safeRide.fareIncreaseWaitMinutes || 0),
    nextFareIncreaseAt: safeRide.nextFareIncreaseAt || null,
  };

  emitToRoom(getUserRoom(safeRide.userId), 'rideBiddingUpdated', payload);
  emitToRoom(getRideRoom(safeRide._id), 'rideBiddingUpdated', payload);

  const dispatchState = getDispatchState(safeRide._id);
  for (const driverId of dispatchState.notifiedDriverIds) {
    emitToDriver(driverId, 'rideBiddingUpdated', payload);
  }
};
