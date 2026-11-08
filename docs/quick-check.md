# Quick Check — caminho leve de lançamento

Status: implementação candidata, não liberada para produção (08/11/2026).

## Decisão de produto

O lançamento inicial deve permitir diagnóstico gratuito sem executar o motor Web-Check. Preservar a experiência e contratos públicos de resultado, a persistência D1, quotas e CTA; o executor isolado continua disponível como opção Advanced futura. O Quick coleta metadados de respostas HTTP(S) e respostas DNS. TLS detalhado não é inspecionado: não atribuir aprovação implícita a certificado, versão ou cifra.

A normalização de relatório reutiliza regras existentes para headers e redirecionamento, mas usa denominador próprio de 65 pontos (HTTPS 25, HSTS 15, CSP 10, nosniff 10, Referrer 5). Exige cobertura de 80% do escopo Quick, observação HTTP e DNS útil para emitir uma nota **apenas Quick**. Não comparar com o score Advanced de 100 pontos. Ausência de coleta é inconclusiva, não adequada. Observações e até três prioridades são mostradas com limites e evidência.

## Implementação

- `src/quick-check.js`: DoH A/AAAA com fail-closed sobre respostas que contenham endereços proibidos; dois probes HTTP(S) com redirects manuais limitados ao mesmo host, portas padrão, prazo e metadados mínimos; não guarda body.
- `src/report.js`: `makeQuickReport`, scoring e limites próprios sem TLS.
- `src/store.js`: `scenario=quick`, versões próprias, conclusão persistida e recuperável por polling sem Queue.
- `src/worker.js`: `ctx.waitUntil` para Quick, mantendo a demonstração local e o executor Advanced desconectado.
- `public/`: Turnstile para execução não sintética e CTA por e-mail comercial. Captura de leads via D1/HubSpot continua adiada; a mensagem de e-mail só é enviada se o visitante escolher seu cliente de e-mail.

## Bloqueios reais para produção

1. **SSRF:** preflight DNS não prova o endereço do peer conectado pelo `fetch` do Worker. Resolver A/AAAA via DoH e consultar por hostname são dois atos independentes. Configuração de destino público, proteção contra rebinding e egress privado devem ser demonstrados na plataforma real. A flag `QUICK_EGRESS_REVIEWED` é um registro operacional de aceite, não uma mitigação técnica. Se não houver garantia na conexão, manter o scanner público bloqueado e usar um executor isolado.
2. **Antiabuso:** testar Turnstile e hostname/action, quotas por sessão/host/domínio/orçamento; fazer testes de carga com limites efetivos de requests/CPU. A cada tentativa nova, deve existir token novo.
3. **Tempo de execução:** `ctx.waitUntil` e D1 cumprem uma versão simples; verificar limites de plataforma, jobs expirados e recuperação. Não equivale à durabilidade Queue.
4. **Semântica:** HTTP 200, redirects e headers não comprovam identidade TLS. Filtros anti-bot, interstitials e respostas que variam por User-Agent podem limitar a interpretação. Revisão humana de falsas conclusões e dos textos de resultado é necessária.
5. **Comercial:** o CTA atual utiliza mailto e não comprova lead entregue ou conversão. Monitoramento comercial e integração consentida podem entrar depois.
6. **Operação:** provisionamento real de D1, deploy, smoke tests externos, retenção e revisão de privacidade/logs. Sem aprovação, `QUICK_CHECK_ENABLED=false` e `QUICK_EGRESS_REVIEWED=false`.

## Estratégia de teste

Executar `npm test`, `npm run test:ui`, `npm run build` e `npm run check`. Adicionar ensaio em staging para consultas reais sem acessar hosts privados; testar redirects maliciosos, respostas DNS mistas e privacidade dos logs. Não usar a demonstração sintética como prova de egress.

O Web-Check permanece sem fork. Seu executor, Queue e guardião não foram removidos nem liberados. Esta implementação não provisiona infraestrutura, envia contatos ou realiza scans reais durante o PR.
