import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import path from 'node:path';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './modules/taxi/middlewares/errorMiddleware.js';
import { taxiRouter } from './modules/taxi/routes/index.js';

export const createApp = () => {
  const app = express();

  const configuredOrigins = String(env.corsOrigin || '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const allowAllOrigins = configuredOrigins.length === 0 || configuredOrigins.includes('*');

  app.use(
    cors({
      origin(origin, callback) {
        if (allowAllOrigins || !origin) {
          callback(null, true);
          return;
        }

        const normalizedOrigin = String(origin).trim().replace(/\/+$/, '');
        callback(null, configuredOrigins.includes(normalizedOrigin));
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  const storageBaseDir = process.env.STORAGE_BASE_DIR || (process.platform === 'win32' ? path.resolve('./var/storage') : '/var/storage');
  app.use('/images', express.static(storageBaseDir));

  app.get('/health', (_req, res) => {
    res.json({ success: true, message: 'Taxi backend is healthy' });
  });

  // Keep both mounts during integration so existing clients using /api or /api/v1 continue to work.
  app.use('/api', taxiRouter);
  app.use('/api/v1', taxiRouter);

  app.get(['/api', '/api/v1'], (_req, res) => {
    res.json({
      success: true,
      message: 'Taxi API is mounted',
      routes: {
        admins: ['/api/admin', '/api/v1/admin'],
        users: ['/api/users', '/api/v1/users'],
        drivers: ['/api/drivers', '/api/v1/drivers'],
        rides: ['/api/rides', '/api/v1/rides'],
        deliveries: ['/api/deliveries', '/api/v1/deliveries'],
      },
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
