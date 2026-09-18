import { DriverSubscription } from '../driver/models/DriverSubscription.js';
import { SubscriptionTier } from '../admin/models/SubscriptionTier.js';
import {
  applyCategoryFromSubscription,
  downgradeToLower,
  enforceCategoryGrace,
  releaseStalePrimeReservations,
} from './driverCategoryService.js';

export const processSubscriptionExpirations = async () => {
  try {
    const now = new Date();
    const expiredSubscriptions = await DriverSubscription.find({
      status: 'active',
      end_date: { $lte: now },
    });

    if (expiredSubscriptions.length === 0) {
      return { processedCount: 0 };
    }

    let transitionedCount = 0;
    let expiredCount = 0;

    for (const sub of expiredSubscriptions) {
      if (sub.queued_tier_id) {
        const queuedTier = await SubscriptionTier.findById(sub.queued_tier_id);
        if (queuedTier && queuedTier.is_active) {
          // Deactivate current sub
          sub.status = 'expired';
          await sub.save();

          // Create new subscription with queued tier
          const durationDays = sub.queued_billing_cycle === 'yearly' ? 365 : 30;
          const startDate = now;
          const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

          const nextSub = await DriverSubscription.create({
            driver_id: sub.driver_id,
            tier_id: queuedTier._id,
            billing_cycle: sub.queued_billing_cycle || 'monthly',
            start_date: startDate,
            end_date: endDate,
            status: 'active',
          });

          // A queued downgrade lands here: move the driver's network category
          // (and their Prime seat) onto the tier that just took over.
          await applyCategoryFromSubscription({ subscription: nextSub });

          transitionedCount += 1;
          continue;
        }
      }

      // No queued tier or tier inactive -> Mark expired (driver falls back to is_default: true tier)
      sub.status = 'expired';
      await sub.save();
      // The fallback default tier is Lower, so the network category and the
      // Prime seat have to follow — otherwise a lapsed driver keeps publishing.
      await downgradeToLower({ driverId: sub.driver_id, reason: 'subscription_expired' });
      expiredCount += 1;
    }

    console.log(`[subscriptionCronService] Processed ${expiredSubscriptions.length} expired subscriptions (${transitionedCount} queued transitions, ${expiredCount} expired to fallback).`);
    return { processedCount: expiredSubscriptions.length, transitionedCount, expiredCount };
  } catch (error) {
    console.error('[subscriptionCronService] Expiration cron failed:', error);
    return { error: error.message };
  }
};

// How many days before expiry the driver is nudged. A driver who only learns
// their plan lapsed *after* it lapsed has already lost a day of Prime rides.
const REMINDER_DAYS = [3, 1];

/**
 * Warns drivers whose plan is about to expire.
 *
 * Guarded by `renewal_reminder_sent_for` so a cron running every five minutes
 * sends each reminder once, not sixty times a day, and respects the driver's
 * own opt-out (`suppress_renewal_reminders`).
 */
export const sendRenewalReminders = async () => {
  const now = new Date();
  let sent = 0;

  for (const days of REMINDER_DAYS) {
    const windowStart = new Date(now.getTime() + (days - 1) * 864e5);
    const windowEnd = new Date(now.getTime() + days * 864e5);

    const due = await DriverSubscription.find({
      status: 'active',
      suppress_renewal_reminders: { $ne: true },
      end_date: { $gt: windowStart, $lte: windowEnd },
      renewal_reminder_sent_for: { $ne: days },
    })
      .populate('tier_id', 'name driver_category')
      .limit(200);

    for (const subscription of due) {
      try {
        const { sendPushNotificationToEntities } = await import('./pushNotificationService.js');
        const { emitToRoom, getDriverRoom } = await import('./dispatchService.js');
        const planName = subscription.tier_id?.name || 'your plan';

        emitToRoom(getDriverRoom(subscription.driver_id), 'driver:subscription:expiring', {
          days_left: days,
          end_date: subscription.end_date,
          tier: planName,
        });

        await sendPushNotificationToEntities({
          driverIds: [String(subscription.driver_id)],
          title: days === 1 ? `${planName} expires tomorrow` : `${planName} expires in ${days} days`,
          body: 'Recharge now to keep your current category and its features.',
          data: { type: 'subscription_expiring', days_left: String(days) },
        });

        subscription.renewal_reminder_sent_for = days;
        await subscription.save();
        sent += 1;
      } catch (error) {
        console.error('[subscriptionCronService] reminder failed:', error.message);
      }
    }
  }

  if (sent) console.log(`[subscriptionCronService] Sent ${sent} renewal reminders.`);
  return { sent };
};

/**
 * Housekeeping that rides along with the subscription sweep: abandoned Prime
 * checkouts must free their seat, and a driver whose vehicle-rule grace has run
 * out must lose the category the rule was guarding.
 */
export const processDriverNetworkMaintenance = async () => {
  try {
    const reservations = await releaseStalePrimeReservations();
    const grace = await enforceCategoryGrace();

    if (reservations.released || grace.downgraded.length) {
      console.log(
        `[subscriptionCronService] Network maintenance: released ${reservations.released} stale Prime reservations, downgraded ${grace.downgraded.length} drivers after grace.`,
      );
    }

    return { ...reservations, graceDowngraded: grace.downgraded.length };
  } catch (error) {
    console.error('[subscriptionCronService] Driver network maintenance failed:', error);
    return { error: error.message };
  }
};

export const startSubscriptionCronJob = (intervalMinutes = 5) => {
  const ms = intervalMinutes * 60 * 1000;
  console.log(`[subscriptionCronService] Initializing driver subscription expiration check (interval: ${intervalMinutes} mins)...`);

  const runAll = () => {
    processSubscriptionExpirations().catch(() => {});
    processDriverNetworkMaintenance().catch(() => {});
    sendRenewalReminders().catch(() => {});
  };

  // Run immediately on start
  runAll();

  // Schedule every 5 minutes
  return setInterval(runAll, ms);
};
