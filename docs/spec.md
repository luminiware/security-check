# Especificação do MVP

## 1. Evidência e objetivo

**Decidido:** produto e limites descritos na fonte S1 e no pedido S2, registrados em [fontes](sources.md). **Proposto:** identificadores, critérios detalhados, apresentação, fórmulas e parâmetros deste documento. Os critérios operacionalizam decisões, mas não comprovam implementação. A revisão deve aceitar ou ajustar as propostas antes de codificá-las como política de produção.

O problema é a distância entre observações técnicas e decisões de um dono de site. O diagnóstico deve explicar o que foi observado, o que isso pode significar e como corrigir. Público: donos de sites e PMEs; técnicos acessam detalhes expansíveis.

O funil é diagnóstico → problemas → recomendações → pedido de ajuda → proposta → contrato. Hipóteses comerciais a validar: o diagnóstico produz pedidos qualificados; as correções têm escopo e margem viáveis; manutenção recorrente pode ser uma expansão posterior. Não há meta de conversão aprovada nem promessa de contratação.

## 2. Fronteira

**Decidido:** gratuito, sem login e sem contato obrigatório. Apenas observações externas selecionadas de HTTP, TLS, headers, DNS e tecnologias quando apropriado. “Passivo” aqui significa requisições e consultas limitadas, sem exploração; não significa ausência de tráfego ao site. Não testa aplicação autenticada, código, infraestrutura interna ou todos os caminhos do domínio.

Inclui análise, normalização, nota explicável, até três prioridades, recomendações, CTA e captura opcional de lead. HubSpot é integração planejada para o MVP, condicionada à configuração e validação do fluxo consentido.

**Adiado/fora do MVP:** login, dashboard complexo, pagamentos, assinaturas, pentest, agentes de IA, monitoramento contínuo, PDF obrigatório, Kubernetes, Redis/Postgres separado, Cloud Run e Cloudflare Containers. Interface avançada upstream é opcional e preferencialmente restrita. Sem port scanning, traceroute, screenshot ou Chromium por padrão. O endpoint `tech-stack` usa Chromium no upstream consultado; proposta: desativá-lo inicialmente, sem substituir por um detector próprio só para preencher a categoria.

## 3. Jornada e interface

**Proposto:** página em `luminiware.com/security`, campo domínio, breve explicação do alcance e botão “Analisar site”. Mostrar o alvo normalizado antes de iniciar; informar que o scanner acessará apenas o website público. Sem checkbox comercial para liberar diagnóstico.

| Situação | Comportamento e mensagem proposta |
|---|---|
| Entrada inválida ou destino proibido | Erro junto ao campo; preservar texto; não criar execução nem revelar IP interno resolvido |
| Turnstile inválido/expirado | Solicitar nova validação; não consumir quota de execução |
| Sem capacidade ou orçamento | “Análises temporariamente indisponíveis”; não aceitar job que não poderá ser atendido |
| Limite excedido | Explicar limite temporário e quando tentar; respeitar `Retry-After` |
| Aguardando | Mostrar “Na fila”, início e prazo; sem porcentagem ou ETA inventados |
| Executando | Mostrar fase e contagem concluída/prevista, sem inferir segurança |
| Falha de rede na consulta | Manter ID local e oferecer retomar consulta; não criar outro job automaticamente |
| Resultado completo | Nota, cobertura, até três prioridades, recomendações e evidências expansíveis |
| Resultado parcial | Cobertura e limitações em destaque; nota suprimida conforme seção 5 |
| Nenhuma evidência suficiente | “Análise inconclusiva”; sem nota e sem selo positivo |
| Falhou/expirou | Motivo compreensível e opção de nova tentativa sujeita às quotas; não exibir aprovação |
| Relatório removido por retenção | Informar expiração; não confundir com falha do site |

Mobile e desktop, teclado, foco visível, rótulos de formulário e anúncios acessíveis de mudança de estado. Não depender de cor para gravidade. Detalhes expansíveis preservam título, evidência, horário, alvo e limite da interpretação. Abertura do CTA não oculta resultado.

## 4. Requisitos e aceitação

Estado dos requisitos: intenção **Decidida** em S1/S2; critérios de teste **Propostos**. Arquitetura e gates indicados nas duas últimas colunas.

