import { connectDatabase } from './src/config/database.js';
import { restoreScheduledDispatches } from './src/modules/taxi/services/dispatchService.js';

const bootstrap = async () => {
  // Connect to the database
  await connectDatabase();

  console.log('Starting scheduler and restoring dispatches...');
  await restoreScheduledDispatches();

  // Keep the scheduler process alive
  setInterval(() => {
    // Keep alive log or heartbeat if needed
  }, 1000 * 60 * 60);
};

bootstrap().catch((error) => {
  console.error('Failed to start taxi scheduler', error);
  process.exit(1);
});
