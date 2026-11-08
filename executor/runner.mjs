import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import ipaddr from 'ipaddr.js';
import { CHECKS, VERSIONS, canonical } from '../src/contracts.js';
import { normalizeTarget } from '../src/target.js';
import { publicAddress } from './address-policy.mjs';
import { DockerCLI, SANDBOX_LABEL, SANDBOX_OWNER, removeOwnedSandbox, reapExpiredSandboxes } from './docker.mjs';
import { normalizeUpstream, resultEnvelope } from './upstream.mjs';
import { guardianState } from './guardian-state.mjs';
import { startSandboxWatchdog } from './watchdog.mjs';
import { POLICY_ROOT,removeOwnedPolicyDirectory } from './policy-files.mjs';
import { createBoundedFetch } from './bounded-fetch.mjs';
const workloadSource = createBoundedFetch.toString()+'\n'+readFileSync(new URL('./workload.mjs',import.meta.url),'utf8');
function limitsChecked(limits) {
  const ranges = { wallMs:[1000,120000], checkMs:[100,30000], memoryMiB:[64,1024], pids:[8,128],
    ingressBytes:[32768,16777216], egressBytes:[32768,16777216], maxPacketBytes:[1500,16384],
    maxDnsRequests:[1,256], maxOutputBytes:[4096,65536], callbackMarginMs:[250,10000],
    maxRedirects:[0,5],maxResponseBytes:[4096,1048576],maxTotalBodyBytes:[4096,2097152],maxHttpRequests:[1,16] };
  if (!limits || Object.keys(limits).some(k => ![...Object.keys(ranges),'cpus'].includes(k))) throw new Error('RUNNER_LIMITS_REQUIRED');
  for (const [key,[min,max]] of Object.entries(ranges)) if (!Number.isSafeInteger(limits[key]) || limits[key]<min || limits[key]>max) throw new Error('RUNNER_LIMITS_REQUIRED');
  if (!Number.isFinite(limits.cpus) || limits.cpus < .1 || limits.cpus > 4) throw new Error('RUNNER_LIMITS_REQUIRED');
  return Object.freeze({...limits});
}
export function validateWorkload(payload,started,now=Date.now()) {
  const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(k=>keys.includes(k));
  const duration=value=>Number.isSafeInteger(value)&&value>=0&&value<=now-started+1000;
  if (!exact(payload,['schema_version','checks','duration_ms']) || payload.schema_version!=='workload-v1-proposal' || !duration(payload.duration_ms) ||
      !Array.isArray(payload.checks) || payload.checks.length!==CHECKS.length) throw new Error('WORKLOAD_CONTRACT_INVALID');
  for (let i=0;i<CHECKS.length;i++) {
    const check=payload.checks[i];
    if (!exact(check,['id','collection','data','http','observed_at','duration_ms']) || check.id!==CHECKS[i] || !['ok','erro','timeout','bloqueado','não_executado'].includes(check.collection) ||
        !duration(check.duration_ms) || check.duration_ms>payload.duration_ms+1000 || typeof check.observed_at!=='string' ||
        !Number.isFinite(Date.parse(check.observed_at)) || Date.parse(check.observed_at)<started || Date.parse(check.observed_at)>now ||
        (check.collection==='ok' ? !check.data||typeof check.data!=='object'||Array.isArray(check.data) : check.data!==null)) throw new Error('WORKLOAD_CONTRACT_INVALID');
    if(check.http!==null&&(!['headers','http-security'].includes(check.id)||
      !exact(check.http,['http_status','interstitial','final_https','redirect_count','http_reaches_https'])||
      !Number.isInteger(check.http.http_status)||check.http.http_status<200||check.http.http_status>599||
      typeof check.http.interstitial!=='boolean'||typeof check.http.final_https!=='boolean'||!Number.isInteger(check.http.redirect_count)||check.http.redirect_count<0||check.http.redirect_count>5||
      (check.http.http_reaches_https!==null&&typeof check.http.http_reaches_https!=='boolean')||
      (check.id==='headers'&&check.http.http_reaches_https!==null)||
      (check.http.http_reaches_https!==null&&(check.http.http_reaches_https!==check.http.final_https||check.http.interstitial||check.http.http_status>=400))))throw new Error('WORKLOAD_CONTRACT_INVALID');
  }
  return payload;
}
export function createDockerRunner(config) { return runner(config,false); }
export function createIsolatedLabRunner(config, { fault } = {}) { return runner(config,true,fault); }
function runner({ engineImage, guardianImage, networkId, limits, resolveTarget, docker = new DockerCLI() }, lab, fault) {
  if (!/^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/u.test(engineImage || '') || !/^sha256:[a-f0-9]{64}$/u.test(guardianImage || '') ||
      !/^[a-f0-9]{64}$/u.test(networkId || '') || typeof resolveTarget !== 'function') throw new Error('RUNNER_CONFIGURATION_REQUIRED');
  const policy = limitsChecked(limits); let healthy = true;
  const faults = {
    unresponsive: "import {writeFileSync} from 'node:fs';import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e','while(true){}'],{stdio:'ignore'});writeFileSync('/tmp/workload-started',JSON.stringify({child_pid:child.pid}));process.on('SIGTERM',()=>{});while(true){}",
    output: "process.stdout.write('x'.repeat(1048576));setInterval(()=>{},1000)",
    memory: "const retained=[];for(;;)retained.push(Buffer.alloc(8*1024*1024,1));",
  };
  if (fault && (!lab || !Object.hasOwn(faults,fault))) throw new Error('INVALID_LAB_FAULT');
  const execute = async (attempt, signal) => {
    attempt = structuredClone(attempt);
    signal?.throwIfAborted();
    if (!healthy) throw new Error('RUNNER_CLEANUP_REQUIRED');
    const started = Date.now();
    if (!attempt || !/^[a-f0-9-]{36}$/u.test(attempt.job_id || '') || !/^[a-f0-9-]{36}$/u.test(attempt.attempt_id || '') ||
        normalizeTarget(attempt.target) !== attempt.target || !Number.isSafeInteger(attempt.lease_until) || canonical(attempt.allowed_checks) !== canonical(CHECKS) ||
        attempt.versions?.digest !== engineImage.split('@')[1] || !/^[a-f0-9]{40}$/u.test(attempt.versions.engine || '') ||
        attempt.versions.policy !== VERSIONS.policy || attempt.versions.rules !== VERSIONS.rules || attempt.versions.result !== VERSIONS.result) throw new Error('RUNNER_CLAIM_INVALID');
    const leaseDeadline = Math.min(attempt.lease_until,Date.parse(attempt.deadline_at));
    if (!Number.isFinite(leaseDeadline) || leaseDeadline <= started + policy.callbackMarginMs) throw new Error('RUNNER_DEADLINE_EXPIRED');
    const outer = AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(Math.min(policy.wallMs,leaseDeadline-started-policy.callbackMarginMs))]);
    const [network,image] = await Promise.all([docker.inspect('network',networkId,{signal:outer}),docker.inspect('image',engineImage,{signal:outer})]);
    if (network.Driver !== 'bridge' || network.Scope !== 'local' || (lab && (network.Internal !== true || network.Labels?.['luminiware.security-check.lab'] !== 'true')) ||
        image.Config?.Labels?.['org.opencontainers.image.revision'] !== attempt.versions.engine || !image.RepoDigests?.includes(engineImage)) throw new Error('RUNNER_ARTIFACT_OR_NETWORK_MISMATCH');
    const supplied = await resolveTarget(attempt.target,outer);
    const reservation = supplied && {...supplied,addresses:Array.isArray(supplied.addresses)?[...supplied.addresses]:null};
    if (!reservation || reservation.hostname !== new URL(attempt.target).hostname || !Array.isArray(reservation.addresses) || !reservation.addresses.length || reservation.addresses.length > 32 || !Number.isSafeInteger(reservation.expires_at)) throw new Error('RUNNER_RESERVATION_INVALID');
    for (const address of reservation.addresses) {
      if (!lab) publicAddress(address);
      else {
        let parsed;try{parsed=ipaddr.parse(address);}catch{throw new Error('DOCUMENTATION_FIXTURE_REQUIRED');}
        if(address.includes('%')||address.includes('[')||address.trim()!==address||
          (parsed.kind()==='ipv4'&&!ipaddr.IPv4.isValidFourPartDecimal(address))||
          !parsed.match(ipaddr.parseCIDR(parsed.kind()==='ipv4'?'192.0.2.0/24':'2001:db8::/32')))throw new Error('DOCUMENTATION_FIXTURE_REQUIRED');
      }
    }
    const deadline = Math.min(leaseDeadline-policy.callbackMarginMs,started+policy.wallMs,reservation.expires_at);
    if (deadline <= Date.now()+250) throw new Error('RUNNER_DEADLINE_EXPIRED');
    const bounded = AbortSignal.any([outer,AbortSignal.timeout(deadline-Date.now())]);
    const runId = crypto.randomUUID(); const prefix = 'sc-sandbox-'+runId;
    const guardName = prefix+'-guard', engineName = prefix+'-engine';
    await mkdir(POLICY_ROOT,{recursive:true,mode:0o700});
    const directory = await mkdtemp(join(POLICY_ROOT,'sandbox-'));
    await writeFile(join(directory,'owner.json'),JSON.stringify({run_id:runId,expires_at:deadline}),{mode:0o600});
    const labels = kind => ['--label',`${SANDBOX_LABEL}=${SANDBOX_OWNER}`,'--label',`luminiware.security-check.run_id=${runId}`,
      '--label',`luminiware.security-check.expires_at=${deadline}`,'--label',`luminiware.security-check.kind=${kind}`];
    const resourceArgs = ['--read-only','--security-opt','no-new-privileges','--pids-limit',String(policy.pids),'--memory',policy.memoryMiB+'m',
      '--memory-swap',policy.memoryMiB+'m','--cpus',String(policy.cpus),'--tmpfs','/tmp:rw,noexec,nosuid,size=16m'];
    let watchdog;
    try {
      watchdog=await startSandboxWatchdog(runId,deadline,directory);
      const networkPolicy = {hostname:reservation.hostname,addresses:reservation.addresses,expires_at:deadline,maxDnsRequests:policy.maxDnsRequests,
        ingressBytes:policy.ingressBytes,egressBytes:policy.egressBytes,maxPacketBytes:policy.maxPacketBytes};
      await writeFile(join(directory,'network.json'),JSON.stringify(networkPolicy),{mode:0o600});
      // Guardian logs contain only readiness/error codes; target data is not logged.
      await docker.run(['create','--name',guardName,...labels('guard'),'--network',networkId,'--dns','127.0.0.1','--user','0:0','--cap-drop','ALL','--cap-add','NET_ADMIN',
        ...resourceArgs,'--log-driver','json-file','--log-opt','max-size=4k','--log-opt','max-file=1',...(lab?['--env','ISOLATED_TEST_FIXTURES=true']:[]),
        '--mount',`type=bind,source=${directory},target=/policy,readonly`,guardianImage],{signal:bounded});
      await docker.run(['start',guardName],{signal:bounded});
      for (;;) {
        bounded.throwIfAborted();
        const state = await docker.inspect('container',guardName,{signal:bounded});
        if (!state.State?.Running) throw new Error('GUARDIAN_UNHEALTHY');
        const logs = await docker.run(['logs',guardName],{signal:bounded,maxBytes:4096});
        if (logs.stdout.split(/\r?\n/u).some(line => { try { return JSON.parse(line).code === 'GUARDIAN_READY'; } catch { return false; } })) break;
        await delay(50,undefined,{signal:bounded});
      }
      const before = await docker.run(['exec',guardName,'nft','-j','list','table','inet','security_check'],{signal:bounded});
      const ruleState = guardianState(JSON.parse(before.stdout),reservation,policy);
      await docker.run(['create','--interactive','--name',engineName,...labels('engine'),'--network','container:'+guardName,
        '--user','65532:65532','--cap-drop','ALL',...resourceArgs,'--log-driver','none','--entrypoint','node',engineImage,'--input-type=module','-e',fault?faults[fault]:workloadSource],{signal:bounded});
      let output;
      try {
        output = await docker.run(['start','--attach','--interactive',engineName],{signal:bounded,input:JSON.stringify({target:attempt.target,check_ms:policy.checkMs,
          http_limits:{maxRedirects:policy.maxRedirects,maxResponseBytes:policy.maxResponseBytes,maxTotalBytes:policy.maxTotalBodyBytes,maxRequests:policy.maxHttpRequests,timeoutMs:policy.checkMs}}),
          timeoutMs:Math.max(1,deadline-Date.now()),maxBytes:policy.maxOutputBytes});
      } catch(error) {
        if(!bounded.aborted) {
          const failed=await docker.inspect('container',engineName,{signal:bounded}).catch(()=>null);
          if(failed?.State?.OOMKilled)throw new Error('WORKLOAD_OOM');
          if(failed?.State?.Running===false&&failed.State.ExitCode!==0)throw new Error('WORKLOAD_FAILED');
        }
        throw error;
      }
      const state = await docker.inspect('container',engineName,{signal:bounded});
      if (state.State?.OOMKilled) throw new Error('WORKLOAD_OOM');
      if (state.State?.ExitCode !== 0) throw new Error('WORKLOAD_FAILED');
      let payload;
      try {payload=validateWorkload(JSON.parse(output.stdout),started);} catch {throw new Error('WORKLOAD_CONTRACT_INVALID');}
      const nft = await docker.run(['exec',guardName,'nft','-j','list','table','inet','security_check'],{signal:bounded});
      if (guardianState(JSON.parse(nft.stdout),reservation,policy)!==ruleState) throw new Error('GUARDIAN_RULES_CHANGED');
      const provenance = {target:attempt.target,peer_verified:true,policy_enforced:true,public_address_count:reservation.addresses.length};
      const checks = payload.checks.map(check => {
        if (check.collection !== 'ok') return {id:check.id,collection:check.collection,observed_at:check.observed_at,evidence:null,
          errors:[check.collection==='timeout'?'CHECK_TIMEOUT':check.collection==='bloqueado'?'POLICY_BLOCKED':check.collection==='não_executado'?'NOT_RUN':'CHECK_ERROR'],duration_ms:check.duration_ms};
        const observed={...provenance,...(check.http??{})};
        return {...normalizeUpstream(check.id,check.data,observed,attempt.target,check.observed_at),duration_ms:check.duration_ms};
      });
      return resultEnvelope(attempt,checks,Date.now()-started);
    } catch (error) {
      // A detached watchdog and the local timeout can win the same deadline
      // race. Normalize the outcome without treating daemon removal as success.
      if (signal?.aborted) throw new Error('SANDBOX_ABORTED');
      if (bounded.aborted || Date.now()>=deadline) throw new Error('RUNNER_DEADLINE_EXPIRED');
      if (typeof error.message==='string'&&/^[A-Z_]{2,64}$/u.test(error.message)) throw error;
      throw new Error('RUNNER_EXECUTION_FAILED');
    } finally {
      const cleanup = await Promise.allSettled([removeOwnedSandbox(docker,engineName,runId)]);
      cleanup.push(...await Promise.allSettled([removeOwnedSandbox(docker,guardName,runId)]));
      healthy = cleanup.every(result=>result.status==='fulfilled');
      try {await removeOwnedPolicyDirectory(directory,runId);}
      catch {healthy=false;}
      if(healthy) watchdog?.stop();
      if (!healthy) {
        const error=new Error('RUNNER_CLEANUP_REQUIRED');
        error.cleanup_codes=cleanup.filter(result=>result.status==='rejected').map(result=>result.reason?.message);
        throw error;
      }
    }
  };
  execute.health = async () => {
    if (!healthy) return false;
    try {
      const [network,image] = await Promise.all([docker.inspect('network',networkId),docker.inspect('image',engineImage),docker.inspect('image',guardianImage)]);
      return network.Driver==='bridge' && network.Scope==='local' && (!lab || (network.Internal===true && network.Labels?.['luminiware.security-check.lab']==='true')) && image.RepoDigests?.includes(engineImage)===true;
    } catch { return false; }
  };
  execute.maintenance = () => reapExpiredSandboxes(docker);
  return execute;
}
