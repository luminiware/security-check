# Implementação e pendências

Atualização: 08/11/2026. Este registro complementa a [spec](spec.md), a [arquitetura](architecture.md) e os estados de evidência em [fontes](sources.md). Código experimental não aprova uma política de produção.

Resultados e limites dos comandos executados estão no [registro de verificação](verification.md).

## Execução local

Node 22.19 ou superior e npm. A instalação é reproduzível pelo `package-lock.json`.

```powershell
npm ci
npm run db:migrate
npm run dev
```

Abrir `http://127.0.0.1:8787/security`. O servidor fica no loopback. Aceita somente `example.com`, `example.org` e `example.net`, com cenários sintéticos identificados na tela. Nenhum desses domínios é acessado. As notas demonstram a fórmula proposta, sem comprovar a condição de qualquer website.

Pedidos de ajuda locais aceitam somente contatos em domínios de exemplo e os textos sintéticos do formulário. O consentimento começa desmarcado. Nenhum pedido local chega ao HubSpot. Não inserir dados pessoais na demonstração.

```powershell
npm run check
npm test
npm run build
npm run test:ui
npm run test:upstream
npm run test:egress
npm run test:runner
npm run test:resolver
npm run test:http
npm run test:ipv6
npm run test:ipv6:routed
npm run metrics:local
```

`check` verifica sintaxe JavaScript; não é um lint ou typecheck. `test` verifica lógica e contratos sobre D1 simulado pelo workerd/Miniflare. `build` executa Wrangler com `--dry-run`: empacota sem publicar. `test:ui` exige Microsoft Edge instalado e inicia seu próprio servidor no loopback, porta 8877, com D1 isolado por execução; não depende do servidor de uso manual nem consome suas quotas. Exercita a interface, sem usar Chromium como scanner. `test:upstream` exige Docker Linux, OpenSSL no host (no Windows, aceita o OpenSSL do Git) e a imagem candidata baixada; roda somente contratos contra fixtures isoladas, com `--network none`, sem porta publicada. Não substitui G2.

Antes do teste upstream, baixar a imagem candidata registrada em `executor/upstream.research.json`: `docker pull ghcr.io/lissy93/web-check@sha256:ce8c90602e533bb3f45bc0e445a6c02040190a49e1d4e85389492dcb3a2b9c6d`. O verificador confere a revisão declarada na imagem. Certificado e chave sintéticos são gerados temporariamente em diretório ignorado e removidos após o teste; não são credenciais de produção.

Os relatórios agregados dos ensaios Docker ficam em `test-results/*.json`. O navegador usa `test-results/browser/` para não apagar essas evidências ao limpar seu próprio diretório de saída. Todos são artefatos sintéticos locais ignorados pelo Git, sem diagnósticos reais.

A reconciliação agendada não dispara automaticamente no Wrangler local. Pode ser acionada pelo endpoint local documentado pelo Wrangler: `http://127.0.0.1:8787/cdn-cgi/local/scheduled`. A consulta pública do resultado nunca inicia coleta. Se o processo morrer durante uma demonstração, o reconciliador recupera a intenção sintética ou encerra o job no prazo.

O D1 local está em `.wrangler/`, ignorado pelo Git. Migrações não usam `--remote`. O UUID zerado em `wrangler.jsonc` é um identificador exclusivamente local, não um recurso provisionado.

## Limite de exposição

O Worker devolve 503 para novas análises fora do modo local, inclusive se alguém definir `PUBLIC_ADMISSION=true`. O supervisor de linha de comando devolve `EXECUTOR_REVIEW_REQUIRED` e não inicia Web-Check. Há runner e resolvedor implementados e testados em laboratório, mas faltam ligação da resolução pública, configuração revisada e os gates restantes. Isso é um bloqueio efetivo, não um teste de segurança aprovado.

Há componentes testáveis para envio/claim/callback/ack, verificação Turnstile, adaptação de evidência e transporte HubSpot. Eles ainda não formam um caminho público de produção. Abrir esse caminho requer implementação e comprovação do guardião P2, revisão dos contratos/parâmetros e conexão das integrações nas condições aprovadas. Não basta trocar uma variável.

`hubspotTransport` exige mapeamento explícito e identificador externo. O scheduler não o instancia. `drainLeads` reserva a intenção antes do I/O e encaminha resposta ambígua para revisão manual, evitando retry cego. A escolha entre contato, objeto de pedido e associação, bem como propriedades únicas, scopes e compatibilidade do plano, permanece P4. A exclusão remota também depende desse contrato; nenhuma exclusão real foi executada.

