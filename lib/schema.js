// lib/schema.js — JSON schema inference and merging (pure functions, no side effects)

// ── Inference ─────────────────────────────────────────────────────────────────

/**
 * Walks a parsed JSON value and infers an OpenAPI-compatible JSON Schema.
 * @param {*} value - Any JSON-deserialized value.
 * @returns {object} A JSON Schema fragment.
 */
export function inferSchema(value) {
  if (value === null) return { type: 'null' };

  if (Array.isArray(value)) {
    const items = value.map(inferSchema);
    return { type: 'array', items: items.length > 0 ? mergeSchemas(items) : {} };
  }

  if (typeof value === 'object') {
    const properties = {};
    const required   = [];
    for (const [k, v] of Object.entries(value)) {
      properties[k] = inferSchema(v);
      required.push(k);
    }
    return { type: 'object', properties, required };
  }

  if (typeof value === 'boolean') return { type: 'boolean', example: value };

  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { type: 'integer', example: value }
      : { type: 'number',  example: value };
  }

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value))  return { type: 'string', format: 'date-time', example: value };
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))  return { type: 'string', format: 'date',      example: value };
    if (/^[a-f0-9-]{36}$/.test(value))       return { type: 'string', format: 'uuid',      example: value };
    if (/^https?:\/\//.test(value))           return { type: 'string', format: 'uri',       example: value };
    return { type: 'string', example: value };
  }

  return {};
}

// ── Merging ───────────────────────────────────────────────────────────────────

/**
 * Merges an array of schemas into one, combining all observed shapes.
 * @param {object[]} schemas
 * @returns {object}
 */
export function mergeSchemas(schemas) {
  if (schemas.length === 0) return {};
  return schemas.slice(1).reduce(mergeTwoSchemas, schemas[0]);
}

/**
 * Merges two schema fragments. When types differ, produces an anyOf union.
 * When both are objects, merges their properties (intersection of required).
 * @param {object} a
 * @param {object} b
 * @returns {object}
 */
export function mergeTwoSchemas(a, b) {
  if (!a || !b) return a || b;

  if (a.type !== b.type) {
    const merged = [...(a.anyOf || [a])];
    for (const s of (b.anyOf || [b])) {
      if (!merged.some((m) => m.type === s.type)) merged.push(s);
    }
    return { anyOf: merged };
  }

  if (a.type === 'object') {
    const allKeys  = new Set([...Object.keys(a.properties || {}), ...Object.keys(b.properties || {})]);
    const properties = {};
    for (const k of allKeys) properties[k] = mergeTwoSchemas(a.properties?.[k], b.properties?.[k]);
    const required = (a.required || []).filter((k) => (b.required || []).includes(k));
    return { type: 'object', properties, required };
  }

  if (a.type === 'array') {
    return { type: 'array', items: mergeTwoSchemas(a.items, b.items) };
  }

  return { ...a, example: b.example ?? a.example };
}
