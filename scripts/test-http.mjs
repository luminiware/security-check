import { spawnSync } from 'node:child_process';
import { readFileSync,mkdirSync,mkdtempSync,writeFileSync,rmSync,existsSync } from 'node:fs';
import { resolve,join,sep } from 'node:path';
import assert from 'node:assert/strict';
const candidate=JSON.parse(readFileSync('executor/upstream.research.json','utf8')),image=candidate.image+'@'+candidate.amd64_digest;
const name='security-check-http-'+crypto.randomUUID(),root=resolve('.wrangler/http-lab');mkdirSync(root,{recursive:true});const temporary=mkdtempSync(join(root,'run-'));
const openssl=process.platform==='win32'&&existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
try {
  const tls=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=example.com','-addext','subjectAltName=DNS:example.com',
    '-keyout',join(temporary,'key.pem'),'-out',join(temporary,'cert.pem')],{encoding:'utf8',windowsHide:true});assert.equal(tls.status,0,'TLS_FIXTURE_FAILED');
  const output=spawnSync('docker',['run','--rm','--name',name,'--network','none','--add-host','example.com:127.0.0.1','--add-host','other.example.net:127.0.0.2',
    '--user','65532:65532','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--pids-limit','32','--log-driver','none',
    '--env','NODE_EXTRA_CA_CERTS=/tls/cert.pem','--mount',`type=bind,source=${temporary},target=/tls,readonly`,
    '--mount',`type=bind,source=${resolve('executor/bounded-fetch.mjs')},target=/transport/bounded-fetch.mjs,readonly`,
    '--mount',`type=bind,source=${resolve('tests/docker/bounded-fetch-lab.mjs')},target=/transport/tests/lab.mjs,readonly`,
    '--entrypoint','node',image,'/transport/tests/lab.mjs'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:32768});
  assert.equal(output.status,0,output.stderr||output.error?.message||'HTTP_LAB_FAILED');
  const report=JSON.parse(output.stdout.trim());assert.equal(report.cases.length,10);mkdirSync('test-results',{recursive:true});
  writeFileSync('test-results/http-lab.json',JSON.stringify({...report,engineImage:image},null,2)+'\n');console.log(JSON.stringify(report,null,2));
} finally {
  spawnSync('docker',['rm','--force',name],{stdio:'ignore',windowsHide:true});
  const target=resolve(temporary);if(!target.startsWith(root+sep))throw new Error('TLS_FIXTURE_OUT_OF_SCOPE');rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