## Cobertura por requisito

| Requisito | Implementação local | Evidência e pendência |
|---|---|---|
| RF-01 | Normalização servidor/browser, IDNA, esquema/porta, classificação IPv4/IPv6 e resolvedor/reservas DNS/peer | Contratos e DNS TCP em contêiner sem rede; firewall com fixtures internas. Resolução/conexões públicas e G2 pendentes |
| RF-02 | Contadores atômicos por sessão, hostname, domínio registrável e orçamento diário; helper Siteverify | Concorrência SQLite, PSL e respostas simuladas; widget/fluxo real, pseudônimo rotativo, limites e benchmark em G3 |
| RF-03 | D1, intenção de publicação, chave vinculada à sessão e ao corpo | Corridas e falha da fila testadas; conta Cloudflare e ponta a ponta remota em G4 |
| RF-04 | Cinco estados, polling com backoff/jitter, retomada e parada no terminal | Testes HTTP/browser; revisão humana de todos os estados em G7 |
| RF-05 | Allowlist, guardião/runner e adaptador HTTP; DNS reservado, nftables, expiração, orçamento, prazo, NDP/fragmentos IPv6 e leitura limitada de body | Ensaios internos IPv4/IPv6 on-link/roteado e HTTP/gzip sem rede; resolução pública, PMTU, VM e revisão ainda em G1/G2 |
| RF-06 | Contrato estrito, minimização, adaptação por versão pesquisada | Casos sintéticos de erro/anti-bot/DNS; fidelidade do motor e proveniência real em G1/G5 |
| RF-07 | Fórmula/eligibilidade v1, regras essenciais, cobertura e nota nula | Exemplos da spec automatizados; pesos, elegibilidade DNS e semântica ainda propostos em P6 |
| RF-08 | Prioridades determinísticas por severidade/peso/ID, máximo três | Testes de relatório; revisão técnica de interpretação em G5 |
| RF-09 | CTA exato e resultado independente do formulário | Jornada browser sem login/contato obrigatório; revisão comercial em G6/G7 |
| RF-10 | Consentimento, resumo derivado do job, recibo D1, dedup e aliases de chave | Corridas locais e transporte simulado; texto, mapping e conta real em G6 |
| RF-11 | Bloqueio público, lease/retry/deadline; intenção CRM independente | Falhas controladas locais; admissão por saúde real e capacidade em G3/G4 |
| RF-12 | Sessão opaca, hash de acesso/lease, 404 cruzado, retenção e exclusão ativa | D1 local; política final, cookies/rotação, logs externos, backup/restore e exclusão CRM em G8 |
| RF-13 | Eventos deduplicados, agregados por modo/coorte UTC, p50/p95 e cálculo explícito de funil/custo | Consultas locais sobre dados retidos; fontes comerciais, CPU/RAM, custos reais, retenção e responsáveis em G9 |

## Pendências que exigem ambiente ou revisão

| ID | Próxima evidência necessária | Estado |
|---|---|---|
| P1 | Pull/ack real na conta e reconciliação D1/Queue sob queda | Proposto; transporte local testável |
| P2 | Guardião sem fork/MITM: default-deny, DNS controlado, peer, redirects, bytes/descompressão, isolamento de processo e evidência de egress | Laboratórios IPv4/IPv6 on-link/roteado; resolução e conexão públicas, PMTU/topologias adicionais, descompressão em VM e limites finais pendentes |
| P3 | Pin aprovado, correspondência imagem/revisão, arm64 nativo, Oracle ou fallback e recuperação | Condicional; digests de pesquisa registrados, sem VM provisionada |
| P4 | Consentimento/privacidade/retenção, modelo CRM, unique property, scopes, resposta ambígua e exclusão na conta de teste | Proposto; adaptador desconectado do scheduler |
| P5 | Revisão dos contratos, sessão, rotação de chaves, leases e limites | Proposto; implementação local para revisão |
| P6 | Revisão técnica da fórmula e condições, severidades, cobertura e risco de falsa confiança | Proposto; implementação local não é aprovação |
| P7 | Limites de carga, quotas/custos, retenção, cache e limiares de saúde | Pendente; `LOCAL` contém apenas parâmetros de demonstração |
| P8 | Donos de gates e apuração de propostas/contratos/margem/custos | Pendente; não há automação comercial ou meta nova |

## Operação e recuperação propostas

