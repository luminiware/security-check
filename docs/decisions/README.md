# Registro de decisões

Contexto comum: [S1 e S2](../sources.md), consulta em 07/11/2026. Aceita significa decisão registrada nas fontes, não implementação verificada. Propostas de mecanismo e parâmetros permanecem propostas até revisão explícita.

| ADR | Status | Assunto |
|---|---|---|
| [001](001-upstream-sem-fork.md) | Decidido | Motor upstream e separação do produto |
| [002](002-cloudflare-first.md) | Decidido; consumo HTTP proposto | Frontend, Worker, D1 e Queues |
| [003](003-executor-e-fallback.md) | Condicional / fallback decidido | Oracle e migração Hetzner |
| [004](004-escopo-e-rede.md) | Decidido; implementação pendente | Escopo passivo e isolamento de rede |
| [005](005-execucao-duravel.md) | Decidido; protocolo proposto | Assincronia, idempotência e estado externo |

Uma proposta nova não deve receber status aceito só por estar neste diretório. Mudanças futuras registram contexto/evidência, consequências e referência ao ADR substituído. Detalhes de contrato ficam na arquitetura, evitando cópias divergentes.
