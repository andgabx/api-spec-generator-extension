// lib/sanitize.js — sensitive data redaction (pure functions, no side effects)

import { SENSITIVE_HEADERS, SENSITIVE_BODY_KEYS } from './constants.js';

const REDACTED = '<REDACTED>';

// ── Headers ───────────────────────────────────────────────────────────────────

/**
 * Returns a copy of the header array with sensitive header values replaced.
 * @param {{ name: string, value: string }[]} headers
 * @returns {{ name: string, value: string }[]}
 */
export function sanitizeHeaders(headers) {
  return headers.map((h) =>
    SENSITIVE_HEADERS.includes(h.name.toLowerCase())
      ? { name: h.name, value: REDACTED }
      : h,
  );
}

/**
 * Returns true if any of the headers is an authentication header.
 * @param {{ name: string, value: string }[]} headers
 * @returns {boolean}
 */
export function hasAuthHeader(headers) {
  return headers.some((h) => SENSITIVE_HEADERS.includes(h.name.toLowerCase()));
}

// ── Body ──────────────────────────────────────────────────────────────────────

/**
 * Recursively walks a parsed JSON object and replaces sensitive key values.
 * Arrays are walked element by element.
 * Primitive values are returned as-is unless their key is sensitive.
 * @param {*} obj - Any JSON-deserialized value.
 * @returns {*}
 */
export function sanitizeBody(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeBody);

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_BODY_KEYS.includes(k.toLowerCase()) ? REDACTED : sanitizeBody(v);
  }
  return out;
}
