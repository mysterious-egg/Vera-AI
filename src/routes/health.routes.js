/**
 * health.routes.js — GET /v1/healthz
 *
 * Returns a liveness snapshot that the judge polls every 60 s.
 * Three consecutive failures = bot disqualified for that test slot.
 *
 * Response shape (per challenge-testing-brief.md §2.4 + CP3 extension):
 * {
 *   "status": "ok",
 *   "uptime_seconds": <number>,
 *   "contexts_loaded": { "category": <n>, "merchant": <n>, "customer": <n>, "trigger": <n> },
 *   "dataset_loaded": <boolean>,
 *   "dataset_stats": { "categories": <n>, "chunks": <n> }
 * }
 */

import { Router } from 'express';
import { contextStore }  from '../stores/context.store.js';
import { datasetService } from '../services/dataset.service.js';

const router = Router();

/** Wall-clock timestamp when the process started. */
const START_TIME = Date.now();

router.get('/healthz', (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);

  res.status(200).json({
    status: 'ok',
    uptime_seconds: uptimeSeconds,
    contexts_loaded: contextStore.counts(),
    dataset_loaded:  datasetService.isLoaded(),
    dataset_stats:   datasetService.counts(),
  });
});

export default router;
