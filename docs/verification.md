# Verificação local e limites de evidência

Atualização local: 08/11/2026, America/Fortaleza. As primeiras etapas foram executadas em 07/11; datas dos artefatos são UTC. Requisitos e propostas permanecem com o estado registrado em [fontes](sources.md). Este registro não aprova os gates de lançamento.

Última regressão integral registrada: 74/74 testes passaram. Também há 9/9 de navegador, 15 casos do runner, 21 de IPv6 on-link e nove de IPv6 roteado com os limites descritos abaixo. Build dry run, sintaxe e links/whitespace são verificações separadas. Os relatórios registram o horário e as versões da execução; mudanças posteriores exigem a verificação pertinente, sem converter teste local em aprovação de gate. O [checkpoint de 08/11](checkpoint-2026-11-08.md) consolida o estado para revisão.

| Verificação executada | Evidência | Limite |
|---|---|---|
| `npm test` | Testes de lógica, D1/SQLite em workerd, HTTP, integrações simuladas, endereços/PSL, DNS, nftables e runner/watchdog | Não é teste integrado em conta Cloudflare; API é chamada pelo harness Node com storage workerd |
| `npm run test:ui` | Nove testes no Worker local e Edge: desktop/mobile, consentimento, retenção, retomada, XSS e input inválido | Browser de teste com D1 isolado; sem scanner de Chromium e sem contato real |
| `npm run test:upstream` | Sete casos de contrato com imagem upstream intacta, amd64 nativo, digest/revisão verificados | Contêiner sem rede; nenhuma evidência de controle de egress público ou arm64 nativo |
| `npm run test:egress` | Dezesseis casos com fixtures RFC5737 em rede Docker interna, nftables/DNS e motor intacto; zero requests na fixture bloqueada e porta proibida; API loopback também bloqueada | Ensaio IPv4 local, não tráfego de website público; ainda não é o runner de produção nem aprovação G2 |
| `npm run test:runner` | Quinze casos unindo D1 local, runner/guardião, motor intacto, callback e ack simulado; timeout/descendente, saída excessiva, OOM, crash e limpeza de contêineres/arquivos | Ainda sem resolução pública original, conta Cloudflare/Queue real ou ensaio em VM; não aprova G2/G4 |
| `npm run test:resolver` | Nove casos DNS TCP em loopback de contêiner sem rede: framing, CNAME/TTL, respostas inválidas, timeout e cancelamento | Resolvedor é fixture própria; não houve DNS público ou ligação ao runner público |
| `npm run test:http` | Dez casos com fetch limitado e handlers upstream intactos: TLS válido, status/redirects, interstitial, gzip e prazo | CA sintética só no contêiner `network=none`; adaptador no processo não é atestação independente ou aprovação G2 |
| `npm run test:ipv6` | Vinte e um casos numa bridge interna sem IPv4: AAAA, HTTP/TLS, NDP, peers/portas, quota/expiração, campos NS/NA inválidos, fragmentos e runner | Endereços RFC3849 on-link; não comprova gateway/PMTU, tráfego público, todos os fragmentos ou VM |
| `npm run test:ipv6:routed` | Nove casos entre bridges IPv6 internas: controles positivos, rota específica por gateway, HTTP/TLS, NDP e runner; zero requests a gateway/peer/porta não permitidos | Um gateway e rotas fixas RFC3849; sem PMTU, policy routing/VRF, tráfego público ou VM |
| `npm run db:migrate` | Quatro migrações aplicadas ao D1 local | Nenhuma migration remota ou operação de produção |
| `npm run metrics:local` | Cinco consultas de leitura no D1 local; agregados, coortes UTC, p50/p95 e denominadores explícitos, testados também em workerd | Linhas retidas; sem histórico comercial completo, CPU/RAM ou custos reais |
| `npm run build` | Bundle Worker/assets por Wrangler `--dry-run` | Sem deploy, conta, credenciais ou teste de recursos remotos |
| `npm run check` | Sintaxe JavaScript | Sem declaração de lint/typecheck |
| `npm run check:docs` e `git diff --check` | Links locais e whitespace da árvore de código/documentação | Sem validação visual dos diagramas ou revisão humana dos contratos |
| `npm audit --json` | Nenhuma vulnerabilidade reportada pelo registro na consulta | Snapshot da consulta; não é auditoria de dependências ou da imagem upstream |

