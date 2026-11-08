# ADR-002 — Cloudflare-first

**Status:** Cloudflare, Worker, D1, Queues e proteções de entrada Decididos. HTTP pull e reconciliador no mesmo Worker **Propostos**.
**Fonte/data:** [S1/S2 e S9–S13](../sources.md); consulta em 07/11/2026.

## Contexto

Frontend estático e gateway pequenos reduzem operação. Estado de jobs e leads deve sobreviver à perda da VM. Scans de rede não precisam executar no Worker.

## Decisão

Frontend na Cloudflare, Worker para API/admissão, D1 para estado/resultados resumidos e Queues para transporte. Turnstile, rate limiting e quotas. Sem Redis ou Postgres separado no MVP. Responsabilidades lógicas não exigem microsserviços.

## Viabilidade e proposta

Documentação oficial confirma Queues em Free, inclusive consumidor HTTP; há limite de operações e retenção. Propor HTTP pull autenticado pelo supervisor, sem endpoint de scan público na VM. O mesmo Worker pode reconciliar intenções D1/Queue e expiração por handler agendado. Isso ainda precisa de teste integrado e apuração de custo/plano. Detalhes únicos em [arquitetura §3](../architecture.md).

## Alternativas

Push consumer Worker exigiria mecanismo adicional para alcançar executor privado. Broker separado aumenta operação. Colocar todo o estado na VM reduz resiliência. Esses caminhos não são necessários pela evidência documental disponível.

## Consequências

D1 e Queue não têm transação conjunta; persistir intenção e reconciliar duplicatas. Controlar custo de polling, quotas, storage e tentativas. “Free” não é garantia de custo zero nem de disponibilidade. Não provisionar neste PR.

## Revisão

Reavaliar mecanismo se teste na conta/plano falhar ou custo/limites inviabilizarem o volume medido. Registrar conflito e menor alteração; não reabrir Cloudflare-first sem evidência. G3/G4/G9 e P1 orientam aprovação.
