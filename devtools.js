// devtools.js — network capture orchestration
// Responsibilities: listen to network events, build endpoint state, relay to panel.
// Business logic (schema, sanitize, normalize, request-body) lives in lib/.

import { MAX_ENDPOINTS }                        from './lib/constants.js';
import { normalizePath, endpointKey,
         shouldCapture }                        from './lib/normalize.js';
import { sanitizeHeaders, sanitizeBody,
         hasAuthHeader }                        from './lib/sanitize.js';
import { inferSchema, mergeTwoSchemas }         from './lib/schema.js';
import { captureRequestBody, mergeRequestBody } from './lib/request-body.js';
import { findJWTInObject }                      from './lib/jwt.js';

// ── Panel registration ────────────────────────────────────────────────────────

chrome.devtools.panels.create('SpecCatcher', 'icons/icon16.png', 'panel.html', () => {});

// ── State ─────────────────────────────────────────────────────────────────────

const state = { captured_endpoints: [] };
const INSPECTED_TAB_ID = chrome.devtools.inspectedWindow.tabId;

// ── Port (auto-reconnect for MV3 SW lifecycle) ────────────────────────────────

let port;
function connectPort() {
  port = chrome.runtime.connect({ name: 'devtools' });
  port.onDisconnect.addListener(() => setTimeout(connectPort, 300));
}
connectPort();

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId() {
  return 'ep_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
}

// ── Network listener ──────────────────────────────────────────────────────────

chrome.devtools.network.onRequestFinished.addListener((request) => {
  const { method, url, headers: reqHeaders = [] } = request.request;
  const { status, headers: resHeaders = [] }       = request.response;

  if (!shouldCapture(url)) return;

  const contentType       = resHeaders.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
  const path              = normalizePath(url);
  const key               = endpointKey(method, path);
  const sanitizedReqHdrs  = sanitizeHeaders(reqHeaders);
  const sanitizedResHdrs  = sanitizeHeaders(resHeaders);
  const security_required = hasAuthHeader(reqHeaders);

  // Capture request body synchronously — postData is already on the request object.
  const request_body = captureRequestBody(request);

  request.getContent((body) => {
    let responseSchema = null;
    let responseJwt = null;

    if (body && contentType.includes('json')) {
      try {
        const parsedBody = JSON.parse(body);
        responseJwt = findJWTInObject(parsedBody);
        responseSchema = inferSchema(sanitizeBody(parsedBody));
      } catch { /* non-JSON body */ }
    }

    const existing = state.captured_endpoints.find((ep) => endpointKey(ep.method, ep.path) === key);

    if (existing) {
      existing.last_status       = status;
      existing.content_type      = contentType;
      existing.timestamp         = new Date().toISOString();
      existing.call_count        = (existing.call_count || 1) + 1;
      existing.security_required = existing.security_required || security_required;
      existing.request_body      = mergeRequestBody(existing.request_body, request_body);
      existing.response_jwt      = responseJwt || existing.response_jwt;

      if (responseSchema && existing.schema_evolution) {
        existing.schema_evolution = mergeTwoSchemas(existing.schema_evolution, responseSchema);
      } else if (responseSchema) {
        existing.schema_evolution = responseSchema;
      }
    } else {
      state.captured_endpoints.unshift({
        id:               generateId(),
        method:           method.toUpperCase(),
        path,
        content_type:     contentType,
        security_required,
        last_status:      status,
        call_count:       1,
        request_headers:  sanitizedReqHdrs,
        response_headers: sanitizedResHdrs,
        schema_evolution: responseSchema,
        request_body,
        response_jwt:     responseJwt,
        timestamp:        new Date().toISOString(),
      });

      if (state.captured_endpoints.length > MAX_ENDPOINTS) {
        state.captured_endpoints = state.captured_endpoints.slice(0, MAX_ENDPOINTS);
      }
    }

    port.postMessage({ type: 'STATE_UPDATE', state, tabId: INSPECTED_TAB_ID });
  });
});
