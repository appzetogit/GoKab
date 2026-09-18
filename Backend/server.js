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