## Falhas exercitadas

Admissão concorrente repete a mesma chave sem duplicar job, evento ou contador. Alteração do corpo com a mesma chave gera conflito. Sessões diferentes e subdomínios não excedem quotas por domínio registrável. Orçamento diário é atômico e retorna indisponibilidade, sem job rejeitado executável.

Claims simultâneos reservam uma tentativa. Callback exige executor, token, tentativa, conjunto de checks, versões e evidência válidos. Repetições simultâneas idênticas recebem aceite; retorno divergente ou antigo não sobrescreve terminal. Deadline e lease perdido são reconciliados, com limite por tick e esgotamento de tentativas. Falha de publicação mantém intenção durável.

Pedidos de ajuda exigem consentimento e diagnóstico da mesma sessão. Aliases de idempotência permanecem vinculados ao corpo mesmo quando apontam para um mesmo lead semântico. Resposta CRM ambígua vai para revisão manual e não provoca reenvio automático. Retenção remove contato/evidência e depois o tombstone; exclusão ativa invalida acesso.

A UI preserva input inválido, alvo normalizado e ID durante falha de polling. Recarregar um relatório removido mostra o estado de retenção. Evidência hostil permanece texto; iniciar outro job limpa o consentimento anterior. Nota ausente, parcial e aviso são visíveis; polling para em estado terminal.

Headers usam o protocolo efetivamente observado, pelo campo obrigatório `final_https` de `normalized-v2-proposal`, inclusive para entrada HTTP. Testes rejeitam tipo inválido/ausente e callbacks legados; HTTPS não comprovado continua inconclusivo. O relatório preserva motor/digest e demais versões do job, exibidos como texto nos detalhes técnicos.

A revisão `score-v1-proposal` mantém pesos/fórmula e suprime o número quando DNS não tem coleta útil, conforme o detalhamento Proposto em P6. A cobertura das regras pode ser 100% e o relatório continuar “Parcial”, sem nota e com limitação DNS explícita. O estado das quatro coletas aparece nos detalhes. O exemplo de callback na arquitetura é parseado e validado pelo teste, evitando divergência de campos e versões.

Uma execução intermediária de regressão retornou 64/65; a saída resumida não preservou o assert e não comprova sua causa. Duas repetições integrais com log local passaram 65/65. Foi removida uma dependência de tempo identificada no teste de polling: a prova de GET sem coleta agora usa um job persistido sem tarefa automática, sem presumir que a demonstração não iniciou durante a leitura. Isso não prova retrospectivamente a causa da falha; reprodução sob carga continua em P7. O log mais recente fica em `.wrangler/regression-latest.txt`.

O diretório padrão do Playwright apagava relatórios Docker que compartilhavam `test-results`. O harness passou a usar exclusivamente `test-results/browser`, incluindo screenshots. A preservação foi verificada comparando o SHA-256 de um relatório Docker antes/depois da execução de navegador. Os relatórios que tinham sido removidos foram regenerados pelos próprios ensaios, sem reconstruir evidência manualmente. Screenshots atuais ficam em `test-results/browser/desktop-report.png` e `test-results/browser/mobile-report.png`.

O [runner](runner.md) executa programa estático passado por argumento e recebe o alvo por stdin, em motor sem mounts de host ou credenciais de controle. Mantém TLS inválido e HTTP sem upgrade como evidência útil; headers HTTPS sem coleta válida ficam inconclusivos, resultando em cobertura 60% e nota nula nessa fixture. O teste exercita busy loop e processo filho observados antes do timeout, limite de stdout, cancelamento, OOM confirmado por `State.OOMKilled` no cgroup de 64 MiB, morte real do processo supervisor com watchdog separado e reaper limitado por ownership. Confere remoção de contêineres e da política temporária. São ensaios locais com daemon saudável; perda do daemon e host continuam pendentes.

O [resolvedor candidato](resolver.md) tem testes de contrato e transporte real restrito ao loopback de contêiner sem rede. CNAME/TTL e os dois conjuntos A/AAAA são validados antes de produzir reserva; respostas mistas não são filtradas para fingir um conjunto seguro. Não houve consulta a resolvedor ou website público.

