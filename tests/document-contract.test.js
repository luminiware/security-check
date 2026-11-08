import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateResult,makeReport } from '../src/report.js';
import { VERSIONS } from '../src/contracts.js';
test('documented callback parses and satisfies the implemented versioned contract',()=>{
  const text=readFileSync(new URL('../docs/architecture.md',import.meta.url),'utf8');
  const examples=[...text.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/gu)].map(match=>JSON.parse(match[1]));
  const body=examples.find(example=>example.result_version);assert.ok(body);
  const now=Math.max(...body.checks.map(check=>Date.parse(check.observed_at)))+1000;
  const versions={...VERSIONS,engine:body.engine.revision,digest:body.engine.image_digest};
  const job={id:body.job_id,attempt_id:body.attempt_id,target:'https://example.com/',created_at:now-body.duration_ms,versions_json:JSON.stringify(versions)};
  validateResult(body,job,now);const report=makeReport(body.checks,job.target,new Date(now).toISOString(),versions);
  assert.equal(report.score,null);assert.equal(report.label,'Parcial');assert.equal(report.versions.result,'normalized-v2-proposal');
});
