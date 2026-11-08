# Trabalho neste repositório

- Leia [spec](docs/spec.md), [arquitetura](docs/architecture.md), [ADRs](docs/decisions/README.md) e [fontes](docs/sources.md) antes de alterar comportamento ou contratos.
- Use os estados de evidência de `docs/sources.md`. Decidido não é sinônimo de implementado; propostas exigem revisão explícita. Não aprove decisões novas por inferência ou pelo simples merge de documentação.
- Preserve Web-Check upstream sem fork, versionado e substituível. Produto, normalização, scoring e conversão pertencem à Luminiware.
- Mantenha infraestrutura mínima. Responsabilidades lógicas não exigem microsserviços. Não adicione banco separado de D1, serviços ou abstrações por antecipação.
- Atualize requisitos, contratos, ADRs e critérios de aceitação juntos quando o comportamento mudar. Registre fonte e data ao afirmar condições de provedores.
- Não registre segredos, dados pessoais ou diagnósticos sensíveis em código, exemplos, fixtures, logs ou commits. Use domínios reservados e dados sintéticos.
- Não reduza controles de rede para facilitar desenvolvimento. Teste destinos privados apenas em ambientes isolados e controlados, nunca expondo um scanner irrestrito.
- Não execute verificações invasivas, Chromium ou serviços de terceiros fora da allowlist revisada.
- Execute verificações pertinentes disponíveis e relate o que foi realmente comprovado. Nesta baseline só há Markdown; `git diff --check` está disponível, mas não há scripts de build, lint ou teste de aplicação. Não invente comandos nem resultados.
- Ao redigir em nome do mantenedor, consulte `vmenezesdev/voice`, especialmente `VOICE.md`; se inacessível, informe e prossiga sem presumir seu conteúdo.
- Não publique diagnósticos reais para validar documentação. Não provisione infraestrutura nem altere CRM em um PR documental.
