import { normalizeTarget } from '/target.js';
const $ = id => document.getElementById(id);
const terminal = new Set(['concluído', 'falhou', 'expirou']);
const labels = { pendente: 'Na fila', executando: 'Executando verificações', concluído: 'Seu diagnóstico', falhou: 'Análise inconclusiva', expirou: 'Prazo da análise encerrado' };
let config, job, timer, polling = false, pollDelay = 2000, generation = 0, normalized = null;
let turnstileToken = '', turnstileWidget = null;
const storage = { get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* Current page remains usable. */ } },
  remove(key) { try { sessionStorage.removeItem(key); } catch { /* Nothing persisted. */ } } };
let pending = null;
try {
  const saved = JSON.parse(storage.get('sc-pending') || 'null');
  if (saved && typeof saved.key === 'string' && typeof saved.identity === 'string' && typeof saved.body?.target === 'string' && (typeof saved.body?.scenario === 'string' || saved.body?.scenario === undefined)) pending = saved;
} catch { storage.remove('sc-pending'); }
let leadKey = crypto.randomUUID();
function text(id, value) { $(id).textContent = value; }
function show(id, visible = true) { $(id).hidden = !visible; }
async function api(path, { method = 'GET', body, key } = {}) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(path, { method, credentials: 'same-origin', signal: controller.signal,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) {
      const e = new Error(data.message || 'Não foi possível concluir.'); e.status = res.status; e.retryAfter = res.headers.get('retry-after'); throw e;
    }
    return data;
  } finally { clearTimeout(timeout); }
}
function forgetPending() { pending = null; storage.remove('sc-pending'); }
function resetLead() { show('lead-form', false); $('lead-consent').checked = false; $('send-lead').disabled = false; text('lead-status', ''); leadKey = crypto.randomUUID(); }
function normalizeInput() {
  try { normalized = normalizeTarget($('target').value); text('normalized-value', normalized); show('normalized'); text('target-error', ''); return true; }
  catch (e) { normalized = null; show('normalized', false); return false; }
}
$('target').addEventListener('input', normalizeInput);
$('analysis-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!normalizeInput()) { text('target-error', 'Informe um domínio válido, sem caminhos ou parâmetros.'); $('target').focus(); return; }
  if (!config.demo && !turnstileToken) { text('target-error','Conclua a validação antiabuso antes de analisar.'); return; }
  const body = config.demo
    ? { target: normalized, turnstile_token: 'synthetic-no-network', scenario: $('scenario').value }
    : { target: normalized, turnstile_token: turnstileToken };
  const identity = JSON.stringify({ target: normalized, scenario: body.scenario || 'quick' });
  if (!pending || pending.identity !== identity) {
    pending = { key: crypto.randomUUID(), body, identity }; storage.set('sc-pending', JSON.stringify(pending));
  }
  // Turnstile tokens are single-use. Keep the idempotency key, but refresh the
  // proof for a retry that did not create a job.
  if (!config.demo) { pending.body.turnstile_token = turnstileToken; storage.set('sc-pending', JSON.stringify(pending)); }
  $('analyze-button').disabled = true; text('target-error', '');
  try {
    const accepted = await api('/api/v1/analyses', { method: 'POST', body: pending.body, key: pending.key }); forgetPending();
    stopPoll(); job = accepted; resetLead(); show('delete-analysis'); show('resume', false); text('poll-error', '');
    storage.set('sc-job', job.id); renderJob(job); $('job-heading').focus(); pollDelay = 2000; schedule();
  } catch (err) {
    if (err.status && err.status < 500 && err.status !== 429) forgetPending();
    if (!config.demo && window.turnstile && turnstileWidget!==null) { window.turnstile.reset(turnstileWidget); turnstileToken=''; }
    text('target-error', err.message + (err.retryAfter ? ` Tente novamente em ${err.retryAfter} segundos.` : '') + (!err.status ? ' Você pode repetir: a mesma solicitação será retomada.' : ''));
  } finally { $('analyze-button').disabled = !config.admission; }
});
function stopPoll() { clearTimeout(timer); generation++; }
function schedule() {
  clearTimeout(timer);
  if (!job || terminal.has(job.state) || document.hidden) return;
  timer = setTimeout(poll, Math.min(15000, pollDelay) * (.85 + Math.random() * .3));
}
async function poll() {
  if (polling || document.hidden || !job) return;
  polling = true; const currentGeneration = generation; const id = job.id;
  try {
    const next = await api('/api/v1/analyses/' + id);
    if (generation !== currentGeneration) return;
    job = next; renderJob(job); text('poll-error', ''); show('resume', false); pollDelay *= 1.25; schedule();
  } catch (e) {
    if (generation !== currentGeneration) return;
    show('job-panel');
    if (!job.state) {
      text('job-heading', 'Consulta interrompida'); text('job-state', 'CONSULTA PENDENTE');
      text('job-progress', 'O identificador foi preservado. Retome a consulta sem criar outra análise.');
    }
    if (e.status === 410 || e.status === 404) {
      stopPoll(); job = null; show('job-panel'); text('job-heading', e.status === 410 ? 'Relatório removido por retenção' : 'Diagnóstico indisponível nesta sessão');
      text('job-state', 'INDISPONÍVEL'); text('job-meta', ''); text('job-progress', 'Isso não indica uma falha de segurança no site.');
      storage.remove('sc-job'); show('report', false); show('delete-analysis', false);
    }
    text('poll-error', e.message); show('resume', ![404, 410].includes(e.status));
  } finally { polling = false; }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else schedule(); });
