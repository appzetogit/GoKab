import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { Ride } from '../../user/models/Ride.js';
import { Driver } from '../models/Driver.js';
import { WalletTransaction } from '../models/WalletTransaction.js';
import { applyDriverWalletAdjustment, getWalletSnapshot } from './walletService.js';
import { getDriverNetworkSettings } from '../../services/appSettingsService.js';

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

/**
 * Locks `amount` of a driver's balance.
 *
 * The balance itself does not move — nothing has been earned or spent yet —
 * only `frozenBalance` grows, and every affordability check works off
 * `balance - frozenBalance`. The `$expr` guard makes the check and the increment
 * one atomic operation, so two simultaneous accepts cannot both pass a
 * "you have enough" test against the same money.
 */
const freeze = async ({ driverId, amount, rideId, session, errorCode, description }) => {
  const safeAmount = round2(amount);
  if (safeAmount <= 0) return null;

  const driver = await Driver.findOneAndUpdate(
    {
      _id: driverId,
      $expr: {
        $gte: [
          { $subtract: ['$wallet.balance', { $ifNull: ['$wallet.frozenBalance', 0] }] },
          safeAmount,
        ],
      },
    },
    { $inc: { 'wallet.frozenBalance': safeAmount } },
    { new: true, session },
  );

  if (!driver) {
    const current = await Driver.findById(driverId).select('wallet').session(session).lean();
    const available = round2(
      Number(current?.wallet?.balance || 0) - Number(current?.wallet?.frozenBalance || 0),
    );
    throw new ApiError(
      402,
      'Not enough available wallet balance',
      { required: safeAmount, available },
      errorCode,
    );
  }

  const frozenAfter = round2(driver.wallet.frozenBalance);
  const [transaction] = await WalletTransaction.create(
    [
      {
        driverId,
        rideId,
        type: 'escrow_hold',
        amount: 0,
        balanceBefore: round2(driver.wallet.balance),
        balanceAfter: round2(driver.wallet.balance),
        cashLimit: Number(driver.wallet.cashLimit || 0),
        isBlockedAfter: Boolean(driver.wallet.isBlocked),
        frozenBefore: round2(frozenAfter - safeAmount),
        frozenAfter,
        description: description || 'Escrow hold for published ride',
        metadata: { heldAmount: safeAmount },
      },
    ],
    { session },
  );

  return transaction;
};

/** Releases a hold without moving any money. */
const unfreeze = async ({ driverId, amount, rideId, session, description }) => {
  const safeAmount = round2(amount);
  if (safeAmount <= 0) return null;

  // Clamped at zero: a double release must not drive `frozenBalance` negative
  // and hand the driver spendable money that was never theirs.
  const before = await Driver.findById(driverId).select('wallet').session(session).lean();
  const frozenBefore = round2(before?.wallet?.frozenBalance || 0);
  const decrement = Math.min(frozenBefore, safeAmount);
  if (decrement <= 0) return null;

  const driver = await Driver.findOneAndUpdate(
    { _id: driverId },
    { $inc: { 'wallet.frozenBalance': -decrement } },
    { new: true, session },
  );

  const [transaction] = await WalletTransaction.create(
    [
      {
        driverId,
        rideId,
        type: 'escrow_release',
        amount: 0,
        balanceBefore: round2(driver.wallet.balance),
        balanceAfter: round2(driver.wallet.balance),
        cashLimit: Number(driver.wallet.cashLimit || 0),
        isBlockedAfter: Boolean(driver.wallet.isBlocked),
        frozenBefore,
        frozenAfter: round2(driver.wallet.frozenBalance),
        description: description || 'Escrow hold released',
        metadata: { releasedAmount: decrement },
      },
    ],
    { session },
  );

  return transaction;
};

