// lib/postman.js — Postman Collection v2.1 builder (pure function, no side effects)
//
// Spec: https://schema.getpostman.com/json/collection/v2.1.0/collection.json

import { BODY_FORMAT } from './constants.js';

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Generates a simple UUID-like string for the collection _postman_id. */
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Extracts unique origins from a list of endpoints and maps each to a
 * Postman collection variable name.
 *
 * Single domain  → "baseUrl"
 * Multiple       → "baseUrl", "baseUrl_2", "baseUrl_3", ...
 *
 * @param {object[]} endpoints
 * @returns {Map<string, string>}  origin → variable name
 */
function buildOriginVarMap(endpoints) {
  const origins = new Set();
  for (const ep of endpoints) {
    try { origins.add(new URL(ep.path).origin); } catch { /* skip unparseable */ }
  }

  const map   = new Map();
  let counter = 1;
  for (const origin of origins) {
    map.set(origin, counter === 1 ? 'baseUrl' : `baseUrl_${counter}`);
    counter++;
  }
  return map;
}

/**
 * Builds the collection-level `variable` array.
 * Always includes one `baseUrl` per unique origin.
 * Adds a `token` placeholder when any endpoint requires authentication.
 *
 * @param {Map<string,string>} originVarMap
 * @param {object[]} endpoints
 * @returns {object[]}
 */
function buildVariables(originVarMap, endpoints) {
  const vars = [];

  for (const [origin, varName] of originVarMap) {
    vars.push({ key: varName, value: origin });
  }

  const needsToken = endpoints.some((ep) => ep.security_required);
  if (needsToken) {
    vars.push({ key: 'token', value: '' });
  }

  return vars;
}

/**
 * Converts a captured body format to the Postman `body` request object.
 * Returns undefined when there is no body (GET/HEAD) or format is unrecognised.
 *
 * @param {object|null} rb  - ep.request_body
 * @returns {object|undefined}
 */
function buildPostmanBody(rb) {
  if (!rb) return undefined;

  switch (rb.format) {
    case BODY_FORMAT.JSON:
      return {
        mode: 'raw',
        raw:  rb.raw ?? (rb.parsed ? JSON.stringify(rb.parsed, null, 2) : ''),
        options: { raw: { language: 'json' } },
      };

    case BODY_FORMAT.FORM_URLENCODED: {
      const urlencoded = rb.parsed
        ? Object.entries(rb.parsed).map(([key, value]) => ({
            key, value: String(value), type: 'text',
          }))
        : [];
      return { mode: 'urlencoded', urlencoded };
    }

    case BODY_FORMAT.MULTIPART: {
      const formdata = rb.parsed
        ? Object.entries(rb.parsed).map(([key, value]) => ({
            key,
            value: value === '[binary file]' ? '' : String(value),
            type:  value === '[binary file]' ? 'file' : 'text',
          }))
        : [];
      return { mode: 'formdata', formdata };
    }

    case BODY_FORMAT.XML:
      return {
        mode: 'raw',
        raw:  rb.raw ?? '',
        options: { raw: { language: 'xml' } },
      };

    case BODY_FORMAT.TEXT:
      return {
        mode: 'raw',
        raw:  rb.raw ?? '',
        options: { raw: { language: 'text' } },
      };

    case BODY_FORMAT.BINARY:
      return { mode: 'file', file: { src: '' } };

    default:
      return undefined;
  }
}

/**
 * Builds the Postman `url` object for an endpoint.
 * Replaces the origin with {{baseUrlVar}} and converts {id} → :id (Postman path var convention).
 *
 * @param {object}           ep
 * @param {Map<string,string>} originVarMap
 * @returns {object}
 */
