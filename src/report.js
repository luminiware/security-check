import { CHECKS, VERSIONS, fail, object, string } from './contracts.js';

export const RULES = Object.freeze([
  { id: 'TLS-IDENTITY', weight: 35, severity: 'Alta', title: 'Identidade do certificado TLS', check: 'ssl', recommendation: 'Revisar validade, cadeia e correspondência do certificado com o domínio.' },
  { id: 'HTTPS-TRANSPORT', weight: 25, severity: 'Média', title: 'Transporte para HTTPS', check: 'http-security', recommendation: 'Configurar o acesso HTTP para conduzir a HTTPS com certificado válido.' },
  { id: 'HSTS', weight: 15, severity: 'Baixa', title: 'Instrução para manter HTTPS', check: 'headers', recommendation: 'Revisar HSTS após confirmar a compatibilidade HTTPS. Avaliar subdomínios antes de políticas abrangentes.' },
  { id: 'CSP', weight: 10, severity: 'Baixa', title: 'Política de conteúdo (CSP)', check: 'headers', recommendation: 'Planejar uma CSP compatível com os recursos do site e testar sua aplicação. A presença não comprova eficácia.' },
  { id: 'NOSNIFF', weight: 10, severity: 'Baixa', title: 'Interpretação do tipo de conteúdo', check: 'headers', recommendation: 'Servir tipos de conteúdo corretos e configurar X-Content-Type-Options: nosniff.' },
  { id: 'REFERRER', weight: 5, severity: 'Baixa', title: 'Política de referência', check: 'headers', recommendation: 'Revisar Referrer-Policy para limitar o envio de referências a outros sites.' },
]);
const HEADER_NAMES = ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'referrer-policy'];
const COLLECTIONS = ['ok', 'erro', 'timeout', 'bloqueado', 'não_executado'];
const INTERPRETATIONS = {
  'TLS-IDENTITY': 'Uma falha de identidade ou validade pode impedir o navegador de autenticar a conexão. Não comprova comprometimento do site.',
  'HTTPS-TRANSPORT': 'A observação se limita ao acesso HTTP e à transição para HTTPS nos limites de coleta. Não avalia todos os caminhos do domínio.',
  HSTS: 'Sem uma instrução HSTS válida, navegadores podem não receber a política de exigir HTTPS em acessos futuros. A implantação exige avaliar compatibilidade.',
  CSP: 'A presença ou ausência de CSP é um sinal de configuração. Esta coleta não comprova eficácia da política nem exploração de XSS.',
  NOSNIFF: 'A diretiva limita a interpretação alternativa do tipo de conteúdo pelo navegador. A observação não demonstra uma exploração.',
  REFERRER: 'A configuração influencia quais referências são enviadas em navegações. O efeito depende do uso do site e dos destinos envolvidos.',
};
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,19) === value.slice(0,19) ? parsed : NaN;
}
function interpretableCsp(value) {
  if (value.includes(',') || /[^\x20-\x7e]/u.test(value)) return false;
  const sourceDirectives = /^(?:(?:default|script|style|img|font|connect|media|object|frame|child|worker|manifest)-src|script-src-elem|script-src-attr|style-src-elem|style-src-attr|base-uri|form-action|frame-ancestors)$/u;
  const seen = new Set();
  for (const part of value.split(';').map(p => p.trim()).filter(Boolean)) {
    const [name, ...sources] = part.split(/\s+/u);
    if (seen.has(name)) return false; seen.add(name);
    if (name === 'upgrade-insecure-requests' || name === 'block-all-mixed-content') { if (sources.length) return false; continue; }
    if (!sourceDirectives.test(name)) return false;
    for (const source of sources) {
      if (/^'(?:self|none|unsafe-inline|unsafe-eval|strict-dynamic|unsafe-hashes|report-sample|wasm-unsafe-eval)'$/u.test(source)) continue;
      if (/^'(?:nonce|sha256|sha384|sha512)-[A-Za-z0-9+/_-]+=*'$/u.test(source)) continue;
      if (/^[a-z][a-z0-9+.-]*:$/iu.test(source)) continue;
      if (/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(?:\d+|\*))?(?:\/[a-z0-9_~!$&()*+./=:@%-]*)?$/iu.test(source)) continue;
      return false;
    }
  }
  return seen.size > 0;
}

