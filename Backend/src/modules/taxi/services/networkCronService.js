import { Ride } from '../user/models/Ride.js';
import { RIDE_STATUS } from '../constants/index.js';
import { expirePublishedRides } from '../driver/services/feedService.js';
import { releasePublishedRide } from '../driver/services/escrowService.js';

const ORPHAN_GRACE_MS = 60 * 60 * 1000;

/**
 * Escrow that outlived its ride.
 *
 * Cancellation releases holds outside the cancelling transaction (Mongo cannot
 * nest one), so a crash between the two leaves money frozen against a ride that
 * is already dead. This is the net that catches that case.
 */
export const releaseOrphanedEscrow = async () => {
  const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS);

  const orphans = await Ride.find({
    'escrow.state': 'held',
    status: { $in: [RIDE_STATUS.CANCELLED, RIDE_STATUS.COMPLETED] },
    updatedAt: { $lt: cutoff },
  })
    .select('_id status')
    .limit(100)
    .lean();

  if (!orphans.length) return { released: 0 };

  let released = 0;
  for (const ride of orphans) {
    try {
      const result = await releasePublishedRide({ rideId: ride._id, reason: 'orphaned_escrow_sweep' });
      if (result.released) released += 1;
      console.warn(
        `[networkCron] Released orphaned escrow on ride ${ride._id} (ride was ${ride.status}).`,
      );
    } catch (error) {
      console.error(`[networkCron] Failed to release orphaned escrow on ${ride._id}:`, error.message);
    }
  }

  return { released };
};

/**
 * Closes the dispute window on settled escrows.
 *
 * Nothing moves here — the money was settled at completion. Clearing
 * `dispute_until` is what makes the record final, so a late dispute is refused
 * with `DISPUTE_WINDOW_CLOSED` rather than silently reopening paid-out rides.
 */
export const finalizeDisputeWindows = async () => {
  const result = await Ride.updateMany(
    {
      'escrow.state': 'settled',
      'escrow.dispute_until': { $ne: null, $lt: new Date() },
    },
    { $set: { 'escrow.dispute_until': null } },
  );

  return { finalized: result?.modifiedCount || 0 };
};

export const runNetworkMaintenance = async () => {
  try {
    const expired = await expirePublishedRides();
    const orphans = await releaseOrphanedEscrow();
    const finalized = await finalizeDisputeWindows();
    return { ...expired, ...orphans, ...finalized };
  } catch (error) {
    console.error('[networkCron] Maintenance pass failed:', error.message);
    return { error: error.message };
  }
};

/**
 * Published leads expire on the minute, so this runs far more often than the
 * subscription sweep; the orphan check is cheap enough to ride along.
 */
export const startNetworkCronJob = (intervalMinutes = 1) => {
  const ms = Math.max(1, intervalMinutes) * 60 * 1000;
  console.log(`[networkCron] Starting driver-network maintenance (interval: ${intervalMinutes} min)...`);

  runNetworkMaintenance().catch(() => {});
  return setInterval(() => {
    runNetworkMaintenance().catch(() => {});
  }, ms);
};
