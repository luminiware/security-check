# Fontes, evidência e pendências

## 1. Regra de leitura

| Estado | Significado |
|---|---|
| Decidido | Consta das fontes fornecidas; não comprova implementação/teste |
| Condicional | Depende de condição registrada, como disponibilidade e validação Arm |
| Proposto | Detalhamento sugerido neste PR; revisão explícita necessária |
| Pendente | Exige investigação, benchmark, teste ou decisão |
| Adiado/fora do MVP | Não deve orientar implementação inicial |

Data de consulta: **07/11/2026**, America/Fortaleza. Horários de contratos são UTC e sintéticos. Links de provedores são mutáveis; confirmar condições novamente no deploy. Repositório inspecionado antes de editar: `main` em `bc2073e6a891bfbd315bf6534c8fabbe95880bec`, único commit `chore: initialize repository`, apenas README mínimo, sem branch documental existente na listagem inicial de branches. Checkout local limpo clonado do remoto; branch `docs/project-baseline` criada a partir desse commit de `origin/main`.

## 2. Fontes fornecidas

| ID | Fonte | Uso e limite |
|---|---|---|
| S1 | `luminiware-security-check-decisoes-infraestrutura-1.md`, 05/11/2026, fornecido no projeto | Fonte integral lida. Produto, Cloudflare-first, executor Oracle condicional, Hetzner, estado externo, controles e gates; preços/cotas são históricos |
| S2 | Pedido anexado `Pasted text.txt` e instruções do projeto | Fonte integral lida. Escopo deste PR, evidência, requisitos, exclusões, documentação e entrega sem merge |
| V1 | `vmenezesdev/voice`, `VOICE.md`, blob `f0a9d13ceda9e33edf594a02571b4da7387afd0f` | Consultado com acesso autorizado apenas para voz técnica; não é fonte arquitetural. Conteúdo privado não reproduzido neste repositório |

S1/S2 são insumos externos deste PR, não caminhos internos navegáveis. As decisões relevantes foram registradas nos ADRs com status; nenhum arquivo privado foi copiado. A ausência de cópia literal não transforma proposta em decisão.

## 3. Upstream verificado

