# Checkpoint de implementação — 08/11/2026

## Situação executiva

O repositório saiu de uma baseline documental para uma implementação experimental executável e testada localmente. Há interface, API Worker, persistência D1, ciclo de jobs, relatório/scoring, captura consentida de lead e um executor candidato que usa Web-Check intacto em laboratórios isolados.

**O sistema ainda não está liberado para produção.** Os gates G1–G9 continuam abertos. Implementação e testes não aprovam as propostas de contratos, rede, scoring, limites ou tratamento de dados. A execução autônoma foi pausada pelo usuário para avaliar este checkpoint; este relatório não a retoma.

O checkpoint parte de `main` em `11c128f`, que já continha a baseline documental mergeada. A solicitação atual autoriza commit e push para a principal; não inclui deploy, provisionamento, abertura da admissão, alteração de CRM ou scan público. Nenhuma dessas operações foi executada.

## Entregas por frente

| Frente | Estado atual | Limite principal |
|---|---|---|
| Interface `/security` | Entrada/preview de domínio, cenários sintéticos, estados de execução, polling, retomada, relatório, evidências, prioridades e formulário opcional | Demonstração local; revisão humana de UX/textos ainda necessária |
| API Worker | Sessão opaca em cookie HttpOnly, controle de origem, JSON limitado, idempotência, criação/consulta/exclusão e rotas internas autenticadas | Novas análises fora da demonstração local retornam 503, inclusive com `PUBLIC_ADMISSION=true` |
| D1/durabilidade | Quatro migrações, quotas atômicas, outbox, claim, lease, tentativa, callback idempotente, reconciliação, retenção e tombstones | Evidência em SQLite/workerd local; falta fluxo na conta com Queue real |
| Relatório | Contrato estrito, minimização de evidência, cobertura, nota condicional e até três prioridades | Pesos, severidades, limiar e semântica continuam Propostos |
| Lead/CRM | Consentimento explícito, recibo durável, deduplicação semântica e por chave, outbox e resposta ambígua para revisão manual | Transporte HubSpot existe, mas está desconectado; mapping, scopes, consentimento e exclusão remota pendentes |
| Executor | Runner por job, imagens identificadas, validação do guardião, limites, deadline, watchdog e reaper por ownership | CLI de produção termina com `EXECUTOR_REVIEW_REQUIRED`; configuração e ligação públicas não foram feitas |
| Rede IPv4 | Classificação conservadora, DNS reservado, peers exatos com expiração, TCP/80/443, quotas e default-deny | Ensaios com endereços de documentação em rede interna; G2 ainda aberto |
| Rede IPv6 | Contexto do kernel, NDP restrito/contabilizado, fragmentos rejeitados antecipadamente e seleção de rota por prefixo/métrica | Ensaios on-link e por um gateway; PMTU, policy routing/VRF, VM e tráfego público pendentes |
| HTTP/DNS | Resolvedor TCP limitado sem fallback; fetch limitado antes dos handlers, com status, redirects, TLS e body decodificado | Testes controlados; sem consulta a resolvedor/website público ou prova completa por conexão em produção |
| Métricas | Cinco consultas D1 somente leitura, coortes UTC, contagens e p50/p95 com denominadores explícitos | Dados retidos; não há histórico comercial permanente, CPU/RAM ou custo real |
| Infra/operação | Configuração local Workers/assets/D1/producer Queue, scripts e lockfile | UUID D1 é placeholder; sem recursos remotos, CI de aplicação ou procedimento de restore remoto comprovado |

A cobertura requisito a requisito RF-01–RF-13 está em [implementação](implementation.md). Os contratos e fluxos estão na [arquitetura](architecture.md); propostas e decisões permanecem diferenciadas em [fontes](sources.md) e nos [ADRs](decisions/README.md).

## Motor e versões

O upstream permanece sem fork ou cópia modificada no produto. O candidato pesquisado é Web-Check 2.4.0, revisão `fd08be81f700254214ef49d093e71a991567841f`, com manifesto amd64 `sha256:ce8c90602e533bb3f45bc0e445a6c02040190a49e1d4e85389492dcb3a2b9c6d`. O manifesto arm64 está registrado, mas não houve execução nativa arm64. A aprovação do pin de produção continua pendente.

Somente `headers`, `http-security`, `ssl` e `dns` são candidatos. A configuração também desabilita explicitamente `get-ip`, porque o upstream pesquisado o excepciona da allowlist. Não foram executados Chromium como scanner, verificações invasivas ou serviços de terceiros fora do escopo.

| Contrato candidato | Versão |
|---|---|
| Schema | `1` |
| Política de rede | `network-v1-proposal` |
| Regras de interpretação | `score-v1-proposal` |
| Resultado normalizado | `normalized-v2-proposal` |
| Resultado intermediário do workload | `workload-v1-proposal` |

O callback exige `final_https` para headers: o protocolo coletado não é inferido do endereço digitado. O relatório conserva as versões do job. Versões legadas não são aceitas silenciosamente.

Os pesos propostos são TLS 35, transporte HTTPS 25, HSTS 15, CSP 10, nosniff 10 e Referrer-Policy 5. A nota exige cobertura suficiente, evidência dos itens essenciais e coleta DNS útil. DNS inconclusivo suprime a nota mesmo com cobertura ponderada completa. Presença de headers não comprova proteção efetiva ou ausência de vulnerabilidade.

## Verificação disponível no checkpoint

Em 08/11/2026 foram executados novamente para o checkpoint: regressão integral **74/74**, navegador **9/9**, sintaxe JavaScript, build Wrangler `--dry-run`, consulta `npm audit` sem vulnerabilidades reportadas e verificação de documentação/whitespace. A CLI do executor foi chamada e permaneceu fechada com `EXECUTOR_REVIEW_REQUIRED`, conforme esperado.

