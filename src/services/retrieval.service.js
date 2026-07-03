/**
 * retrieval.service.js — deterministic keyword retrieval over the dataset.
 *
 * Consumes chunks from datasetService (loaded in CP3).
 * No filesystem access. No embeddings. No AI. Fully synchronous.
 *
 * Algorithm
 * ─────────
 * 1. Tokenize the query into lowercase words.
 * 2. For each chunk, score by counting token hits against the chunk's
 *    individual fields using per-field weights:
 *      title match   → +5
 *      kind  match   → +4
 *      category match→ +3
 *      summary match → +2
 *      source match  → +1
 * 3. A token is counted at most once per field (no duplicate-hit inflation).
 * 4. Chunks with score 0 are excluded.
 * 5. Sort: descending score, then ascending title (deterministic tie-break).
 * 6. Return up to `limit` results (default 5).
 *
 * Public API
 * ──────────
 *   tokenize(text)                — split text into lowercase word tokens
 *   scoreChunk(chunk, keywords)   — compute score for a single chunk
 *   search(query, options)        — main entry point
 *   searchByCategory(slug, query) — shorthand for category-filtered search
 */

import { datasetService } from './dataset.service.js';

// ── Field weights ─────────────────────────────────────────────────────────────

const WEIGHTS = {
  title:    5,
  kind:     4,
  category: 3,
  summary:  2,
  source:   1,
};

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
 * Each token is scored at most once per field (no duplicate inflation).
 * A token scores against a field when it appears as a substring of the
 * field's tokenized text (word-boundary match via the tokenized field set).
 *
 * @param {object}   chunk     Normalized chunk from datasetService.
 * @param {string[]} keywords  Lowercase query tokens from tokenize().
 * @returns {number}           Non-negative integer score.
 */
export function scoreChunk(chunk, keywords) {
  if (!keywords || keywords.length === 0) return 0;

  let score = 0;

  for (const [field, weight] of Object.entries(WEIGHTS)) {
    const fieldValue = chunk[field] ?? '';
    const fieldTokens = new Set(tokenize(String(fieldValue)));

    for (const kw of keywords) {
      if (fieldTokens.has(kw)) {
        score += weight;
        break; // count each field at most once per keyword
      }
    }
  }

  return score;
}

// ── Main search ───────────────────────────────────────────────────────────────

/**
 * Search the knowledge base for chunks relevant to a query.
 *
 * @param {string} query               Free-text search string.
 * @param {object} [options={}]
 * @param {string} [options.category]  Slug to restrict results to one category.
 * @param {number} [options.limit]     Max results to return (default: 5).
 * @returns {object[]}  Scored, ranked chunks (score included on each item).
 *                      Returns [] on empty query, unknown category, no matches.
 */
export function search(query, options = {}) {
  const { category, limit = DEFAULT_LIMIT } = options;

  // Graceful handling — never throw
  if (typeof query !== 'string' || query.trim() === '') return [];

  const keywords = tokenize(query);
  if (keywords.length === 0) return [];

  // Obtain candidate pool
  let chunks = datasetService.getAllChunks();

  // Category filter
  if (category) {
    chunks = chunks.filter((c) => c.category === category);
    // If the filter yields no chunks the category is unknown — return []
    if (chunks.length === 0) return [];
  }

  // Score every candidate
  const scored = [];
  for (const chunk of chunks) {
    const score = scoreChunk(chunk, keywords);
    if (score > 0) {
      scored.push({ ...chunk, score });
    }
  }

  if (scored.length === 0) return [];

  // Sort: highest score first; title alphabetically as deterministic tie-break
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.title.localeCompare(b.title);
  });

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
