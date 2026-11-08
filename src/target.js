import { fail, string } from './contracts.js';
// Host validation is an admission filter, NEVER an egress/rebinding control.
export function normalizeTarget(input) {
  const raw = string(input, 2048).trim();
  if (!raw || /[\s\\%?#@]/u.test(raw)) fail(400, 'INVALID_TARGET', 'Informe apenas um domínio público, sem caminho, credenciais ou parâmetros.');
  const authority = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, '');
  if (!/^[^/]+\/?$/u.test(authority) || /:\/?$/u.test(authority)) fail(400, 'INVALID_TARGET', 'Informe apenas o domínio e, opcionalmente, a barra final.');
  let url;
  try { url = new URL(raw.includes('://') ? raw : 'https://' + raw); }
  catch { fail(400, 'INVALID_TARGET', 'Domínio inválido.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.port || url.pathname !== '/' || url.username || url.password) {
    fail(400, 'INVALID_TARGET', 'Use HTTP ou HTTPS, porta padrão e nenhum caminho.');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  if (host.length > 253 || labels.length < 2 || labels.some(l => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(l)) ||
      !/^[a-z][a-z0-9-]*$/u.test(labels.at(-1)) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/u.test(host) ||
      /^\d+(?:\.\d+){3}$/u.test(host) || host.includes(':')) {
    fail(400, 'INVALID_TARGET', 'Informe um domínio DNS público válido.');
  }
  return `${url.protocol}//${host}/`;
}
export function syntheticTarget(target) {
  return ['example.com', 'example.org', 'example.net'].includes(new URL(target).hostname);
}
