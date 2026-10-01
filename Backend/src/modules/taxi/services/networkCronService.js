import { Ride } from '../user/models/Ride.js';
import { FleetVehicle } from '../admin/models/FleetVehicle.js';
import { Driver } from '../driver/models/Driver.js';
import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../constants/index.js';
import { expirePublishedRides } from '../driver/services/feedService.js';
import { releasePublishedRide } from '../driver/services/escrowService.js';
import {
  notifyAssignmentUnacknowledged,
  notifyScheduledRideReminder,
  notifyScheduledRideReminderOwner,
  notifyVehicleDocumentExpiring,
} from './networkNotificationService.js';

const ORPHAN_GRACE_MS = 60 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// Pickup reminder window: a scheduled ride 30-45 min away. Wide enough (15 min)
// that a missed cron tick or a short restart still lands inside it.
const PICKUP_REMINDER_MIN_MS = 30 * MINUTE_MS;
const PICKUP_REMINDER_MAX_MS = 45 * MINUTE_MS;

// "Driver has not confirmed" nudge: an immediate ride 10 min after assigning,
// a scheduled one 2 h before pickup (but never sooner than 10 min after the
// assignment itself, so assigning a ride 90 min out doesn't nudge instantly).
const UNACKNOWLEDGED_AFTER_MS = 10 * MINUTE_MS;
const UNACKNOWLEDGED_SCHEDULED_LEAD_MS = 2 * 60 * MINUTE_MS;

const DOCUMENT_EXPIRY_LEAD_DAYS = 15;
// The document scan walks every active fleet vehicle, and a reminder is only
// ever relevant once per day, so it does not ride along on every 1-minute tick.
const DOCUMENT_SWEEP_INTERVAL_MS = 6 * 60 * MINUTE_MS;
let lastDocumentSweepAt = 0;

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

const driverNameOf = async (driverId) =>
  (await Driver.findById(driverId).select('name').lean())?.name || 'Your driver';

/**
 * Pickup reminders for assigned driver-created rides, sent exactly once each:
 *  - the assigned driver, 30-45 min before pickup;
 *  - the owner at the same moment, but only if the driver still hasn't confirmed.
 *
 * Each send is claimed with a guarded update first, so two overlapping passes
 * (or a restart mid-pass) can never double-send.
 */
export const sendScheduledRideReminders = async (now = new Date()) => {
  const rides = await Ride.find({
    origin: 'driver_created',
    status: RIDE_STATUS.ACCEPTED,
    liveStatus: { $nin: [RIDE_LIVE_STATUS.STARTED, RIDE_LIVE_STATUS.COMPLETED, RIDE_LIVE_STATUS.CANCELLED] },
    driverId: { $ne: null },
    scheduledAt: {
      $gte: new Date(now.getTime() + PICKUP_REMINDER_MIN_MS),
      $lte: new Date(now.getTime() + PICKUP_REMINDER_MAX_MS),
    },
    $or: [
      { 'reminders.pickup_sent_at': null },
      { 'reminders.owner_pickup_sent_at': null, 'assignment.acknowledged_at': null },
    ],
  })
    .select('driverId scheduledAt pickupAddress created_by_driver_id assignment reminders')
    .limit(200)
    .lean();

  let driverReminders = 0;
  let ownerReminders = 0;

  for (const ride of rides) {
    try {
      const driverClaim = await Ride.findOneAndUpdate(
        { _id: ride._id, 'reminders.pickup_sent_at': null },
        { $set: { 'reminders.pickup_sent_at': now } },
      );
      if (driverClaim) {
        await notifyScheduledRideReminder(ride);
        driverReminders += 1;
      }

      if (!ride.assignment?.acknowledged_at) {
        const ownerClaim = await Ride.findOneAndUpdate(
          { _id: ride._id, 'reminders.owner_pickup_sent_at': null, 'assignment.acknowledged_at': null },
          { $set: { 'reminders.owner_pickup_sent_at': now } },
        );
        if (ownerClaim) {
          await notifyScheduledRideReminderOwner(ride, await driverNameOf(ride.driverId));
          ownerReminders += 1;
        }
      }
    } catch (error) {
      console.error(`[networkCron] Pickup reminder failed for ride ${ride._id}:`, error.message);
    }
  }

  return { driverReminders, ownerReminders };
};