export function validateResult(body, job, now) {
  object(body, ['schema_version', 'job_id', 'attempt_id', 'engine', 'policy_version', 'rules_version', 'result_version', 'duration_ms', 'checks']);
  object(body.engine, ['name', 'revision', 'image_digest']);
  const versions = JSON.parse(job.versions_json);
  if (body.schema_version !== '1' || body.job_id !== job.id || body.attempt_id !== job.attempt_id ||
      ['schema','policy','rules','result'].some(key=>versions[key]!==VERSIONS[key]) ||
      body.engine.name !== 'web-check' || body.engine.revision !== versions.engine || body.engine.image_digest !== versions.digest ||
      body.policy_version !== versions.policy || body.rules_version !== versions.rules || body.result_version !== versions.result) {
    fail(400, 'VERSION_MISMATCH', 'Versões ou tentativa incompatíveis.');
  }
  duration(body.duration_ms, now - (job.attempt_started_at || job.created_at));
  if (!Array.isArray(body.checks) || body.checks.length !== CHECKS.length || body.checks.some(c => !c || typeof c !== 'object' || Array.isArray(c)) || new Set(body.checks.map(c => c.id)).size !== CHECKS.length) {
    fail(400, 'CHECK_SET', 'Conjunto de verificações inválido.');
  }
  for (const check of body.checks) {
    object(check, ['id', 'collection', 'observed_at', 'evidence', 'errors', 'duration_ms']);
    if (!CHECKS.includes(check.id) || !COLLECTIONS.includes(check.collection)) fail(400, 'INVALID_CHECK', 'Verificação inválida.');
    duration(check.duration_ms, body.duration_ms);
    const observed = timestamp(check.observed_at);
    if (!Number.isFinite(observed) || observed < (job.attempt_started_at || job.created_at) || observed > now) fail(400, 'INVALID_TIME', 'Horário da evidência inválido.');
    if (!Array.isArray(check.errors) || check.errors.length > 4 || check.errors.some(e => !['CHECK_ERROR', 'CHECK_TIMEOUT', 'POLICY_BLOCKED', 'NOT_RUN', 'UPSTREAM_MALFORMED'].includes(e))) fail(400, 'INVALID_ERRORS', 'Código de coleta inválido.');
    if (check.collection !== 'ok') {
      if (check.evidence !== null) fail(400, 'INVALID_EVIDENCE', 'Coleta sem sucesso não pode fornecer evidência.');
      continue;
    }
    if (check.errors.length) fail(400, 'INVALID_EVIDENCE', 'Coleta com erro não pode ser interpretada como sucesso.');
    const ev = check.evidence;
    const fields = check.id === 'headers' ? ['target', 'peer_verified', 'http_status', 'interstitial', 'final_https', 'headers'] :
      check.id === 'ssl' ? ['target', 'peer_verified', 'identity_valid', 'valid_from', 'valid_to'] :
      check.id === 'http-security' ? ['target', 'peer_verified', 'http_reaches_https'] : ['target', 'peer_verified', 'public_address_count'];
    object(ev, fields);
    if (ev.target !== job.target || ev.peer_verified !== true) fail(400, 'INVALID_PROVENANCE', 'Proveniência inválida.');
    if (check.id === 'headers') {
      if (!Number.isInteger(ev.http_status) || ev.http_status < 200 || ev.http_status > 599 || typeof ev.interstitial !== 'boolean' || typeof ev.final_https!=='boolean') fail(400, 'INVALID_HTTP', 'Resposta HTTP inválida.');
      object(ev.headers, HEADER_NAMES, []);
      for (const value of Object.values(ev.headers)) string(value, 4096, 0);
    } else if (check.id === 'ssl') {
      if (typeof ev.identity_valid !== 'boolean' || !Number.isFinite(timestamp(ev.valid_from)) || !Number.isFinite(timestamp(ev.valid_to)) || Date.parse(ev.valid_from) > Date.parse(ev.valid_to)) fail(400, 'INVALID_TLS', 'Evidência TLS inválida.');
    } else if (check.id === 'http-security') {
      if (typeof ev.http_reaches_https !== 'boolean') fail(400, 'INVALID_TRANSPORT', 'Transporte inválido.');
    } else if (!Number.isInteger(ev.public_address_count) || ev.public_address_count < 1 || ev.public_address_count > 32) fail(400, 'INVALID_DNS', 'DNS vazio ou ambíguo não comprova coleta.');
  }
  return body;
}
function duration(value, max) {
  if (!Number.isInteger(value) || value < 0 || value > Math.max(0, max) + 1000) fail(400, 'INVALID_DURATION', 'Duração inválida.');
}

