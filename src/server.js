/**
 * server.js — process entry point.
 *
 * Loads env config, creates the Express app, and binds to PORT.
 * Handles graceful shutdown on SIGTERM (Railway sends this before recycling).
 */

import { config }         from './utils/env.js';
import { logger }         from './utils/logger.js';
import { createApp }      from './app.js';
import { datasetService } from './services/dataset.service.js';

// ── Dataset startup ──────────────────────────────────────────────────────────

try {
  await datasetService.load();
} catch (err) {
  logger.error('dataset_load_failed', { message: err.message });
  process.exit(1);
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('server_started', {
    port: config.port,
    env: config.nodeEnv,
  });
});

// ── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal) {
  logger.info('shutdown_signal', { signal });
  server.close(() => {
    logger.info('server_closed');
    process.exit(0);
  });

  // Force-exit after 10 s if connections linger
  setTimeout(() => {
    logger.error('shutdown_timeout', { message: 'Forcing exit after 10 s' });
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Log unhandled rejections instead of silently swallowing them
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { reason: String(reason) });
});
