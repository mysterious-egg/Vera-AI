/**
 * app.js — Express application factory.
 *
 * Creates and configures the Express app:
 *  - Global middleware (JSON parsing, request logging)
 *  - API routes under /v1
 *  - 404 and error handlers
 *
 * Deliberately separated from server.js so it can be tested without
 * binding to a port.
 */

import express from 'express';
import { logger } from './utils/logger.js';
import { AppError } from './utils/errors.js';

// Routes
import healthRouter  from './routes/health.routes.js';
import metadataRouter from './routes/metadata.routes.js';
import contextRouter  from './routes/context.routes.js';
import tickRouter     from './routes/tick.routes.js';
import replyRouter    from './routes/reply.routes.js';

export function createApp() {
  const app = express();

  // ── Middleware ──────────────────────────────────────────────────────────────

  app.use(express.json({ limit: '10mb' }));

  /** Structured request logger */
  app.use((req, _res, next) => {
    logger.info('request', { method: req.method, path: req.path });
    next();
  });

  // ── Routes ──────────────────────────────────────────────────────────────────

  app.use('/v1', healthRouter);
  app.use('/v1', metadataRouter);
  app.use('/v1', contextRouter);
  app.use('/v1', tickRouter);
  app.use('/v1', replyRouter);

  // ── 404 ─────────────────────────────────────────────────────────────────────

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ── Global error handler ────────────────────────────────────────────────────

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) {
      logger.warn('app_error', { code: err.code, message: err.message });
      return res.status(err.status).json({ error: err.message, code: err.code });
    }

    logger.error('unhandled_error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
