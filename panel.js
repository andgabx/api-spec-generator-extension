// panel.js — real-time UI, filtering, selection, and JSON export

// ── State ─────────────────────────────────────────────────────────────────────

let allEndpoints      = [];
let selectedId        = null;
let filterText        = '';
let filterMethod      = 'ALL';
let filterStatus      = 'ALL';
let smartFilter       = true;

let exportMode        = false;
let selectedForExport = new Set();   // Set of endpoint IDs

// ── DOM refs ──────────────────────────────────────────────────────────────────

const appEl          = document.getElementById('app');
const listEl         = document.getElementById('endpoint-list');
const detailEl       = document.getElementById('detail-panel');
const countBadge     = document.getElementById('count-badge');
const showingCountEl = document.getElementById('showing-count');
const searchEl       = document.getElementById('search');
const btnClear       = document.getElementById('btn-clear');
const btnCancel      = document.getElementById('btn-cancel');
const btnExport      = document.getElementById('btn-export');
const smartFilterEl  = document.getElementById('smart-filter');
const smartLabelEl   = document.getElementById('smart-filter-label');

// ── Background connection (auto-reconnect for MV3 SW lifecycle) ───────────────

const TAB_ID = chrome.devtools.inspectedWindow.tabId;

function connectPort() {
  const port = chrome.runtime.connect({ name: 'panel' });
  port.postMessage({ type: 'PANEL_INIT', tabId: TAB_ID });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'STATE_UPDATE') {
      allEndpoints = msg.state.captured_endpoints || [];
      renderList();
      if (selectedId) renderDetail(selectedId);
    }
  });

  port.onDisconnect.addListener(() => setTimeout(connectPort, 300));
}

connectPort();

// ── Smart filter patterns ─────────────────────────────────────────────────────

const BUILD_NOISE = [
  /\.chunk\.[a-f0-9]+\.js(\?|$)/i,
  /\.[a-f0-9]{8,}\.js(\?|$)/i,
  /__webpack_hmr/i,
  /\.hot-update\./i,
  /webpack_hot_update/i,
  /\?hmr=/i,
  /\/sockjs-node\//i,
  /\/@vite\//i,
  /\/@react-refresh/i,
  /\/node_modules\//i,
];

function passesSmartFilter(ep) {
  if (BUILD_NOISE.some((r) => r.test(ep.path))) return false;
  const ct = ep.content_type || '';
  if (ct.includes('text/html')) return false;
  if (/\.js(\?|$)/i.test(ep.path) && !ct.includes('json')) return false;
  return true;
}

// ── Filter application ────────────────────────────────────────────────────────

function filteredEndpoints() {
  return allEndpoints.filter((ep) => {
    if (smartFilter && !passesSmartFilter(ep)) return false;
    if (filterMethod !== 'ALL' && ep.method !== filterMethod) return false;
    if (filterStatus !== 'ALL') {
      if ((Math.floor(ep.last_status / 100) + 'xx') !== filterStatus) return false;
    }
    if (filterText) {
      if (!(ep.path.toLowerCase() + ' ' + ep.method.toLowerCase()).includes(filterText)) return false;
    }
    return true;
  });
}

// ── Export mode ───────────────────────────────────────────────────────────────

function enterExportMode() {
  exportMode = true;
  selectedForExport.clear();
  appEl.classList.add('export-mode');
  btnCancel.style.display = '';
  btnClear.style.display  = 'none';
  updateExportButton();
  renderList();
  if (selectedId) renderDetail(selectedId);
}

function exitExportMode() {
  exportMode = false;
  selectedForExport.clear();
  appEl.classList.remove('export-mode');
  btnCancel.style.display = 'none';
  btnClear.style.display  = '';
  btnExport.textContent   = 'Export as JSON';
  btnExport.disabled      = false;
  renderList();
  if (selectedId) renderDetail(selectedId);
}

function updateExportButton() {
  const n = selectedForExport.size;
  btnExport.textContent = n === 0 ? 'Export as JSON' : `Export ${n} selected`;
  btnExport.disabled    = n === 0;
}

function toggleEndpointSelection(id) {
  if (selectedForExport.has(id)) {
    selectedForExport.delete(id);
  } else {
    selectedForExport.add(id);
  }
  updateExportButton();
  renderList();
  if (selectedId === id) renderDetail(id);
}

