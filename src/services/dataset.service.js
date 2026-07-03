/**
 * dataset.service.js — loads, normalizes, and caches all category knowledge.
 *
 * Reads every JSON file from dataset/categories/ at startup.
 * All other services consume data through this service's API — no direct
 * filesystem access is permitted outside fileLoader.js.
 *
 * Public API:
 *   load()            — load (or reload) all category files; throws on error
 *   reload()          — alias for load(); convenience for hot-reloading
 *   isLoaded()        — true once load() completes without error
 *   getCategories()   — all normalized category objects as an array
 *   getCategory(slug) — single category by slug, or undefined
 *   getDigest(slug)   — digest chunks for one category
 *   getChunk(id)      — single chunk by its id (across all categories)
 *   getAllChunks()     — all digest chunks as a flat array
 *   counts()          — { categories, chunks } totals
 */

import { join, dirname } from 'node:path';
import { fileURLToPath }  from 'node:url';
import { listJsonFiles, loadJsonFile } from '../utils/fileLoader.js';
import { logger } from '../utils/logger.js';

// Absolute path to the categories directory.
// import.meta.url resolves to this file; dataset/ sits two levels above src/.
const __dirname = dirname(fileURLToPath(import.meta.url));
const CATEGORIES_DIR = join(__dirname, '..', '..', 'dataset', 'categories');

// ── In-memory cache ───────────────────────────────────────────────────────────

/** @type {Map<string, object>} slug → normalized category */
const _categories = new Map();

/** @type {Map<string, object>} chunk id → chunk */
const _chunks = new Map();

/** Whether load() has completed successfully at least once. */
let _loaded = false;

// ── Normalization ─────────────────────────────────────────────────────────────

/**
 * Normalize a raw JSON category into a consistent internal structure.
 *
 * @param {object} raw  Parsed JSON from a category file.
 * @returns {object}    Normalized category.
 */
function normalizeCategory(raw) {
  return {
    slug:                   raw.slug                  ?? '',
    display_name:           raw.display_name          ?? raw.slug ?? '',
    voice:                  raw.voice                 ?? {},
    offer_catalog:          Array.isArray(raw.offer_catalog)          ? raw.offer_catalog          : [],
    peer_stats:             raw.peer_stats             ?? {},
    digest:                 Array.isArray(raw.digest)                 ? raw.digest                 : [],
    patient_content_library: Array.isArray(raw.patient_content_library) ? raw.patient_content_library : [],
    seasonal_beats:         Array.isArray(raw.seasonal_beats)         ? raw.seasonal_beats         : [],
    trend_signals:          Array.isArray(raw.trend_signals)          ? raw.trend_signals          : [],
    regulatory_authorities: Array.isArray(raw.regulatory_authorities) ? raw.regulatory_authorities : [],
    professional_journals:  Array.isArray(raw.professional_journals)  ? raw.professional_journals  : [],
  };
}

/**
 * Convert a single raw digest item into a reusable knowledge chunk.
 * Chunks are flat records — easy to iterate and filter during retrieval.
 *
 * @param {object} item      Raw digest item from the category file.
 * @param {string} categorySlug
 * @returns {object}         Normalized chunk.
 */
function normalizeChunk(item, categorySlug) {
  const title   = item.title   ?? '';
  const summary = item.summary ?? '';
  const kind    = item.kind    ?? 'unknown';
  const source  = item.source  ?? '';

  return {
    id:         item.id,
    category:   categorySlug,
    kind,
    title,
    summary,
    source,
    metadata: {
      actionable:      item.actionable      ?? null,
      trial_n:         item.trial_n         ?? null,
      patient_segment: item.patient_segment ?? null,
      date:            item.date            ?? null,
      credits:         item.credits         ?? null,
    },
    // Pre-built search surface for the Retrieval Engine (CP4).
    // Lowercase concatenation of all human-readable fields.
    searchText: [categorySlug, kind, title, summary, source]
      .join(' ')
      .toLowerCase(),
  };
}

// ── Core load logic ───────────────────────────────────────────────────────────

/**
 * Load every .json file from the categories directory, normalize, and cache.
 * Throws on any unrecoverable error (missing dir, bad JSON, duplicate IDs).
 */
function load() {
  logger.info('dataset_loading', { dir: CATEGORIES_DIR });

  // Clear existing cache before (re)loading
  _categories.clear();
  _chunks.clear();
  _loaded = false;

  const files = listJsonFiles(CATEGORIES_DIR);

  if (files.length === 0) {
    throw new Error(`No JSON files found in dataset directory: "${CATEGORIES_DIR}"`);
  }

  for (const filePath of files) {
    const raw = loadJsonFile(filePath);

    // ── Slug validation ──────────────────────────────────────────────────────

    const slug = raw.slug;
    if (!slug || typeof slug !== 'string') {
      throw new Error(`Category file missing "slug": ${filePath}`);
    }

    if (_categories.has(slug)) {
      throw new Error(`Duplicate category slug "${slug}" found in: ${filePath}`);
    }

    // ── Normalize & store category ───────────────────────────────────────────

    const category = normalizeCategory(raw);

    if (category.digest.length === 0) {
      logger.warn('dataset_empty_digest', { slug });
    }

    // ── Normalize & store digest chunks ─────────────────────────────────────

    for (const item of category.digest) {
      if (!item.id) {
        logger.warn('dataset_chunk_missing_id', { slug, title: item.title });
        continue;
      }

      if (_chunks.has(item.id)) {
        throw new Error(`Duplicate digest ID "${item.id}" in category "${slug}"`);
      }

      _chunks.set(item.id, normalizeChunk(item, slug));
    }

    _categories.set(slug, category);
    logger.info('dataset_category_loaded', {
      slug,
      digest:  category.digest.length,
      content: category.patient_content_library.length,
    });
  }

  _loaded = true;

  logger.info('dataset_ready', {
    categories: _categories.size,
    chunks:     _chunks.size,
  });
}

// ── Public service API ────────────────────────────────────────────────────────

export const datasetService = {
  /**
   * Load (or reload) all category files from disk.
   * Throws on any error — callers must handle or let the process abort.
   */
  load,

  /** Alias for load() — used when hot-reloading is needed. */
  reload: load,

  /** Whether the dataset has been successfully loaded. */
  isLoaded: () => _loaded,

  /**
   * All normalized categories as an array.
   * @returns {object[]}
   */
  getCategories: () => [..._categories.values()],

  /**
   * Look up a single category by slug.
   * @param {string} slug
   * @returns {object|undefined}
   */
  getCategory: (slug) => _categories.get(slug),

  /**
   * All digest chunks for a single category.
   * @param {string} slug
   * @returns {object[]}
   */
  getDigest: (slug) => {
    const category = _categories.get(slug);
    if (!category) return [];
    return category.digest.map((item) => _chunks.get(item.id)).filter(Boolean);
  },

  /**
   * Look up a single chunk by its id.
   * @param {string} chunkId
   * @returns {object|undefined}
   */
  getChunk: (chunkId) => _chunks.get(chunkId),

  /**
   * All chunks across all categories as a flat array.
   * @returns {object[]}
   */
  getAllChunks: () => [..._chunks.values()],

  /**
   * Totals for health reporting.
   * @returns {{ categories: number, chunks: number }}
   */
  counts: () => ({
    categories: _categories.size,
    chunks:     _chunks.size,
  }),
};
