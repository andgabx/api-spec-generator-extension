// lib/request-body.js — request body capture, parsing, and schema inference

import { BODY_FORMAT, MAX_BODY_SIZE, SENSITIVE_BODY_KEYS } from './constants.js';
import { sanitizeBody }                                     from './sanitize.js';
import { inferSchema, mergeTwoSchemas }                     from './schema.js';

// ── Format detection ──────────────────────────────────────────────────────────

/**
 * Maps a MIME type string to one of the BODY_FORMAT constants.
 * @param {string|null} mimeType
 * @returns {string} A BODY_FORMAT value.
 */
export function detectBodyFormat(mimeType) {
  if (!mimeType)                                                return BODY_FORMAT.TEXT;
  if (mimeType.includes('application/json'))                    return BODY_FORMAT.JSON;
  if (mimeType.includes('application/x-www-form-urlencoded'))  return BODY_FORMAT.FORM_URLENCODED;
  if (mimeType.includes('multipart/form-data'))                 return BODY_FORMAT.MULTIPART;
  if (mimeType.includes('application/xml') ||
      mimeType.includes('text/xml'))                            return BODY_FORMAT.XML;
  if (mimeType.includes('text/'))                               return BODY_FORMAT.TEXT;
  return BODY_FORMAT.BINARY;
}

// ── Body parsing ──────────────────────────────────────────────────────────────

/**
 * Parses postData into a plain object based on the detected format.
 * Returns null for unparseable formats (xml, text, binary) or on error.
 *
 * @param {{ text?: string, params?: {name:string,value:string,contentType?:string}[] }} postData
 * @param {string} format - A BODY_FORMAT value.
 * @returns {object|null}
 */
function parseBody(postData, format) {
  try {
    switch (format) {
      case BODY_FORMAT.JSON: {
        const parsed = JSON.parse(postData.text);
        return sanitizeBody(parsed);
      }

      case BODY_FORMAT.FORM_URLENCODED: {
        const obj = {};
        for (const [k, v] of new URLSearchParams(postData.text).entries()) {
          obj[k] = SENSITIVE_BODY_KEYS.includes(k.toLowerCase()) ? '<REDACTED>' : v;
        }
        return obj;
      }

      case BODY_FORMAT.MULTIPART: {
        if (!postData.params?.length) return null;
        const obj = {};
        for (const { name, value, contentType } of postData.params) {
          if (contentType?.includes('octet-stream')) {
            obj[name] = '[binary file]';
          } else {
            obj[name] = SENSITIVE_BODY_KEYS.includes(name.toLowerCase()) ? '<REDACTED>' : value;
          }
        }
        return obj;
      }

      default:
        return null; // xml, text, binary — raw only
    }
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reads and processes the request body from a DevTools HAR request object.
 * Operates synchronously — postData is already present on the request object,
 * no extra async call is needed.
 *
 * Returns null when there is no body (GET, HEAD, OPTIONS, etc.).
 *
 * @param {object} harRequest - The full object from onRequestFinished.
 * @returns {{
 *   mime_type: string|null,
 *   format:    string,
 *   raw:       string|null,
 *   parsed:    object|null,
 *   schema:    object|null,
 *   truncated: boolean,
 * }|null}
 */
export function captureRequestBody(harRequest) {
  const postData = harRequest.request.postData;
  if (!postData) return null;

  const mimeType = postData.mimeType || null;
  const format   = detectBodyFormat(mimeType);

  // Binary: signal presence without storing bytes
  if (format === BODY_FORMAT.BINARY) {
    return { mime_type: mimeType, format, raw: null, parsed: null, schema: null, truncated: false };
  }

  const rawText   = postData.text ?? null;
  const truncated = rawText !== null && rawText.length > MAX_BODY_SIZE;
  const raw       = truncated ? rawText.slice(0, MAX_BODY_SIZE) : rawText;

  const parsed = parseBody(postData, format);
  const schema = parsed !== null ? inferSchema(parsed) : null;

  return { mime_type: mimeType, format, raw, parsed, schema, truncated };
}

/**
 * Merges two request_body snapshots for the same endpoint.
 *
 * Strategy:
 *   - Schema is merged (union of all observed shapes, same as response schema).
 *   - Raw body comes from the most recent capture (incoming).
 *   - truncated flag is OR'd — if any call was truncated, we flag it.
 *
 * @param {object|null} existing
 * @param {object|null} incoming
 * @returns {object|null}
 */
export function mergeRequestBody(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const schema =
    existing.schema && incoming.schema
      ? mergeTwoSchemas(existing.schema, incoming.schema)
      : existing.schema ?? incoming.schema;

  return {
    ...incoming,                                          // most recent raw/parsed
    schema,                                               // broadest known shape
    truncated: existing.truncated || incoming.truncated,  // any truncation flagged
  };
}
