/**
 * test-retrieval.mjs — unit + integration tests for the Retrieval Service (CP4).
 *
 * Runs entirely in process — imports the service directly.
 * Does NOT require a running HTTP server.
 *
 * Covers:
 *   - tokenize()
 *   - scoreChunk()
 *   - search() — single keyword, multiple keywords, no results, unknown category
 *   - searchByCategory()
 *   - Top-5 default limit
 *   - Configurable limit
 *   - Deterministic ordering (stable across repeated calls)
 */

// Load the dataset first (service initialises synchronously, but the module
// graph needs datasetService.load() to have run before retrievalService
// can return results).
import { datasetService }  from './src/services/dataset.service.js';
import {
  tokenize,
  scoreChunk,
  search,
  searchByCategory,
  retrievalService,
} from './src/services/retrieval.service.js';

// Load dataset synchronously before tests
datasetService.load();

// ── Assertion helper ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, cond, detail = '') {
  const mark = cond ? '✅' : '❌';
  console.log(`${mark}  ${label}${detail ? ' — ' + detail : ''}`);
  if (cond) { passed++; } else { failed++; process.exitCode = 1; }
}

// ── Header ────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════');
console.log(' Retrieval Service — Tests (CP4)');
console.log('══════════════════════════════════════════════════\n');

// ─────────────────────────────────────────────────────────────────────────────
// TOKENIZER
// ─────────────────────────────────────────────────────────────────────────────

console.log('--- tokenize() ---');

const t1 = tokenize('Fluoride Varnish, 2026!');
assert('tokenize: lowercase',        t1.every(t => t === t.toLowerCase()));
assert('tokenize: splits on punct',  JSON.stringify(t1) === JSON.stringify(['fluoride','varnish','2026']));
assert('tokenize: no empty tokens',  t1.every(t => t.length > 0));

const t2 = tokenize('');
assert('tokenize: empty string → []', t2.length === 0);

const t3 = tokenize('  ');
assert('tokenize: whitespace only → []', t3.length === 0);

const t4 = tokenize(null);
assert('tokenize: null → []',        t4.length === 0);

// ─────────────────────────────────────────────────────────────────────────────
// SCORER
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- scoreChunk() ---');

const sampleChunk = {
  id: 'test_001',
  category: 'dentists',
  kind: 'research',
  title: 'fluoride varnish recall',
  summary: 'reduces caries recurrence in high-risk adults',
  source: 'JIDA Oct 2026',
};

const s1 = scoreChunk(sampleChunk, ['fluoride']);
assert('score: title hit = 5',       s1 === 5, `got ${s1}`);

const s2 = scoreChunk(sampleChunk, ['research']);
assert('score: kind hit = 4',        s2 === 4, `got ${s2}`);

const s3 = scoreChunk(sampleChunk, ['dentists']);
assert('score: category hit = 3',    s3 === 3, `got ${s3}`);

const s4 = scoreChunk(sampleChunk, ['caries']);
assert('score: summary hit = 2',     s4 === 2, `got ${s4}`);

const s5 = scoreChunk(sampleChunk, ['jida']);
assert('score: source hit = 1',      s5 === 1, `got ${s5}`);

const s6 = scoreChunk(sampleChunk, ['fluoride', 'caries']);
assert('score: multi-keyword adds',  s6 === 7, `got ${s6}`);  // title(5) + summary(2)

const s7 = scoreChunk(sampleChunk, []);
assert('score: empty keywords = 0',  s7 === 0, `got ${s7}`);

const s8 = scoreChunk(sampleChunk, ['zzznomatch']);
assert('score: no match = 0',        s8 === 0, `got ${s8}`);

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH — single keyword
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- search() — single keyword ---');

const r1 = search('fluoride');
assert('search: returns array',              Array.isArray(r1));
assert('search: fluoride hits dentist chunk', r1.length > 0 && r1[0].id === 'd_2026W17_jida_fluoride', `first id=${r1[0]?.id}`);
assert('search: each result has score',      r1.every(c => typeof c.score === 'number' && c.score > 0));
assert('search: default limit ≤ 5',         r1.length <= 5);

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH — multiple keywords
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- search() — multiple keywords ---');

const r2 = search('keratin smoothening salons');
assert('search: multi-kw returns results',  r2.length > 0);
assert('search: salons chunk first',        r2[0].category === 'salons', `got ${r2[0]?.category}`);

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH — category filter
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- search() — category filter ---');

const r3 = search('seasonal', { category: 'gyms' });
assert('search: category filter restricts', r3.every(c => c.category === 'gyms'), 'all gyms');
assert('search: category filter returns results', r3.length > 0);

const r4 = search('fluoride', { category: 'salons' });
assert('search: cross-category filtered out', r4.length === 0, 'fluoride not in salons');

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH — unknown category
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- search() — unknown category ---');

const r5 = search('fluoride', { category: 'nonexistent' });
assert('search: unknown category → []',     r5.length === 0);

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH — no results
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- search() — no results ---');

const r6 = search('zzzabsolutelynothing99999');
assert('search: no matches → []',          r6.length === 0);

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH — empty / invalid query
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- search() — edge cases ---');

assert('search: empty string → []',        search('').length === 0);
assert('search: whitespace → []',          search('   ').length === 0);
assert('search: null → []',               search(null).length === 0);

// ─────────────────────────────────────────────────────────────────────────────
// LIMIT
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- search() — limit ---');

const rLimit1 = search('2026', { limit: 3 });
assert('search: limit=3 respected',        rLimit1.length <= 3);

const rLimit2 = search('2026', { limit: 10 });
assert('search: limit=10 returns ≤10',    rLimit2.length <= 10);

const rLimit3 = search('2026');
assert('search: default limit=5',          rLimit3.length <= 5);

// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC ORDERING
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- search() — deterministic ordering ---');

const runA = search('seasonal compliance trend');
const runB = search('seasonal compliance trend');
assert('deterministic: two runs equal',
  JSON.stringify(runA) === JSON.stringify(runB));

// Verify sort: descending score
let orderedByScore = true;
for (let i = 1; i < runA.length; i++) {
  if (runA[i].score > runA[i - 1].score) { orderedByScore = false; break; }
}
assert('deterministic: sorted by score desc', orderedByScore);

// Verify tie-break: same-score entries in alpha title order
const tiedEntries = runA.filter(c => c.score === runA[0].score);
const sortedTitles = [...tiedEntries.map(c => c.title)].sort((a, b) => a.localeCompare(b));
assert('deterministic: tied scores sorted by title',
  JSON.stringify(tiedEntries.map(c => c.title)) === JSON.stringify(sortedTitles));

// ─────────────────────────────────────────────────────────────────────────────
// searchByCategory
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- searchByCategory() ---');

const rCat = searchByCategory('pharmacies', 'compliance');
assert('searchByCategory: returns results',    rCat.length > 0);
assert('searchByCategory: correct category',   rCat.every(c => c.category === 'pharmacies'));

const rCatNone = searchByCategory('restaurants', 'zzznothing');
assert('searchByCategory: no match → []',      rCatNone.length === 0);

// ─────────────────────────────────────────────────────────────────────────────
// retrievalService object API (mirrors spec's suggested object form)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- retrievalService object API ---');
assert('object: tokenize exists',       typeof retrievalService.tokenize === 'function');
assert('object: scoreChunk exists',     typeof retrievalService.scoreChunk === 'function');
assert('object: search exists',         typeof retrievalService.search === 'function');
assert('object: searchByCategory exists', typeof retrievalService.searchByCategory === 'function');

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n══════════════════════════════════════════════════`);
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════════════════\n`);
