// lib/constants.js — shared constants across all modules

// ── Body format "enum" ────────────────────────────────────────────────────────
// Object.freeze makes this behave like a true enum: values are read-only and
// iterable, and typos in property names fail loudly at runtime.
export const BODY_FORMAT = Object.freeze({
  JSON:            'json',
  FORM_URLENCODED: 'form-urlencoded',
  MULTIPART:       'multipart',
  XML:             'xml',
  TEXT:            'text',
  BINARY:          'binary',
});

// ── Limits ────────────────────────────────────────────────────────────────────
export const MAX_ENDPOINTS = 100;
export const MAX_BODY_SIZE = 50_000; // 50 KB — bodies larger than this are truncated

// ── Sensitive data lists ──────────────────────────────────────────────────────
export const SENSITIVE_HEADERS = Object.freeze([
  'authorization',
  'cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
]);

export const SENSITIVE_BODY_KEYS = Object.freeze([
  'password',
  'token',
  'secret',
  'api_key',
  'access_token',
  'refresh_token',
  'credit_card',
  'cvv',
  'ssn',
]);

// ── Asset filter ──────────────────────────────────────────────────────────────
// Only drop true binary assets that can never be API endpoints.
export const BINARY_ASSET_PATTERN = /\.(png|jpg|jpeg|gif|webp|svg|ico|css|woff|woff2|ttf|eot|otf|mp4|webm|avi|mov|pdf|zip|gz|br|tar|bz2|map)(\?|$)/i;
