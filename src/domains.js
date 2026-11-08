import { parse } from 'tldts';
import { fail } from './contracts.js';
export function quotaDomains(target) {
  const hostname = new URL(target).hostname;
  const result = parse(hostname, { allowPrivateDomains: true });
  if (!result.domain || (!result.isIcann && !result.isPrivate)) fail(400, 'INVALID_TARGET', 'Informe um domínio com sufixo público reconhecido.');
  return { hostname, registrable: result.domain };
}
