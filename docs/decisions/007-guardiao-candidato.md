# ADR-007 — Guardião por namespace, DNS reservado e nftables

**Status:** Proposto para revisão P2. Código experimental e testes de laboratório não constituem aceitação. Preserva [ADR-001](001-upstream-sem-fork.md) e [ADR-004](004-escopo-e-rede.md).
**Fonte/data:** S14 e requisitos de isolamento em [fontes](../sources.md), 07/11/2026. Fontes técnicas e limites do ensaio em [guardião](../guardian.md).

## Contexto

O upstream pesquisa DNS por mais de um caminho, segue redirects e permite observar falha de certificado por socket TLS direto. Um proxy HTTP isolado não protege todos esses caminhos. O motor não pode receber credenciais nem acessar a rede de controle.

## Proposta experimental

Executar cada job em namespace dedicado, com um guardião separado do filesystem/processos do motor. O guardião aplica conjuntos exatos de peers com expiração e regras default-deny no kernel. DNS local responde somente o hostname reservado e nunca encaminha consultas. O DNS Docker de loopback é redirecionado para esse resolvedor, evitando editar o upstream, resolv.conf ou interceptar TLS.

Somente o guardião recebe NET_ADMIN. O motor permanece sem root/capabilities, read-only e limitado por cgroups. O supervisor controla o ciclo de vida de fora do namespace e não transmite suas credenciais ao motor. Em 08/11/2026, o [runner candidato](../runner.md) acrescentou montagem por job, prazo rígido, watchdog e limpeza testados em laboratório; ligação de produção e revisão continuam pendentes.

Na mesma data, o [resolvedor candidato](../resolver.md) acrescentou coleta CNAME/A/AAAA por TCP em IP explícito, sem DNS implícito/fallback, com TTL, limites e rejeição de respostas mistas. O ensaio usa DNS próprio em loopback de contêiner sem rede, sem consultar resolvedor público. Escolha, configuração e ligação ao runner ainda exigem revisão P2/P7.

## Evidência e limites

Há funções testadas de geração de regras/DNS e ensaio reproduzível com fixtures em rede Docker interna. O gerador público rejeita endereços especiais e instala negação de ranges no kernel. O caminho de laboratório é separado, aceita somente documentação RFC5737/RFC3849 e rejeita rotas default ativas; não habilita serviços privados ou públicos arbitrários.

Evolução Proposta em 08/11/2026: [IPv6](../ipv6.md) em `network-v1-proposal`, com contexto de enlace derivado do kernel, NDP restrito a endereços/interface/target, quotas/expiração e descarte de fragmentos antes da defragmentação. Gateway ganha só papel NDP, sem exceção TCP/UDP. O laboratório on-link exercita 21 casos, inclusive NS/NA com campos alterados por controle confiável separado do motor. A nova política continua sujeita à revisão P2/P5/P7; não aprova exposição pública ou suporte IPv6 completo.

Ainda em 08/11, o candidato passou a selecionar rotas por prefixo/métrica do kernel, rejeitando ambiguidades e rotas dependentes da origem. Nove casos adicionais usam duas bridges IPv6 internas e um gateway, com rotas específicas sem default. HTTP/TLS e runner alcançaram o peer remoto; serviço do gateway, peer e porta não reservados receberam zero requests. O gateway permaneceu somente no conjunto NDP. Imagem/entrypoint de preparação de rota são exclusivos do laboratório; o guardião normal não ganha `iproute2`.

Isso ainda não demonstra o ciclo completo por conexão pública, PMTU, policy routing/VRF, todos os mecanismos de rebinding ou limites no ambiente selecionado. O adaptador do ADR-008, prazo/watchdog e descompressão têm evidência local, sem aceitação implícita. G2 permanece aberto, assim como a revisão de privilégios, parâmetros e artefato.

## Consequências e revisão

O desenho usa um componente lógico do próprio executor, sem novo banco ou serviço gerenciado. É mais código de operação e depende de nftables/kernel/Docker compatíveis; precisa de benchmark, teste na VM e revisão antes de adoção. A admissão pública e a CLI de produção não são abertas por este ADR.
