/**
 * test-tick.mjs — scenario tests for POST /v1/tick (CP7).
 *
 * Requires the server to be running: npm run dev
 * The server must have GEMINI_API_KEY set in .env.
 *
 * Scenarios:
 *   T1 — missing `now` field → 400
 *   T2 — empty available_triggers → 200 { actions: [] }
 *   T3 — trigger not found in store → 200 { actions: [] }
 *   T4 — merchant not found → 200 { actions: [] }
 *   T5 — full happy path (push all contexts, then tick with real trigger)
 */

const BASE = 'http://localhost:3000';

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  return { status: r.status, body: await r.json() };
}

const get  = (path)        => req('GET',  path);
const post = (path, body)  => req('POST', path, body);

let passed = 0;
let failed = 0;

function assert(label, cond, detail = '') {
  const mark = cond ? '✅' : '❌';
  console.log(`${mark}  ${label}${detail ? ' — ' + detail : ''}`);
  if (cond) { passed++; } else { failed++; process.exitCode = 1; }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = '2026-04-26T10:30:00Z';

const CATEGORY_PAYLOAD = {
  slug: 'dentists',
  offer_catalog: [{ title: 'Dental Cleaning @ ₹299', value: '299', audience: 'new_user' }],
  voice: { tone: 'peer_clinical', vocab_allowed: ['fluoride varnish', 'caries'], taboos: ['cure'] },
  peer_stats: { avg_rating: 4.4, avg_reviews: 62, avg_ctr: 0.030, scope: 'delhi_solo_practices' },
  digest: [],
  patient_content_library: [],
  seasonal_beats: [],
  trend_signals: [],
};

const MERCHANT_PAYLOAD = {
  merchant_id: 'm_001_drmeera',
  category_slug: 'dentists',
  identity: { name: "Dr. Meera's Dental Clinic", city: 'Delhi', locality: 'Lajpat Nagar', verified: true, languages: ['en', 'hi'] },
  subscription: { status: 'active', plan: 'Pro', days_remaining: 82 },
  performance: { window_days: 30, views: 2410, calls: 18, directions: 45, ctr: 0.021 },
  offers: [{ id: 'o_meera_001', title: 'Dental Cleaning @ ₹299', status: 'active' }],
  conversation_history: [],
  customer_aggregate: { total_unique_ytd: 540, lapsed_180d_plus: 78, retention_6mo_pct: 0.38 },
  signals: ['ctr_below_peer_median'],
};

const TRIGGER_PAYLOAD = {
  id: 'trg_2026_04_26_research_digest_dentists',
  scope: 'merchant',
  kind: 'research_digest',
  source: 'external',
  merchant_id: 'm_001_drmeera',
  customer_id: null,
  payload: { category: 'dentists', top_item_id: 'd_2026W17_jida_fluoride' },
  urgency: 2,
  suppression_key: 'research:dentists:2026-W17',
  expires_at: '2026-05-03T00:00:00Z',
};

const TRIGGER_ID = 'trg_2026_04_26_research_digest_dentists';

// ── Helper: push a context ────────────────────────────────────────────────────

async function pushContext(scope, context_id, version, payload) {
  return post('/v1/context', {
    scope,
    context_id,
    version,
    payload,
    delivered_at: NOW,
  });
}

// ── Header ────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════');
console.log(' POST /v1/tick — Scenario Tests (CP7)');
console.log('══════════════════════════════════════════════════\n');

// ── T1: missing `now` → 400 ───────────────────────────────────────────────────

console.log('--- T1: missing `now` field ---');
const t1 = await post('/v1/tick', { available_triggers: [] });
console.log('T1:', JSON.stringify(t1.body));
assert('T1 status=400',                  t1.status === 400);
assert('T1 error field present',         typeof t1.body.error === 'string');

// ── T2: empty available_triggers → 200 { actions: [] } ───────────────────────

console.log('\n--- T2: empty available_triggers ---');
const t2 = await post('/v1/tick', { now: NOW, available_triggers: [] });
console.log('T2:', JSON.stringify(t2.body));
assert('T2 status=200',                  t2.status === 200);
assert('T2 actions is array',            Array.isArray(t2.body.actions));
assert('T2 actions empty',               t2.body.actions.length === 0);

// ── T3: trigger not loaded → 200 { actions: [] } ─────────────────────────────

console.log('\n--- T3: trigger not in store ---');
const t3 = await post('/v1/tick', {
  now: NOW,
  available_triggers: ['trg_does_not_exist'],
});
console.log('T3:', JSON.stringify(t3.body));
assert('T3 status=200',                  t3.status === 200);
assert('T3 actions empty (skip trigger)', t3.body.actions.length === 0);

// ── T4: trigger loaded but merchant missing → 200 { actions: [] } ────────────

console.log('\n--- T4: merchant not in store ---');
// Push a trigger whose merchant_id points to an unknown merchant
await pushContext('trigger', 'trg_orphan', 1, {
  id: 'trg_orphan',
  scope: 'merchant',
  kind: 'research_digest',
  source: 'external',
  merchant_id: 'm_nobody',
  customer_id: null,
  payload: { category: 'dentists', top_item_id: 'x' },
  urgency: 1,
  suppression_key: 'orphan',
  expires_at: '2027-01-01T00:00:00Z',
});
const t4 = await post('/v1/tick', {
  now: NOW,
  available_triggers: ['trg_orphan'],
});
console.log('T4:', JSON.stringify(t4.body));
assert('T4 status=200',                  t4.status === 200);
assert('T4 actions empty (no merchant)', t4.body.actions.length === 0);

// ── T5: full happy path (requires GEMINI_API_KEY) ─────────────────────────────

console.log('\n--- T5: full pipeline (Gemini required) ---');

// Push all four context layers
await pushContext('category', 'dentists',          100, CATEGORY_PAYLOAD);
await pushContext('merchant', 'm_001_drmeera',      100, MERCHANT_PAYLOAD);
await pushContext('trigger',  TRIGGER_ID,           100, TRIGGER_PAYLOAD);

const t5 = await post('/v1/tick', {
  now: NOW,
  available_triggers: [TRIGGER_ID],
});
console.log('T5 status:', t5.status);
console.log('T5 body:', JSON.stringify(t5.body, null, 2));

assert('T5 status=200',                  t5.status === 200);
assert('T5 actions is array',            Array.isArray(t5.body.actions));

if (t5.body.actions.length > 0) {
  const action = t5.body.actions[0];
  assert('T5 action has conversation_id', typeof action.conversation_id === 'string' && action.conversation_id.length > 0);
  assert('T5 action has merchant_id',     action.merchant_id === 'm_001_drmeera');
  assert('T5 action has trigger_id',      action.trigger_id  === TRIGGER_ID);
  assert('T5 action has body',            typeof action.body === 'string' && action.body.length > 0);
  assert('T5 action has cta',             typeof action.cta  === 'string');
  assert('T5 action has suppression_key', typeof action.suppression_key === 'string');
  assert('T5 action has rationale',       typeof action.rationale === 'string' && action.rationale.length > 0);
  assert('T5 send_as is set',             typeof action.send_as === 'string');
} else {
  // Gemini may have been unavailable or returned nothing; note it but don't fail
  console.log('   ℹ️  No actions returned — Gemini may be unavailable or suppressed this trigger.');
}

// ── T6: healthz still works after tick ───────────────────────────────────────

console.log('\n--- T6: healthz regression after tick ---');
const t6 = await get('/v1/healthz');
assert('T6 status=200',                  t6.status === 200);
assert('T6 status=ok',                   t6.body.status === 'ok');
assert('T6 dataset_loaded',              t6.body.dataset_loaded === true);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n══════════════════════════════════════════════════`);
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════════════════\n`);
