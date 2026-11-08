import { CHECKS, VERSIONS } from './contracts.js';
export const SCENARIOS = ['complete', 'partial', 'insufficient', 'inconclusive', 'tls-failure'];
export function syntheticResult(job, now = Date.now()) {
  const scenario = job.scenario || 'complete';
  const observed = new Date(now).toISOString();
  const common = { target: job.target, peer_verified: true };
  const evidence = {
    headers: { ...common, http_status: 200, interstitial: false, final_https:true, headers: { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' } },
    'http-security': { ...common, http_reaches_https: true },
    ssl: { ...common, identity_valid: true, valid_from: new Date(now - 86400000).toISOString(), valid_to: new Date(now + 86400000).toISOString() },
    dns: { ...common, public_address_count: 1 },
  };
  if (scenario === 'partial') evidence.headers.headers = { 'strict-transport-security': 'max-age=3600', 'content-security-policy': "default-src 'self'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'uninterpretable-synthetic' };
  if (scenario === 'tls-failure') evidence.ssl.identity_valid = false;
  return {
    schema_version: '1', job_id: job.id, attempt_id: job.attempt_id,
    engine: { name: 'web-check', revision: VERSIONS.engine, image_digest: VERSIONS.digest },
    policy_version: VERSIONS.policy, rules_version: VERSIONS.rules, result_version: VERSIONS.result, duration_ms: 0,
    checks: CHECKS.map(id => {
      const skip = scenario === 'inconclusive' || (scenario === 'insufficient' && ['headers', 'dns'].includes(id)) || (scenario === 'tls-failure' && id !== 'ssl');
      return { id, collection: skip ? 'timeout' : 'ok', observed_at: observed, evidence: skip ? null : evidence[id], errors: skip ? ['CHECK_TIMEOUT'] : [], duration_ms: 0 };
    }),
  };
}
