import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTarget } from '../src/target.js';
import { makeReport, validateResult } from '../src/report.js';
import { syntheticResult } from '../src/synthetic.js';
import { syntheticJob } from './helpers.js';

test('normalization preserves canonical scheme, IDNA and www', () => {
  assert.equal(normalizeTarget('EXAMPLE.com.'), 'https://example.com/');
  assert.equal(normalizeTarget('http://www.example.com:80/'), 'http://www.example.com/');
  assert.equal(normalizeTarget('https://ação.example.com'), 'https://xn--ao-siap.example.com/');
});
test('rejects URL ambiguity, private names, literals and alternate IP encodings', () => {
  for (const input of ['localhost', 'a.internal', 'example.com:8080', 'ftp://example.com', 'https://example.com/path', 'example.com?x', 'example.com#', 'user@example.com', '127.0.0.1', '2130706433', '0x7f000001', '0177.0.0.1', '[::1]', '[::ffff:127.0.0.1]', 'https://example.com\\@127.0.0.1', 'example%2ecom', '-bad.example.com', 'example.com:443/path', 'example.com//']) {
    assert.throws(() => normalizeTarget(input), { code: 'INVALID_TARGET' }, input);
  }
});
for (const [scenario, score, coverage, priorities] of [
  ['complete', 75, 1, 2], ['partial', 100, .95, 0], ['insufficient', null, .6, 0],
  ['inconclusive', null, 0, 0], ['tls-failure', null, .35, 1],
]) test(`scoring acceptance: ${scenario}`, () => {
  const now = Date.now(); const job = syntheticJob(now, scenario); const body = syntheticResult(job, now);
  validateResult(body, job, now);
  const report = makeReport(body.checks, job.target, new Date(now).toISOString());
  assert.equal(report.score, score); assert.equal(report.coverage, coverage); assert.equal(report.priorities.length, priorities);
  assert.deepEqual(makeReport(body.checks, job.target, report.observed_at), report);
  assert.match(report.disclaimer, /Não garante/u);
});
test('malformed, mismatched, extra and stale evidence never becomes approval', () => {
  const now = Date.now(); const job = syntheticJob(now); const body = syntheticResult(job, now);
  const mutations = [b => b.score = 100, b => b.checks.pop(), b => b.checks[0].evidence.target = 'https://example.org/',
    b => b.checks[0].evidence.peer_verified = false, b => b.checks[0].errors.push('CHECK_ERROR'),
    b => b.checks[0].evidence.headers.cookie = 'synthetic', b => b.checks[0].observed_at = '2000-01-01T00:00:00Z',
    b => b.engine.revision = 'unknown', b => b.checks[3].evidence.public_address_count = 0];
  for (const mutate of mutations) { const copy = structuredClone(body); mutate(copy); assert.throws(() => validateResult(copy, job, now)); }
});
test('anti-bot and HTTP errors suppress header scoring; errors never count as pass', () => {
  const job = syntheticJob(); const body = syntheticResult(job); body.checks[0].evidence.interstitial = true;
  let report = makeReport(body.checks, job.target, new Date().toISOString());
  assert.equal(report.coverage, .6); assert.equal(report.score, null);
  body.checks[0].evidence.interstitial = false; body.checks[0].evidence.http_status = 503;
  report = makeReport(body.checks, job.target, new Date().toISOString()); assert.equal(report.score, null);
});
test('headers use the observed HTTPS response, independently of the entered scheme; unproven HTTPS remains inconclusive',()=>{
  const now=Date.now(),job={...syntheticJob(now),target:'http://example.com/'};
  const body=syntheticResult(job,now);validateResult(body,job,now);
  let report=makeReport(body.checks,job.target,new Date(now).toISOString());assert.equal(report.coverage,1);assert.equal(report.score,75);
  body.checks[0].evidence.final_https=false;validateResult(body,job,now);
  report=makeReport(body.checks,job.target,new Date(now).toISOString());assert.equal(report.coverage,.6);assert.equal(report.score,null);
  for(const value of [undefined,'true',1]) {
    body.checks[0].evidence.final_https=value;assert.throws(()=>validateResult(body,job,now));
  }
  const legacy=syntheticResult(job,now);legacy.result_version='normalized-v1-proposal';assert.throws(()=>validateResult(legacy,job,now),{code:'VERSION_MISMATCH'});
  const legacyJob={...job,versions_json:JSON.stringify({...JSON.parse(job.versions_json),result:'normalized-v1-proposal'})};
  assert.throws(()=>validateResult(legacy,legacyJob,now),{code:'VERSION_MISMATCH'});
  const priorRules=syntheticResult(job,now);priorRules.rules_version='score-v0-proposal';
  const priorRulesJob={...job,versions_json:JSON.stringify({...JSON.parse(job.versions_json),rules:'score-v0-proposal'})};
  assert.throws(()=>validateResult(priorRules,priorRulesJob,now),{code:'VERSION_MISMATCH'});
});
test('uninterpretable CSP and duplicate HSTS directives never count as adequate', () => {
  const job = syntheticJob(); const body = syntheticResult(job);
  body.checks[0].evidence.headers['content-security-policy'] = "default-src 'self'; unrecognized <script>";
  body.checks[0].evidence.headers['strict-transport-security'] = 'max-age=3600; max-age=0';
  const report = makeReport(body.checks, job.target, new Date().toISOString());
  assert.equal(report.evaluations.find(r => r.id === 'CSP').evaluation, 'inconclusivo');
  assert.equal(report.evaluations.find(r => r.id === 'HSTS').evaluation, 'inconclusivo'); assert.equal(report.score, null);
});
test('callback rejects null checks and evidence from before the claimed attempt', () => {
  const now = Date.now(); const job = { ...syntheticJob(now), attempt_started_at: now - 100 };
  const body = syntheticResult(job, now); body.checks[0] = null;
  assert.throws(() => validateResult(body, job, now), { code: 'CHECK_SET' });
  const old = syntheticResult(job, now - 500); assert.throws(() => validateResult(old, job, now), { code: 'INVALID_TIME' });
});
test('failed informative DNS is disclosed as partial without changing scoring weights or inventing a priority',()=>{
  const now=Date.now(),job=syntheticJob(now),body=syntheticResult(job,now);
  Object.assign(body.checks.find(check=>check.id==='dns'),{collection:'timeout',evidence:null,errors:['CHECK_TIMEOUT']});
  validateResult(body,job,now);const report=makeReport(body.checks,job.target,new Date(now).toISOString());
  assert.equal(report.coverage,1);assert.equal(report.score,null);assert.equal(report.label,'Parcial');assert.equal(report.priorities.length,2);assert.match(report.score_message,/DNS/u);
  assert.ok(report.limitations.some(limitation=>limitation.id==='COLETA-DNS'&&limitation.reason.includes('não comprova ausência')));
  Object.assign(body.checks[0].evidence.headers,{'strict-transport-security':'max-age=3600','content-security-policy':"default-src 'self'"});
  assert.equal(makeReport(body.checks,job.target,new Date(now).toISOString()).score,null);
});
