import { spawn } from 'node:child_process';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DockerCLI,removeOwnedSandbox } from './docker.mjs';
import { removeOwnedPolicyDirectory } from './policy-files.mjs';

export async function startSandboxWatchdog(runId,deadline,directory) {
  if (!/^[a-f0-9-]{36}$/u.test(runId) || !Number.isSafeInteger(deadline) || deadline>Date.now()+120000) throw new Error('INVALID_WATCHDOG_RESERVATION');
  const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(?:PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TMPDIR|TEMP|TMP|DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH)$/iu.test(key)));
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),runId,String(deadline),directory],{
    detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:environment,
  });
  await new Promise((resolveReady,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('WATCHDOG_STARTUP_FAILED'));},Math.max(1,Math.min(2000,deadline-Date.now())));
    child.once('error',()=>{clearTimeout(timer);reject(new Error('WATCHDOG_STARTUP_FAILED'));});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('WATCHDOG_STARTUP_FAILED'));});
    child.once('message',message=>{
      if(message?.code!=='WATCHDOG_READY')return;
      clearTimeout(timer);child.disconnect();resolveReady();
    });
  });
  child.on('error',()=>{}); child.unref();
  return {stop(){child.kill();}};
}
export async function watchSandbox(runId,deadline,docker=new DockerCLI(),ready=()=>{},directory) {
  if (!/^[a-f0-9-]{36}$/u.test(runId) || !Number.isSafeInteger(deadline) || deadline>Date.now()+120000) throw new Error('INVALID_WATCHDOG_RESERVATION');
  ready();
  while (Date.now()<deadline) await delay(Math.max(1,Math.min(1000,deadline-Date.now())));
  const names=['sc-sandbox-'+runId+'-engine','sc-sandbox-'+runId+'-guard'];
  const retryUntil=deadline+30000;
  do {
    let complete=true;
    for (const name of names) {try {await removeOwnedSandbox(docker,name,runId);}catch{complete=false;}}
    if(complete&&directory) {try{await removeOwnedPolicyDirectory(directory,runId);}catch{complete=false;}}
    if(complete) return;
    await delay(500);
  } while(Date.now()<retryUntil);
  throw new Error('WATCHDOG_CLEANUP_REQUIRED');
}
if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {await watchSandbox(process.argv[2],Number(process.argv[3]),new DockerCLI(),()=>process.send?.({code:'WATCHDOG_READY'}),process.argv[4]);}
  catch {process.exitCode=1;}
}
