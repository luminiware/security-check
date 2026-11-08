# Luminiware Security Check

Diagnóstico gratuito de segurança de websites, integrado à [Luminiware](https://luminiware.com/), para ajudar donos de sites e PMEs a entender problemas e solicitar correção profissional.

**Domínio → análise → nota e cobertura → até três prioridades → recomendações → “Precisa de ajuda para corrigir?”**

O diagnóstico não exige login nem contato. O pedido de ajuda é opcional, mediante consentimento. A nota descreve verificações limitadas: não garante segurança nem comprova automaticamente uma vulnerabilidade.

## Estado do projeto

Baseline de documentação. Não há produto implementado, serviços provisionados, benchmarks ou testes de segurança executados neste repositório. Detalhamentos novos estão identificados como propostas; o merge deste PR não os converte automaticamente em decisões aprovadas.

## Arquitetura decidida

Frontend estático e gateway Worker na Cloudflare, D1 para estado e resultados resumidos, Queues para execução assíncrona. Web-Check upstream sem fork, isolado em um executor substituível. Oracle Always Free é a primeira opção **condicional** à capacidade, compatibilidade Arm e validação operacional; Hetzner é o fallback reproduzível. Não há dois servidores obrigatórios, alta disponibilidade ou failover automático no MVP.

Cloudflare-first é uma decisão arquitetural; custo zero e viabilidade operacional não estão garantidos. O mecanismo proposto de consumo HTTP da fila tem suporte documental, mas ainda depende de teste integrado.

## Leitura

| Documento | Conteúdo principal |
|---|---|
| [Especificação](docs/spec.md) | Jornada, requisitos, scoring proposto, métricas e critérios de lançamento |
| [Arquitetura](docs/architecture.md) | Contratos propostos, estados, dados, segurança e operação |
| [ADRs](docs/decisions/README.md) | Decisões preservadas, alternativas e condições de revisão |
| [Fontes](docs/sources.md) | Evidência, consulta ao upstream e pendências |
| [AGENTS.md](AGENTS.md) | Instruções para contribuir |

## Escopo

Inclui entrada de domínio, verificações passivas selecionadas, normalização, scoring, recomendações, CTA e captura opcional de lead com HubSpot planejado. A implementação depende dos critérios de lançamento da spec.

Ficam fora: login, dashboard complexo, assinaturas, pagamentos, pentest, agentes de IA, monitoramento contínuo, PDF obrigatório, Kubernetes e banco separado de D1. Cloud Run, Cloudflare Containers e interface avançada do Web-Check estão adiados.

## Verificação desta baseline

Somente Markdown. Há verificação disponível de whitespace com `git diff --check`; não existem comandos de build ou teste de aplicação. Links, exemplos JSON, rastreabilidade e diagramas devem ser conferidos ao editar a documentação. Veja as limitações registradas em [fontes](docs/sources.md).