/** Moves money between two drivers as one debit and one credit. */
const transferBetweenDrivers = async ({ fromDriverId, toDriverId, amount, rideId, session, reason }) => {
  const safeAmount = round2(amount);
  if (safeAmount <= 0) return [];

  const out = await applyDriverWalletAdjustment({
    driverId: fromDriverId,
    amount: -safeAmount,
    type: 'escrow_transfer_out',
    rideId,
    description: reason || 'Paid to network driver',
    metadata: { counterpartyDriverId: String(toDriverId) },
    session,
  });

  const credit = await applyDriverWalletAdjustment({
    driverId: toDriverId,
    amount: safeAmount,
    type: 'escrow_transfer_in',
    rideId,
    description: reason || 'Received from network driver',
    metadata: { counterpartyDriverId: String(fromDriverId) },
    session,
  });

  await WalletTransaction.updateOne(
    { _id: out.transaction._id },
    { $set: { counterpartyDriverId: toDriverId, settlementSource: 'driver' } },
    { session },
  );
  await WalletTransaction.updateOne(
    { _id: credit.transaction._id },
    { $set: { counterpartyDriverId: fromDriverId, settlementSource: 'driver' } },
    { session },
  );

  return [out.transaction._id, credit.transaction._id];
};

/**
 * Locks both sides of a published ride the moment a driver accepts it.
 *
 * The publisher freezes the driver's payout and the acceptor freezes the
 * publisher's commission, so whichever of them physically collects the cash can
 * be made to pay the other one out at completion.
 */
export const holdForPublishedRide = async ({ ride, session }) => {
  const publisherId = ride.created_by_driver_id;
  const acceptorId = ride.driverId;
  const publisherHold = round2(ride.publish?.driver_payout);
  const acceptorHold = round2(ride.publish?.owner_commission);

  if (!publisherId || !acceptorId) {
    throw new ApiError(409, 'This ride is missing a publisher or acceptor', null, 'ESCROW_STATE_INVALID');
  }

  const holdTxnIds = [];

  const publisherTxn = await freeze({
    driverId: publisherId,
    amount: publisherHold,
    rideId: ride._id,
    session,
    errorCode: 'PUBLISHER_INSUFFICIENT_WALLET',
    description: 'Held for driver payout on published ride',
  });
  if (publisherTxn) holdTxnIds.push(publisherTxn._id);

  const acceptorTxn = await freeze({
    driverId: acceptorId,
    amount: acceptorHold,
    rideId: ride._id,
    session,
    errorCode: 'INSUFFICIENT_WALLET',
    description: 'Held for owner commission on published ride',
  });
  if (acceptorTxn) holdTxnIds.push(acceptorTxn._id);

  // Guarded on `state: 'none'` so a retry cannot double-book the escrow.
  const updated = await Ride.findOneAndUpdate(
    { _id: ride._id, 'escrow.state': 'none' },
    {
      $set: {
        'escrow.state': 'held',
        'escrow.publisher_driver_id': publisherId,
        'escrow.acceptor_driver_id': acceptorId,
        'escrow.publisher_hold': publisherHold,
        'escrow.acceptor_hold': acceptorHold,
        'escrow.hold_txn_ids': holdTxnIds,
      },
    },
    { new: true, session },
  );

  if (!updated) {
    throw new ApiError(409, 'Escrow is already open for this ride', null, 'ESCROW_STATE_INVALID');
  }

  return updated;
};

const runInTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Closes the escrow once the trip is done.
 *
 * `collectedBy` says who actually took the customer's money, and that decides
 * the single transfer needed to leave both sides whole:
 *   - publisher collected → publisher owes the acceptor the driver payout
 *   - acceptor collected  → acceptor owes the publisher the commission
 *   - paid in-app         → nobody holds cash, so each side is simply credited
 */
