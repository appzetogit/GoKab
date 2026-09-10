import { createServer } from 'node:http';
import { connectDatabase } from './src/config/database.js';
import { env } from './src/config/env.js';
import { configureTaxiSocketServer } from './src/modules/taxi/socket/index.js';

const bootstrap = async () => {
  // Connect to the database
  await connectDatabase();

  // Create HTTP Server for Socket.io
  const httpServer = createServer();
  configureTaxiSocketServer(httpServer);

  // Use a separate port for Socket server
  const port = env.socketPort;

  httpServer.listen(port, () => {
    console.log(`Taxi socket server listening on port ${port}`);
  });
};

bootstrap().catch((error) => {
  console.error('Failed to start taxi socket server', error);
  process.exit(1);
});
