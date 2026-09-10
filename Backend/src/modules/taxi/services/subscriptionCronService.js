import { DriverSubscription } from '../driver/models/DriverSubscription.js';
import { SubscriptionTier } from '../admin/models/SubscriptionTier.js';

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

          await DriverSubscription.create({
            driver_id: sub.driver_id,
            tier_id: queuedTier._id,
            billing_cycle: sub.queued_billing_cycle || 'monthly',
            start_date: startDate,
            end_date: endDate,
            status: 'active',
          });

          transitionedCount += 1;
          continue;
        }
      }

      // No queued tier or tier inactive -> Mark expired (driver falls back to is_default: true tier)
      sub.status = 'expired';
      await sub.save();
      expiredCount += 1;
    }

    console.log(`[subscriptionCronService] Processed ${expiredSubscriptions.length} expired subscriptions (${transitionedCount} queued transitions, ${expiredCount} expired to fallback).`);
    return { processedCount: expiredSubscriptions.length, transitionedCount, expiredCount };
  } catch (error) {
    console.error('[subscriptionCronService] Expiration cron failed:', error);
    return { error: error.message };
  }
};

export const startSubscriptionCronJob = (intervalMinutes = 5) => {
  const ms = intervalMinutes * 60 * 1000;
  console.log(`[subscriptionCronService] Initializing driver subscription expiration check (interval: ${intervalMinutes} mins)...`);

  // Run immediately on start
  processSubscriptionExpirations().catch(() => {});

  // Schedule every 5 minutes
  return setInterval(() => {
    processSubscriptionExpirations().catch(() => {});
  }, ms);
};
