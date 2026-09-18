import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { Ride } from '../user/models/Ride.js';
import { User } from '../user/models/User.js';
import { UserWallet } from '../user/models/UserWallet.js';
import { Driver } from '../driver/models/Driver.js';
import { WalletTransaction } from '../driver/models/WalletTransaction.js';
import { applyDriverWalletAdjustment } from '../driver/services/walletService.js';
import { matchDrivers, findZoneByPickup } from './matchingService.js';
import {
  RIDE_LIVE_STATUS,
  RIDE_STATUS,
} from '../constants/index.js';
import { Delivery } from '../user/models/Delivery.js';
import { getRideRoom, resolveSetPriceForRide } from './rideService.js';
import { releasePromoForCancelledRide } from './promoService.js';
import { SOCKET_EVENTS } from '../socket/events.js';
import { resolveTransportDispatchConfig } from './transportSettingsService.js';
import { sendPushNotificationToEntities } from './pushNotificationService.js';

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

  if (serviceType === 'parcel') {
    return transportType === 'both' ? 'delivery' : (transportType || 'delivery');
  }

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
  if (serviceType === 'parcel') return 'parcel';
  if (serviceType === 'intercity') return 'outstation';
  return 'city';
};

const emitToSocket = (socketId, event, payload) => {
  if (ioInstance && socketId) {
    ioInstance.to(socketId).emit(event, payload);
  }
};

export const emitToRoom = (room, event, payload) => {
  if (ioInstance) {
    ioInstance.to(room).emit(event, payload);
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
      parcel: ride.parcel || null,
      intercity: ride.intercity || null,
      radius: effectiveRadius,
      attempt: attemptIndex + 1,
      maxAttempts: dispatchConfig.maxAttempts,
      acceptRejectDurationSeconds: dispatchConfig.retryWindowSeconds,
      expiresInSeconds: dispatchConfig.retryWindowSeconds,
      requestExpiresAt,
      zoneId: zone?._id ? String(zone._id) : null,
    });
  }

  sendPushNotificationToEntities({
    driverIds: targetDrivers.map((driver) => String(driver._id)),
    title: ride.serviceType === 'parcel' ? 'New delivery request' : 'New ride request',
    body: ride.pickupAddress
      ? `Pickup: ${ride.pickupAddress}`
      : 'A new booking is waiting for your response.',
    data: {
      type: 'ride_request',
      rideId: String(ride._id),
      serviceType: ride.serviceType || 'ride',
      userId: String(ride.userId?._id || ride.userId || ''),
    },
  }).catch((error) => {
    console.error('Failed to send driver ride-request push notification', error);
  });
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

  if (ride.deliveryId) {
    await Delivery.findByIdAndUpdate(ride.deliveryId, {
      status: ride.status,
      liveStatus: ride.liveStatus,
    });
  }

  await User.updateOne({ _id: ride.userId, currentRideId: ride._id }, { currentRideId: null });

  emitToRoom(getUserRoom(ride.userId), 'rideCancelled', {
    rideId: String(ride._id),
    room: getRideRoom(ride._id),
    reason: 'No drivers accepted the ride request',
  });

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

  if (ride.deliveryId) {
    await Delivery.findByIdAndUpdate(ride.deliveryId, {
      driverId: ride.driverId || null,
      status: ride.status,
      liveStatus: ride.liveStatus,
    });
  }

  await Promise.all([
    User.updateOne({ _id: ride.userId, currentRideId: ride._id }, { currentRideId: null }),
    ride.driverId ? Driver.findByIdAndUpdate(ride.driverId, { isOnRide: false }) : Promise.resolve(),
  ]);

  await releaseEscrowAfterCancel(ride, { reason: 'cancelled_by_admin' });
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

export const cancelRideByUser = async ({ rideId, userId }) => {
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
    if (ride.bookingMode === 'bidding') {
      ride.biddingStatus = 'cancelled';
    }
    await ride.save({ session });

    if (ride.deliveryId) {
      await Delivery.findByIdAndUpdate(ride.deliveryId, {
        driverId: ride.driverId || null,
        status: ride.status,
        liveStatus: ride.liveStatus,
      }, { session });
    }

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

    await releasePromoForCancelledRide({ ride, session });

    ride.status = RIDE_STATUS.CANCELLED;
    ride.liveStatus = RIDE_LIVE_STATUS.CANCELLED;
    if (ride.bookingMode === 'bidding') {
      ride.biddingStatus = 'cancelled';
    }
    await ride.save({ session });

    if (ride.deliveryId) {
      await Delivery.findByIdAndUpdate(ride.deliveryId, {
        driverId: ride.driverId || null,
        status: ride.status,
        liveStatus: ride.liveStatus,
      }, { session });
    }

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

  const cancelReason = 'Your scheduled ride was cancelled by the driver.';

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
    title: 'Scheduled ride cancelled',
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

const dispatchAttempt = async (rideId, attemptIndex = 0) => {
  const ride = await Ride.findById(rideId).populate('userId', 'name phone countryCode');

  if (!ride || ride.status !== RIDE_STATUS.SEARCHING) {
    stopDispatchFlow(rideId);
    return;
  }

  try {
    const dispatchConfig = await resolveTransportDispatchConfig();
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
  const delayMs = scheduledAt ? scheduledAt.getTime() - Date.now() : 0;
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

export const restoreScheduledDispatches = async () => {
  const rides = await Ride.find({
    status: RIDE_STATUS.SEARCHING,
    liveStatus: RIDE_LIVE_STATUS.SEARCHING,
    scheduledAt: { $ne: null },
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
    .select('_id isOnline isOnRide wallet location zoneId vehicleTypeId vehicleType vehicleIconType');

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
    parcel: populatedRide.parcel || null,
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
    parcel: populatedRide.parcel || null,
    intercity: populatedRide.intercity || null,
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
