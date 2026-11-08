import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database } from './helpers.js';
import { createJob,getJob,claim,finish,reconcile,stmt } from '../src/store.js';
import { syntheticResult } from '../src/synthetic.js';
import { captureLead } from '../src/leads.js';
import { LOCAL } from '../src/contracts.js';
const sql=readFileSync(new URL('../scripts/metrics.sql',import.meta.url),'utf8').replace(/^--.*$/gmu,'').split(';').map(text=>text.trim()).filter(Boolean);
test('local metric queries preserve rows, separate cohorts/modes, deduplicate leads and compute nearest-rank latency from first claim',async()=>{
  const db=await database();const env=db.env;const base=Date.parse('2026-11-08T12:00:00Z');
  try {
    const jobIds=[];
    for(let i=0;i<5;i++) {
      const created=base+i*1000,queued=(i+1)*10,total=(i+1)*100;
      const {job}=await createJob(env,'synthetic-metrics-session','metrics-'+i,'synthetic-hash','https://example.com/','complete',created);jobIds.push(job.id);
      let attempt=await claim(env,job.id,'synthetic-metrics',created+queued);
      if(i===0) {
        await stmt(env,'UPDATE jobs SET lease_until=? WHERE id=?',created+20,job.id).run();
        await reconcile(env,created+30);attempt=await claim(env,job.id,'synthetic-metrics',created+60);
      }
      const result=syntheticResult(await getJob(env,job.id),created+total);
      if(i===4)Object.assign(result.checks.find(check=>check.id==='dns'),{collection:'timeout',evidence:null,errors:['CHECK_TIMEOUT']});
      await finish(env,job.id,'synthetic-metrics',attempt.lease_token,result,created+total);
      await finish(env,job.id,'synthetic-metrics',attempt.lease_token,result,created+total);
    }
    const body={analysis_id:jobIds[0],email:'pessoa@example.com',consent:true,consent_version:LOCAL.consent};
    await captureLead(env,'synthetic-metrics-session','metrics-lead-a',body,base+10000,true);
    await captureLead(env,'synthetic-metrics-session','metrics-lead-b',body,base+10000,true);
    // Real-mode data is seeded without a scanner or any network I/O.
    await createJob(env,'synthetic-other-session','metrics-real','synthetic-hash','https://example.net/',null,base+86400000);
    const before=await env.DB.prepare('SELECT COUNT(*) n FROM jobs').first();
    const results=[];for(const query of sql)results.push((await env.DB.prepare(query).all()).results);
    assert.equal(sql.length,5);assert.deepEqual(await env.DB.prepare('SELECT COUNT(*) n FROM jobs').first(),before);
    assert.equal(results[0].find(row=>row.event==='analysis_concluído').total,5);
    assert.equal(results[2].find(row=>row.mode==='synthetic').total,1);
    assert.equal(results[1].find(row=>row.mode==='synthetic').partial,1);assert.equal(results[1].find(row=>row.mode==='synthetic').with_score,4);
    const queue=results[3].find(row=>row.mode==='synthetic'&&row.metric==='queue_ms');assert.equal(queue.samples,5);assert.equal(queue.p50,30);assert.equal(queue.p95,50);
    const total=results[3].find(row=>row.mode==='synthetic'&&row.metric==='total_ms');assert.equal(total.p50,300);assert.equal(total.p95,500);
    const synthetic=results[4].find(row=>row.mode==='synthetic');assert.equal(synthetic.cohort_utc,'2026-11-08');assert.equal(synthetic.started,5);assert.equal(synthetic.completed,5);assert.equal(synthetic.leads,1);assert.equal(synthetic.leads_per_started,.2);
    const real=results[4].find(row=>row.mode==='real');assert.equal(real.cohort_utc,'2026-11-09');assert.equal(real.active,1);assert.equal(real.leads_per_completed,null);
    const output=JSON.stringify(results);for(const forbidden of ['pessoa@example.com','https://example.com/','synthetic-metrics-session',...jobIds])assert.ok(!output.includes(forbidden));
  } finally {await db.dispose();}
});