| ID | Comportamento | Critério de aceitação futuro | Arquitetura/ADR | Gate |
|---|---|---|---|---|
| RF-01 | Receber domínio e normalizar | Casos válidos geram alvo canônico; esquemas, portas e destinos proibidos não geram tráfego de scan | arquitetura §5; ADR-004 | G2 |
| RF-02 | Proteger admissão | Turnstile validado no servidor, quotas e orçamento aplicados; 429/503 não criam job executável | arquitetura §3, §5 | G3 |
| RF-03 | Criar análise assíncrona | 202 após persistência; duplicata com mesma chave/corpo retorna mesmo job; consulta não inicia scan | arquitetura §3–4; ADR-005 | G4 |
| RF-04 | Exibir progresso verdadeiro | Todos os estados terminais e não terminais têm tela; polling interrompe no terminal; sem progresso fictício | arquitetura §4 | G4, G7 |
| RF-05 | Coletar apenas allowlist | Contadores de rede provam ausência de portas extras, Chromium, crawling e APIs externas não permitidas | arquitetura §2, §5; ADR-001/004 | G1, G2 |
| RF-06 | Normalizar evidência | Erro, skip, timeout e resposta malformada nunca viram check aprovado; fixture por versão upstream | arquitetura §2–3 | G1, G5 |
| RF-07 | Exibir nota explicável | Mesma evidência e versões produzem mesma nota; cobertura insuficiente suprime número; fórmula da seção 5 testada | spec §5 | G5 |
| RF-08 | Selecionar até três prioridades | Ordenação determinística, sem duplicatas de causa; evidência e ação acessíveis; sem chamar ausência de header de exploração | spec §5 | G5, G7 |
| RF-09 | Oferecer ajuda opcional | CTA exato “Precisa de ajuda para corrigir?”; resultado utilizável sem formulário | spec §6 | G6, G7 |
| RF-10 | Capturar lead consentido | Sem consentimento não envia CRM; aceite só depois de D1 durável; repetição não multiplica lead | arquitetura §3, §6 | G6 |
| RF-11 | Comunicar degradação | Sem executor saudável bloqueia admissão; falha do CRM não apaga lead nem altera análise | arquitetura §6 | G4, G6 |
| RF-12 | Limitar retenção e acesso | Token inválido não lê relatório; exclusão remove dados ativos e invalida acesso/cache; logs sem contato ou token | arquitetura §3, §5–6 | G8 |
| RF-13 | Medir funil e custo | Duplicatas não inflam iniciadas/concluídas; propostas/contratos e margem têm origem identificada | spec §7 | G9 |

## 5. Evidências, cobertura e scoring

### 5.1 Classificação

**Decidido:** `confirmado`, `suspeito`, `inconclusivo`. **Proposta de semântica:**

| Dimensão | Valores e regra |
|---|---|
| Estado do job | `pendente`, `executando`, `concluído`, `falhou`, `expirou`; ciclo de execução, não avaliação de segurança |
| Coleta por verificação | `ok`, `erro`, `timeout`, `bloqueado`, `não_executado`; `ok` significa dado interpretável, não segurança aprovada |
| Classificação do achado | `confirmado`: evidência direta e validada da observação; `suspeito`: inferência que precisa de contexto; `inconclusivo`: evidência insuficiente/contraditória |
| Avaliação por regra | `adequado`, `atenção`, `inconclusivo`, `não_aplicável`; distinta da coleta |
| Cobertura | Peso de regras avaliáveis dividido pelo peso aplicável da política fixada |

“Header CSP ausente” pode ser uma observação confirmada. “Há XSS explorável” não decorre dessa ausência. Tecnologia detectada não prova versão nem CVE; registro DNS vazio pode ser erro mascarado pelo upstream. Falha de coleta não equivale a aprovação.

Cada achado terá observação, evidência mínima, interpretação limitada, confiança, severidade e recomendação. Exemplo: “HSTS não apareceu na resposta HTTPS final” → “Navegadores podem não receber uma instrução de forçar HTTPS; requer avaliar compatibilidade” → “Revisar HTTPS de todos os subdomínios antes de ativar políticas abrangentes”. Não sugerir `includeSubDomains` ou preload sem avaliação.

### 5.2 Fórmula e elegibilidade propostas v1, ainda não aprovadas

Não usar o scoring upstream como contrato do produto. A revisão `score-v1-proposal` conserva os pesos e a fórmula v0 e acrescenta elegibilidade DNS explícita, conforme abaixo. A versão v0 anterior não é aceita silenciosamente pelo código atual. Pesos somam 100. A política fixa o conjunto antes da coleta, impedindo remover uma regra que falhou para melhorar a cobertura. A versão v1 também exige revisão P6, sem aprovação por existência de código.

