import { tmpdir } from 'node:os';
import { resolve,basename,sep,join } from 'node:path';
import { lstat,readFile,rm } from 'node:fs/promises';
export const POLICY_ROOT=resolve(tmpdir(),'luminiware-security-check');
export async function removeOwnedPolicyDirectory(directory,runId) {
  const target=resolve(directory);
  if (!target.startsWith(POLICY_ROOT+sep) || !/^sandbox-[a-zA-Z0-9]{6}$/u.test(basename(target))) throw new Error('POLICY_DIRECTORY_OUT_OF_SCOPE');
  let metadata;
  try {
    const info=await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('POLICY_DIRECTORY_OUT_OF_SCOPE');
    metadata=JSON.parse(await readFile(join(target,'owner.json'),'utf8'));
  } catch(error) {if(error.code==='ENOENT')return;throw error;}
  if (metadata.run_id!==runId) throw new Error('SANDBOX_OWNERSHIP_MISMATCH');
  // Only a verified UUID-owned temporary child of POLICY_ROOT is recursive.
  await rm(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
