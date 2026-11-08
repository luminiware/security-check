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

Árvore consultada inicialmente: [Web-Check no commit fd08be8](https://github.com/Lissy93/web-check/tree/fd08be81f700254214ef49d093e71a991567841f). A baseline teve inspeção estática, sem execução do motor. A implementação posterior acrescentou execução isolada em Docker, registrada na seção 8; não houve scan de website real. O commit é referência de pesquisa, não pin de produção aprovado.

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

## 7. Evidência da baseline documental (histórico)

Disponível: leitura integral de S1/S2 e VOICE.md; inspeção local/remota/histórico; consulta estática do upstream e documentação oficial; revisão cruzada de requisitos, contratos, ADRs e gates. Validação local concluída: `git diff --cached --check` sem erros; 11 arquivos Markdown processados, 32 links internos resolvidos, quatro exemplos JSON válidos, 23 tabelas com cardinalidade consistente e dois diagramas aceitos pelo parser Mermaid. Verificadores e dependências temporários ficaram fora do repositório. Não houve renderização visual dos diagramas; a validação de sintaxe não comprova legibilidade visual no GitHub.

Na baseline documental não estavam disponíveis: aplicação, build, testes de contrato/rede/CRM, medição de custos, benchmark, imagem executada ou deploy. A etapa original continha apenas Markdown. O estado da implementação posterior está abaixo; esse histórico não descreve o estado atual da árvore de trabalho.

## 8. Implementação posterior — 07/11/2026

Fonte S14: pedido explícito para implementar a spec até o limite, marcando pendências. Autoriza código e verificações locais; não converte propostas em política aprovada nem implica provisionamento, envio de contato ou scan público. O responsável iniciou a Docker Engine para permitir avançar na validação isolada.

Código disponível: frontend/Worker, migrações D1, contratos, relatório/scoring experimental, estado e recuperação, leads consentidos, clientes Queue/control, adaptação upstream e transporte HubSpot desconectado. Ver [inventário RF/gates e instruções](implementation.md). Status de revisão preservados no [ADR-006](decisions/006-implementacao-experimental.md).

O [registro de verificação](verification.md) discrimina comandos, resultados e limites de cada evidência.

Fontes primárias adicionais consultadas nesta etapa:

| ID | Fonte/data | Evidência e limite |
|---|---|---|
| S15 | [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/binding/), [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), 07/11/2026 | Contratos de assets/D1; schema do Wrangler instalado também inspecionado. Build local não valida conta |
| S16 | [Queues pull consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/), 07/11/2026 | JSON no pull codificado em base64, ack por lease; HTTP pull habilitado via CLI/dashboard, não bloco consumer do Wrangler |
| S17 | [HubSpot Contacts](https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide), 07/11/2026 | Upsert admite unique property; não comprova mapeamento, scopes, plano ou associação na conta do projeto |
| S18 | `docker buildx imagetools inspect ghcr.io/lissy93/web-check:2.4.0`, 07/11/2026 | Índice e manifestos amd64/arm64 identificados em `executor/upstream.research.json`; candidatura de pesquisa, não pin aprovado nem execução nativa Arm |
| S19 | Clone público detached no commit S3–S8, 07/11/2026 | Fonte upstream intacta em diretório local ignorado; `get-ip` é exceção à allowlist e requer negação explícita. Nenhum fork ou patch do motor |
| S20 | [IANA IPv4 special registry](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xml), [IANA IPv6 special registry](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xml), 07/11/2026 | XMLs consultados para classificador conservador de blocos especiais; não comprova controle de conexão, firewall ou ausência de rebinding |
| S21 | [ipaddr.js](https://github.com/whitequark/ipaddr.js), [tldts](https://github.com/remusao/tldts), 07/11/2026 | Bibliotecas de interpretação de endereço/PSL, versões fixadas no lockfile. Candidatas implementadas; sem transformar escolha em política aprovada |
| S22 | [nftables quotas](https://wiki.nftables.org/wiki-nftables/index.php/Quotas), [nftables NAT](https://wiki.nftables.org/wiki-nftables/index.php/Performing_Network_Address_Translation_(NAT)), [Docker networking](https://docs.docker.com/engine/network/), 07/11/2026 | Base do guardião candidato e ensaios em namespace/rede interna. Não comprova implantação em VM, IPv6 ou limites de descompressão |
| S23 | [Azure platform IP](https://learn.microsoft.com/en-us/azure/virtual-network/what-is-ip-address-168-63-129-16), 07/11/2026 | O IP de controle Azure 168.63.129.16 é bloqueado explicitamente no classificador e regras candidatas. Apenas documentação e teste puro; nenhum acesso ao endpoint |
| S24 | [RFC1035](https://www.rfc-editor.org/rfc/rfc1035), [RFC2181](https://www.rfc-editor.org/rfc/rfc2181), [RFC7766](https://www.rfc-editor.org/rfc/rfc7766), 08/11/2026 | Formato DNS, TTL/CNAME e transporte TCP do resolvedor candidato. Contratos e DNS em loopback de contêiner sem rede; não é validação de um resolvedor público, DNSSEC ou escolha de provedor |
| S25 | [Node22 fetch](https://nodejs.org/download/release/v22.17.0/docs/api/globals.html#fetch), [Undici Fetch](https://github.com/nodejs/undici/blob/main/docs/docs/api/Fetch.md), [Undici README](https://github.com/nodejs/undici/blob/main/README.md), 08/11/2026 | APIs de fetch, stream e redirect manual do adaptador candidato. Comportamento executado na imagem pinada; revisão do runtime/adaptador e produção não estão aprovadas |
| S26 | [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/), ajuda de `wrangler d1 execute` instalado em 4.158.0, 08/11/2026 | `--local --file` validado nas consultas agregadas; não houve comando remoto ou provisionamento |
| S27 | [RFC3849](https://www.rfc-editor.org/rfc/rfc3849), [RFC4861](https://datatracker.ietf.org/doc/html/rfc4861), [RFC6980](https://datatracker.ietf.org/doc/html/rfc6980), 08/11/2026 | Endereços de documentação e formato/restrições NDP/fragmentos do candidato IPv6; não é certificação de conformidade IPv6 completa |
| S28 | [nftables manual](https://netfilter.org/projects/nftables/manpage.html), headers Linux de [prioridade IPv6](https://github.com/torvalds/linux/blob/master/include/uapi/linux/netfilter_ipv6.h) e [flags de endereço](https://github.com/torvalds/linux/blob/master/include/uapi/linux/if_addr.h), 08/11/2026 | Payload NDP, estado de endereço e ordem -450/-400 usados pelo candidato; compilação e pacotes verificados localmente, VM ainda pendente |
| S29 | [Docker bridge IPv6](https://docs.docker.com/engine/network/drivers/bridge/), ajuda instalada de network create/run no Engine 28.2.2, 08/11/2026 | Bridge interna com IPv4 desativado e endereços de documentação; sem configuração do daemon ou rede externa |
| S30 | [ip-route](https://man7.org/linux/man-pages/man8/ip-route.8.html), [Linux IP sysctls](https://docs.kernel.org/networking/ip-sysctl.html), 08/11/2026 | Rotas específicas, métricas e forwarding no laboratório roteado interno; não aprova policy routing/VRF, PMTU ou ambiente público |

Verificado localmente: testes de lógica/contrato/concorrência em workerd/Miniflare, sintaxe JavaScript, aplicação de migrações D1 local e build Wrangler `--dry-run`. Jornada de navegador executada no Edge desktop/mobile com fixtures sintéticas, sem tráfego de scan a websites. Resultados de novas verificações devem ser consultados nos comandos; testes não são aprovação humana de G5/G7.

Motor executado localmente: imagem amd64 por digest de S18, label de revisão correspondente a S19, sete casos de contrato em contêiner `--network none`, usuário sem root, capabilities removidas e filesystem de aplicação read-only. Confirmados headers, redirect seguido sem prova de saltos, alvo HTTP 503 convertido em API 200 sem status original, anti-bot como body de erro, identidade TLS inválida, DNS vazio e erro de conexão como body de erro. Alvos apenas loopback/nomes reservados controlados dentro do namespace isolado. Isso é evidência parcial de G1/G5, não de egress público/G2 ou Arm nativo. Artefato sintético regenerável em `test-results/upstream-contract.json`, ignorado pelo Git.

Guardião candidato: código DNS/nftables e imagem local, com ensaio em rede Docker `--internal`, fixtures próprias RFC5737 e motor sem alterações. Demonstrados peers/portas bloqueados, DNS pinado inclusive resolver Docker, certificado TLS original, orçamento de entrada e expiração do conjunto de peer no kernel. Contadores de drops e controles positivos evitam tratar uma conexão que já era impossível como prova do firewall. Relatório agregado em `test-results/egress-lab.json`; desenho e limites em [guardião](guardian.md) e [ADR-007](decisions/007-guardiao-candidato.md). A revisão e os demais itens de G2 continuam pendentes.

Evolução em 08/11/2026: [runner](runner.md) por job com imagens imutáveis, verificações nftables, retorno filtrado, prazo, watchdog independente e reaper por ownership. O laboratório uniu claim D1 local → motor real isolado → callback normalizado/persistido → ack simulado, com nota suprimida por falta de proveniência HTTP. Exercitados processo ocupado com filho, limite de saída, cancelamento, perda real do processo supervisor e remoção de recurso vencido sem remover fixture não pertencente ao reaper. Relatório em `test-results/runner-lab.json`; não comprova Queue remota, resolvedor público original, VM/Arm, descompressão ou perda do daemon.

Na mesma etapa, OOM foi observado por `State.OOMKilled` no limite Docker de 64 MiB, com classificação de falha e limpeza; o watchdog também remove a política temporária após crash do supervisor. O [resolvedor candidato](resolver.md) valida CNAME/A/AAAA, menor TTL e respostas mistas, com nove casos de transporte DNS em contêiner `network=none`. Relatório em `test-results/resolver-lab.json`; não houve DNS ou scan público, nem ligação de produção.

O [adaptador HTTP candidato](http-adapter.md) passou a fornecer fetch limitado ao coletor, preservando a imagem/arquivos upstream. Dez casos em contêiner sem rede cobrem status/redirects, TLS com CA sintética só nesse teste, interstitial, gzip e prazo. O contrato intermediário mudou para `workload-v1-proposal`; [ADR-008](decisions/008-adaptador-http-limitado.md) permanece Proposto. No runner, a fixture TLS inválida e HTTP sem upgrade passou a produzir cobertura 60% e nota nula; os quatro headers HTTPS continuam inconclusivos. Não é aprovação do adaptador ou evidência de saída pública/VM.

Evolução do contrato ainda em 08/11: `normalized-v2-proposal` exige `final_https` para avaliar a resposta de headers independentemente do esquema de entrada, rejeita versões legadas e mantém versões do job no relatório. Campo e atualização incompatível foram documentados no ADR-008, sem aceitação implícita. O laboratório de egress passou a dezesseis casos após remover a permissão desnecessária da API loopback/3000; DNS local permanece permitido.

`score-v1-proposal` conserva pesos/fórmula e detalha a elegibilidade DNS: uma coleta DNS inconclusiva suprime a nota, sem alterar os pesos ou inventar prioridade. Proposto em P6/ADR-008. A UI mostra o estado das quatro coletas e versões; o callback documentado é validado por teste. Cinco consultas de métricas foram executadas somente no D1 local, com coortes UTC, p50/p95 e denominadores sobre linhas retidas; custo/conta, CPU/RAM e histórico comercial permanecem pendentes.

[IPv6 candidato](ipv6.md), ainda em 08/11: `network-v1-proposal` acrescentou contexto de enlace derivado do kernel, NDP restrito/contabilizado, expiração e rejeição de fragmentos antes da remontagem. Vinte e um casos em rede interna sem IPv4 incluem NS/NA válidos e com campos alterados, fragmentos e motor intacto pelo runner. Peers/portas não permitidos receberam zero requests; o resultado da fixture continua parcial, sem nota. Relatório em `test-results/ipv6-lab.json`. O desenho e a nova versão continuam Propostos em P2/P5/P7; gateway/PMTU, VM e saída pública não foram comprovados.

Complemento IPv6 em 08/11: nove casos adicionais comprovaram HTTP/TLS e runner por um gateway entre duas bridges internas. A escolha de rota específica considera prefixo/métrica e rejeita alternativas ambíguas/dependentes de origem. Serviços do gateway, peer e porta não reservados receberam zero requests após controles positivos. Somente o gateway foi reservado como vizinho NDP. Imagem de preparação de rota é exclusiva do laboratório; relatório em `test-results/ipv6-routed-lab.json`. A evidência não aprova P2/P5/P7 ou roteamento público.

Ainda não comprovados: controle completo de egress/rebinding/peer/redirects/bytes no ambiente de produção, PMTU/topologias adicionais IPv6, caminho Worker/D1/Queues remoto, manifesto de produção aprovado, Arm nativo, VM/fallback, orçamento/custos reais, Turnstile na conta, consentimento/mapeamento e exclusão HubSpot/backup. Sem provisionamento, deploy, alteração de CRM ou publicação de diagnóstico real.