| Regra | Peso | Condição de atenção observável | Severidade proposta |
|---|---:|---|---|
| TLS-IDENTITY | 35 | Certificado vencido, identidade/cadeia inválida com evidência validada | Alta |
| HTTPS-TRANSPORT | 25 | HTTP público não conduz a HTTPS válido no orçamento de redirecionamentos | Média |
| HSTS | 15 | Diretiva ausente/inválida na resposta HTTPS final | Baixa |
| CSP | 10 | Política ausente; presença apenas não comprova eficácia | Baixa |
| NOSNIFF | 10 | `X-Content-Type-Options: nosniff` ausente/inválido | Baixa |
| REFERRER | 5 | `Referrer-Policy` ausente ou explicitamente permissiva na política revisada | Baixa |

DNS auxilia a observação e elegibilidade de rede, sem penalizar MX/TXT ausentes para qualquer website. Tecnologia é informativa, peso zero. Avaliar CSP sintaticamente não equivale a auditoria; política incompreensível gera inconclusivo em vez de “adequado”. Proposta de relevância e limiares precisa de revisão técnica.

Defina A como soma dos pesos aplicáveis e E como soma dos pesos avaliáveis. Cobertura C = E/A. Ausência de HTTPS torna TLS/headers HTTPS **inconclusivos**, não automaticamente não aplicáveis. `não_aplicável` exige regra determinística da política com motivo; não pode ser escolha do executor.

Para cada regra avaliável, déficit d = 0 quando adequada, 1 quando atenção confirmada, 0,5 quando atenção suspeita; inconclusivas ficam fora de E. Nota N = arredondar(100 × (1 − soma(peso × d)/E)), limitada a 0–100. Os fatores de confiança são convenções revisáveis, não probabilidades estatísticas. Exibir número **somente se C ≥ 80% e TLS-IDENTITY e HTTPS-TRANSPORT forem avaliáveis**. Caso contrário, `score: null` e “Cobertura insuficiente para calcular a nota”. Até com nota, mostrar “Parcial” se C < 100%.

Detalhamento **Proposto em P6** para cumprir a proibição de nota positiva por falha DNS: a coleta DNS precisa ter observação útil antes de exibir qualquer número. DNS continua sem peso e não altera C ou o déficit. Se falhar com regras avaliáveis, suprimir a nota, marcar “Parcial” e explicar “Coleta DNS inconclusiva; nota não calculada”. Exibir o estado de todas as quatro coletas nos detalhes, inclusive as informativas. Esse caso pode ter C=100% das regras e continuar sem nota; não inferir ausência de registros ou vulnerabilidade.

Nota sempre acompanha horário, cobertura, versão e aviso “Esta nota considera apenas as verificações realizadas. Não garante que o site seja seguro.” Não chamar 100 de “site seguro”. Falha DNS ou de conexão nunca gera nota 100.

Prioridades: incluir apenas achados de atenção acionáveis; ordenar severidade alta → média → baixa, classificação confirmada → suspeita, maior peso, depois ID lexical. Deduplicar por causa/regra; no máximo três. Inconclusivos aparecem em limitações com próximo passo de coleta, sem afirmação de vulnerabilidade. Nunca preencher três cartões artificialmente.

### 5.3 Exemplos sintéticos de aceitação

| Caso | Evidência | Resultado esperado pela proposta |
|---|---|---|
| Completo | Seis regras avaliadas; HSTS e CSP ausentes, outras adequadas | C=100%; N=75; duas prioridades baixas; ausência confirmada, exploração não demonstrada |
| Parcial suficiente | REFERRER em timeout; outras adequadas | E=95, C=95%, N=100, selo “Parcial”, 5% não verificados; aviso visível |
| Parcial insuficiente | Só TLS e transporte avaliáveis, adequados | E=60, C=60%, sem nota; sem selo positivo; explicar quatro regras não avaliadas |
| Inconclusivo | DNS/HTTP bloqueados ou timeout, nenhum dado útil | C=0%, sem nota, limitações e nova tentativa; job `falhou` se falha técnica, conforme arquitetura |
| Falha de identidade | TLS inválido comprovado; demais regras inconclusivas | Sem nota por cobertura; prioridade alta sobre identidade com evidência; nunca chamar ausência de dados de aprovação |
| Falha DNS informativa | Seis regras avaliáveis, mas coleta DNS em erro/timeout | C das regras não muda; nota suprimida, “Parcial” e limitação DNS explícita; nenhuma prioridade DNS inventada |

