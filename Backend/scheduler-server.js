import { connectDatabase } from './src/config/database.js';
import { restoreScheduledDispatches } from './src/modules/taxi/services/dispatchService.js';
import { startNetworkCronJob } from './src/modules/taxi/services/networkCronService.js';
import { startSubscriptionCronJob } from './src/modules/taxi/services/subscriptionCronService.js';

const bootstrap = async () => {
  // Connect to the database
  await connectDatabase();

  console.log('Starting scheduler and restoring dispatches...');
  await restoreScheduledDispatches();

  // The same jobs `server.js` arms under its scheduler role. This standalone
  // entry point exists so the jobs can be split onto their own process; run
  // that process with ENABLE_SCHEDULER=false on the API so the timers still
  // have exactly one owner.
  startSubscriptionCronJob(5);
  startNetworkCronJob(1);

  // Keep the scheduler process alive
  setInterval(() => {
    // Keep alive log or heartbeat if needed
  }, 1000 * 60 * 60);
};

bootstrap().catch((error) => {
  console.error('Failed to start taxi scheduler', error);
  process.exit(1);
});
