import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export class DockerCLI {
  async run(args, { input, signal, timeoutMs = 10000, maxBytes = 65536 } = {}) {
    if (!Array.isArray(args) || args.some(a => typeof a !== 'string') || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('INVALID_DOCKER_OPERATION');
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = spawn('docker', args, { shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
      const stdout = [], stderr = []; let size = 0, failure;
      const stop = code => { failure ||= new Error(code); child.kill(); };
      const abort = () => stop('SANDBOX_ABORTED');
      const timer = setTimeout(() => stop('DOCKER_TIMEOUT'), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', data => { size += data.length; if (size > maxBytes) stop('DOCKER_OUTPUT_LIMIT'); else stdout.push(data); });
      child.stderr.on('data', data => { size += data.length; if (size > maxBytes) stop('DOCKER_OUTPUT_LIMIT'); else stderr.push(data); });
      child.stdin.on('error', () => {});
      child.on('error', () => { failure ||= new Error('DOCKER_UNAVAILABLE'); });
      child.on('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error('DOCKER_OPERATION_FAILED'));
        else resolve({ stdout: Buffer.concat(stdout).toString('utf8').trim(), stderr: Buffer.concat(stderr).toString('utf8').trim() });
      });
      child.stdin.end(input === undefined ? undefined : input);
    });
  }
  async inspect(kind, id, options) {
    if (!['container','image','network'].includes(kind) || typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,255}$/u.test(id)) throw new Error('INVALID_DOCKER_REFERENCE');
    const { stdout } = await this.run([kind,'inspect',id], options);
    const payload = JSON.parse(stdout); if (!Array.isArray(payload) || payload.length !== 1) throw new Error('INVALID_DOCKER_RESPONSE');
    return payload[0];
  }
}

export const SANDBOX_LABEL = 'luminiware.security-check.component';
export const SANDBOX_OWNER = 'executor-sandbox';
async function awaitRemoved(docker,name) {
  const deadline=Date.now()+3000;
  do {
    const remaining=await docker.run(['ps','-aq','--filter','name=^/'+name+'$'],{timeoutMs:1000});
    if(!remaining.stdout)return true;
    await delay(100);
  } while(Date.now()<deadline);
  return false;
}
export async function removeOwnedSandbox(docker, name, runId) {
  const { stdout } = await docker.run(['ps','-aq','--filter','name=^/'+name+'$'], { timeoutMs: 5000 });
  if (!stdout) return;
  let container;
  try { container = await docker.inspect('container', name); }
  catch (error) {
    if(await awaitRemoved(docker,name))return;throw error;
  }
  if (container.Config?.Labels?.[SANDBOX_LABEL] !== SANDBOX_OWNER || container.Config.Labels['luminiware.security-check.run_id'] !== runId) throw new Error('SANDBOX_OWNERSHIP_MISMATCH');
  try { await docker.run(['rm','--force',name], { timeoutMs: 5000 }); }
  catch (error) {
    if(!await awaitRemoved(docker,name))throw error;
  }
}
export async function reapExpiredSandboxes(docker = new DockerCLI(), now = Date.now()) {
  const { stdout } = await docker.run(['ps','-aq','--filter',`label=${SANDBOX_LABEL}=${SANDBOX_OWNER}`]);
  const expired = [];
  for (const id of stdout.split(/\r?\n/u).filter(Boolean)) {
    if (!/^[a-f0-9]{12,64}$/u.test(id)) throw new Error('INVALID_DOCKER_RESPONSE');
    const container = await docker.inspect('container', id);
    const labels = container.Config?.Labels || {};
    const deadline = Number(labels['luminiware.security-check.expires_at']);
    if (labels[SANDBOX_LABEL] === SANDBOX_OWNER && Number.isSafeInteger(deadline) && deadline <= now) expired.push(container);
  }
  // Stop workloads before removing their network namespace holder.
  expired.sort((a,b) => Number(b.Config.Labels['luminiware.security-check.kind'] === 'engine') - Number(a.Config.Labels['luminiware.security-check.kind'] === 'engine'));
  for (const container of expired) {
    const name = container.Name.replace(/^\//u,'');
    if (!/^sc-sandbox-[a-f0-9-]{36}-(?:guard|engine)$/u.test(name)) throw new Error('SANDBOX_OWNERSHIP_MISMATCH');
    await removeOwnedSandbox(docker, name, container.Config.Labels['luminiware.security-check.run_id']);
  }
  return expired.length;
}
