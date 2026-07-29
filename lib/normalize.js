// lib/normalize.js — URL normalization and capture filtering (pure functions)

import { BINARY_ASSET_PATTERN } from './constants.js';

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Strips query string and fragment from a URL, returning only origin + pathname.
 * Falls back gracefully if the URL is not parseable.
 * @param {string} url
 * @returns {string}
 */
export function normalizePath(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

/**
 * Produces a stable key used to deduplicate endpoints across multiple calls.
 * @param {string} method  - HTTP method (case-insensitive).
 * @param {string} path    - URL or path (will be normalized).
 * @returns {string}  e.g. "POST::https://api.example.com/auth/login"
 */
export function endpointKey(method, path) {
  return `${method.toUpperCase()}::${normalizePath(path)}`;
}

// ── Capture filter ────────────────────────────────────────────────────────────

/**
 * Returns true if the URL should be captured as a potential API endpoint.
 * Drops non-HTTP URLs and known binary asset extensions.
 * Smart filter and method/status filters live in panel.js (user-controlled).
 * @param {string} url
 * @returns {boolean}
 */
export function shouldCapture(url) {
  if (!url.startsWith('http')) return false;
  if (BINARY_ASSET_PATTERN.test(url)) return false;
  return true;
}
