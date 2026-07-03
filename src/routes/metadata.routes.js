/**
 * metadata.routes.js — GET /v1/metadata
 *
 * Identifies this bot to the judge harness.
 *
 * Response shape (per challenge-testing-brief.md §2.5):
 * {
 *   "team_name": string,
 *   "team_members": string[],
 *   "model": string,
 *   "approach": string,
 *   "contact_email": string,
 *   "version": string,
 *   "submitted_at": ISO-8601 string
 * }
 */

import { Router } from 'express';

const router = Router();

/**
 * Static identity payload — fill in team details before submission.
 * Fields are exactly those defined in challenge-testing-brief.md §2.5.
 * No extra fields.
 */
const METADATA = {
  team_name: 'Vera AI',
  team_members: [],
  model: 'Gemini 2.5 Flash',
  approach: 'Express foundation with 5-endpoint API surface; Gemini integration and context handling in subsequent checkpoints',
  contact_email: '',
  version: '1.0.0',
  submitted_at: '2026-07-03T00:00:00Z',
};

router.get('/metadata', (_req, res) => {
  res.status(200).json(METADATA);
});

export default router;
