import { createServer } from 'node:http';
import { createApp } from './src/app.js';
import { connectDatabase } from './src/config/database.js';
import { env } from './src/config/env.js';
import { configureTaxiSocketServer } from './src/modules/taxi/socket/index.js';
import { restoreScheduledDispatches } from './src/modules/taxi/services/dispatchService.js';
import { startSubscriptionCronJob } from './src/modules/taxi/services/subscriptionCronService.js';
import { startNetworkCronJob } from './src/modules/taxi/services/networkCronService.js';

// Live dispatch state (`activeDispatches`, `scheduledDispatchTimers`) and the
// Socket.IO server instance both live in this process's memory, and Socket.IO is
// running without a cross-process adapter. That makes each of the roles below
// single-owner: a second copy does not share work, it duplicates or loses it.
//
//   sockets   - emits only reach clients connected to the same process, so a
//               second socket server silently drops events for half the users.
//   scheduler - every copy arms its own timer per scheduled ride, so a booking
//               is dispatched once per copy at pickup time.
//   cron      - every copy runs the subscription expiry pass concurrently.
//
// The flags exist so these can later be split across processes once Socket.IO
// has a shared adapter and dispatch state moves to a shared store. Until then
// they all default on, and exactly one process may run them.
const isEnabled = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const roles = {
  sockets: isEnabled(process.env.ENABLE_SOCKET_SERVER, true),
  scheduler: isEnabled(process.env.ENABLE_SCHEDULER, true),
  subscriptionCron: isEnabled(process.env.ENABLE_SUBSCRIPTION_CRON, true),
};

// PM2 numbers cluster instances from 0. Anything above 0 means this file was
// started with more than one instance, which silently corrupts every role above.
// Failing here turns an invisible data problem into an obvious boot error.
const instanceId = Number(process.env.NODE_APP_INSTANCE ?? process.env.pm_id ?? 0);
const ownsSingletonRole = roles.sockets || roles.scheduler || roles.subscriptionCron;

if (ownsSingletonRole && Number.isFinite(instanceId) && instanceId > 0) {
  throw new Error(
    `Refusing to start instance ${instanceId}: this process owns single-owner roles ` +
    `(${Object.entries(roles).filter(([, on]) => on).map(([name]) => name).join(', ')}) ` +
    'which cannot be clustered while dispatch state and Socket.IO are process-local. ' +
    'Run this app with instances: 1, or disable these roles here and give them a dedicated process.',
  );
}

const bootstrap = async () => {
  await connectDatabase();

  // With no default tier, every driver with no active recharge (which is
  // most of them, most of the time) resolves to `null` in
  // getEffectiveDriverTier and is silently skipped in matching — not an
  // error anywhere, just no rides. Nothing enforces a default existing at
  // write time except updateTier/deleteTier refusing to remove the last one;
  // this catches the case where it never existed in the first place (a fresh
  // environment before seeding, or one seeded incorrectly).
  if (roles.scheduler || roles.subscriptionCron) {
    try {
      const { SubscriptionTier } = await import('./src/modules/taxi/admin/models/SubscriptionTier.js');
      const defaultTier = await SubscriptionTier.findOne({ is_default: true, is_active: true }).select('_id').lean();
      if (!defaultTier) {
        console.error(
          '[server] No active default SubscriptionTier found. Every driver with no active ' +
          'subscription will be skipped by matching entirely until one tier has ' +
          'is_default:true and is_active:true. Run scripts/seed_driver_network_tiers.js or set ' +
          'a default from the admin panel.',
        );
      }
    } catch (error) {
      console.error('[server] Default-tier check failed:', error.message);
    }
  }

  const app = createApp();
  const httpServer = createServer(app);

  if (roles.sockets) {
    configureTaxiSocketServer(httpServer);
  }

  if (roles.scheduler) {
    await restoreScheduledDispatches();
    // Published leads expire on the minute, so this shares the scheduler's
    // single-owner guarantee rather than running once per cluster worker.
    startNetworkCronJob(1);
  }

  if (roles.subscriptionCron) {
    startSubscriptionCronJob(5); // Run subscription expiration check every 5 minutes
  }

  httpServer.listen(env.port, () => {
    console.log(
      `Taxi backend listening on port ${env.port} ` +
      `(sockets: ${roles.sockets ? 'on' : 'off'}, scheduler: ${roles.scheduler ? 'on' : 'off'}, ` +
      `subscription cron: ${roles.subscriptionCron ? 'on' : 'off'})`,
    );
  });
};

bootstrap().catch((error) => {
  console.error('Failed to start taxi backend', error);
  process.exit(1);
});
