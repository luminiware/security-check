# Runner privado candidato

**Status:** Proposto para revisão P2/P5/P7. Implementação e testes locais em 08/11/2026, America/Fortaleza. Preserva a spec, o [guardião candidato](guardian.md) e o motor upstream sem fork. Não abre admissão pública ou envio ao CRM.

## Ciclo de execução

`executor/runner.mjs` implementa factories separadas para execução pública futura e laboratório isolado. Exige imagem upstream por digest, imagem do guardião por ID imutável local, ID de rede, limites explícitos e uma função de resolução/reserva. Não há seleção automática de instância pública ou fallback de DNS.

O runner confere alvo canônico, allowlist exata, versões, revisão declarada na imagem, digest, lease e deadline. A rede precisa ser uma bridge local. O caminho de laboratório exige ainda a label própria, `Internal=true` e exclusivamente documentação RFC5737/RFC3849. O caminho público recusa essas exceções e repete a classificação de endereços especiais. O [laboratório IPv6](ipv6.md) exercita esse runner somente com fixtures on-link.

Uma reserva válida produz política temporária, legível apenas pelo processo de controle do guardião. O motor não monta diretório do host, não recebe essa política em seu filesystem e não recebe chave de Queue, Worker, lease ou HubSpot. O programa coletor é código estático da Luminiware passado por argumento; o alvo entra por stdin, sem interpolação em JavaScript ou shell. Nenhum módulo upstream é alterado.

Após o guardião estar pronto, o runner verifica o snapshot local nftables: políticas default-deny, peers reservados com prazo e quotas esperadas. O motor roda sem root/capabilities, com `no_new_privileges`, filesystem read-only, tmpfs limitado, memória/swap/CPU/PIDs limitados e logging Docker desativado. Ao final, o snapshot é conferido novamente, desconsiderando somente contabilidade e tempo restante. Não é uma atestação criptográfica remota nem prova de todos os caminhos de G2.

`executor/workload.mjs` importa somente os quatro handlers literais. O [adaptador HTTP candidato](http-adapter.md), Proposto no ADR-008, limita fetch/redirects/body e acrescenta observações da resposta final ao contrato intermediário `workload-v1-proposal`. O coletor filtra headers permitidos, validade/autorização TLS e A/AAAA antes de emitir o retorno limitado. Não transmite body, cookies, certificados completos ou texto de erro upstream. O supervisor valida o contrato e faz a normalização final. Na fixture do runner, TLS inválido impede headers HTTPS e HTTP permanece sem upgrade: cobertura 60%, sem nota.

O processo do motor termina após enviar o JSON. Timeouts, cancelamento ou limite de saída acionam remoção forçada do contêiner, incluindo descendentes. OOM observado pelo Docker produz `WORKLOAD_OOM`, sem relatório de sucesso. A limpeza confere a label de componente e UUID da execução antes de remover qualquer recurso. Se a limpeza falhar, o runner fica indisponível; não anuncia capacidade como se o recurso tivesse sido removido.

## Prazo e perda do supervisor

Antes de criar contêineres, o runner inicia `executor/watchdog.mjs` como processo separado e aguarda confirmação de prontidão por IPC. O watchdog recebe UUID, prazo, caminho temporário próprio e variáveis de ambiente necessárias ao Docker, sem segredos da aplicação. Continua vivo se o supervisor for encerrado. Ao vencer a reserva, remove motor e depois guardião, verificando ownership, e apaga a política temporária após conferir diretório e UUID. A janela candidata de retry de limpeza é de 30 segundos; revisão e benchmark em P7 continuam necessários.

`reapExpiredSandboxes` recupera recursos vencidos pelas labels, sem depender de arquivos locais de jobs. O supervisor chama manutenção antes de consumir outra mensagem e só anuncia vagas depois da saúde do runner. Durante execução anuncia zero vagas. Falha do ciclo tenta anunciar indisponibilidade; se o canal estiver quebrado, o heartbeat anterior expira. O cancelamento do supervisor é propagado ao runner.

Essa proteção pressupõe Docker/API local operacionais. Não comprova remoção durante falha do daemon, host desligado ou kernel travado. O firewall expira a reserva de rede no kernel e os recursos continuam limitados por cgroups; recuperação/reconciliação e alertas nessas falhas ainda exigem ensaio e política operacional. Não há SLA novo.

## Teste reproduzível

```powershell
npm run test:runner
```

Exige Docker Linux ativo, imagem upstream candidata e OpenSSL do host. Cria somente uma rede interna com fixtures RFC5737; não publica portas ou diagnóstico. Deve rodar separadamente de `test:egress`, pois ambos reservam `192.0.2.0/24`. O relatório sintético fica em `test-results/runner-lab.json`.

O teste une claim D1 local, runner/guardião, motor intacto, validação/normalização do callback, persistência e ack simulado. Confere falta de nota quando a proveniência é insuficiente, processo ocupado com filho, excesso de saída, OOM real no cgroup e limpeza posterior, cancelamento prévio, perda real do processo supervisor, remoção da política temporária pelo watchdog, remoção de sandbox vencido e preservação de uma fixture não pertencente ao reaper. Não usa Queue/Worker remotos nem comprova o plano da conta.

## Pendências de produção

- Escolha, configuração e ligação do [resolvedor candidato](resolver.md), com CNAME/TTL sem fallback para DNS da tenancy. A função injetada no laboratório retorna somente a fixture; o ensaio DNS separado não é consulta pública original.
- Revisão da observação de status/anti-bot/redirects pelo adaptador e de seus limites, incluindo mudanças de hostname e caminhos não baseados em fetch.
- IPv6 roteado/PMTU, rebinding e variações de fragmentação, limites de descompressão/memória em VM, perda do daemon e ensaio na arquitetura selecionada. IPv6 on-link, body gzip e OOM foram ensaiados localmente, sem constituir benchmark dos limites.
- Configuração revisada, rotação de chaves, parâmetros/benchmark, aprovação do pin e ligação do caminho real Worker/D1/Queues.

`npm run executor` continua saindo com `EXECUTOR_REVIEW_REQUIRED`. A existência do runner não aprova políticas ou transforma um laboratório em operação pública.
