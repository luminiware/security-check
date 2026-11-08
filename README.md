# Luminiware Security Check

Diagnóstico gratuito de segurança de websites, integrado à [Luminiware](https://luminiware.com/), para ajudar donos de sites e PMEs a entender problemas e solicitar correção profissional.

**Domínio → análise → nota e cobertura → até três prioridades → recomendações → “Precisa de ajuda para corrigir?”**

O diagnóstico não exige login nem contato. O pedido de ajuda é opcional, mediante consentimento. A nota descreve verificações limitadas: não garante segurança nem comprova automaticamente uma vulnerabilidade.

## Estado do projeto

Implementação experimental local: frontend responsivo, Worker, migrações D1, contratos de jobs, normalização, scoring proposto, leads consentidos e componentes de integração. A jornada usa evidências sintéticas e não acessa o domínio digitado. A admissão pública e o executável de scan permanecem bloqueados enquanto os gates de rede, motor, conta e revisão estiverem pendentes. Nenhum serviço foi provisionado ou CRM alterado.

Contratos, parâmetros e scoring ainda identificados como propostas não se tornam aprovados por terem código ou testes. Consulte a [cobertura por requisito e as pendências](docs/implementation.md).

## Executar localmente

Com Node 22.19 ou superior:

```powershell
npm ci
npm run db:migrate
npm run dev
```

Abra `http://127.0.0.1:8787/security`. Use `example.com`, `example.org` ou `example.net`. Os cenários são sintéticos e os contatos de demonstração ficam somente no D1 local.

```powershell
npm run check
npm test
npm run build
```

`build` é um dry run, sem deploy. Para testar a interface: `npm run test:ui` (Microsoft Edge; servidor/D1 de teste isolados são iniciados automaticamente). Para os contratos do motor em contêiner isolado: `npm run test:upstream` (Docker Linux, OpenSSL e imagem candidata). Preparação, limites e recuperação em [implementação](docs/implementation.md).

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
| [Implementação](docs/implementation.md) | Execução local, cobertura RF-01–13, integrações e bloqueios |
| [Verificação](docs/verification.md) | Resultados executados e limites por gate |
| [Checkpoint de 08/11/2026](docs/checkpoint-2026-11-08.md) | Status consolidado, evidência, bloqueios e próximos passos para revisão |
| [Guardião candidato](docs/guardian.md) | Namespace, firewall/DNS e laboratório de egress isolado |
| [Guardião IPv6](docs/ipv6.md) | Controle NDP, fragmentos, ensaios on-link/roteado e limites |
| [Runner candidato](docs/runner.md) | Ciclo de vida, prazo rígido, watchdog e ensaio D1/motor |
| [Resolvedor candidato](docs/resolver.md) | CNAME/A/AAAA, TTL e transporte DNS controlado |
| [Adaptador HTTP candidato](docs/http-adapter.md) | Status/redirects, interstitial e limites de body |
| [Métricas locais](docs/metrics.md) | Contagens, coortes UTC, p50/p95 e limites do denominador |
| [AGENTS.md](AGENTS.md) | Instruções para contribuir |

## Escopo

Inclui entrada de domínio, verificações passivas selecionadas, normalização, scoring, recomendações, CTA e captura opcional de lead com HubSpot planejado. A implementação depende dos critérios de lançamento da spec.

Ficam fora: login, dashboard complexo, assinaturas, pagamentos, pentest, agentes de IA, monitoramento contínuo, PDF obrigatório, Kubernetes e banco separado de D1. Cloud Run, Cloudflare Containers e interface avançada do Web-Check estão adiados.

## Verificação

Há testes de lógica, concorrência/durabilidade D1, rotas HTTP, integrações simuladas e jornada de navegador local. O teste Docker usa o upstream sem alterações, um digest candidato e somente fixtures no contêiner sem rede. Essas verificações não comprovam um guardião de rede de produção, execução nativa arm64, conta Cloudflare, CRM real ou viabilidade econômica. `git diff --check` continua disponível. O registro de evidência está em [fontes](docs/sources.md).
