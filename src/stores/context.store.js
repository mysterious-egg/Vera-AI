/**
 * context.store.js — in-memory store for the 4 context layers.
 *
 * Each scope is a Map keyed by context_id.
 * Each entry: { context_id, version, payload, delivered_at }
 *
 * Idempotency rules (challenge-testing-brief.md §2.1):
 *   same (context_id, version) → no-op, return { status: 'noop' }
 *   incoming version < stored  → return { status: 'stale', currentVersion }
 *   incoming version > stored  → replace atomically, return { status: 'stored' }
 */

/** @type {Record<string, Map<string, object>>} */
const _store = {
  category: new Map(),
  merchant:  new Map(),
  customer:  new Map(),
  trigger:   new Map(),
};

export const VALID_SCOPES = new Set(['category', 'merchant', 'customer', 'trigger']);

export const contextStore = {
  /**
   * Store or update a context record.
   *
   * @param {string} scope        One of the four valid scopes.
   * @param {string} contextId
   * @param {number} version
   * @param {object} payload
   * @param {string} deliveredAt  ISO-8601 string from the judge.
   * @returns {{ status: 'stored'|'noop'|'stale', currentVersion?: number }}
   */
  set(scope, contextId, version, payload, deliveredAt) {
    const map = _store[scope];
    const existing = map.get(contextId);

    if (existing !== undefined) {
      if (existing.version === version) {
        // Same version — idempotent no-op
        return { status: 'noop' };
      }
      if (version < existing.version) {
        // Incoming is older than what we have
        return { status: 'stale', currentVersion: existing.version };
      }
    }

    // New entry or higher version — store atomically
    map.set(contextId, { context_id: contextId, version, payload, delivered_at: deliveredAt });
    return { status: 'stored' };
  },

  /**
   * Retrieve a single context record.
   *
   * @param {string} scope
   * @param {string} contextId
   * @returns {object|undefined}
   */
  get(scope, contextId) {
    return _store[scope]?.get(contextId);
  },

  /**
   * Return all records for a scope as an array.
   *
   * @param {string} scope
   * @returns {object[]}
   */
  getScope(scope) {
    return _store[scope] ? [..._store[scope].values()] : [];
  },

  /**
   * Counts per scope — consumed by GET /v1/healthz.
   *
   * @returns {{ category: number, merchant: number, customer: number, trigger: number }}
   */
  counts() {
    return {
      category: _store.category.size,
      merchant:  _store.merchant.size,
      customer:  _store.customer.size,
      trigger:   _store.trigger.size,
    };
  },

  /**
   * Wipe all stored contexts (useful for testing; not called by any route).
   */
  clear() {
    for (const map of Object.values(_store)) {
      map.clear();
    }
  },
};
