// Browser preview only. The Worker independently validates every request.
export function normalizeTarget(input) {
  const raw = input.trim();
  if (!raw || /[\s\\%?#@]/u.test(raw)) throw new Error('Domínio inválido.');
  if (!/^[^/]+\/?$/u.test(raw.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, ''))) throw new Error('Domínio inválido.');
  const url = new URL(raw.includes('://') ? raw : 'https://' + raw);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['https:', 'http:'].includes(url.protocol) || url.port || url.pathname !== '/' || !host.includes('.') || host.includes(':') || /^\d+(?:\.\d+){3}$/u.test(host)) throw new Error('Domínio inválido.');
  return `${url.protocol}//${host}/`;
}
