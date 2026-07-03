/**
 * tick.routes.js — POST /v1/tick
 *
 * Periodic wake-up called by the judge every 5 simulated minutes.
 * Vera inspects the currently-active triggers and decides whether to
 * proactively initiate conversations.
 *
 * Pipeline (per active trigger)
 * ─────────────────────────────
 *  1. Load trigger payload from contextStore
 *  2. Load merchant context
 *  3. Load category context (via merchant.category_slug)
 *  4. Run keyword retrieval for relevant knowledge chunks
 *  5. Build prompt via promptBuilder
 *  6. Call Gemini; receive validated JSON response
 *  7. Compose an action object conforming to the spec schema
 *
 * Request:  { now, available_triggers[] }
 * Response: { actions[] }                  — may be an empty array
 *
 * Timeouts: the judge waits 30s. If anything takes too long the handler
 * catches the error, logs it, and continues with remaining triggers.
 */

import { Router } from 'express';
import { contextStore }    from '../stores/context.store.js';
import { search }          from '../services/retrieval.service.js';
import { buildPrompt }     from '../prompts/prompt.builder.js';
import { generate, GeminiError, ValidationError, JsonParseError }
  from '../services/gemini.service.js';
import { logger }          from '../utils/logger.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Produce a stable conversation_id for a (merchant, trigger) pair.
 * Reusing the same string across ticks for the same pair is invalid;
 * the spec says reusing a conversation_id is only valid in /v1/reply.
 * We append a timestamp bucket (minute-level) so each tick generates a
 * fresh id while remaining readable.
 *
 * @param {string} merchantId
 * @param {string} triggerId
 * @returns {string}
 */
function makeConversationId(merchantId, triggerId) {
  const minuteBucket = new Date().toISOString().slice(0, 16).replace(/[^0-9]/g, '');
  return `conv_${merchantId}_${triggerId}_${minuteBucket}`;
}

/**
 * Build the free-text retrieval query from available context.
 *
 * @param {object} triggerPayload
 * @param {object} categoryPayload
 * @returns {string}
 */
function buildQuery(triggerPayload, categoryPayload) {
  const parts = [
    triggerPayload?.kind ?? '',
    triggerPayload?.payload?.top_item_id ?? '',
    categoryPayload?.slug ?? '',
  ];
  return parts.filter(Boolean).join(' ');
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * Wall-clock budget for a single tick.
 * The judge waits 30 s; we leave a 5 s safety margin.
 * If we are still processing triggers when the budget expires we break early
 * and return whatever actions have been composed so far.
 */
const TICK_DEADLINE_MS = 25_000;

router.post('/tick', async (req, res) => {
  const { now, available_triggers } = req.body ?? {};

  // ── Input validation ────────────────────────────────────────────────────────

  if (!now || typeof now !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid field: now' });
  }

  const triggers = Array.isArray(available_triggers) ? available_triggers : [];

  logger.info('tick_start', { now, trigger_count: triggers.length });

  // ── Short-circuit when no triggers are active ───────────────────────────────

  if (triggers.length === 0) {
    logger.info('tick_no_triggers', { now });
    return res.status(200).json({ actions: [] });
  }

  // ── Process each trigger independently (within budget) ─────────────────────

  const tickStart = Date.now();
  const actions   = [];

  for (const triggerId of triggers) {
    // Stop processing if we are approaching the judge's 30 s timeout.
    if (Date.now() - tickStart > TICK_DEADLINE_MS) {
      logger.warn('tick_budget_exceeded', {
        now,
        processed: actions.length,
        remaining: triggers.length - triggers.indexOf(triggerId),
      });
      break;
    }

    try {
      // 1. Load trigger
      const triggerRecord = contextStore.get('trigger', triggerId);
      if (!triggerRecord) {
        logger.warn('tick_trigger_not_found', { triggerId });
        continue;
      }
      const triggerPayload = triggerRecord.payload;

      // 2. Load merchant
      const merchantId = triggerPayload?.merchant_id;
      if (!merchantId) {
        logger.warn('tick_trigger_no_merchant', { triggerId });
        continue;
      }

      const merchantRecord = contextStore.get('merchant', merchantId);
      if (!merchantRecord) {
        logger.warn('tick_merchant_not_found', { triggerId, merchantId });
        continue;
      }
      const merchantPayload = merchantRecord.payload;

      // 3. Load category
      const categorySlug = merchantPayload?.category_slug;
      const categoryRecord = categorySlug
        ? contextStore.get('category', categorySlug)
        : undefined;
      const categoryPayload = categoryRecord?.payload ?? null;

      // 4. Optional: load customer context if trigger specifies one
      const customerId = triggerPayload?.customer_id ?? null;
      const customerRecord = customerId
        ? contextStore.get('customer', customerId)
        : undefined;
      const customerPayload = customerRecord?.payload ?? null;

      // 5. Retrieve relevant knowledge chunks
      const query = buildQuery(triggerPayload, categoryPayload);
      const knowledge = query
        ? search(query, { category: categorySlug, limit: 5 })
        : [];

      logger.info('tick_retrieval', {
        triggerId,
        merchantId,
        query,
        chunks: knowledge.length,
      });

      // 6. Build prompt
      const prompt = buildPrompt({
        merchant:  merchantPayload,
        trigger:   triggerPayload,
        category:  categoryPayload,
        customer:  customerPayload,
        knowledge,
      });

      // 7. Call Gemini
      const geminiResult = await generate(prompt);

      // 8. Compose action
      const action = {
        conversation_id:  makeConversationId(merchantId, triggerId),
        merchant_id:      merchantId,
        customer_id:      customerId,
        send_as:          geminiResult.send_as  ?? 'vera',
        trigger_id:       triggerId,
        template_name:    'vera_generic_v1',
        template_params:  [
          merchantPayload?.identity?.name ?? merchantId,
          geminiResult.cta ?? '',
          geminiResult.suppression_key ?? '',
        ],
        body:             geminiResult.message,
        cta:              geminiResult.cta,
        suppression_key:  geminiResult.suppression_key
                            ?? triggerPayload?.suppression_key
                            ?? `${triggerId}:${now}`,
        rationale:        geminiResult.rationale,
      };

      actions.push(action);

      logger.info('tick_action_composed', {
        triggerId,
        merchantId,
        conversation_id: action.conversation_id,
      });

    } catch (err) {
      // Classify the error for logging; never let one trigger crash the response
      if (err instanceof ValidationError || err instanceof JsonParseError) {
        logger.warn('tick_gemini_validation_error', {
          triggerId: String(triggerId),
          error: err.message,
        });
      } else if (err instanceof GeminiError) {
        logger.error('tick_gemini_error', {
          triggerId: String(triggerId),
          error: err.message,
        });
      } else {
        logger.error('tick_unexpected_error', {
          triggerId: String(triggerId),
          error: err.message,
        });
      }
      // Continue processing remaining triggers
    }
  }

  logger.info('tick_complete', { now, actions: actions.length });

  return res.status(200).json({ actions });
});

export default router;
