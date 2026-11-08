# ADR-006 — Implementação experimental e gates de produção

**Status:** Proposto para revisão. Não aprova P1–P8 nem substitui ADR-001–005.
**Fonte/data:** pedido de implementação até o limite e [spec/fontes](../sources.md), 07/11/2026.

## Contexto

A baseline documental ainda tem parâmetros, contratos e condições de operação pendentes. É possível implementar e testar a jornada e os contratos localmente sem transformar essas propostas em políticas públicas.

## Proposta implementada para revisão

Manter a arquitetura Worker/D1/Queues e Web-Check sem fork. Implementar componentes e migrações próprios para validação, com modo sintético restrito ao loopback e sem tráfego ao domínio digitado. Bloquear admissão pública e execução de scan enquanto P2 e os demais gates não tiverem evidência e revisão. Transporte CRM fica desconectado até P4.

## Consequências

O repositório passa a conter código, dependências e verificações executáveis. Os parâmetros `LOCAL`, as migrações e contratos continuam propostas. Não há promessa de segurança, disponibilidade, custo zero ou produção pronta. Um build e testes locais não satisfazem gates de conta, rede, plataforma ou revisão humana.

O inventário e os procedimentos estão em [implementação](../implementation.md). A conexão do caminho real exige revisão explícita e alteração verificável de código/configuração; não existe flag que aprove o guardião de rede.