Os sete relatórios Docker abaixo estavam presentes e foram inspecionados. Todos são sintéticos e locais; seus horários são UTC. Os cinco primeiros não foram reexecutados especificamente para o commit; são evidência das etapas anteriores no mesmo dia. Os ensaios IPv6 foram executados na última etapa de implementação, antes da pausa. Não se apresenta essa evidência como teste remoto ou aprovação de gate.

| Ensaio | Casos aprovados | Último relatório UTC em 08/11 |
|---|---:|---|
| Upstream intacto | 7 | 15:57:32 |
| Egress IPv4 | 16 | 15:58:14 |
| Runner, falhas de processo e integração D1 local | 15 | 15:46:49 |
| Resolvedor TCP | 9 | 15:58:17 |
| Adaptador HTTP | 10 | 15:58:19 |
| IPv6 on-link | 21 | 16:08:55 |
| IPv6 por gateway | 9 | 16:10:33 |

Os ensaios cobrem timeout/descendente, limite de saída, OOM observado no Docker, cancelamento, crash do supervisor e limpeza; DNS/CNAME/TTL e respostas mistas; TLS original inválido; redirects/status/interstitial/gzip; peers/portas proibidos, quotas, expiração, NDP inválido e fragmentos IPv6. Os controles positivos de rede confirmam que um destino era alcançável antes de considerar um bloqueio como evidência do guardião.

No ensaio roteado, alvo e motor ficaram em enlaces diferentes, unidos por um gateway sintético. O gateway foi reservado somente para NDP. Serviço TCP/80 do gateway, peer não reservado e porta extra receberam zero requests. O runner preservou TLS inválido e HTTP sem upgrade, produzindo cobertura de 60% e nota nula. Isso reduz a lacuna de roteamento local, sem comprovar PMTU ou caminhos públicos.

Relatórios, screenshots, certificados temporários, bancos locais, logs e dependências ficam fora do Git. Os harnesses e as instruções para reproduzir a evidência são versionados. Consequentemente, quem clonar o checkpoint precisa executar os ensaios para regenerar os artefatos; o commit não contém os resultados brutos. Os limites de cada prova estão em [verificação](verification.md).

Uma regressão anterior retornou 64/65 sem preservar o assert; a causa não foi comprovada retrospectivamente. O teste de polling teve uma dependência temporal independente corrigida, e regressões integrais posteriores passaram, incluindo a atual. Também foi corrigido o diretório do Playwright para evitar apagar relatórios Docker. Esses fatos permanecem registrados, sem ocultar a falha anterior.

## Gates e pendências que bloqueiam lançamento

| Gate | O que ainda falta |
|---|---|
| G1 — motor | Revisar/aprovar pin, validar manifesto e executar arm64 nativo; revisar interpretação por versão |
| G2 — rede | Revisão do guardião; DNS original e rebinding; prova por conexão/redirect/bytes no ambiente selecionado; PMTU e topologias IPv6 adicionais; captura de egress sem bypass |
| G3 — limites | Benchmark p95/CPU/RAM, carga/quotas/orçamento, widget/Siteverify na conta e limites aprovados |
| G4 — durabilidade | Worker/D1/Queues/executor real, falhas entre passos, recuperação e migração Oracle/Hetzner ensaiadas |
| G5 — interpretação | Revisar regras/pesos/severidades, evidência parcial, condições DNS/HTTPS e risco de falsa confiança |
| G6 — comercial | Aprovar texto/consentimento, mapping/unique property/scopes HubSpot; testar indisponibilidade, ambiguidade e exclusão na conta de teste |
| G7 — UX | Revisão humana desktop/mobile/teclado e de todos os estados, avisos, prioridades e CTA |
| G8 — dados | Política de retenção e rotação, logs/cache externos, propagação de exclusão CRM/backup e restore com reaplicação de remoções |
| G9 — viabilidade | Conta/região/capacidade Oracle ou fallback, preços/cotas atuais, orçamento real, donos e fontes de métricas comerciais |

P1/P5/P6 continuam propostas sujeitas a revisão; P2 bloqueia exposição pública; P3 depende de plataforma; P4 depende de consentimento/modelo CRM; P7/P8 dependem de parâmetros, orçamento e responsáveis. Não há prazo ou responsável pessoal presumido.

Há uma diferença de coleta já documentada para revisão: o cenário parcial suficiente obtém 95% com Referrer-Policy não interpretável, em vez de timeout isolado de um header recebido junto aos demais na mesma resposta. A fórmula é testada; equivalência de semântica não foi declarada.

## Próximos passos para decisão

1. Revisar este checkpoint e os ADRs 006–008, contratos, scoring e política de rede, registrando aceites ou mudanças explícitas. O push para `main` não altera seus estados de evidência.
2. Definir responsáveis e o ambiente controlado para os gates, aprovar orçamento e escolher VM/arquitetura, pin e parâmetros de ensaio. A escolha de plataforma não está resolvida pelo laboratório Docker.
3. Preparar CI com os checks locais que forem aprovados e uma estratégia separada para testes Docker/arm64. Ainda não há workflow de aplicação versionado.
4. Após aprovação do escopo e configuração, validar rede/recuperação na VM e ligar Worker/D1/Queues/executor em ambiente de teste, mantendo admissão pública fechada.
5. Validar CRM, Turnstile, retenção/restore, UX e custo; abrir serviço somente após evidência e aprovação dos gates restantes.

O trabalho de implementação permanece pausado para essa avaliação. O checkpoint preserva o código alcançado, os comandos de reprodução e as lacunas conhecidas; não é uma release de produção.
