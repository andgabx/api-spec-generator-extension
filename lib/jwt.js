// lib/jwt.js — JWT detection and decoding (pure functions, no side effects)
//
// ⚠️  Limitation: this module only decodes — it does NOT verify signatures.
//     Verification requires the server's private/secret key, which is never
//     available in a browser DevTools context.

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Decodes a base64url-encoded string to a UTF-8 string.
 * base64url differs from base64 in two characters: - instead of + and _ instead of /
 */
function base64urlDecode(str) {
  // Normalize to standard base64
  const base64  = str.replace(/-/g, '+').replace(/_/g, '/');
  // Pad to a multiple of 4
  const padded  = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
  return atob(padded);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if the string structurally looks like a JWT
 * (three base64url segments separated by dots).
 * Does NOT verify the signature.
 *
 * @param {string} token
 * @returns {boolean}
 */
export function isJWT(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p));
}

/**
 * Scans request headers for an Authorization: Bearer <token> header
 * and returns the raw JWT string if one is found and structurally valid.
 * Returns null otherwise.
 *
 * @param {{ name: string, value: string }[]} headers
 * @returns {string|null}
 */
export function getJWTFromHeaders(headers) {
  const authHeader = headers.find((h) => h.name.toLowerCase() === 'authorization');
  if (!authHeader) return null;

  const match = authHeader.value.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const token = match[1].trim();
  return isJWT(token) ? token : null;
}

/**
 * Decodes the header and payload segments of a JWT.
 * Does NOT verify the signature.
 *
 * @param {string} token
 * @returns {{ header: object, payload: object, raw: string } | null}
 *   Returns null if the token cannot be decoded (malformed base64 or JSON).
 */
export function decodeJWT(token) {
  try {
    const [headerB64, payloadB64] = token.split('.');
    const header  = JSON.parse(base64urlDecode(headerB64));
    const payload = JSON.parse(base64urlDecode(payloadB64));
    return { header, payload, raw: token };
  } catch {
    return null; // malformed token
  }
}

/**
 * Recursively scans an object or array to find a string that is a valid JWT.
 * Returns the first valid JWT string found, or null.
 *
 * @param {any} obj
 * @returns {string|null}
 */
export function findJWTInObject(obj) {
  if (typeof obj === 'string') {
    return isJWT(obj) ? obj : null;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findJWTInObject(item);
      if (found) return found;
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const key of Object.keys(obj)) {
      const found = findJWTInObject(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Analyses the expiry claim (`exp`) of a decoded JWT payload.
 *
 * @param {object} payload - The decoded JWT payload object.
 * @returns {{
 *   status:    'valid' | 'expiring' | 'expired' | 'no-exp',
 *   expired:   boolean,
 *   expiresAt: Date | null,
 *   timeLeft:  string | null,   // human-readable, e.g. "2h 15m left"
 * }}
 */
export function getTokenExpiry(payload) {
  if (!payload.exp) {
    return { status: 'no-exp', expired: false, expiresAt: null, timeLeft: null };
  }

  const expiresAt = new Date(payload.exp * 1000);
  const diffMs    = expiresAt - Date.now();

  if (diffMs <= 0) {
    return { status: 'expired', expired: true, expiresAt, timeLeft: null };
  }

  const diffSecs  = Math.floor(diffMs / 1_000);
  const diffMins  = Math.floor(diffSecs  / 60);
  const diffHours = Math.floor(diffMins  / 60);
  const diffDays  = Math.floor(diffHours / 24);

  let timeLeft;
  if      (diffDays  > 0) timeLeft = `${diffDays}d ${diffHours % 24}h left`;
  else if (diffHours > 0) timeLeft = `${diffHours}h ${diffMins % 60}m left`;
  else if (diffMins  > 0) timeLeft = `${diffMins}m left`;
  else                    timeLeft = `${diffSecs}s left`;

  // Warn when less than 5 minutes remain
  const status = diffMs < 5 * 60 * 1_000 ? 'expiring' : 'valid';

  return { status, expired: false, expiresAt, timeLeft };
}
