# ADR-003 — Executor Oracle condicional e fallback Hetzner

**Status:** Oracle **Condicional**; fallback Hetzner e ausência de HA/failover automático **Decididos**.
**Fonte/data:** [S1/S2](../sources.md), decisão de 05/11/2026.

## Contexto

Baixo custo favorece experimentar o funil, mas capacidade regional, Arm e recuperação de recursos ociosos podem comprometer uma VM gratuita. Não há probabilidade quantitativa validada desses riscos.

## Decisão

Uma VM Oracle Always Free Arm como primeira opção somente se capacidade, compatibilidade e operação forem validadas. Se impedir lançamento ou comprometer disponibilidade, usar Hetzner com executor reproduzível. Não manter dois servidores ativos por obrigação. Leads, resultados e estado indispensável ficam em D1, fora da VM.

## Alternativas

Hetzner inicial é o fallback já autorizado pela fonte. Cloud Run e Cloudflare Containers ficam adiados; não comparar apenas CPU/RAM sem rede, fidelidade TLS/DNS e custo operacional. HA ativa aumentaria custo antes de validar demanda.

## Consequências

Exigir manifesto/dependências arm64 e benchmark nativo; workflow multiarch é apenas evidência de intenção de build. Testar recuperação no fallback com a mesma versão/política e segredos próprios. Não gerar tráfego artificial contra regras de ociosidade. Sem saúde/capacidade, suspender novas análises claramente.

Preços/cotas de S1 são históricos. Não houve cotação atual nem provisionamento neste PR. O prazo de 1–2 dias era ilustrativo e não cria SLA.

## Revisão

Migrar manualmente quando Oracle impedir entrega confiável; redimensionar/adicionar executor só por p95, fila, recursos, custos e resultado comercial. O orçamento, região e limiar de migração ainda precisam de responsável e aprovação. Ver [operação](../architecture.md), P3 e G1/G4/G9.
