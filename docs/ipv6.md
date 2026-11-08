# Guardião IPv6 candidato

**Status:** Proposto para revisão P2/P5/P7 em 08/11/2026, como evolução do [ADR-007](decisions/007-guardiao-candidato.md). A política candidata é `network-v1-proposal`; a admissão pública e a CLI de produção continuam fechadas.

## Destinos e controle de enlace

O caminho público mantém a classificação de endereços especiais e só admite peers globais permitidos em TCP/80 ou TCP/443. O laboratório separado acrescenta exclusivamente `2001:db8::/32` à faixa IPv4 de documentação já existente. Isso não autoriza serviços em ULA/link-local, metadata ou destinos arbitrários. O ensaio verifica `Internal=true`, IPv4 desativado e ausência de rota default ativa.

`executor/guardian/ipv6.mjs` deriva interface, endereços locais prontos, peers on-link e eventual gateway dos dados do próprio kernel. O visitante e o arquivo de política não podem fornecer esse contexto. Interfaces/gateways ambíguos, endereço necessário ainda tentative/DAD-failed ou ausência de rota protegida impedem prontidão. Antes de criar o motor, o guardião pode aguardar brevemente a preparação da interface; falha não abre um fallback.

Para cada peer IPv6, o candidato seleciona o maior prefixo de destino ativo e depois a menor métrica das rotas do kernel. Uma rota específica prevalece sobre uma conectada/default menos específica. Ausência de rota, rota selecionada rejeitada, interface diferente, alternativas de mesmo custo com caminhos divergentes, rotas dependentes da origem ou múltiplos próximos saltos impedem prontidão. Não infere rota apenas por coincidência com o CIDR da interface. O único gateway selecionado precisa estar no enlace local pronto. Isso cobre o modelo restrito do candidato, sem implementar um resolvedor geral de policy routing/VRF.

O NDP permitido limita-se a Neighbor Solicitation/Advertisement entre os endereços locais e os vizinhos reservados. Um gateway descoberto na rota ganha somente essa função de controle, sem exceção para seus serviços TCP/UDP. Cada regra restringe interface, origem/destino, target de 128 bits no pacote, Hop Limit 255, Code 0 e tamanho de 64–96 bytes, sem extension headers. O protocolo é numérico (58), sem depender de `/etc/protocols`.

Conjuntos de controle expiram no mesmo prazo da reserva, têm limite de taxa e compartilham as quotas de bytes aceitos de entrada/saída. Há contadores separados de NDP. TCP IPv6 exige ainda origem/destino local do namespace, conforme a direção, além do peer reservado. Não há permissão genérica de ICMPv6, Echo, Router Advertisement ou redirect de roteador. O motor permanece sem root/capabilities.

Uma chain de prerouting em prioridade -450 rejeita fragmentos IPv6 antes da etapa de defragmentação considerada (-400). A rejeição cobre todos os fragmentos IPv6 nesse namespace, não apenas os de NDP. O snapshot antes/depois exige essa chain e conjuntos de enlace vivos. Isso é um controle local, sem atestação independente do host e sem promessa de eliminar todo custo de pacotes descartados.

## Ensaio reproduzível

```powershell
npm run test:ipv6
npm run test:ipv6:routed
```

Exige Docker Linux, OpenSSL do host e imagem upstream candidata. Cria somente uma bridge interna IPv6 em `2001:db8:5c::/64`, com fixtures próprias e portas não publicadas. A imagem do guardião é construída localmente. Contêineres/rede e certificado sintético são removidos ao final. Não muda a configuração do daemon ou o firewall de outros projetos.

Os 21 casos abrangem controles positivos anteriores ao firewall; AAAA e lookup do sistema pinados; HTTP/TLS IPv6 com peer observado e certificado original; peer/porta não reservados; NDP contado; quota; expiração de peers/controle; campos inválidos de NS/NA; fragmentos; e o runner com os quatro handlers upstream intactos, validado pelo contrato de resultado.

Um controle confiável de laboratório recebe NET_ADMIN apenas no namespace da fixture para modificar três campos fixos de pacotes NDP gerados pelo kernel. Não recebe NET_RAW, não executa um scanner e não altera as permissões do motor. Cada receptor usa endereço de documentação distinto para evitar cache de vizinho de um caso anterior. Controles positivos confirmam emissão e aceitação de pacotes válidos; nos negativos, emissão é confirmada, aceitação NDP permanece zero e drops aumentam.