Esses exemplos definem a especificação proposta. A implementação experimental cobre os seis casos com testes sintéticos; isso não aprova a fórmula, o detalhamento de elegibilidade DNS ou comprova coleta real. Evidência e limites em [implementação](implementation.md).

## 6. Pedido de ajuda

**Proposto:** nome opcional, e-mail de contato obrigatório, intenção curta opcional e consentimento explícito, não pré-marcado, para enviar contato e resumo do diagnóstico à Luminiware/HubSpot para responder ao pedido. Texto final, aviso de privacidade e retenção de contatos dependem de revisão humana. Não incluir aceite de marketing nem inscrição recorrente por padrão.

Worker vincula domínio e resumo ao job autorizado, sem confiar no resumo enviado pelo browser. Só enviar campos mínimos e consentidos: contato, domínio, ID/horário, prioridades, intenção e versão do consentimento. Sem IP do visitante, cookies ou corpo bruto do site no CRM. Se o diagnóstico expirou, não aceitar referência silenciosamente quebrada; pedir nova análise ou contato sem anexar diagnóstico, se esse fluxo for aprovado posteriormente.

D1 confirma recebimento durável. CRM indisponível: “Recebemos seu pedido; o encaminhamento está pendente”, nunca “enviado ao CRM” antes da confirmação. Reenvio e reconciliação limitados estão na arquitetura. A proposta comercial exige avaliação técnica e escopo; não há orçamento automático nem promessa de correção de tudo.

## 7. Métricas

**Decidido:** medir análises → leads → propostas → contratos → margem. **Proposto:** eventos deduplicados pelo ID, sem rastreadores novos obrigatórios.

| Indicador | Definição e origem |
|---|---|
| Iniciadas | Job novo persistido e admitido; separar pedidos, rejeições e cache hits |
| Concluídas | Primeiro terminal `concluído`; segmentar completo/parcial e com/sem nota |
| Falhas/expiradas | Terminais por motivo, sem contar retry como análise nova |
| Leads | Pedido consentido persistido; separar sincronizados, pendentes e qualificados por avaliação humana |
| Propostas e contratos | Registro comercial no CRM ou apuração manual vinculada ao lead; sem automação de pipeline neste PR |
| Margem | Receita recebida menos custos diretos de execução e entrega; critério contábil pendente |
| Conversão | Leads/iniciadas e leads/concluídas, propostas/leads qualificados, contratos/propostas; manter janela/coorte e denominadores |
| Custo por etapa | Gasto atribuível/quantidade de diagnósticos, leads qualificados e contratos; mostrar “sem denominador” quando zero |
| Serviço | Espera e duração p50/p95, erros, timeouts, cobertura, CPU/RAM e indisponibilidade |

Custo inclui VM, IPv4 quando cobrado, rede, armazenamento, operações Cloudflare, retentativas, observabilidade e esforço operacional separado. Sem metas numéricas aprovadas. Não inferir sucesso comercial só pelo tráfego.

Método local **Proposto em P7/P8**: [consultas](metrics.md) por modo sintético/real e coorte UTC de criação do job, com percentis nearest rank e contagem de amostras. Espera inicial termina no primeiro claim; total vai ao terminal. A fonte atual são linhas retidas, não uma série comercial após exclusões. Fontes comerciais, CPU/RAM, custos, agregação/retenção e coleta periódica permanecem pendentes.

## 8. Gates de lançamento

Todos **pendentes**, exceto evidência documental indicada em fontes. O responsável técnico valida G1–G5/G8; o responsável de produto/comercial revisa G6/G7/G9 e aprova parâmetros e orçamento. Pessoas e datas ainda não atribuídas. Nenhum gate é satisfeito apenas por este PR.

| Gate | Evidência necessária | Cobertura |
|---|---|---|
| G1 — motor | Versão/digest escolhidos, manifesto arm64 e execução nativa; contratos HTTP/TLS/DNS comparados com alvos controlados | RF-05/06; ADR-001/003 |
| G2 — rede | Testes de normalização, IPv4/IPv6, rebinding, redirect, metadata e IP conectado; captura de egress sem bypass | RF-01/05; ADR-004 |
| G3 — limites | Benchmark p95/CPU/RAM e ensaios de quota concorrente, Turnstile, orçamento e indisponibilidade; aprovar todos os limites | RF-02; ADR-002 |
| G4 — durabilidade | Fluxo real Worker/D1/Queues/executor; duplicação, queda entre passos, lease perdido, callback tardio e reconciliação; migração testada Hetzner | RF-03/04/11; ADR-003/005 |
| G5 — interpretação | Fixtures sintéticas por versão, erro HTTP com body 200 upstream, bloqueio anti-bot, DNS vazio, scoring e prioridades revistos | RF-06/07/08 |
| G6 — comercial | Consentimento/texto/mapeamento CRM aprovados; teste de indisponibilidade e retorno ambíguo sem spam/duplicação | RF-09/10/11 |
| G7 — UX | Revisão mobile/desktop e teclado, todos os estados, até três prioridades, cobertura/aviso e CTA sem contato obrigatório | RF-04/08/09 |
| G8 — dados | Retenções aprovadas; teste de exclusão, expiração de acesso, limpeza de logs/cache e restauração com reaplicação de exclusões | RF-12 |
| G9 — viabilidade | Plano/cotas e orçamento confirmados na conta/região; eventos e custos reconciliáveis com funil; decidir Oracle ou fallback | RF-13; ADR-002/003 |

