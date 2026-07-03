/**
 * test-reply.mjs — scenario tests for POST /v1/reply (CP8).
 *
 * Requires the server to be running: npm run dev
 * GEMINI_API_KEY must be set in .env for T3–T5 (live Gemini calls).
 *
 * Scenarios:
 *   T1 — missing required fields → 400
 *   T2 — merchant not in store → 404
 *   T3 — minimal valid request (no conversation history, no customer)
 *   T4 — customer context loaded → Gemini call
 *   T5 — conversation history is passed through → Gemini call
 *   T6 — healthz regression after reply calls
 *   T7 — validateReplyResponse unit checks (no HTTP required)
 */

// Static imports must appear at the top of an ES module.
import { validateReplyResponse } from './src/services/gemini.service.js';

const BASE = 'http://localhost:3000';

async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  return { status: r.status, body: await r.json() };
}

const get  = (path)       => req('GET',  path);
const post = (path, body) => req('POST', path, body);

let passed = 0;
let failed = 0;

function assert(label, cond, detail = '') {
  const mark = cond ? '✅' : '❌';
  console.log(`${mark}  ${label}${detail ? ' — ' + detail : ''}`);
  if (cond) { passed++; } else { failed++; process.exitCode = 1; }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = '2026-04-26T10:45:00Z';

const MERCHANT_PAYLOAD = {
  merchant_id:   'm_001_drmeera',
  category_slug: 'dentists',
  identity: {
    name: "Dr. Meera's Dental Clinic",
    city: 'Delhi',
    locality: 'Lajpat Nagar',
    verified: true,
    languages: ['en', 'hi'],
  },
  subscription:         { status: 'active', plan: 'Pro', days_remaining: 82 },
  performance:          { window_days: 30, views: 2410, calls: 18, directions: 45, ctr: 0.021 },
  offers:               [{ id: 'o_meera_001', title: 'Dental Cleaning @ ₹299', status: 'active' }],
  conversation_history: [],
  customer_aggregate:   { total_unique_ytd: 540, lapsed_180d_plus: 78, retention_6mo_pct: 0.38 },
  signals:              ['ctr_below_peer_median'],
};

const CUSTOMER_PAYLOAD = {
  customer_id:  'c_001_priya',
  merchant_id:  'm_001_drmeera',
  identity:     { name: 'Priya', language_pref: 'hi-en mix' },
  relationship: {
    first_visit: '2025-11-04', last_visit: '2026-05-12',
    visits_total: 4,
    services_received: ['cleaning', 'cleaning', 'whitening', 'cleaning'],
  },
  state:       'lapsed_soft',
  preferences: { preferred_slots: 'weekday_evening', channel: 'whatsapp' },
  consent:     { opted_in_at: '2025-11-04', scope: ['recall_reminders'] },
};

const BASE_REPLY = {
  conversation_id: 'conv_m_001_drmeera_trg_research',
  merchant_id:     'm_001_drmeera',
  from_role:       'merchant',
  message:         'Yes, please send me the abstract.',
  received_at:     NOW,
  turn_number:     2,
};

async function pushContext(scope, context_id, version, payload) {
  return post('/v1/context', { scope, context_id, version, payload, delivered_at: NOW });
}

// ── Header ────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════');
console.log(' POST /v1/reply — Scenario Tests (CP8)');
console.log('══════════════════════════════════════════════════\n');

// ── T1: missing required fields → 400 ────────────────────────────────────────

console.log('--- T1: missing required fields ---');
const t1 = await post('/v1/reply', { merchant_id: 'm_001_drmeera' });
console.log('T1:', JSON.stringify(t1.body));
assert('T1 status=400',            t1.status === 400);
assert('T1 missing array present', Array.isArray(t1.body.missing));
assert('T1 lists missing fields',  t1.body.missing.length > 0);

// ── T2: merchant not in store → 404 ──────────────────────────────────────────

console.log('\n--- T2: merchant not found ---');
const t2 = await post('/v1/reply', { ...BASE_REPLY, merchant_id: 'm_nobody' });
console.log('T2:', JSON.stringify(t2.body));
assert('T2 status=404',        t2.status === 404);
assert('T2 error field present', typeof t2.body.error === 'string');

// ── T3: minimal valid request (merchant only, no customer, no history) ────────

console.log('\n--- T3: minimal valid request ---');
await pushContext('merchant', 'm_001_drmeera', 200, MERCHANT_PAYLOAD);

const t3 = await post('/v1/reply', BASE_REPLY);
console.log('T3 status:', t3.status);
console.log('T3 body:', JSON.stringify(t3.body));

assert('T3 status=200',        t3.status === 200);
assert('T3 action is string',  typeof t3.body.action === 'string');
assert('T3 action is valid',   ['send', 'wait', 'end'].includes(t3.body.action));
assert('T3 rationale present', typeof t3.body.rationale === 'string' && t3.body.rationale.length > 0);

if (t3.body.action === 'send') {
  assert('T3 send has body',       typeof t3.body.body === 'string' && t3.body.body.length > 0);
}
if (t3.body.action === 'wait') {
  assert('T3 wait has wait_seconds', typeof t3.body.wait_seconds === 'number' && t3.body.wait_seconds > 0);
}

// ── T4: customer context loaded ───────────────────────────────────────────────

console.log('\n--- T4: customer context present ---');
await pushContext('customer', 'c_001_priya', 200, CUSTOMER_PAYLOAD);

const t4 = await post('/v1/reply', {
  ...BASE_REPLY,
  customer_id: 'c_001_priya',
  message:     'Can I get a discount on whitening?',
  turn_number: 3,
});
console.log('T4 status:', t4.status);
console.log('T4 body:', JSON.stringify(t4.body));

assert('T4 status=200',        t4.status === 200);
assert('T4 action is valid',   ['send', 'wait', 'end'].includes(t4.body.action));
assert('T4 rationale present', typeof t4.body.rationale === 'string');

// ── T5: conversation history is forwarded to Gemini ───────────────────────────

console.log('\n--- T5: conversation history ---');
const t5 = await post('/v1/reply', {
  ...BASE_REPLY,
  message: 'Interesting, tell me more.',
  turn_number: 4,
  conversation_history: [
    { from: 'vera',     msg: 'Dr. Meera, JIDA research shows 3-mo recall cuts caries 38%.' },
    { from: 'merchant', msg: 'Yes, please send me the abstract.' },
    { from: 'vera',     msg: 'Sending now. Would you like to run a campaign this month?' },
  ],
});
console.log('T5 status:', t5.status);
console.log('T5 body:', JSON.stringify(t5.body));

assert('T5 status=200',        t5.status === 200);
assert('T5 action is valid',   ['send', 'wait', 'end'].includes(t5.body.action));
assert('T5 rationale present', typeof t5.body.rationale === 'string');

// ── T6: healthz regression ────────────────────────────────────────────────────

console.log('\n--- T6: healthz regression ---');
const t6 = await get('/v1/healthz');
assert('T6 status=200',              t6.status === 200);
assert('T6 status=ok',               t6.body.status === 'ok');
assert('T6 dataset_loaded',          t6.body.dataset_loaded === true);
assert('T6 merchant context loaded', t6.body.contexts_loaded.merchant >= 1);

// ── T7: validateReplyResponse unit checks ─────────────────────────────────────

console.log('\n--- T7: validateReplyResponse unit checks ---');

const validSend = { action: 'send', body: 'Hello', cta: 'open_ended', rationale: 'grounded' };
const validWait = { action: 'wait', wait_seconds: 1800, rationale: 'merchant asked for time' };
const validEnd  = { action: 'end',  rationale: 'merchant declined' };

let threw = false;
try { validateReplyResponse({ action: 'unknown', rationale: 'x' }); } catch { threw = true; }
assert('T7 invalid action throws',     threw);

threw = false;
try { validateReplyResponse({ action: 'send', body: '', rationale: 'x' }); } catch { threw = true; }
assert('T7 send with empty body throws', threw);

threw = false;
try { validateReplyResponse({ action: 'wait', wait_seconds: 0, rationale: 'x' }); } catch { threw = true; }
assert('T7 wait with 0 seconds throws', threw);

assert('T7 valid send accepted', JSON.stringify(validateReplyResponse(validSend)) === JSON.stringify(validSend));
assert('T7 valid wait accepted', JSON.stringify(validateReplyResponse(validWait)) === JSON.stringify(validWait));
assert('T7 valid end accepted',  JSON.stringify(validateReplyResponse(validEnd))  === JSON.stringify(validEnd));

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n══════════════════════════════════════════════════`);
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════════════════\n`);
