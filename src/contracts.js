export const CHECKS = Object.freeze(['headers', 'http-security', 'ssl', 'dns']);
export const VERSIONS = Object.freeze({
  schema: '1', policy: 'network-v1-proposal', rules: 'score-v1-proposal',
  result: 'normalized-v2-proposal', engine: 'synthetic-only', digest: 'synthetic-only',
});
export const QUICK_VERSIONS = Object.freeze({
  ...VERSIONS, policy: 'worker-public-only-v1-proposal', rules: 'quick-score-v1-proposal',
  result: 'quick-result-v1-proposal', engine: 'worker-quick', digest: 'worker-quick-v1',
});
// Experimental local parameters. These are NOT approved production defaults.
export const LOCAL = Object.freeze({ jobMs: 120000, leaseMs: 30000, retainMs: 86400000,
  maxAttempts: 2, sessionQuota: 6, domainQuota: 12, dailyBudget: 30,
  healthMs: 45000, pollMs: 2000, maxBody: 32768, consent: 'local-review-v0' });
export const TERMINAL = new Set(['concluído', 'falhou', 'expirou']);
export class Problem extends Error {
  constructor(status, code, message, retryable = false) {
    super(message); Object.assign(this, { status, code, retryable });
  }
}
export function fail(status, code, message, retryable = false) { throw new Problem(status, code, message, retryable); }
export function object(value, keys, required = keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(k => !keys.includes(k)) || required.some(k => !(k in value))) {
    fail(400, 'INVALID_SCHEMA', 'Formato de dados inválido.');
  }
  return value;
}
export function string(value, max = 200, min = 1) {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(400, 'INVALID_FIELD', 'Campo inválido.');
  }
  return value;
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export function token() { return crypto.randomUUID() + crypto.randomUUID(); }
export async function secretEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
export async function jsonBody(request, limit = LOCAL.maxBody) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'JSON_REQUIRED', 'Envie JSON.');
  if (!request.body) fail(400, 'INVALID_JSON', 'Dados ausentes.');
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE', 'Dados excedem o limite.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(400, 'INVALID_JSON', 'JSON inválido.'); }
}
