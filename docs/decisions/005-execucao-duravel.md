# ADR-005 — Execução assíncrona e estado externo

**Status:** Assincronia, idempotência, tentativas limitadas e persistência fora da VM **Decididas**. Protocolo claim/lease, reconciliação e contratos **Propostos**.
**Fonte/data:** [S1/S2/S10/S11](../sources.md); consulta em 07/11/2026.

## Contexto

Requisições públicas não devem aguardar a duração do scan. Queue pode repetir entrega; VM e callback podem falhar entre persistência e ack. Perder VM não pode perder lead nem deixar job eternamente executando.

## Decisão

D1 é fonte de estado; Queues transporta jobs e executor devolve resultado autenticado. Estados: `pendente`, `executando`, `concluído`, `falhou`, `expirou`. Não presumir exatamente uma vez. Resultado validado e idempotente, tentativas limitadas e prazo global.

## Proposta de protocolo

Publicar a partir de intenção durável, claim atômico com tentativa e token, lease de aplicação distinto do lease da fila, aceite do resultado em D1 antes do ack. Deadline e reconciliação encerram trabalho abandonado. Retornos antigos não sobrescrevem terminais. Cobertura das verificações e classificação de achados são dimensões separadas do estado do job. Contratos/transições normativos para revisão em [arquitetura §3–4](../architecture.md).

## Alternativas

Scan síncrono aumenta timeout e acoplamento. Ack antes de persistir perde resultado. Somente memória/arquivos da VM perde continuidade. Supor entrega única deixa efeitos duplicados e estado inconsistente.

## Consequências

Há comparação atômica, deduplicação, reconciliação e testes de falha entre passos. O mecanismo é mínimo para essas garantias, sem serviço separado de orquestração. Leads têm persistência própria e envio CRM reconciliado; não presumir idempotência HubSpot.

## Revisão

Rever limites de retry/lease com benchmark e falhas reais; mudança de transporte preserva invariantes. G4/G6 devem provar recuperação e não duplicação de efeitos antes de lançamento. P1/P4/P5 continuam abertas.
