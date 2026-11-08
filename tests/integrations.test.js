import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteverify } from '../src/worker.js';
import { hubspotTransport } from '../src/hubspot.js';
test('Turnstile validates success, hostname and action on server', async () => {
  const original = globalThis.fetch;
  try {
    for (const [payload, valid] of [
      [{ success: true, hostname: 'security.example.com', action: 'security-check' }, true],
      [{ success: true, hostname: 'other.example.com', action: 'security-check' }, false],
      [{ success: true, hostname: 'security.example.com', action: 'other' }, false],
      [{ success: false }, false],
    ]) {
      globalThis.fetch = async (url, init) => { assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify'); assert.equal(JSON.parse(init.body).response, 'synthetic'); return Response.json(payload); };
      const check = siteverify(new Request('https://security.example.com/'), { TURNSTILE_SECRET: 'synthetic', TURNSTILE_HOSTNAME: 'security.example.com' }, 'synthetic');
      if (valid) await check; else await assert.rejects(check, { code: 'TURNSTILE_INVALID' });
    }
  } finally { globalThis.fetch = original; }
});
test('HubSpot transport requires approved mapping, minimizes data and preserves external ID', async () => {
  assert.throws(() => hubspotTransport({ accessToken: 'synthetic', mapping: {} }), /CRM_MAPPING_REVIEW_REQUIRED/u);
  let sent;
  const transport = hubspotTransport({ accessToken: 'synthetic', mapping: { reviewed: true, objectType: 'synthetic_object', uniqueProperty: 'synthetic_external_id', properties: { email: 'synthetic_email', domain: 'synthetic_domain' } },
    fetcher: async (url, init) => { assert.match(url, /^https:\/\/api\.hubapi\.com\/crm\/v3\/objects\/synthetic_object\/batch\/upsert$/u); sent = JSON.parse(init.body); return Response.json({ status: 'COMPLETE', results: [{ id: 'synthetic-crm-id' }] }); } });
  const lead = { id: 'synthetic-lead', state: 'revisão_manual', email: 'pessoa@example.com', consent_at: 1, consent_version: 'synthetic',
    session_hash: 'must-not-send', summary_json: JSON.stringify({ target: 'https://example.com/', analysis_id: 'synthetic-job', priorities: [], synthetic: false }) };
  assert.equal((await transport(lead)).status, 'confirmed');
  assert.equal(sent.inputs[0].id, 'synthetic-lead');
  assert.deepEqual(sent.inputs[0].properties, { synthetic_external_id: 'synthetic-lead', synthetic_email: 'pessoa@example.com', synthetic_domain: 'https://example.com/' });
  await assert.rejects(transport({ ...lead, consent_at: null }), /CONSENT_REQUIRED/u);
  await assert.rejects(transport({ ...lead, summary_json: JSON.stringify({ synthetic: true }) }), /SYNTHETIC_CRM_DELIVERY_FORBIDDEN/u);
});
test('ambiguous CRM responses are never reported as sent', async () => {
  const base = { accessToken: 'synthetic', mapping: { reviewed: true, objectType: 'synthetic', uniqueProperty: 'external_id', properties: { email: 'email' } } };
  const lead = { id: 'synthetic', state: 'revisão_manual', email: 'pessoa@example.com', consent_at: 1, consent_version: 'synthetic', summary_json: '{}' };
  for (const response of [new Response('', { status: 500 }), Response.json({ status: 'PENDING' }), Response.json({ status: 'COMPLETE', results: [], errors: [{}] })]) {
    const send = hubspotTransport({ ...base, fetcher: async () => response }); assert.equal((await send(lead)).status, 'ambiguous');
  }
});