function downloadSelected() {
  const toExport = allEndpoints.filter((ep) => selectedForExport.has(ep.id));
  if (toExport.length === 0) return;
  const spec = buildOpenAPISpec(toExport);
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `api-spec-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  exitExportMode();
}

// ── Event listeners ───────────────────────────────────────────────────────────

searchEl.addEventListener('input', () => {
  filterText = searchEl.value.toLowerCase();
  renderList();
});

document.getElementById('method-pills').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-method]');
  if (!btn) return;
  filterMethod = btn.dataset.method;
  document.querySelectorAll('#method-pills .pill').forEach((p) => p.classList.toggle('active', p === btn));
  renderList();
});

document.getElementById('status-pills').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-status]');
  if (!btn) return;
  filterStatus = btn.dataset.status;
  document.querySelectorAll('#status-pills .pill').forEach((p) => p.classList.toggle('active', p === btn));
  renderList();
});

smartFilterEl.addEventListener('change', () => {
  smartFilter = smartFilterEl.checked;
  smartLabelEl.textContent = smartFilter ? 'On' : 'Off';
  renderList();
});

btnClear.addEventListener('click', () => {
  allEndpoints = [];
  selectedId   = null;
  renderList();
  renderPlaceholder();
});

btnCancel.addEventListener('click', exitExportMode);

btnExport.addEventListener('click', () => {
  if (!exportMode) {
    enterExportMode();
  } else {
    downloadSelected();
  }
});

// Delegated clicks on the list (navigation + checkbox toggle)
listEl.addEventListener('click', (e) => {
  const checkEl = e.target.closest('.ep-check');
  if (checkEl) {
    e.stopPropagation();
    toggleEndpointSelection(checkEl.dataset.id);
    return;
  }
  const li = e.target.closest('.endpoint-item');
  if (li) {
    selectedId = li.dataset.id;
    renderList();
    renderDetail(selectedId);
  }
});

// Delegated clicks on the detail panel (export toggle)
detailEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.detail-export-check');
  if (btn) toggleEndpointSelection(btn.dataset.id);
});

// ── List rendering ────────────────────────────────────────────────────────────

function renderList() {
  const visible = filteredEndpoints();
  countBadge.textContent   = allEndpoints.length;
  showingCountEl.textContent = `${visible.length} of ${allEndpoints.length} endpoint${allEndpoints.length !== 1 ? 's' : ''}`;

  if (visible.length === 0) {
    listEl.innerHTML = `
      <li class="empty-state">
        <span>${allEndpoints.length === 0 ? 'No endpoints captured.' : 'No results match filters.'}</span>
        <small>${allEndpoints.length === 0 ? 'Reload the monitored page.' : 'Try adjusting your filters.'}</small>
      </li>`;
    return;
  }

  listEl.innerHTML = visible.map((ep) => {
    const isChecked = selectedForExport.has(ep.id);
    return `
      <li
        class="endpoint-item ${ep.id === selectedId ? 'selected' : ''} ${ep.last_status >= 400 ? 'error' : ''} ${isChecked ? 'export-checked' : ''}"
        data-id="${ep.id}"
        title="${ep.path}"
      >
        <span class="method method-${ep.method.toLowerCase()}">${ep.method}</span>
        <span class="path">${truncatePath(ep.path)}</span>
        <span class="status status-${statusBand(ep.last_status)}">${ep.last_status}</span>
        ${ep.security_required
          ? '<span class="auth-icon" title="Authenticated">🔒</span>'
          : '<span class="auth-icon public" title="Public">🌐</span>'}
        <span class="ep-check ${isChecked ? 'checked' : ''}" data-id="${ep.id}" title="Select for export"></span>
      </li>`;
  }).join('');
}

function truncatePath(path) {
  try {
    const u = new URL(path);
    const p = u.pathname + (u.search ? '?…' : '');
    return p.length > 44 ? '…' + p.slice(-43) : p;
  } catch {
    return path.length > 44 ? '…' + path.slice(-43) : path;
  }
}

function statusBand(code) {
  if (code >= 500) return '5xx';
  if (code >= 400) return '4xx';
  if (code >= 300) return '3xx';
  if (code >= 200) return '2xx';
  return 'other';
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function renderPlaceholder() {
  detailEl.innerHTML = `
    <div class="detail-placeholder">
      <span>← Select an endpoint to view its details</span>
    </div>`;
}

function renderDetail(id) {
  const ep = allEndpoints.find((e) => e.id === id);
  if (!ep) { renderPlaceholder(); return; }

  const isChecked = selectedForExport.has(ep.id);

  const schemaHtml = ep.schema_evolution
    ? `<pre class="code-block">${escHtml(JSON.stringify(ep.schema_evolution, null, 2))}</pre>`
    : '<p class="no-schema">No JSON response body captured yet.</p>';

  detailEl.innerHTML = `
    <div class="detail-content">
      <div class="detail-header">
        <span class="method method-${ep.method.toLowerCase()} method-lg">${ep.method}</span>
        <span class="detail-url">${ep.path}</span>
        <button
          class="detail-export-check ${isChecked ? 'checked' : ''}"
          data-id="${ep.id}"
          title="Toggle selection for export"
        >
          <span class="dex-box"></span>
          <span class="dex-label">${isChecked ? 'Selected' : 'Select'}</span>
        </button>
      </div>

      <div class="detail-meta">
        <span class="status status-${statusBand(ep.last_status)}">${ep.last_status}</span>
        ${ep.security_required
          ? '<span class="auth-badge auth">🔒 Authenticated</span>'
          : '<span class="auth-badge public">🌐 Public</span>'}
        <span class="meta-item" title="Captured calls">📊 ${ep.call_count ?? 1}×</span>
        <span class="meta-item" title="Last captured">🕐 ${formatTime(ep.timestamp)}</span>
        ${ep.content_type ? `<span class="meta-item ct-badge">${ep.content_type.split(';')[0]}</span>` : ''}
      </div>

      <section class="detail-section">
        <h3>JSON Schema (Response)</h3>
        ${schemaHtml}
      </section>

      <section class="detail-section">
        <h3>Request Headers</h3>
        <pre class="code-block">${escHtml(formatHeaders(ep.request_headers))}</pre>
      </section>

      <section class="detail-section">
        <h3>Response Headers</h3>
        <pre class="code-block">${escHtml(formatHeaders(ep.response_headers))}</pre>
      </section>
    </div>`;
}

function formatHeaders(headers) {
  if (!headers || headers.length === 0) return '(none)';
  return headers.map((h) => `${h.name}: ${h.value}`).join('\n');
}

function formatTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false });
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── OpenAPI 3.1 builder ───────────────────────────────────────────────────────

function buildOpenAPISpec(endpoints) {
  const paths = {};

  for (const ep of endpoints) {
    let pathKey;
    try { pathKey = new URL(ep.path).pathname; }
    catch { pathKey = ep.path; }

    pathKey = pathKey.replace(/\/(\d+)(\/|$)/g, '/{id}$2');

    if (!paths[pathKey]) paths[pathKey] = {};

    const method = ep.method.toLowerCase();
    const responseSchema = ep.schema_evolution
      ? { 'application/json': { schema: ep.schema_evolution } }
      : {};

    paths[pathKey][method] = {
      summary: `${ep.method} ${pathKey}`,
      security: ep.security_required ? [{ bearerAuth: [] }] : [],
      parameters: extractQueryParams(ep.path),
      responses: {
        [String(ep.last_status)]: {
          description: httpStatusDescription(ep.last_status),
          content: responseSchema,
        },
      },
      'x-capture-count': ep.call_count ?? 1,
      'x-last-captured': ep.timestamp,
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'API Spec — Auto Generated',
      version: chrome.runtime.getManifest().version,
      description: 'Automatically generated by API Spec Generator Extension.',
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKey:     { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
    },
  };
}

function extractQueryParams(url) {
  try {
    const u = new URL(url);
    return Array.from(u.searchParams.keys()).map((name) => ({
      name, in: 'query', schema: { type: 'string' }, example: u.searchParams.get(name),
    }));
  } catch { return []; }
}

function httpStatusDescription(code) {
  const map = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Entity',
    429: 'Too Many Requests', 500: 'Internal Server Error',
    502: 'Bad Gateway', 503: 'Service Unavailable',
  };
  return map[code] || 'Response';
}