Árvore consultada: [Web-Check no commit fd08be8](https://github.com/Lissy93/web-check/tree/fd08be81f700254214ef49d093e71a991567841f). Inspeção estática; nenhuma execução do motor ou scan de website real. O commit é referência de pesquisa, não pin de produção aprovado.

| ID | Fonte primária | Evidência e consequência |
|---|---|---|
| S3 | [SECURITY.md](https://github.com/Lissy93/web-check/blob/fd08be81f700254214ef49d093e71a991567841f/.github/SECURITY.md) | Host blocklist não cobre DNS/redirects; operação/isolar rede é responsabilidade do operador. Não expor motor irrestrito; G2 continua necessário |
| S4 | [headers.js](https://github.com/Lissy93/web-check/blob/fd08be81f700254214ef49d093e71a991567841f/api/headers.js), [http-security.js](https://github.com/Lissy93/web-check/blob/fd08be81f700254214ef49d093e71a991567841f/api/http-security.js) | Há coleta de headers; erro/anti-bot e presença precisam de interpretação própria, sem inferir exploração |
| S5 | [ssl.js](https://github.com/Lissy93/web-check/blob/fd08be81f700254214ef49d093e71a991567841f/api/ssl.js), [dns.js](https://github.com/Lissy93/web-check/blob/fd08be81f700254214ef49d093e71a991567841f/api/dns.js) | TLS tem autorização/erro observáveis; DNS suprime algumas exceções em arrays vazios. Validar fixtures e proveniência |
| S6 | [tech-stack.js](https://github.com/Lissy93/web-check/blob/fd08be81f700254214ef49d093e71a991567841f/api/tech-stack.js) | Usa Wappalyzer/Chromium; proposta de desabilitar no MVP |
| S7 | [Dockerfile](https://github.com/Lissy93/web-check/blob/fd08be81f700254214ef49d093e71a991567841f/Dockerfile), [workflow Docker](https://github.com/Lissy93/web-check/blob/fd08be81f700254214ef49d093e71a991567841f/.github/workflows/docker.yml) | Inclui Chromium/traceroute; workflow prevê arm64/amd64. Não verifica imagem escolhida nem runtime com privilégios reduzidos |
| S8 | [LICENSE](https://github.com/Lissy93/web-check/blob/fd08be81f700254214ef49d093e71a991567841f/LICENSE), [http.js](https://github.com/Lissy93/web-check/blob/fd08be81f700254214ef49d093e71a991567841f/api/_common/http.js), [middleware.js](https://github.com/Lissy93/web-check/blob/fd08be81f700254214ef49d093e71a991567841f/api/_common/middleware.js) | MIT com preservação de avisos; HTTP segue redirects/lê body, timeout de middleware não comprova cancelamento da operação. Exigir limites externos |

## 4. Provedores: o que foi e não foi confirmado

| ID | Documentação oficial consultada | Conclusão limitada |
|---|---|---|
| S9 | [Queues Free changelog](https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/) | Confirma Free incluindo HTTP pull; compatibilidade documental da intenção inicial |
| S10 | [Pull consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/) | REST pull/ack, Bearer com read/write, short polling, lease e retry; confirmar token/conta e parâmetros em teste |
| S11 | [Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) | At least once; deduplicação necessária, sem promessa de exactly once |
| S12 | [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) | Free tem 10.000 operações/dia e retenção de 24h na consulta. Escrita/leitura/delete e retries consomem franquia; não equivale a 10.000 diagnósticos nem garante custo total zero |
| S13 | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Turnstile Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) | D1 tem limites dependentes de plano; índices/retenção e teste real necessários. Turnstile exige validação servidor, tokens single-use e expiração; widget sozinho não basta |

O caminho `queues/configuration/delivery-guarantees/` não respondeu na consulta inicial; a referência correta encontrada é S11. Compatibilidade documental de Queues não comprova credenciais, configurações ou execução na conta do projeto.

**Não verificado atualmente:** região/capacidade/cotas da Oracle, preços Oracle/Hetzner, manifesto do digest, benchmark arm64, mapeamento/scopes/plano HubSpot, custo integrado Cloudflare. Não há novos preços de VM neste PR. Valores de S1 não devem ser tratados como atuais. Referências para investigação, **não consultadas como comprovação atual**:

- [Oracle Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm).
- [Hetzner Cloud](https://www.hetzner.com/cloud/).
- [HubSpot developer docs](https://developers.hubspot.com/docs).
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

WebSec0 e Sentinela são referências de intenção UX fornecidas pelo projeto, sem auditoria de suas funcionalidades neste PR. Cloud Run/Containers ficam adiados; as observações históricas de S1 não são aqui revalidadas como restrições atuais desses produtos.

## 5. Rastreabilidade de decisões

| Decisão | Fonte | Registro principal | Validação de lançamento |
|---|---|---|---|
| Produto gratuito, sem login/contato obrigatório e CTA contextual | S1 §1; S2 | spec RF-09/10 | G6/G7 |
| Web-Check sem fork; produto separado | S1 §2–3; S2 | ADR-001 | G1/G5 |
| Worker/D1/Queues, entrada protegida | S1 §2–4; S2; S9–S13 | ADR-002 | G3/G4/G9 |
| Oracle condicional, Hetzner fallback, sem HA | S1 §5–7; S2 | ADR-003 | G1/G4/G9 |
| Escopo passivo e rede protegida | S1 §4; S2; S3–S8 | ADR-004 | G2/G5 |
| Assincronia, idempotência e persistência externa | S1 §3/6; S2; S10/S11 | ADR-005 | G4/G6 |
| Scoring final e limites ainda não decididos | S1 §9; S2 | spec §5; arquitetura §6 | G3/G5/G8 |

Requisitos e critérios individuais RF-01 a RF-13 estão mapeados a gates na spec. Fonte → ADR → contrato/requisito → gate define a cadeia de evidência; gate futuro não pode ser apresentado como teste executado.

## 6. Pendências e propostas para revisão

| ID | Situação | Decisão/validação necessária | Impacto |
|---|---|---|---|
| P1 | Proposto, viabilidade documental disponível | Aprovar HTTP pull, modelo de token, claim e reconciliação D1/Queue; testar na conta e medir custo | G3/G4/G9 |
| P2 | Pendente, bloqueia exposição pública | Escolher e demonstrar guardião/egress/peer/redirects/bytes sem fork nem MITM TLS; revisar allowlist e evidência para scoring | G1/G2/G5 |
| P3 | Condicional | Confirmar capacidade/cotas/região Oracle, digest arm64 e benchmark; cotar fallback e provar deploy/recuperação | G1/G4/G9 |
| P4 | Planejado/proposto | Aprovar campos/texto consentimento, política de privacidade, retenção e mapeamento/dedup HubSpot; definir responsável comercial | G6/G8 |
| P5 | Proposto | Aprovar contratos v1, sessão/capability, leases e tentativas; fixar limites após benchmark | G3/G4/G8 |
| P6 | Proposto | Revisar pesos, condições de regra, severidade, limiar 80%, regras essenciais e desempate; validar risco de falsa confiança | G5/G7 |
| P7 | Pendente | Aprovar TTL/cache/retenções, quotas e orçamento global; escolher limiares de saúde/expansão e responsáveis | G3/G8/G9 |
| P8 | Pendente | Atribuir donos de gates e método de apuração de propostas/contratos/margem/custos | G6/G9 |

Sequência mínima futura: revisar propostas P1/P5/P6; validar motor/rede P2/P3 em ambiente controlado; medir e aprovar limites P7; implementar contratos e recuperação; integrar lead consentido P4; verificar todos os gates e só então abrir admissão pública. Investigações independentes podem avançar em paralelo sem provisionar pelo PR documental. Nenhuma pendência reabre automaticamente upstream sem fork ou Cloudflare-first.

## 7. Evidência desta entrega

Disponível: leitura integral de S1/S2 e VOICE.md; inspeção local/remota/histórico; consulta estática do upstream e documentação oficial; revisão cruzada de requisitos, contratos, ADRs e gates. Validação local concluída: `git diff --cached --check` sem erros; 11 arquivos Markdown processados, 32 links internos resolvidos, quatro exemplos JSON válidos, 23 tabelas com cardinalidade consistente e dois diagramas aceitos pelo parser Mermaid. Verificadores e dependências temporários ficaram fora do repositório. Não houve renderização visual dos diagramas; a validação de sintaxe não comprova legibilidade visual no GitHub.

Não disponível: aplicação, build, testes de contrato/rede/CRM, medição de custos, benchmark, imagem executada ou deploy. Este PR contém apenas Markdown, sem dependências, workflows ou infraestrutura. Não altera HubSpot/configurações GitHub e não faz merge.