function buildPostmanUrl(ep, originVarMap) {
  let u;
  try {
    u = new URL(ep.path);
  } catch {
    // Fallback for non-parseable paths
    return { raw: ep.path, host: [ep.path], path: [] };
  }

  const varName      = originVarMap.get(u.origin) ?? 'baseUrl';
  const rawSegments  = u.pathname.split('/').filter(Boolean);

  // Convert OpenAPI {id} → Postman :id path variable syntax
  const pmSegments   = rawSegments.map((s) =>
    /^\{.+\}$/.test(s) ? ':' + s.slice(1, -1) : s,
  );

  const query = Array.from(u.searchParams.entries()).map(([key, value]) => ({
    key, value,
  }));

  const rawPath = pmSegments.length ? '/' + pmSegments.join('/') : '/';
  const rawUrl  = `{{${varName}}}${rawPath}${u.search}`;

  return {
    raw:   rawUrl,
    host:  [`{{${varName}}}`],
    path:  pmSegments,
    ...(query.length && { query }),
  };
}

/**
 * Builds a single Postman request item from a captured endpoint.
 *
 * @param {object}           ep
 * @param {Map<string,string>} originVarMap
 * @returns {object}
 */
function buildPostmanItem(ep, originVarMap) {
  let pathname = '/';
  try { pathname = new URL(ep.path).pathname; } catch { pathname = ep.path; }

  const url  = buildPostmanUrl(ep, originVarMap);
  const body = buildPostmanBody(ep.request_body);

  // Filter out sensitive / already-sanitized headers; keep informational ones.
  const SKIP_HEADERS = new Set(['authorization', 'cookie', 'host', 'content-length']);
  const headers = (ep.request_headers ?? [])
    .filter((h) => !SKIP_HEADERS.has(h.name.toLowerCase()))
    .map(({ name, value }) => ({ key: name, value }));

  const request = {
    method: ep.method,
    ...(ep.security_required && {
      auth: {
        type: 'bearer',
        bearer: [{ key: 'token', value: '{{token}}', type: 'string' }],
      },
    }),
    header: headers,
    ...(body && { body }),
    url,
  };

  return {
    name:     `${ep.method} ${pathname}`,
    request,
    response: [], // saved responses not captured by design
  };
}

/**
 * Groups endpoints into folders by the first path segment.
 * Endpoints at the root (e.g. /health) go into a special "root" group.
 *
 * @param {object[]}         endpoints
 * @param {Map<string,string>} originVarMap
 * @returns {Map<string, object[]>}  folderName → Postman items
 */
function groupIntoFolders(endpoints, originVarMap) {
  const folders = new Map();

  for (const ep of endpoints) {
    let firstSegment = 'root';
    try {
      const segments = new URL(ep.path).pathname.split('/').filter(Boolean);
      if (segments.length) firstSegment = segments[0];
    } catch { /* keep 'root' */ }

    if (!folders.has(firstSegment)) folders.set(firstSegment, []);
    folders.get(firstSegment).push(buildPostmanItem(ep, originVarMap));
  }

  return folders;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds a complete Postman Collection v2.1 object from captured endpoints.
 *
 * Structure:
 *   - Endpoints are grouped into folders by their first URL path segment
 *   - Each unique origin becomes a {{baseUrl}} collection variable
 *   - If any endpoint requires auth, a {{token}} placeholder is added
 *
 * @param {object[]} endpoints
 * @returns {object}  Postman Collection v2.1
 */
export function buildPostmanCollection(endpoints) {
  const originVarMap = buildOriginVarMap(endpoints);
  const variables    = buildVariables(originVarMap, endpoints);
  const folders      = groupIntoFolders(endpoints, originVarMap);

  // Build top-level item array: single-segment folders become Postman folders,
  // multi-entry folders are wrapped; single items skip the folder wrapper.
  const items = [];
  for (const [folderName, folderItems] of folders) {
    if (folders.size === 1 && folderName === 'root') {
      // Everything at root — no folder wrapper needed
      items.push(...folderItems);
    } else {
      items.push({ name: folderName, item: folderItems });
    }
  }

  return {
    info: {
      name:         'SpecCatcher — Auto Generated',
      description:  'Automatically generated by SpecCatcher.',
      schema:       'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      _postman_id:  generateId(),
    },
    item: items,
    variable: variables,
  };
}