O teste de fragmentação envia um datagrama sintético de 6.000 bytes, maior que a MTU do enlace. Sem o guardião, a fixture o recebe; com o guardião, o contador de fragmentos aumenta na chain anterior à remontagem. TLS inválido é conservado como evidência útil no runner; HTTP sem upgrade é observado, headers HTTPS ficam sem coleta válida, cobertura é 60% e nota é nula.

Relatório agregado: `test-results/ipv6-lab.json`, fora do versionamento. Inclui versões, imagens, casos e contadores; não inclui diagnóstico público, body ou credenciais. O resultado não comprova todos os formatos de fragmento ou caminhos de um host diferente.

## Ensaio roteado e critérios

O segundo comando cria duas bridges internas, `2001:db8:5d:1::/64` e `2001:db8:5d:2::/64`, sem IPv4 ou portas publicadas. Um roteador sintético conecta os enlaces; forwarding é configurado somente no namespace desse contêiner. Rotas específicas e de retorno ligam apenas esses prefixos de documentação. Router, fixtures e guardião têm ausência de rota default verificada. Não há alteração de daemon, firewall do host ou redes de outros projetos.

Uma imagem exclusiva do ensaio acrescenta `iproute2` e um entrypoint que prepara uma rota fixa antes de carregar o guardião inalterado. A imagem normal do guardião não ganha esse pacote ou entrypoint. O ensaio usa os IDs locais capturados das imagens; isso não equivale a pin de produção aprovado nem a build bit a bit reproduzível. O motor upstream permanece intacto, sem root/capabilities, mounts de host ou CA temporária.

Nove casos foram executados em 08/11/2026. Os critérios exigem:

- Antes do firewall, alcançar alvo, peer não reservado, porta extra e serviço do gateway, para excluir bloqueios de topologia como falsa evidência.
- Derivar do kernel apenas o gateway do enlace, com peers remotos fora de `on_link_peers`; contar NDP de entrada/saída e manter só o gateway no conjunto de vizinhos.
- Permitir HTTP/TLS do alvo reservado e preservar o certificado original inválido, com zero requests na fixture bloqueada, porta extra e serviço TCP/80 do gateway.
- Rodar os quatro handlers intactos pelo runner, validar o callback e conservar resultado parcial: cobertura 60%, nota nula e headers HTTPS inconclusivos.

Os nove critérios passaram no ambiente local. Relatório agregado em `test-results/ipv6-routed-lab.json`, fora do versionamento, com imagens/versões, contexto derivado e contadores. Recursos e certificado sintético são removidos ao final. Esse ensaio reduz a lacuna de roteamento; não aprova o desenho nem comprova roteamento público ou todas as topologias.

## Pendências explícitas

- Tráfego público roteado, policy routing/VRF, múltiplas interfaces/próximos saltos e gateway na VM selecionada. O laboratório agora comprova apenas uma rota específica por um gateway em bridges internas.
- PMTU/ICMPv6 Packet Too Big, variações de extension headers/fragmentos, SEND, DAD/RA completo, mudanças de endereço/rota e validação na VM/arquitetura selecionada. O candidato restringe esses caminhos; não promete implementar todo IPv6.
- Revisão de regras/privilégios/limites e benchmark; DNS público original; rebinding completo e correlação por conexão; fluxo Worker/D1/Queues remoto.

G2 continua aberto. Compatibilidade menor ou coleta inconclusiva não autoriza ampliar o firewall por conveniência.

## Fontes

Consultadas em 08/11/2026: [RFC3849](https://www.rfc-editor.org/rfc/rfc3849), [RFC4861](https://datatracker.ietf.org/doc/html/rfc4861), [RFC6980](https://datatracker.ietf.org/doc/html/rfc6980), [nftables manual](https://netfilter.org/projects/nftables/manpage.html), headers Linux de [prioridade IPv6](https://github.com/torvalds/linux/blob/master/include/uapi/linux/netfilter_ipv6.h) e [flags de endereço](https://github.com/torvalds/linux/blob/master/include/uapi/linux/if_addr.h), e [bridge IPv6 no Docker](https://docs.docker.com/engine/network/drivers/bridge/). O laboratório comprova o comportamento local relevante; as fontes não aprovam a implementação ou o ambiente de produção.

Para o ensaio roteado, também foram consultados [ip-route](https://man7.org/linux/man-pages/man8/ip-route.8.html) e [sysctls de rede do Linux](https://docs.kernel.org/networking/ip-sysctl.html), em 08/11/2026. Rotas específicas e forwarding são configuração controlada do laboratório; não são uma nova permissão do serviço público.
