/**
 * context.routes.js — POST /v1/context
 *
 * Receives context pushes from the judge (category / merchant / customer / trigger).
 * Validates input, delegates to contextStore, returns spec-compliant responses.
 *
 * Response shapes (challenge-testing-brief.md §2.1):
 *   200  { accepted: true,  ack_id, stored_at }
 *   409  { accepted: false, reason: 'stale_version', current_version }
 *   400  { accepted: false, reason: 'invalid_scope' | 'missing_fields', details }
 */

import { createHash } from 'node:crypto';
import { Router }     from 'express';
import { contextStore, VALID_SCOPES } from '../stores/context.store.js';
import { logger } from '../utils/logger.js';

const router = Router();

/** Required top-level fields in every context push. */
const REQUIRED_FIELDS = ['scope', 'context_id', 'version', 'payload', 'delivered_at'];

/**
 * Produce a deterministic ack_id for a given (scope, context_id, version) triple.
 * Stable across retries of the same push; unique across distinct pushes.
 *
 * @param {string} scope
 * @param {string} contextId
 * @param {number} version
 * @returns {string}  "ack_<16-hex-chars>"
 */
function makeAckId(scope, contextId, version) {
  const hash = createHash('sha256')
    .update(`${scope}:${contextId}:${version}`)
    .digest('hex')
    .slice(0, 16);
  return `ack_${hash}`;
}

router.post('/context', (req, res) => {
  const body = req.body ?? {};

  // ── Field presence validation ────────────────────────────────────────────────

  const missing = REQUIRED_FIELDS.filter((f) => body[f] === undefined || body[f] === null);
  if (missing.length > 0) {
    return res.status(400).json({
      accepted: false,
      reason: 'missing_fields',
      details: `Required fields missing: ${missing.join(', ')}`,
    });
  }

  const { scope, context_id, version, payload, delivered_at } = body;

  // ── Scope validation ─────────────────────────────────────────────────────────

  if (!VALID_SCOPES.has(scope)) {
    return res.status(400).json({
      accepted: false,
      reason: 'invalid_scope',
      details: `scope must be one of: ${[...VALID_SCOPES].join(', ')}`,
    });
  }

  // ── Version type validation ──────────────────────────────────────────────────

  if (!Number.isInteger(version) || version < 0) {
    return res.status(400).json({
      accepted: false,
      reason: 'invalid_version',
      details: 'version must be a non-negative integer',
    });
  }

  // ── Delegate to store ────────────────────────────────────────────────────────

  const result = contextStore.set(scope, context_id, version, payload, delivered_at);

  if (result.status === 'stale') {
    logger.warn('context_stale', { scope, context_id, incoming: version, current: result.currentVersion });
    return res.status(409).json({
      accepted: false,
      reason: 'stale_version',
      current_version: result.currentVersion,
    });
  }

  // Both 'stored' and 'noop' are successes from the judge's perspective.
  logger.info('context_accepted', { scope, context_id, version, status: result.status });

  return res.status(200).json({
    accepted: true,
    ack_id:    makeAckId(scope, context_id, version),
    stored_at: new Date().toISOString(),
  });
});

export default router;