export const settlePublishedRide = async ({ rideId, collectedBy, confirmedBy = 'driver' }) => {
  // Captured inside the transaction, notified after it commits — telling both
  // drivers about money that then rolled back would be worse than a late push.
  let settled = null;

  if (!['publisher', 'driver', 'platform'].includes(String(collectedBy))) {
    throw new ApiError(
      422,
      "collected_by must be 'publisher', 'driver' or 'platform'",
      null,
      'COLLECTED_BY_REQUIRED',
    );
  }

  const settings = await getDriverNetworkSettings();
  const platformPercent = Math.max(
    0,
    Number(settings.platform_commission_on_published_rides_percent || 0),
  );

  const result = await runInTransaction(async (session) => {
    // Claiming the state transition first makes the whole settlement idempotent:
    // a second call finds nothing in `held` and does no money movement.
    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, 'escrow.state': 'held' },
      {
        $set: {
          'escrow.state': 'settled',
          'escrow.collected_by': collectedBy,
          'escrow.collected_confirmed_by': confirmedBy,
          'escrow.settled_at': new Date(),
          'escrow.dispute_until': new Date(
            Date.now() + Math.max(0, Number(settings.escrow_dispute_window_hours || 24)) * 3600 * 1000,
          ),
        },
      },
      { new: true, session },
    );

    if (!ride) {
      throw new ApiError(409, 'This ride has no open escrow to settle', null, 'ESCROW_STATE_INVALID');
    }

    const publisherId = ride.escrow.publisher_driver_id;
    const acceptorId = ride.escrow.acceptor_driver_id;
    const publisherHold = round2(ride.escrow.publisher_hold);
    const acceptorHold = round2(ride.escrow.acceptor_hold);

    await unfreeze({
      driverId: publisherId,
      amount: publisherHold,
      rideId: ride._id,
      session,
      description: 'Published ride settled',
    });
    await unfreeze({
      driverId: acceptorId,
      amount: acceptorHold,
      rideId: ride._id,
      session,
      description: 'Published ride settled',
    });

    let settleTxnIds = [];

    if (collectedBy === 'publisher') {
      settleTxnIds = await transferBetweenDrivers({
        fromDriverId: publisherId,
        toDriverId: acceptorId,
        amount: publisherHold,
        rideId: ride._id,
        session,
        reason: 'Driver payout for published ride',
      });
    } else if (collectedBy === 'driver') {
      settleTxnIds = await transferBetweenDrivers({
        fromDriverId: acceptorId,
        toDriverId: publisherId,
        amount: acceptorHold,
        rideId: ride._id,
        session,
        reason: 'Owner commission for published ride',
      });
    } else {
      // Paid in the app: the platform holds the fare, so it pays both sides.
      const platformFee = round2((acceptorHold * platformPercent) / 100);

      const publisherCredit = await applyDriverWalletAdjustment({
        driverId: publisherId,
        amount: round2(acceptorHold - platformFee),
        type: 'escrow_transfer_in',
        rideId: ride._id,
        description: 'Owner commission for published ride (paid online)',
        metadata: { platformFee, counterpartyDriverId: String(acceptorId) },
        session,
      });
      const acceptorCredit = await applyDriverWalletAdjustment({
        driverId: acceptorId,
        amount: publisherHold,
        type: 'escrow_transfer_in',
        rideId: ride._id,
        description: 'Driver payout for published ride (paid online)',
        metadata: { counterpartyDriverId: String(publisherId) },
        session,
      });
      // `counterpartyDriverId` is a real column, not just metadata — reports and
      // audits join on it, and leaving it null here made the platform payouts
      // the only escrow rows with no recorded other party.
      await WalletTransaction.updateOne(
        { _id: publisherCredit.transaction._id },
        { $set: { counterpartyDriverId: acceptorId, settlementSource: 'platform' } },
        { session },
      );
      await WalletTransaction.updateOne(
        { _id: acceptorCredit.transaction._id },
        { $set: { counterpartyDriverId: publisherId, settlementSource: 'platform' } },
        { session },
      );

      settleTxnIds = [publisherCredit.transaction._id, acceptorCredit.transaction._id];
    }

    await Ride.updateOne(
      { _id: ride._id },
      { $set: { 'escrow.settle_txn_ids': settleTxnIds, walletSettledAt: new Date() } },
      { session },
    );

    settled = ride;
    return { rideId: String(ride._id), collectedBy, settleTxnIds: settleTxnIds.map(String) };
  });

  if (settled) {
    const { notifyEscrowSettled } = await import('../../services/networkNotificationService.js');
    await notifyEscrowSettled({
      ride: settled,
      collectedBy,
      disputeUntil: settled.escrow?.dispute_until || null,
    }).catch((error) => console.error('[escrowService] settle notification failed:', error.message));
  }

  return result;
};

/**
 * Unwinds an escrow that will never complete — cancelled, expired or
 * unassigned. Nothing changes hands; both holds simply go back.
 */