export function makeReport(checks, target, observedAt, versions=VERSIONS) {
  const byId = new Map(checks.map(c => [c.id, c]));
  const evaluations = RULES.map(rule => {
    const check = byId.get(rule.check);
    const base = { ...rule, interpretation: INTERPRETATIONS[rule.id], confidence: 'Evidência insuficiente', evaluation: 'inconclusivo', classification: 'inconclusivo', observation: 'Evidência insuficiente.', observed_at: check?.observed_at ?? observedAt, target, evidence: null };
    if (!check || check.collection !== 'ok' || !check.evidence) return base;
    const ev = check.evidence; let adequate; let observation;
    if (rule.check === 'ssl') {
      adequate = ev.identity_valid && Date.parse(ev.valid_from) <= Date.parse(check.observed_at) && Date.parse(ev.valid_to) > Date.parse(check.observed_at);
      observation = adequate ? 'Identidade e validade TLS observadas como válidas.' : 'Identidade ou validade TLS apresentou falha.';
    } else if (rule.check === 'http-security') {
      adequate = ev.http_reaches_https;
      observation = adequate ? 'HTTP conduziu a HTTPS válido dentro dos limites da coleta.' : 'HTTP não conduziu a HTTPS válido dentro dos limites da coleta.';
    } else {
      if (ev.final_https!==true || ev.http_status < 200 || ev.http_status >= 400 || ev.interstitial) return { ...base, observation: 'Resposta HTTP de erro, bloqueio ou sem HTTPS: headers não avaliados.' };
      const h = ev.headers;
      if (rule.id === 'HSTS') {
        const v = h['strict-transport-security'];
        if (v && v.split(';').filter(p => /^\s*max-age\s*=/iu.test(p)).length > 1) return { ...base, observation: 'HSTS contém diretivas max-age conflitantes; requer revisão.' };
        const matches = v?.match(/(?:^|;)\s*max-age\s*=\s*(\d+)\s*(?:;|$)/iu);
        adequate = Boolean(matches && Number(matches[1]) > 0);
        observation = adequate ? 'Diretiva HSTS com max-age positivo observada.' : 'HSTS ausente ou sem max-age positivo na resposta HTTPS final.';
      } else if (rule.id === 'CSP') {
        const v = h['content-security-policy'];
        if (v?.trim() && !interpretableCsp(v)) return { ...base, observation: 'CSP presente, mas não interpretável por esta política.' };
        adequate = Boolean(v?.trim());
        observation = adequate ? 'CSP presente; eficácia e proteção contra XSS não foram auditadas.' : 'CSP não apareceu na resposta. Isso não demonstra XSS explorável.';
      } else if (rule.id === 'NOSNIFF') {
        adequate = h['x-content-type-options']?.trim().toLowerCase() === 'nosniff';
        observation = adequate ? 'X-Content-Type-Options: nosniff observado.' : 'X-Content-Type-Options ausente ou diferente de nosniff.';
      } else {
        const v = h['referrer-policy']?.trim().toLowerCase();
        const allowed = ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'];
        const permissive = ['unsafe-url', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin'];
        if (v && !allowed.includes(v) && !permissive.includes(v)) return { ...base, observation: 'Referrer-Policy não interpretável por esta política.' };
        adequate = allowed.includes(v);
        observation = adequate ? 'Política de referência restritiva observada.' : 'Referrer-Policy ausente ou permissiva segundo a política proposta.';
      }
    }
    return { ...base, confidence: 'Observação direta validada', evaluation: adequate ? 'adequado' : 'atenção', classification: 'confirmado', observation, evidence: ev };
  });
  const evaluated = evaluations.filter(r => r.evaluation !== 'inconclusivo');
  const weight = evaluated.reduce((sum, r) => sum + r.weight, 0);
  const coverage = weight / 100;
  const essentials = ['TLS-IDENTITY', 'HTTPS-TRANSPORT'].every(id => evaluated.some(r => r.id === id));
  const dns=byId.get('dns');const dnsUsable=dns?.collection==='ok'&&Number.isInteger(dns.evidence?.public_address_count)&&dns.evidence.public_address_count>0;
  const deficit = evaluated.reduce((sum, r) => sum + (r.evaluation === 'atenção' ? r.weight * (r.classification === 'suspeito' ? .5 : 1) : 0), 0);
  const score = coverage >= .8 && essentials && dnsUsable ? Math.max(0, Math.min(100, Math.round(100 * (1 - deficit / weight)))) : null;
  const severity = { Alta: 0, Média: 1, Baixa: 2 };
  const priorities = evaluations.filter(r => r.evaluation === 'atenção').sort((a, b) => severity[a.severity] - severity[b.severity] || a.classification.localeCompare(b.classification) || b.weight - a.weight || a.id.localeCompare(b.id)).slice(0, 3);
  const informativeFailures=checks.filter(check=>!RULES.some(rule=>rule.check===check.id)&&check.collection!=='ok');
  if(!dnsUsable&&!informativeFailures.some(check=>check.id==='dns'))informativeFailures.push({id:'dns'});
  const limitations=evaluations.filter(r => r.evaluation === 'inconclusivo').map(r => ({ id: r.id, reason: r.observation, next_step: 'Repetir a coleta controlada ou solicitar avaliação técnica.' }));
  for(const check of informativeFailures)limitations.push({id:'COLETA-'+check.id.toUpperCase(),
    reason:'A coleta informativa de DNS ficou inconclusiva. Isso não comprova ausência de registros. Os pesos e a cobertura das regras não mudam, mas a nota não é exibida.',
    next_step:'Repetir a coleta controlada de DNS.'});
  return { schema_version: '1', target, observed_at: observedAt, rules_version: versions.rules,
    versions:Object.fromEntries(Object.keys(VERSIONS).map(key=>[key,versions[key]])),coverage,score,
    label: coverage === 0 ? 'Análise inconclusiva' : coverage < 1||informativeFailures.length ? 'Parcial' : 'Completo',
    score_message: score === null ? coverage>=.8&&essentials&&!dnsUsable?'Coleta DNS inconclusiva; nota não calculada':'Cobertura insuficiente para calcular a nota' : null,
    disclaimer: 'Esta nota considera apenas as verificações realizadas. Não garante que o site seja seguro.',
    priorities, evaluations, limitations,
    useful: checks.some(c => c.collection === 'ok' && c.evidence !== null), checks };
}
