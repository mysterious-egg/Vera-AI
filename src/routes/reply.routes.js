/**
 * reply.routes.js — POST /v1/reply
 *
 * Receives merchant/customer replies to bot-initiated messages.
 * Implemented in Checkpoint 4 (conversation management).
 */

import { Router } from 'express';

const router = Router();

// TODO (Checkpoint 4): implement conversation reply handling
router.post('/reply', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export default router;
