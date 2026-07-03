/**
 * tick.routes.js — POST /v1/tick
 *
 * Periodic wake-up called by the judge. The bot may proactively initiate
 * conversations here.
 * Implemented in Checkpoint 3 (proactive messaging).
 */

import { Router } from 'express';

const router = Router();

// TODO (Checkpoint 3): implement proactive message generation
router.post('/tick', (_req, res) => {
  res.status(200).json({ actions: [] });
});

export default router;
