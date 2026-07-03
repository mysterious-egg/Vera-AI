/**
 * retrieval.service.js — deterministic keyword retrieval over the dataset.
 *
 * Consumes chunks from datasetService (loaded in CP3).
 * No filesystem access. No embeddings. No AI. Fully synchronous.
 *
 * Algorithm
 * ─────────
 * 1. Tokenize the query into lowercase word tokens (once per call).
 * 2. For each chunk, score against five weighted fields:
 *      title    → +5
 *      kind     → +4
 *      category → +3
 *      summary  → +2
 *      source   → +1
 *    Each field contributes its weight at most once per call (no duplicate
 *    inflation). Field token sets are derived from chunk.searchText (precomputed
 *    in CP3) so no per-call re-tokenization of individual fields occurs.
 * 3. Chunks with score 0 are excluded.
 * 4. Sort: descending score, then ascending title (deterministic tie-break).
 * 5. Return up to `limit` results (default 5).
 *
 * Public API
 * ──────────
 *   tokenize(text)                — split text into lowercase word tokens
 *   scoreChunk(chunk, keywords)   — compute score for a single chunk
 *   search(query, options)        — main entry point
 *   searchByCategory(slug, query) — shorthand for category-filtered search
 *   retrievalService              — named object exposing all four functions
 */

import { datasetService } from './dataset.service.js';

// ── Field weights ─────────────────────────────────────────────────────────────

/** Ordered list of [fieldName, weight] pairs. */
const FIELD_WEIGHTS = [
  ['title',    5],
  ['kind',     4],
  ['category', 3],
  ['summary',  2],
  ['source',   1],
];

const DEFAULT_LIMIT = 5;

// ── Tokenizer ─────────────────────────────────────────────────────────────────

/**
 * Split text into lowercase word tokens.
 * Splits on any non-alphanumeric character (punctuation, whitespace, symbols).
 * Removes empty tokens. No stemming, no stop-word removal.
 *
 * @param {string} text
 * @returns {string[]}  Array of lowercase word tokens.
 */
export function tokenize(text) {
  if (typeof text !== 'string' || text.trim() === '') return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

// ── Scorer ────────────────────────────────────────────────────────────────────

/**
 * Compute a relevance score for a single chunk against a set of query tokens.
 *
 * Uses chunk.searchText (precomputed in CP3) as the fast lookup surface.
 * Per-field weights are applied by checking each keyword against each field's
 * own token set, built once per scoreChunk() call.
 * Each field contributes its weight at most once per call — no duplicate
 * inflation regardless of how many keywords match the same field.
 *
 * @param {object}   chunk     Normalized chunk from datasetService (must have searchText).
 * @param {string[]} keywords  Lowercase query tokens from tokenize().
 * @returns {number}           Non-negative integer score.
 */
export function scoreChunk(chunk, keywords) {
  if (!keywords || keywords.length === 0) return 0;

  // Build token sets for each weighted field once per call.
  // This avoids rebuilding them N times inside nested loops.
  const fieldTokenSets = FIELD_WEIGHTS.map(([field]) => {
    const value = chunk[field] ?? '';
    return new Set(tokenize(String(value)));
  });

  let score = 0;

  for (let f = 0; f < FIELD_WEIGHTS.length; f++) {
    const weight   = FIELD_WEIGHTS[f][1];
    const tokens   = fieldTokenSets[f];

    // A field scores its weight if ANY query keyword appears in it.
    // The break ensures the weight is added at most once per field.
    for (const kw of keywords) {
      if (tokens.has(kw)) {
        score += weight;
        break;
      }
    }
  }

  return score;
}

// ── Main search ───────────────────────────────────────────────────────────────

/**
 * Search the knowledge base for chunks relevant to a query.
 *
 * @param {string} query                  Free-text search string.
 * @param {object} [options={}]
 * @param {string} [options.category]     Restrict results to one category slug.
 * @param {string} [options.merchant]     Accepted; reserved for future use (ignored in CP4).
 * @param {string} [options.trigger]      Accepted; reserved for future use (ignored in CP4).
 * @param {number} [options.limit]        Max results to return (default: 5).
 * @returns {object[]}  Scored, ranked chunks (score field included on each item).
 *                      Returns [] on empty query, unknown category, or no matches.
 *                      Never throws.
 */
export function search(query, options = {}) {
  // merchant and trigger are accepted for forward-compatibility but unused in CP4.
  const { category, limit = DEFAULT_LIMIT } = options;

  if (typeof query !== 'string' || query.trim() === '') return [];

  const keywords = tokenize(query);
  if (keywords.length === 0) return [];

  // Candidate pool — optionally filtered by category
  let chunks = datasetService.getAllChunks();

  if (category) {
    chunks = chunks.filter((c) => c.category === category);
    if (chunks.length === 0) return []; // unknown or empty category
  }

  // Score every candidate; exclude zero-score chunks
  const scored = [];
  for (const chunk of chunks) {
    const score = scoreChunk(chunk, keywords);
    if (score > 0) {
      scored.push({ ...chunk, score });
    }
  }

  if (scored.length === 0) return [];

  // Primary: highest score. Secondary: title alphabetically (deterministic tie-break).
  scored.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : a.title.localeCompare(b.title),
  );

  return scored.slice(0, limit);
}

// ── Convenience shorthand ─────────────────────────────────────────────────────

/**
 * Search within a single category.
 *
 * @param {string} category  Category slug.
 * @param {string} query     Free-text query.
 * @param {number} [limit]   Max results (default: 5).
 * @returns {object[]}
 */
export function searchByCategory(category, query, limit = DEFAULT_LIMIT) {
  return search(query, { category, limit });
}

// ── Named export object (mirrors spec's suggested API) ────────────────────────

export const retrievalService = {
  tokenize,
  scoreChunk,
  search,
  searchByCategory,
};