O [adaptador HTTP](http-adapter.md), Proposto no ADR-008, é executado antes dos handlers intactos. O ensaio conserva API 200 com alvo 503, observa HTTP→HTTPS e interstitial, bloqueia outro hostname antes do request e limita um gzip de 1 MiB comprimido para menos de 4 KiB. A CA temporária desse laboratório não é instalada no runner normal. Nenhum body chega ao callback.

As [consultas de métricas](metrics.md) usam o primeiro claim para a fila, inclusive após perda de lease e retry. Callbacks e chaves de lead repetidas não multiplicam amostras. Contagens parciais usam o rótulo do relatório, inclusive quando DNS impede nota com cobertura ponderada completa. Não se selecionam identificadores ou contatos; exclusões/retenção impedem tratar esses dados como histórico permanente.

O [ensaio IPv6](ipv6.md) tem controles positivos e contadores NDP antes de avaliar bloqueios. Pacotes NS/NA com Hop Limit 254, Code 1 ou target errado são emitidos por controle confiável da fixture e descartados pelo receptor, sem aceitação NDP. Datagrama de 6.000 bytes maior que a MTU é recebido sem firewall; sob o guardião foram observados cinco fragmentos (6.248 bytes) descartados na chain -450. O runner mantém o certificado original inválido e HTTP sem upgrade, com cobertura 60% e nota nula. A leitura de nftables exige também conjuntos de enlace vivos e chain de fragmentos anterior à defragmentação.

Complemento roteado em 08/11: nove casos adicionais em duas bridges internas comprovaram HTTP/TLS e runner por gateway, com controle positivo anterior e zero requests no serviço do gateway, peer e porta bloqueados. Contexto e conjuntos NDP reservam somente o gateway do enlace, escolhido por rota específica do kernel. Relatório em `test-results/ipv6-routed-lab.json`; a imagem de preparação de rotas é exclusiva desse ensaio, sem modificar o guardião normal ou motor upstream. Não comprova PMTU, policy routing/VRF, saída pública ou VM.

## Motor sem fork

O teste usa o manifesto amd64 `sha256:ce8c90602e533bb3f45bc0e445a6c02040190a49e1d4e85389492dcb3a2b9c6d`, com label de revisão `fd08be81f700254214ef49d093e71a991567841f`. O arquivo [candidato](../executor/upstream.research.json) registra o índice e o manifesto arm64. A escolha de produção não está aprovada.

Foram confirmados: resposta de headers, redirect seguido sem prova de saltos, HTTP 503 do alvo retornado como API 200 sem status original, anti-bot com body de erro, falha de autorização de TLS, DNS reduzido a arrays vazios e erro de conexão com body de erro. Há asserts de usuário sem root, capabilities vazias, `no_new_privileges`, ausência de rota IPv4 e escrita negada em `/app`. A execução tem limites Docker de memória/CPU/PIDs, mas não é benchmark desses limites.

As fixtures privadas/loopback ficam somente dentro de contêiner `network=none`. A política pública não tem exceção para esses alvos. Os testes de classificador/reserva não abrem sockets. O relatório sintético é regenerado em `test-results/upstream-contract.json`, fora do versionamento.

## Lacunas mantidas explícitas

G1 depende ainda de revisão do pin e execução nativa arm64. G2 tem guardião/runner candidatos e evidência local de pacotes/DNS/peer/processos em laboratório interno IPv4/IPv6 on-link e por um gateway; depende ainda de resolução pública original, rebinding, redirects completos, PMTU/topologias adicionais, variantes de fragmentos e bytes/descompressão no ambiente com saída pública. G3 exige benchmark e parâmetros aprovados; Siteverify foi simulado, não validado na conta. G4 exige o caminho real D1/Queue/executor e recuperação em VM/fallback.

G5/G7 têm evidência local, mas ainda exigem revisão de significado, pesos e UX. O cenário parcial suficiente do código obtém 95% com Referrer-Policy não interpretável, em vez de simular um timeout isolado de um único header que chega na mesma resposta HTTP dos demais. A fórmula/nota esperada é testada, mas essa diferença de coleta precisa de revisão no contrato; não é escondida como fidelidade exata.

G6 exige texto, consentimento, mapping, scopes e reconciliação HubSpot na conta de teste. G8 exige retenção aprovada, rotação, logs externos, propagação de exclusões e restore com reaplicação de remoções. G9 exige orçamento, conta/região, custos e origem das métricas comerciais. O inventário completo está em [implementação](implementation.md).