export const releasePublishedRide = async ({ rideId, reason = '', penaltyFrom = null }) => {
  const settings = await getDriverNetworkSettings();
  const penalty = round2(settings.cancel_penalty_after_accept || 0);

  return runInTransaction(async (session) => {
    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, 'escrow.state': 'held' },
      {
        $set: {
          'escrow.state': 'released',
          'escrow.released_at': new Date(),
        },
      },
      { new: true, session },
    );

    if (!ride) return { released: false, reason: 'no-open-escrow' };

    await unfreeze({
      driverId: ride.escrow.publisher_driver_id,
      amount: ride.escrow.publisher_hold,
      rideId: ride._id,
      session,
      description: reason || 'Published ride closed',
    });
    await unfreeze({
      driverId: ride.escrow.acceptor_driver_id,
      amount: ride.escrow.acceptor_hold,
      rideId: ride._id,
      session,
      description: reason || 'Published ride closed',
    });

    // A driver who backs out after accepting compensates the publisher, if the
    // admin has configured a penalty.
    if (penalty > 0 && penaltyFrom === 'acceptor') {
      await transferBetweenDrivers({
        fromDriverId: ride.escrow.acceptor_driver_id,
        toDriverId: ride.escrow.publisher_driver_id,
        amount: penalty,
        rideId: ride._id,
        session,
        reason: 'Cancellation penalty after accepting a published ride',
      });
    }

    return { released: true, penaltyApplied: penalty > 0 && penaltyFrom === 'acceptor' };
  });
};

const openDisputeTicket = async ({ ride, driverId, reason }) => {
  try {
    const { SupportTicket } = await import('../../support/models/SupportTicket.js');
    const driver = await Driver.findById(driverId).select('name phone').lean();

    const ticketCode = `TIC_${Date.now()}${Math.floor(100000 + Math.random() * 900000)}`;
    const summary =
      `Escrow dispute on ride ${String(ride._id)}. ` +
      `Driver reported the fare as collected by "${ride.escrow?.collected_by}". ` +
      `Publisher hold ₹${ride.escrow?.publisher_hold}, acceptor hold ₹${ride.escrow?.acceptor_hold}.` +
      `${reason ? ` Reason: ${reason}` : ''}`;

    return await SupportTicket.create({
      ticketCode,
      title: 'Escrow settlement dispute',
      userType: 'driver',
      supportType: 'request',
      requesterRole: 'driver',
      requesterId: driverId,
      requesterName: driver?.name || '',
      requesterPhone: driver?.phone || '',
      status: 'pending',
      messages: [
        {
          senderRole: 'driver',
          senderId: driverId,
          senderName: driver?.name || '',
          message: summary,
        },
      ],
      lastMessageAt: new Date(),
    });
  } catch (error) {
    // The dispute itself already succeeded; failing to file the ticket must not
    // roll that back, but it does need to be loud in the logs.
    console.error('[escrowService] could not open dispute support ticket:', error.message);
    return null;
  }
};

export const openEscrowDispute = async ({ rideId, driverId, reason = '' }) => {
  const ride = await Ride.findById(rideId);
  if (!ride) throw new ApiError(404, 'Ride not found', null, 'RIDE_NOT_FOUND');

  if (ride.escrow?.state !== 'settled') {
    throw new ApiError(409, 'Only a settled escrow can be disputed', null, 'ESCROW_STATE_INVALID');
  }
  if (String(ride.escrow.publisher_driver_id || '') !== String(driverId)) {
    throw new ApiError(403, 'Only the publisher can dispute this settlement', null, 'NOT_RIDE_OWNER');
  }
  if (!ride.escrow.dispute_until || ride.escrow.dispute_until < new Date()) {
    throw new ApiError(409, 'The dispute window has closed', null, 'DISPUTE_WINDOW_CLOSED');
  }

  ride.escrow.state = 'disputed';
  ride.network_notes = String(reason || ride.network_notes || '').trim();
  await ride.save();

  // A dispute needs somewhere an admin will actually see it. A socket event
  // only reaches an admin who happens to be online at that moment, so the
  // dispute also opens a support ticket that survives until someone works it.
  const ticket = await openDisputeTicket({ ride, driverId, reason });

  const { notifyEscrowDisputed } = await import('../../services/networkNotificationService.js');
  await notifyEscrowDisputed({ ride, reason }).catch((error) =>
    console.error('[escrowService] dispute notification failed:', error.message),
  );

  return { disputed: true, rideId: String(ride._id), ticketCode: ticket?.ticketCode || null };
};

