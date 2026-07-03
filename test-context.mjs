/**
 * test-context.mjs — one-shot scenario test for POST /v1/context
 * Run: node test-context.mjs
 */

const BASE = 'http://localhost:3000';

async function post(body) {
  const r = await fetch(`${BASE}/v1/context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: await r.json() };
}

function assert(label, cond, detail = '') {
  const mark = cond ? '✅' : '❌';
  console.log(`${mark}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
}

const CTX = {
  scope: 'category',
  context_id: 'dentists',
  version: 1,
  delivered_at: '2026-04-26T10:00:00Z',
  payload: { slug: 'dentists' },
};

console.log('\n══════════════════════════════════════════════════');
console.log(' POST /v1/context — Scenario Tests');
console.log('══════════════════════════════════════════════════\n');

// S1 — new context
const s1 = await post(CTX);
console.log('S1 POST v1 (new):', JSON.stringify(s1));
assert('S1 status=200',        s1.status === 200);
assert('S1 accepted=true',     s1.body.accepted === true);
assert('S1 has ack_id',        typeof s1.body.ack_id === 'string' && s1.body.ack_id.startsWith('ack_'));
assert('S1 has stored_at',     typeof s1.body.stored_at === 'string');

// S2 — same version (noop)
const s2 = await post(CTX);
console.log('\nS2 POST v1 again (noop):', JSON.stringify(s2));
assert('S2 status=200',        s2.status === 200);
assert('S2 accepted=true',     s2.body.accepted === true);
assert('S2 same ack_id',       s2.body.ack_id === s1.body.ack_id, 'deterministic ack');

// S3 — stale version
const s3 = await post({ ...CTX, version: 0 });
console.log('\nS3 POST v0 (stale):', JSON.stringify(s3));
assert('S3 status=409',        s3.status === 409);
assert('S3 accepted=false',    s3.body.accepted === false);
assert('S3 reason=stale',      s3.body.reason === 'stale_version');
assert('S3 current_version=1', s3.body.current_version === 1);

// S4 — upgrade version
const s4 = await post({ ...CTX, version: 2, payload: { slug: 'dentists', updated: true } });
console.log('\nS4 POST v2 (upgrade):', JSON.stringify(s4));
assert('S4 status=200',        s4.status === 200);
assert('S4 accepted=true',     s4.body.accepted === true);
assert('S4 new ack_id',        s4.body.ack_id !== s1.body.ack_id, 'different ack for new version');

// S5 — invalid scope
const s5 = await post({ ...CTX, scope: 'unknown' });
console.log('\nS5 invalid scope:', JSON.stringify(s5));
assert('S5 status=400',        s5.status === 400);
assert('S5 accepted=false',    s5.body.accepted === false);
assert('S5 reason=invalid',    s5.body.reason === 'invalid_scope');

// S5b — missing fields
const s5b = await post({ scope: 'merchant' });
console.log('\nS5b missing fields:', JSON.stringify(s5b));
assert('S5b status=400',       s5b.status === 400);
assert('S5b accepted=false',   s5b.body.accepted === false);
assert('S5b reason=missing',   s5b.body.reason === 'missing_fields');

// S6 — healthz counts (category=1, upgraded once so still 1 key)
const s6 = await get('/v1/healthz');
console.log('\nS6 healthz:', JSON.stringify(s6));
assert('S6 status=200',        s6.status === 200);
assert('S6 status=ok',         s6.body.status === 'ok');
assert('S6 category=1',        s6.body.contexts_loaded.category === 1);
assert('S6 merchant=0',        s6.body.contexts_loaded.merchant === 0);
assert('S6 customer=0',        s6.body.contexts_loaded.customer === 0);
assert('S6 trigger=0',         s6.body.contexts_loaded.trigger === 0);
assert('S6 uptime>=0',         s6.body.uptime_seconds >= 0);

console.log('\n══════════════════════════════════════════════════\n');
