# ADR-001 — Motor upstream sem fork

**Status:** Decidido em S1/S2. Detalhes de integração e pin de produção pendentes.
**Fonte/data:** [S1–S8](../sources.md), decisão inicial de 05/11/2026; verificação documental em 07/11/2026.

## Contexto

O objetivo é validar um funil comercial com pouco esforço de manutenção. Web-Check oferece verificações reutilizáveis, mas sua interface, abrangência e interpretações não são o contrato do produto Luminiware.

## Decisão

Executar Web-Check upstream, versionado e atualizável, sem fork. Frontend, normalização, scoring, recomendações e captura comercial são da Luminiware. Motor isolado e substituível por contrato de jobs/resultados. Interface upstream avançada é opcional, preferencialmente restrita e fora do requisito inicial.

## Alternativas

Fork com interface própria aumentaria custo de acompanhar upstream. Construir motor do zero duplicaria trabalho. Expor interface upstream diretamente não atende à jornada simplificada e ao isolamento necessário.

## Consequências

Manter adaptador e fixtures por versão; revisar atualizações e preservar MIT/copyright e avisos de dependências. Não assumir que todo endpoint upstream é apropriado. `tech-stack` usa Chromium no commit consultado, por isso sua exclusão inicial é uma proposta coerente com o escopo; não é motivo para criar fork. Pin/digest e execução real ainda precisam de G1.

## Revisão

Somente evidência concreta de incompatibilidade de segurança/contrato justifica reconsiderar integração. Primeiro configurar, reduzir allowlist ou contribuir upstream. Não converter uma lacuna de implementação em autorização para fork. Ver [arquitetura §2](../architecture.md) e P2.
