/**
 * test-dataset.mjs — one-shot scenario test for the Dataset Service (CP3).
 * Run with the server already started: node test-dataset.mjs
 */

const BASE = 'http://localhost:3000';

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: await r.json() };
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

function assert(label, cond, detail = '') {
  const mark = cond ? '✅' : '❌';
  console.log(`${mark}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
}

console.log('\n══════════════════════════════════════════════════');
console.log(' Dataset Service — Scenario Tests (CP3)');
console.log('══════════════════════════════════════════════════\n');

// ── T1: healthz reflects dataset_loaded=true ────────────────────────────────

const t1 = await get('/v1/healthz');
console.log('T1 healthz:', JSON.stringify(t1.body));
assert('T1 status=200',              t1.status === 200);
assert('T1 status=ok',               t1.body.status === 'ok');
assert('T1 uptime_seconds exists',   typeof t1.body.uptime_seconds === 'number');
assert('T1 contexts_loaded exists',  typeof t1.body.contexts_loaded === 'object');
assert('T1 dataset_loaded=true',     t1.body.dataset_loaded === true);
assert('T1 dataset_stats exists',    typeof t1.body.dataset_stats === 'object');

// ── T2: category and chunk counts are positive (dataset-size-agnostic) ───────

console.log('\n--- T2: dataset counts ---');
const { categories: catCount, chunks: chunkCount } = t1.body.dataset_stats;
console.log(`   categories=${catCount}  chunks=${chunkCount}`);
assert('T2 categories > 0',  catCount > 0,   `got ${catCount}`);
assert('T2 chunks > 0',      chunkCount > 0, `got ${chunkCount}`);
// Sanity: at least one chunk per category
assert('T2 chunks >= categories', chunkCount >= catCount);

// ── T3: POST /v1/context regression ─────────────────────────────────────────

console.log('\n--- T3: POST /v1/context regression ---');
const t3 = await post('/v1/context', {
  scope: 'category',
  context_id: 'dentists',
  version: 1,
  delivered_at: new Date().toISOString(),
  payload: { slug: 'dentists' },
});
console.log('T3 context push:', JSON.stringify(t3));
assert('T3 status=200',    t3.status === 200);
assert('T3 accepted=true', t3.body.accepted === true);
assert('T3 has ack_id',    typeof t3.body.ack_id === 'string');

// ── T4: healthz context count reflects the push ─────────────────────────────

console.log('\n--- T4: healthz context count after push ---');
const t4 = await get('/v1/healthz');
assert('T4 category context=1',       t4.body.contexts_loaded.category === 1);
// Dataset stats must be unchanged after a context push
assert('T4 dataset still loaded',     t4.body.dataset_loaded === true);
assert('T4 dataset counts unchanged', t4.body.dataset_stats.categories === catCount);

console.log('\n══════════════════════════════════════════════════\n');