/** Nudges the owner about an assignment the driver has not confirmed in time. */
export const sendUnacknowledgedAssignmentNudges = async (now = new Date()) => {
  const rides = await Ride.find({
    origin: 'driver_created',
    status: RIDE_STATUS.ACCEPTED,
    driverId: { $ne: null },
    'assignment.acknowledged_at': null,
    'assignment.assigned_at': { $ne: null, $lte: new Date(now.getTime() - UNACKNOWLEDGED_AFTER_MS) },
    'reminders.unacknowledged_sent_at': null,
    $or: [
      { scheduledAt: null },
      {
        scheduledAt: {
          $gt: now,
          $lte: new Date(now.getTime() + UNACKNOWLEDGED_SCHEDULED_LEAD_MS),
        },
      },
    ],
  })
    .select('driverId scheduledAt pickupAddress created_by_driver_id assignment')
    .limit(200)
    .lean();

  let nudged = 0;

  for (const ride of rides) {
    try {
      const claim = await Ride.findOneAndUpdate(
        { _id: ride._id, 'reminders.unacknowledged_sent_at': null, 'assignment.acknowledged_at': null },
        { $set: { 'reminders.unacknowledged_sent_at': now } },
      );
      if (!claim) continue;

      await notifyAssignmentUnacknowledged(ride, await driverNameOf(ride.driverId));
      nudged += 1;
    } catch (error) {
      console.error(`[networkCron] Unacknowledged nudge failed for ride ${ride._id}:`, error.message);
    }
  }

  return { nudged };
};

const parseDocumentExpiry = (document) => {
  const raw = document?.expiresAt || document?.expiryDate || document?.expiry_date;
  if (!raw) return null;

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Pushes the owner when a fleet vehicle document is within 15 days of expiry.
 * One reminder per document *and expiry value*: renewing a document (a new
 * expiry) re-arms it, while an unchanged one never repeats.
 */
export const sendVehicleDocumentExpiryReminders = async (now = new Date()) => {
  const floor = now.getTime() - DAY_MS;
  const horizon = now.getTime() + DOCUMENT_EXPIRY_LEAD_DAYS * DAY_MS;
  const recipientCache = new Map();
  let sent = 0;

  const resolveRecipients = async (ownerId) => {
    const cacheKey = String(ownerId);
    if (!recipientCache.has(cacheKey)) {
      const selfDriveOwners = await Driver.find({ owner_id: ownerId, deletedAt: null, is_self_drive_owner: true })
        .select('_id')
        .lean();
      const drivers = selfDriveOwners.length
        ? selfDriveOwners
        : await Driver.find({ owner_id: ownerId, deletedAt: null }).select('_id').lean();
      recipientCache.set(cacheKey, drivers.map((driver) => String(driver._id)));
    }
    return recipientCache.get(cacheKey);
  };

  const cursor = FleetVehicle.find({ active: true })
    .select('owner_id license_plate_number documents document_expiry_notified')
    .lean()
    .cursor();

  for await (const vehicle of cursor) {
    for (const [key, document] of Object.entries(vehicle.documents || {})) {
      if (!document || typeof document !== 'object' || key.includes('.') || key.startsWith('$')) continue;

      const expiresAt = parseDocumentExpiry(document);
      if (!expiresAt || expiresAt.getTime() < floor || expiresAt.getTime() > horizon) continue;

      const stamp = expiresAt.toISOString();
      if (vehicle.document_expiry_notified?.[key] === stamp) continue;

      try {
        const claim = await FleetVehicle.updateOne(
          { _id: vehicle._id, [`document_expiry_notified.${key}`]: { $ne: stamp } },
          { $set: { [`document_expiry_notified.${key}`]: stamp } },
        );
        if (!claim.modifiedCount) continue;

        await notifyVehicleDocumentExpiring({
          driverIds: await resolveRecipients(vehicle.owner_id),
          vehicle,
          key,
          expiresAt,
          daysLeft: Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS),
        });
        sent += 1;
      } catch (error) {
        console.error(`[networkCron] Document expiry reminder failed for ${vehicle._id}/${key}:`, error.message);
      }
    }
  }

  return { documentReminders: sent };
};

const runGuarded = async (label, task) => {
  try {
    return await task();
  } catch (error) {
    console.error(`[networkCron] ${label} failed:`, error.message);
    return { [`${label}Error`]: error.message };
  }
};

export const runNetworkMaintenance = async () => {
  try {
    const expired = await expirePublishedRides();
    const orphans = await releaseOrphanedEscrow();
    const finalized = await finalizeDisputeWindows();

    // Independent of each other and of the sweeps above: one failing must not
    // starve the rest.
    const pickupReminders = await runGuarded('pickupReminders', () => sendScheduledRideReminders());
    const nudges = await runGuarded('unacknowledgedNudges', () => sendUnacknowledgedAssignmentNudges());

    let documentReminders = {};
    if (Date.now() - lastDocumentSweepAt >= DOCUMENT_SWEEP_INTERVAL_MS) {
      lastDocumentSweepAt = Date.now();
      documentReminders = await runGuarded('documentReminders', () => sendVehicleDocumentExpiryReminders());
    }

    return { ...expired, ...orphans, ...finalized, ...pickupReminders, ...nudges, ...documentReminders };
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
