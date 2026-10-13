import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';

import { env, isTest } from '@/config/env';
import { logger } from '@/lib/logger';
import { errorHandler, notFoundHandler } from '@/middleware/error';
import { apiLimiter } from '@/middleware/rate-limit';
import { authRouter } from '@/modules/auth';
import { bookingsRouter } from '@/modules/bookings';
import { catalogRouter } from '@/modules/catalog';
import { companiesRouter } from '@/modules/companies';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // behind Nginx on the VPS
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      // Mobile apps send no Origin header; browsers must be on the allow list.
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
      credentials: true,
      maxAge: 600,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  if (!isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  app.get('/health', (_req, res) => {
    const db = mongoose.connection.readyState === 1;
    res.status(db ? 200 : 503).json({ ok: db, uptime: Math.round(process.uptime()) });
  });

  const api = express.Router();
  api.use(apiLimiter);
  api.use('/auth', authRouter);
  api.use('/companies', companiesRouter);
  api.use('/bookings', bookingsRouter);
  api.use('/', catalogRouter);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