$('resume').addEventListener('click', () => { pollDelay = 2000; poll(); });
function node(tag, content, className) { const el = document.createElement(tag); if (content !== undefined) el.textContent = content; if (className) el.className = className; return el; }
function finding(rule, index, evidence = false) {
  const card = node('article', undefined, 'finding');
  const status = rule.evaluation === 'inconclusivo' ? 'INCONCLUSIVO' : rule.evaluation === 'adequado' ? 'ADEQUADO · OBSERVAÇÃO CONFIRMADA' : `${rule.severity} · ${rule.classification}`;
  card.append(node('span', status, 'severity' + (rule.evaluation === 'atenção' && rule.severity === 'Alta' ? ' high' : '')));
  card.append(node('h4', (index !== null ? `${String(index + 1).padStart(2, '0')} / ` : '') + rule.title), node('p', rule.observation), node('p', rule.interpretation), node('p', rule.recommendation));
  if (evidence) {
    card.append(node('p', `${rule.id} · ${rule.evaluation} · ${rule.observed_at} · ${rule.target}`, 'muted'));
    card.append(node('pre', JSON.stringify(rule.evidence, null, 2), 'evidence'));
  }
  return card;
}
function renderJob(value) {
  show('job-panel'); text('job-state', value.synthetic ? 'EVIDÊNCIA SINTÉTICA' : value.state.toUpperCase());
  text('job-heading', labels[value.state]);
  text('job-meta', `${value.target} · Início: ${new Date(value.created_at).toLocaleString('pt-BR')} · Prazo: ${new Date(value.deadline_at).toLocaleTimeString('pt-BR')}`);
  text('job-progress', terminal.has(value.state) ? (value.state === 'expirou' ? 'A execução terminou sem resultado no prazo. Isso não comprova falha do site.' : '') : value.state === 'pendente' ? 'Aguardando execução. Nenhuma conclusão sobre segurança.' : `${value.progress.completed} de ${value.progress.total} verificações concluídas.`);
  const report = value.report; show('report', Boolean(report));
  if (!report) return;
  text('score', report.score === null ? '—' : String(report.score)); text('score-caption', report.score === null ? 'sem nota' : '/ 100');
  text('coverage', `${Math.round(report.coverage * 100)}%`); $('coverage-meter').value = report.coverage * 100;
  text('report-label', `${report.label} · ${report.rules_version} · ${new Date(report.observed_at).toLocaleString('pt-BR')}`);
  text('report-versions',report.versions?JSON.stringify(report.versions,null,2):'Versões da coleta indisponíveis para este relatório antigo.');
  const checkNames={headers:'Headers HTTPS','http-security':'Transporte HTTP para HTTPS',ssl:'Identidade TLS',dns:'DNS informativo'};
  const collectionNames={ok:'Evidência coletada',erro:'Falha de coleta',timeout:'Tempo de coleta esgotado',bloqueado:'Coleta bloqueada pelos limites',não_executado:'Coleta não executada'};
  $('collection-checks').replaceChildren(...(report.checks||[]).map(check=>{
    const card=node('article',undefined,'finding');card.append(node('h4',checkNames[check.id]||check.id),node('p',collectionNames[check.collection]||'Coleta inconclusiva'),
      node('p',`${check.observed_at} · ${report.target}`,'muted'),node('pre',JSON.stringify(check.evidence,null,2),'evidence'));return card;
  }));
  text('disclaimer', report.disclaimer); text('score-message', report.score_message || ''); show('score-message', Boolean(report.score_message));
  $('priorities').replaceChildren(...(report.priorities.length ? report.priorities.map((p, i) => finding(p, i)) : [node('p', report.coverage === 1 ? 'Nenhuma prioridade identificada nas verificações realizadas.' : 'Não há prioridades confirmadas com a evidência disponível.', 'muted')]));
  $('limitations').replaceChildren(...report.limitations.map(l => node('li', `${l.id}: ${l.reason} ${l.next_step}`))); show('limitations-wrap', report.limitations.length > 0);
  $('evaluations').replaceChildren(...report.evaluations.map(p => finding(p, null, true)));
  show('help', value.state === 'concluído');
  if (value.state === 'concluído' && !value.synthetic) $('open-lead').textContent='Conversar sobre correção';
}
$('open-lead').addEventListener('click', () => {
  if (config && !config.demo) {
    const subject = 'Security Check — pedido de correção';
    const details = job?.report?.priorities?.map(p=>p.id+': '+p.title).join('; ') || 'Avaliação do diagnóstico';
    const body = 'Olá, gostaria de conversar sobre a correção de problemas encontrados no Security Check.\nDomínio: '+(job?.target||'')+'\nPontos observados: '+details+'\n';
    window.location.href = 'mailto:contact@luminiware.com?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
    return;
  }
  show('lead-form'); $('lead-email').focus();
});
$('lead-form').addEventListener('submit', async e => {
  e.preventDefault(); text('lead-status', '');
  if (!$('lead-consent').checked || !$('lead-email').checkValidity()) { text('lead-status', 'Informe um e-mail válido e marque o consentimento.'); return; }
  $('send-lead').disabled = true; const analysisId = job.id;
  try {
    const result = await api('/api/v1/leads', { method: 'POST', key: leadKey, body: { analysis_id: job.id, email: $('lead-email').value.trim(), name: $('lead-name').value, intention: $('lead-intention').value, consent: true, consent_version: config.consent_version } });
    if (job?.id === analysisId) text('lead-status', result.message);
  } catch (err) { if (job?.id === analysisId) { text('lead-status', err.message); $('send-lead').disabled = false; } }
});
$('new-analysis').addEventListener('click', () => { stopPoll(); storage.remove('sc-job'); job = null; show('job-panel', false); resetLead(); $('target').focus(); });
$('delete-analysis').addEventListener('click', async () => {
  if (!job) return;
  const deletingId = job.id;
  try { await api('/api/v1/analyses/' + deletingId, { method: 'DELETE' }); if (job?.id === deletingId) { $('new-analysis').click(); text('target-error', 'Dados ativos deste diagnóstico excluídos.'); } }
  catch (err) { text('poll-error', err.message); }
});
async function initTurnstile(sitekey) {
  if (!sitekey) return;
  const script = document.createElement('script');
  script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async=true;
  script.onload=()=>{
    if (!window.turnstile) return;
    turnstileWidget=window.turnstile.render('#turnstile',{sitekey,action:'security-check',
      callback:value=>{turnstileToken=value; text('target-error','');},
      'expired-callback':()=>{turnstileToken='';},
      'error-callback':()=>{turnstileToken=''; text('target-error','Não foi possível validar a solicitação.');}});
  };
  document.head.append(script);
}
async function init() {
  try {
    config = await api('/api/v1/config'); text('mode-notice', config.message); $('analyze-button').disabled = !config.admission; show('scenario-field', config.demo); if (!config.demo && config.admission) initTurnstile(config.turnstile_sitekey);
    if (pending) { $('target').value = pending.body.target; if(config.demo) $('scenario').value = pending.body.scenario; normalizeInput(); text('target-error', 'Uma solicitação ficou sem confirmação. Clique em Analisar site para retomá-la com a mesma chave.'); }
    const id = storage.get('sc-job');
    if (id && /^[a-f0-9-]{36}$/u.test(id)) { job = { id }; await poll(); }
  } catch { text('mode-notice', 'Não foi possível verificar a disponibilidade. Recarregue a página.'); }
}
init();
