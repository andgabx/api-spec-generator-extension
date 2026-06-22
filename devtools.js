// devtools.js — network capture, processing, and forwarding to panel

const MAX_ENDPOINTS = 100;
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'x-api-key', 'x-auth-token', 'proxy-authorization'];
const SENSITIVE_BODY_KEYS = ['password', 'token', 'secret', 'api_key', 'access_token', 'refresh_token', 'credit_card', 'cvv', 'ssn'];

chrome.devtools.panels.create('API Spec', 'icons/icon16.png', 'panel.html', () => {});

const state = { captured_endpoints: [] };

const INSPECTED_TAB_ID = chrome.devtools.inspectedWindow.tabId;

let port;
function connectPort() {
  port = chrome.runtime.connect({ name: 'devtools' });
  port.onDisconnect.addListener(() => setTimeout(connectPort, 300));
}
connectPort();

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return 'ep_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
}

function endpointKey(method, path) {
  return `${method.toUpperCase()}::${normalizePath(path)}`;
}

function normalizePath(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

function sanitizeHeaders(headers) {
  return headers.map((h) =>
    SENSITIVE_HEADERS.includes(h.name.toLowerCase()) ? { name: h.name, value: '<REDACTED>' } : h
  );
}

function sanitizeBody(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeBody);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_BODY_KEYS.includes(k.toLowerCase()) ? '<REDACTED>' : sanitizeBody(v);
  }
  return out;
}

function inferSchema(value) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    const items = value.map(inferSchema);
    return { type: 'array', items: items.length > 0 ? mergeSchemas(items) : {} };
  }
  if (typeof value === 'object') {
    const properties = {}, required = [];
    for (const [k, v] of Object.entries(value)) { properties[k] = inferSchema(v); required.push(k); }
    return { type: 'object', properties, required };
  }
  if (typeof value === 'boolean') return { type: 'boolean', example: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'integer', example: value } : { type: 'number', example: value };
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return { type: 'string', format: 'date-time', example: value };
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))  return { type: 'string', format: 'date', example: value };
    if (/^[a-f0-9-]{36}$/.test(value))       return { type: 'string', format: 'uuid', example: value };
    if (/^https?:\/\//.test(value))           return { type: 'string', format: 'uri', example: value };
    return { type: 'string', example: value };
  }
  return {};
}

function mergeSchemas(schemas) {
  if (schemas.length === 0) return {};
  return schemas.slice(1).reduce(mergeTwoSchemas, schemas[0]);
}

function mergeTwoSchemas(a, b) {
  if (!a || !b) return a || b;
  if (a.type !== b.type) {
    const merged = [...(a.anyOf || [a])];
    for (const s of (b.anyOf || [b])) {
      if (!merged.some((m) => m.type === s.type)) merged.push(s);
    }
    return { anyOf: merged };
  }
  if (a.type === 'object') {
    const allKeys = new Set([...Object.keys(a.properties || {}), ...Object.keys(b.properties || {})]);
    const properties = {};
    for (const k of allKeys) properties[k] = mergeTwoSchemas(a.properties?.[k], b.properties?.[k]);
    const required = (a.required || []).filter((k) => (b.required || []).includes(k));
    return { type: 'object', properties, required };
  }
  if (a.type === 'array') return { type: 'array', items: mergeTwoSchemas(a.items, b.items) };
  return { ...a, example: b.example ?? a.example };
}

function hasAuthHeader(headers) {
  return headers.some((h) => SENSITIVE_HEADERS.includes(h.name.toLowerCase()));
}

// ── Minimum capture filter ────────────────────────────────────────────────────
// Only drop true binary assets that can never be API endpoints.
// Smart-filter and method/status filters live in panel.js so the user controls them.
const BINARY_ASSET = /\.(png|jpg|jpeg|gif|webp|svg|ico|css|woff|woff2|ttf|eot|otf|mp4|webm|avi|mov|pdf|zip|gz|br|tar|bz2|map)(\?|$)/i;

function shouldCapture(url) {
  if (!url.startsWith('http')) return false;
  if (BINARY_ASSET.test(url)) return false;
  return true;
}

// ── Network listener ─────────────────────────────────────────────────────────

chrome.devtools.network.onRequestFinished.addListener((request) => {
  const { method, url, headers: reqHeaders = [] } = request.request;
  const { status, headers: resHeaders = [] } = request.response;

  if (!shouldCapture(url)) return;

  const contentType = resHeaders.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
  const path = normalizePath(url);
  const key = endpointKey(method, path);
  const sanitizedReqHeaders = sanitizeHeaders(reqHeaders);
  const sanitizedResHeaders = sanitizeHeaders(resHeaders);
  const security_required = hasAuthHeader(reqHeaders);

  request.getContent((body) => {
    let responseSchema = null;

    if (body && contentType.includes('json')) {
      try {
        responseSchema = inferSchema(sanitizeBody(JSON.parse(body)));
      } catch { /* non-JSON body */ }
    }

    const existing = state.captured_endpoints.find((ep) => endpointKey(ep.method, ep.path) === key);

    if (existing) {
      existing.last_status = status;
      existing.content_type = contentType;
      existing.timestamp = new Date().toISOString();
      existing.call_count = (existing.call_count || 1) + 1;
      existing.security_required = existing.security_required || security_required;
      if (responseSchema && existing.schema_evolution) {
        existing.schema_evolution = mergeTwoSchemas(existing.schema_evolution, responseSchema);
      } else if (responseSchema) {
        existing.schema_evolution = responseSchema;
      }
    } else {
      state.captured_endpoints.unshift({
        id: generateId(),
        method: method.toUpperCase(),
        path,
        content_type: contentType,
        security_required,
        last_status: status,
        call_count: 1,
        request_headers: sanitizedReqHeaders,
        response_headers: sanitizedResHeaders,
        schema_evolution: responseSchema,
        timestamp: new Date().toISOString(),
      });

      if (state.captured_endpoints.length > MAX_ENDPOINTS) {
        state.captured_endpoints = state.captured_endpoints.slice(0, MAX_ENDPOINTS);
      }
    }

    port.postMessage({ type: 'STATE_UPDATE', state, tabId: INSPECTED_TAB_ID });
  });
});