/**
 * Admin correction: the settlement was booked against the wrong collector, so
 * reverse the transfer that was made and apply the correct one.
 */
export const resolveEscrowDispute = async ({ rideId, correctCollectedBy, adminId = null }) => {
  if (!['publisher', 'driver', 'platform'].includes(String(correctCollectedBy))) {
    throw new ApiError(422, 'collected_by is invalid', null, 'COLLECTED_BY_REQUIRED');
  }

  let resolved = null;
  const outcome = await runInTransaction(async (session) => {
    const ride = await Ride.findOne({ _id: rideId, 'escrow.state': 'disputed' }).session(session);
    if (!ride) {
      throw new ApiError(409, 'This ride has no open dispute', null, 'ESCROW_STATE_INVALID');
    }

    const previous = ride.escrow.collected_by;
    const publisherId = ride.escrow.publisher_driver_id;
    const acceptorId = ride.escrow.acceptor_driver_id;
    const publisherHold = round2(ride.escrow.publisher_hold);
    const acceptorHold = round2(ride.escrow.acceptor_hold);

    if (previous !== correctCollectedBy) {
      // Undo whichever transfer the original settlement made...
      if (previous === 'publisher') {
        await transferBetweenDrivers({
          fromDriverId: acceptorId,
          toDriverId: publisherId,
          amount: publisherHold,
          rideId: ride._id,
          session,
          reason: 'Dispute correction: reversing driver payout',
        });
      } else if (previous === 'driver') {
        await transferBetweenDrivers({
          fromDriverId: publisherId,
          toDriverId: acceptorId,
          amount: acceptorHold,
          rideId: ride._id,
          session,
          reason: 'Dispute correction: reversing owner commission',
        });
      }

      // ...then apply the one that should have happened.
      if (correctCollectedBy === 'publisher') {
        await transferBetweenDrivers({
          fromDriverId: publisherId,
          toDriverId: acceptorId,
          amount: publisherHold,
          rideId: ride._id,
          session,
          reason: 'Dispute correction: driver payout',
        });
      } else if (correctCollectedBy === 'driver') {
        await transferBetweenDrivers({
          fromDriverId: acceptorId,
          toDriverId: publisherId,
          amount: acceptorHold,
          rideId: ride._id,
          session,
          reason: 'Dispute correction: owner commission',
        });
      }
    }

    ride.escrow.state = 'settled';
    ride.escrow.collected_by = correctCollectedBy;
    ride.escrow.collected_confirmed_by = 'admin';
    ride.escrow.dispute_until = null;
    ride.escrow.settled_at = new Date();
    await ride.save({ session });

    resolved = ride;
    return { rideId: String(ride._id), collectedBy: correctCollectedBy, correctedBy: adminId };
  });

  if (resolved) {
    const { notifyEscrowDisputeResolved } = await import('../../services/networkNotificationService.js');
    await notifyEscrowDisputeResolved({ ride: resolved, collectedBy: correctCollectedBy }).catch(
      (error) => console.error('[escrowService] resolve notification failed:', error.message),
    );
  }

  return outcome;
};

/** Wallet view including what is locked — used by the wallet screen. */
export const getEscrowAwareWallet = async (driverOrId) => {
  const driver =
    typeof driverOrId === 'object' && driverOrId?._id && !(driverOrId instanceof mongoose.Types.ObjectId)
      ? driverOrId
      : await Driver.findById(driverOrId);

  if (!driver) throw new ApiError(404, 'Driver not found', null, 'DRIVER_NOT_FOUND');

  const snapshot = await getWalletSnapshot(driver);
  const frozen = round2(driver.wallet?.frozenBalance || 0);

  return {
    balance: snapshot.balance,
    frozenBalance: frozen,
    available: round2(snapshot.balance - frozen),
  };
};
