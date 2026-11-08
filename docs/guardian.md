# Guardião de rede candidato

**Status:** Proposto para revisão P2; implementação e ensaios locais não aprovam lançamento. Complementa [ADR-004](decisions/004-escopo-e-rede.md), [arquitetura](architecture.md) e [fontes](sources.md). Não altera a decisão de manter o upstream sem fork.

## Implementação experimental

`executor/guardian/` contém um processo de DNS limitado e gerador de regras nftables. Um namespace dedicado por job compartilha rede entre esse processo e o motor, com filesystem e privilégios separados. Somente o guardião recebe `NET_ADMIN` para aplicar as regras; o motor usa usuário sem root, capabilities vazias, `no_new_privileges`, filesystem read-only e limites Docker de memória/CPU/PIDs. O processo de controle do supervisor permanece fora desse namespace. Nenhuma credencial de Queue, Worker ou CRM é passada ao motor.

O firewall tem políticas input/output/forward default-deny, conjuntos de IPs exatos com expiração no kernel, somente serviços TCP de destino 80/443, contadores e quotas de bytes. A versão pública do gerador repete a classificação de endereços e instala conjuntos de negação de ranges especiais no kernel, mesmo se uma etapa anterior de validação for omitida. O [candidato IPv6](ipv6.md) acrescenta NDP de controle restrito e rejeição antecipada de fragmentos. Tráfego público roteado, PMTU, falhas do guardião e recursos de uma VM real ainda exigem validação.

O DNS responde apenas A/AAAA do hostname reservado pelo supervisor. Outros nomes recebem NXDOMAIN; tipos adicionais recebem resposta vazia, sem afirmar ausência no DNS original. Nada é encaminhado para um resolvedor externo. Há limites de pacote, quantidade de consultas, conexões TCP e prazo. O resolver embutido do Docker em `127.0.0.11:53` é redirecionado por DNAT para esse DNS local antes das regras do Docker, sem alterar resolv.conf ou o upstream. Isso cobre tanto consultas explícitas quanto getaddrinfo no ensaio local; outros caminhos ainda precisam da validação exigida por G2.

O coletor chama handlers diretamente e não requer API upstream em loopback. A exceção TCP local limita-se ao DNS/53; a porta 3000 foi removida das permissões e seu bloqueio é exercitado com um listener controlado no próprio namespace.

O TLS é direto entre motor e fixture/alvo reservado. O guardião não substitui certificados nem termina TLS. Redirecionamentos para endereços fora do conjunto são bloqueados. Isso não fornece, por si só, observação de cada salto HTTPS. O [adaptador HTTP candidato](http-adapter.md) acrescenta limites e observação do fetch no coletor, sob esse firewall; é proposta sujeita a revisão, não atestação independente do processo.

Quotas de rede contam pacotes, incluindo overhead, e reservam margem igual ao tamanho máximo aceito de pacote. Pacotes maiores são descartados. O ensaio verifica um teto de corpo para uma fixture específica; não transforma o valor em limite aprovado de body descomprimido. O [runner candidato](runner.md), implementado em 08/11/2026, acrescenta prazo rígido, encerramento de processos, watchdog separado e limpeza; descompressão, limites finais e desempenho continuam P2/G3.

## Laboratório reproduzível

```powershell
npm run test:egress
```

Requer Docker Linux ativo, imagem upstream candidata já disponível e OpenSSL no host. O comando constrói somente uma imagem local do guardião, com base pinada por digest e dependências próprias pelo lockfile. Não publica imagem nem provisiona VM. Se houver falha de cache de snapshot do Docker, `npm run test:egress -- --rebuild` reconstrói apenas essa imagem sem apagar caches ou recursos de outros projetos.

O teste IPv4 cria uma rede `--internal`, verifica essa propriedade e usa apenas fixtures próprias em `192.0.2.0/24`. O [laboratório IPv6](ipv6.md) usa separadamente `2001:db8:5c::/64`, sem IPv4. Essas faixas de documentação são admitidas exclusivamente pelo caminho de laboratório, que rejeita rotas default ativas nas duas famílias. O gerador público recusa as faixas. O caminho de laboratório recusa destinos privados de serviço, metadata e endereços públicos reais; não é uma flag para abrir um scanner público. Não há portas publicadas. Ensaios que reservam a mesma sub-rede devem rodar separadamente; uma sobreposição faz o Docker rejeitar a criação, sem alterar a rede existente.

Contêineres e rede criados pela execução são removidos ao final; imagens locais são preservadas para repetição. Certificado e chave de fixture são temporários e sintéticos, fora do versionamento. Os mounts de código de teste e TLS existem somente no laboratório, não definem autorização para mounts de diretórios do host no executor de produção.

O relatório agregado fica em `test-results/egress-lab.json`: inclui cenários, contadores, número de requisições recebidas pela fixture bloqueada e porta proibida, digests e horário. Não contém diagnóstico de website real. Resultados de uma versão anterior do teste não comprovam o código após alterações; repetir o comando é necessário.

## O que permanece pendente

- Ligação do [runner implementado](runner.md) à configuração revisada e ao caminho real Worker/D1/Queues, com ensaio no ambiente de produção candidato.
- Ligação e validação pública do [resolvedor candidato](resolver.md), com CNAME/A/AAAA, limites/TTL, prova de origem e associação entre reserva e cada conexão; o DNS pinado não substitui essa etapa.
- Revisão e validação em VM do adaptador de status/anti-bot/redirects e do teto descomprimido; caminhos fora de fetch e mudança de hostname continuam exigindo avaliação.
- Validação IPv6 roteada/PMTU e variantes de mapped/túneis/fragmentação, rebinding e bytes descomprimidos no ambiente selecionado. O laboratório IPv6 on-link já exercita pacotes, NDP e fragmentos descartados antes da remontagem. OOM, perda do processo supervisor e processo ocupado com descendente foram exercitados no runner local; daemon/host e VM continuam pendentes.
- Revisão humana do desenho, privilégios, política, limites, pin e artefato; ensaio na VM selecionada e comprovação dos gates.

Até lá, a admissão pública e o executável de scan continuam bloqueados. O guardião não é considerado aprovado apenas porque os casos de laboratório passam.