Manter o serviço fechado até a revisão e G1–G9. Para uma futura migração: suspender admissão, revogar a credencial do executor anterior, reconciliar leases, preservar D1, instalar o mesmo artefato/política no fallback, injetar segredos fora do motor, repetir os testes de rede/contrato, verificar heartbeat e só então reabrir. Ainda não foi ensaiado em Oracle/Hetzner.

Uma atualização upstream exige nova revisão de allowlist, fixtures e G2. O upstream pesquisado deixa `get-ip` habilitado apesar de `API_ENABLED_CHECKS`; por isso a configuração candidata também define `API_DISABLED_CHECKS=get-ip`. Não usar `/api` agregado nem instancia pública como fallback. Headers retornados pela API não carregam status/redirect/proveniência suficientes para aprovar transporte.

Os eventos e consultas em `scripts/metrics.sql` não selecionam contatos ou relatório. Retenção de métricas e amostragem precisam de aprovação. `funnelMetrics` calcula apenas números fornecidos; não atribui qualificação, proposta, contrato ou margem ao CRM por inferência.

O classificador candidato em `executor/address-policy.mjs` usa ipaddr.js e blocos especiais IANA consultados em 07/11/2026. Bloqueia conservadoramente todos os blocos especiais, inclusive serviços especiais globalmente alcançáveis, multicast, mapeamentos e túneis; aceita IPv6 somente no espaço unicast global considerado. Não é um firewall, resolvedor ou autorização para acessar os endereços usados nos testes puros. A escolha e atualização dessa política continuam em P2. O agrupamento de quota usa tldts com sufixos privados, sem equiparar tenants distintos de uma plataforma; atualização da PSL e política final continuam sujeitas a revisão.

A interpretação de CSP implementa um subconjunto conservador: diretivas ou tokens não interpretáveis tornam a regra inconclusiva, mesmo quando uma política válida poderia ser aceita por um navegador. HSTS com múltiplos max-age também fica inconclusivo. Nenhuma dessas regras audita eficácia ou demonstra exploração. Cada achado separa observação, interpretação limitada, confiança descritiva e recomendação.

O [guardião candidato](guardian.md) implementa geração nftables e DNS limitado em componente separado do motor. `npm run test:egress` cria e remove um laboratório interno com fixtures em faixa de documentação e testa bloqueios, certificados TLS sem MITM, orçamento de rede e expiração no kernel. A CLI real continua bloqueada: esse teste não é o runner de produção, nem aprova G2.

O [runner candidato](runner.md) implementa ciclo de vida, execução por digest/revisão, retorno filtrado, prazo rígido, watchdog separado e limpeza por ownership. `npm run test:runner` acrescenta o caminho D1 local → motor isolado → callback → ack simulado, falhas de processo e OOM. O caminho remoto e a resolução original continuam pendentes.

O [resolvedor candidato](resolver.md) exige IP público literal e limites explícitos, consulta CNAME/A/AAAA e reserva pelo menor TTL, sem fallback para DNS do sistema. `npm run test:resolver` usa somente DNS de fixture em loopback de contêiner `network=none`; exige a imagem local do guardião criada por um dos laboratórios anteriores. Escolha do resolvedor, ligação ao runner e tráfego público não estão comprovados.

O [adaptador HTTP candidato](http-adapter.md), registrado como Proposto no ADR-008, fornece fetch limitado ao coletor sem alterar arquivos upstream. `npm run test:http` usa CA temporária e fixtures em contêiner sem rede; exercita status real, HTTP→HTTPS, interstitial, redirects, gzip e prazo. Limites, semântica e uso em produção ainda exigem revisão, sem substituir o firewall externo.

[Métricas locais](metrics.md): `npm run metrics:local` executa somente SELECTs no D1 local. Mostra contagens, modo sintético/real, coortes UTC e percentis da fila/terminal; não seleciona identificadores ou contatos. São linhas retidas, não histórico comercial após exclusões. Custos, CPU/RAM, conta e fontes comerciais continuam pendentes.

[IPv6 candidato](ipv6.md): `npm run test:ipv6` constrói laboratório interno sem IPv4, exercita 21 casos de NDP/peers/quotas/expiração/fragmentos e roda o motor intacto pelo runner. `npm run test:ipv6:routed` acrescenta nove casos entre duas bridges internas por um gateway, com rotas específicas e serviço do gateway bloqueado. A política passou a `network-v1-proposal`, ainda sujeita a revisão. Contexto de enlace e rota são derivados do kernel; não são parâmetros do visitante. PMTU, policy routing/VRF, VM e caminhos públicos não foram comprovados.
