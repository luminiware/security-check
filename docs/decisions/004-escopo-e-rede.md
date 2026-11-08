# ADR-004 — Escopo passivo e proteção no executor

**Status:** Escopo e controles indispensáveis **Decididos**; implementação do guardião de rede **Pendente**; desenho da arquitetura **Proposto**.
**Fonte/data:** [S1/S2/S3](../sources.md); consulta em 07/11/2026.

## Contexto

Um scanner público pode virar ponte para rede interna/metadata. O upstream não promete bloquear DNS/redirects pela lista de hostname. Observações externas não demonstram exploração de vulnerabilidade.

## Decisão

Allowlist passiva de HTTP, TLS, headers, DNS e tecnologias quando apropriado. Sem port scan, traceroute, screenshot/Chromium ou verificações invasivas por padrão. Validar esquemas, portas, resoluções, saltos e endereço efetivamente conectado; bloquear destinos não permitidos também no executor e na rede.

## Alternativas

Validação só no Worker ou regex de host não protege resolução posterior. Expor motor genérico transfere controle ao visitante. Desligar firewall para facilitar integração viola a decisão. Proxy que altera certificados compromete diagnóstico TLS.

## Consequências

Default-deny, isolamento sem privilégios, orçamento de bytes/tempo/CPU/RAM e controle de todos os caminhos de saída. `tech-stack` deve ficar desabilitado na proposta inicial por depender de Chromium. Namespace/guardião externo precisam comprovar peer e limites sem fork. Resultados inconclusivos não aprovam segurança; headers ausentes não são exploração automaticamente.

## Revisão

Check sem proteção demonstrável fica bloqueado/inconclusivo, com revisão de cobertura e produto. Se a restrição externa for inviável, registrar incompatibilidade e buscar mudança upstream antes de lançar. G2 é obrigatório, não satisfeito por documentação ou configuração de hostname. Ver [arquitetura §5](../architecture.md), P2 e [scoring](../spec.md).

Evolução experimental: [ADR-007](007-guardiao-candidato.md) descreve candidato com namespace/DNS/nftables e laboratório isolado. Continua Proposto; não substitui esta decisão nem encerra P2/G2.