Riscos: capacidade Oracle, controles externos insuficientes para upstream, coleta enganosa por WAF, scoring superficial, duplicação de jobs/leads, abuso e custos. Pendências e sequência mínima de implementação estão em [fontes](sources.md); não são autorização para provisionamento neste PR.

## 9. Implementação experimental para revisão

Há uma jornada executável local, com contratos e migrações próprios, conforme [cobertura RF-01–RF-13](implementation.md). Ela não abre admissão pública nem envia leads ao CRM. Usa os parâmetros `LOCAL` para demonstração; P1–P8 e os gates desta seção continuam sujeitos à evidência e revisão. RF-05 não é considerado satisfeito por uma allowlist em código, e helpers de integração desconectados não comprovam RF-02/RF-10 em produção.

Extensões propostas do contrato: `GET /api/v1/config` estabelece sessão e informa disponibilidade; `DELETE /api/v1/analyses/{id}` remove dados ativos da sessão autorizada. Retenção local usa tombstone temporário para distinguir 410 de 404, sem exibir o relatório removido. Essas extensões estão descritas na arquitetura e no ADR-006; aprovação final de G8 permanece pendente.

RF-01/RF-05 têm também um [candidato de guardião](guardian.md), registrado como Proposto no ADR-007. Os ensaios de firewall/DNS usam apenas fixtures em rede Docker interna; não substituem o gate de egress público, rebinding, IPv6 roteado, redirects e bytes descomprimidos no ambiente selecionado.

Em 08/11/2026, o [runner candidato](runner.md) acrescentou montagem e limpeza por job, prazo rígido, watchdog independente e reaper. Os ensaios locais cobrem processo travado, descendente e perda do processo supervisor, ligados a claim/result D1 e ack simulado. Isso avança RF-03/RF-05/RF-06/RF-11 sem declarar G2/G4 encerrados ou aprovar parâmetros de produção.

RF-01/RF-05 contam também com [resolvedor candidato](resolver.md), testado por contratos e DNS TCP em contêiner sem rede externa, e com OOM/limpeza exercitados no runner. Resolução pública original, escolha/configuração do resolvedor, conexão de produção e os gates restantes permanecem pendentes.

RF-05/RF-06 receberam um [adaptador HTTP candidato](http-adapter.md), Proposto no ADR-008, para limitar redirects/body e observar status, interstitial e HTTP→HTTPS antes da interpretação. A imagem upstream permanece intacta. Ensaios isolados cobrem gzip e erro de alvo sob API 200; revisão do desenho/semântica/limites e validação de produção continuam pendentes.

O callback experimental `normalized-v2-proposal` exige o protocolo observado em headers (`final_https`), sem confundi-lo com o esquema digitado. O relatório mantém as versões do job nos detalhes técnicos. O campo, o versionamento incompatível com o callback anterior e sua política de atualização permanecem Propostos em P5/ADR-008; testes locais não são aprovação do contrato.

RF-01/RF-05 receberam ainda [IPv6 candidato](ipv6.md), em `network-v1-proposal`: NDP restrito ao enlace reservado, quota/expiração e rejeição antecipada de fragmentos. Vinte e um casos on-link e nove roteados usam somente documentação RFC3849 em redes internas, sem IPv4 ou scan público. A seleção por prefixo/métrica rejeita ambiguidades; o gateway tem função NDP, sem permissão para seus serviços. Os critérios do ensaio roteado incluem controles positivos e zero requests a peer/porta/serviço não permitidos. Gate G2 continua pendente para tráfego público/PMTU, DNS original/rebinding, ambiente selecionado e revisão do desenho; não há aprovação implícita da nova política.
