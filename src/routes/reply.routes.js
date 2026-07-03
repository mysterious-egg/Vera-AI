/**
 * reply.routes.js — POST /v1/reply
 *
 * Receives a merchant or customer reply to a bot-initiated message.
 * Vera must respond synchronously within 30 s with its next move.
 *
 * Pipeline
 * ────────
 *  1. Validate required fields
 *  2. Load merchant context (required)
 *  3. Load category context (via merchant.category_slug)
 *  4. Load trigger context (optional; context_id supplied by caller or inferred)
 *  5. Load customer context (optional)
 *  6. Retrieve relevant knowledge chunks
 *  7. Build reply prompt (includes conversation history + incoming message)
 *  8. Call Gemini with reply-specific schema
 *  9. Return validated action object
 *
 * Request (per testing-brief §2.3):
 * {
 *   conversation_id, merchant_id, customer_id?,
 *   from_role, message, received_at, turn_number,
 *   conversation_history?   // optional; array of prior turns
 *   trigger_id?             // optional; lets Vera reload trigger context
 * }
 *
 * Response — one of:
 *   { action: "send", body, cta, rationale }
 *   { action: "wait", wait_seconds, rationale }
 *   { action: "end",  rationale }
 */

import { Router } from 'express';
import { contextStore } from '../stores/context.store.js';
import { search } from '../services/retrieval.service.js';
import { buildReplyPrompt } from '../prompts/prompt.builder.js';
import {
  generateReply,
  GeminiError,
  ValidationError,
  JsonParseError,
} from '../services/gemini.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ── Required fields in every /v1/reply request ────────────────────────────────

const REQUIRED_FIELDS = [
  'conversation_id',
  'merchant_id',
  'from_role',
  'message',
  'received_at',
  'turn_number',
];

// ── Route ─────────────────────────────────────────────────────────────────────

router.post('/reply', async (req, res) => {
  const body = req.body ?? {};

  // ── 1. Validate required fields ─────────────────────────────────────────────

  const missing = REQUIRED_FIELDS.filter(
    (f) => body[f] === undefined || body[f] === null || body[f] === '',
  );
  if (missing.length > 0) {
    return res.status(400).json({
      error: 'Missing required fields',
      missing,
    });
  }

  const {
    conversation_id,
    merchant_id,
    customer_id = null,
    from_role,
    message,
    received_at,
    turn_number,
    conversation_history = [],
    trigger_id = null,
  } = body;


  // ─────────────────────────────────────────────────────────────
  // Fast-path decisions (avoid unnecessary Gemini calls)
  // ─────────────────────────────────────────────────────────────

  const normalized = message.toLowerCase().trim();

  // Automatic replies
  const AUTO_REPLY_PATTERNS = [
    "thank you for contacting",
    "thank you for your message",
    "we will get back",
    "we'll get back",
    "our team will respond",
    "automated response",
    "auto reply",
    "out of office",
    "received your request",
  ];

  // Hostile / opt-out
  const HOSTILE_PATTERNS = [
    "stop messaging",
    "stop contacting",
    "leave me alone",
    "spam",
    "not interested",
    "don't message",
    "dont message",
    "unsubscribe",
  ];

  // Merchant already committed
  const COMMIT_PATTERNS = [
    "ok",
    "okay",
    "yes",
    "yeah",
    "yep",
    "let's do it",
    "lets do it",
    "what's next",
    "whats next",
    "go ahead",
    "please proceed",
    "sounds good",
  ];

  // Fast-path: auto reply
  if (AUTO_REPLY_PATTERNS.some(p => normalized.includes(p))) {
    return res.status(200).json({
      action: "end",
      rationale: "Detected automated acknowledgement."
    });
  }

  // Fast-path: hostile
  if (HOSTILE_PATTERNS.some(p => normalized.includes(p))) {
    return res.status(200).json({
      action: "end",
      rationale: "Merchant requested no further communication."
    });
  }

  // Fast-path: merchant committed
  if (COMMIT_PATTERNS.some(p => normalized.includes(p))) {
    return res.status(200).json({
      action: "send",
      body: "Great! I'll prepare the next step and guide you through the process.",
      cta: "open_ended",
      rationale: "Merchant has already committed and is ready to proceed."
    });
  }

  logger.info('reply_start', {
    conversation_id,
    merchant_id,
    from_role,
    turn_number,
  });

  // ── 2. Load merchant (required) ─────────────────────────────────────────────

  const merchantRecord = contextStore.get('merchant', merchant_id);
  if (!merchantRecord) {
    logger.warn('reply_merchant_not_found', { merchant_id });
    return res.status(404).json({ error: `Merchant not found: ${merchant_id}` });
  }
  const merchantPayload = merchantRecord.payload;

  // ── 3. Load category (optional) ─────────────────────────────────────────────

  const categorySlug = merchantPayload?.category_slug;
  const categoryRecord = categorySlug
    ? contextStore.get('category', categorySlug)
    : undefined;
  const categoryPayload = categoryRecord?.payload ?? null;

  // ── 4. Load trigger context (optional) ──────────────────────────────────────

  const triggerRecord = trigger_id
    ? contextStore.get('trigger', trigger_id)
    : undefined;
  const triggerPayload = triggerRecord?.payload ?? null;

  // ── 5. Load customer context (optional) ─────────────────────────────────────

  const customerRecord = customer_id
    ? contextStore.get('customer', customer_id)
    : undefined;
  const customerPayload = customerRecord?.payload ?? null;

  // ── 6. Retrieve relevant knowledge chunks ───────────────────────────────────

  // Build a search query from the incoming message and available context
  const queryParts = [
    message,
    triggerPayload?.kind ?? '',
    categorySlug ?? '',
  ].filter(Boolean);
  const query = queryParts.join(' ');
  const knowledge = search(query, { category: categorySlug, limit: 5 });

  logger.info('reply_retrieval', {
    conversation_id,
    query,
    chunks: knowledge.length,
  });

  // ── 7. Build reply prompt ───────────────────────────────────────────────────

  const prompt = buildReplyPrompt({
    merchant: merchantPayload,
    category: categoryPayload,
    trigger: triggerPayload,
    customer: customerPayload,
    fromRole: from_role,
    incomingMessage: message,
    turnNumber: turn_number,
    conversationHistory: Array.isArray(conversation_history) ? conversation_history : [],
    knowledge,
  });

  // ── 8. Call Gemini ──────────────────────────────────────────────────────────

  let result;
  try {
    result = await generateReply(prompt);
  } catch (err) {
    if (err instanceof ValidationError || err instanceof JsonParseError) {
      logger.warn('reply_gemini_validation_error', {
        conversation_id,
        error: err.message,
      });
      return res.status(422).json({
        error: 'Gemini response validation failed',
        detail: err.message,
      });
    }

    if (err instanceof GeminiError) {
      const msg = err.message?.toLowerCase() ?? '';
      if (msg.includes('429') || msg.includes('rate')) {
        logger.warn('reply_rate_limited', { conversation_id, error: err.message });
        return res.status(429).json({ error: 'Rate limited. Retry later.' });
      }
      logger.error('reply_gemini_error', { conversation_id, error: err.message });
      return res.status(500).json({ error: 'Internal error generating reply.' });
    }

    logger.error('reply_unexpected_error', {
      conversation_id,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error.' });
  }

  // ── 9. Return validated action ──────────────────────────────────────────────

  logger.info('reply_complete', {
    conversation_id,
    action: result.action,
  });

  return res.status(200).json(result);
});

export default router;
