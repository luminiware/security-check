# ADR-008 — Adaptador HTTP limitado fora do upstream

**Status:** Proposto para revisão P2/P5/P6/P7. Implementação e ensaios locais em 08/11/2026 não aprovam este desenho para produção. Fontes S14/S25 em [fontes](../sources.md).

## Problema

O upstream intacto usa `fetch` para obter headers e presença de controles, segue redirects e materializa o body. A saída desses handlers perde o status original e não demonstra HTTP→HTTPS. O firewall limita peers, portas e pacotes, mas não observa o plaintext HTTPS ou bytes após descompressão. Uma API 200 pode representar alvo 503 ou interstitial.

## Proposta

Fornecer `globalThis.fetch` pelo coletor Luminiware, antes de importar os handlers, por um adaptador que usa o fetch nativo com redirects manuais e lê o stream sob limites explícitos de resposta/job. Não alterar arquivos, imagem ou certificados upstream. A função própria é código estático passado pelo runner; não recebe JavaScript do visitante. O motor continua versionado e substituível.

O adaptador permite somente GET no hostname reservado e portas padrão HTTP/HTTPS, sem credenciais/cookies, com teto de requests/redirects, proibição de downgrade e prazo. Headers são coletados por HTTPS; o handler `http-security` recebe HTTP para observar a transição. Status final, indicador heurístico de interstitial e transição vêm da chamada efetivamente concluída, sem inferir transporte pela presença de um header.

O firewall externo, o DNS reservado e os limites de processo continuam indispensáveis. O adaptador roda no processo do motor; não é uma atestação independente, sandbox de código ou defesa suficiente contra comprometimento desse processo. Falha, timeout ou limite não gera evidência aprovada. O contrato intermediário passa a `workload-v1-proposal`. O callback `normalized-v2-proposal` exige `final_https` em headers, para avaliar o protocolo observado sem inferi-lo do esquema digitado. O relatório conserva as versões pinadas do job. Versões legadas não são aceitas pelo novo validador.

Detalhamento Proposto em P6: `score-v1-proposal` mantém pesos/fórmula e exige coleta DNS útil para exibir número, sem atribuir peso ou penalizar ausência de MX/TXT. Falha da coleta suprime nota e é mostrada como limitação, inclusive com 100% de cobertura das regras. Isso operacionaliza a vedação da spec a nota positiva por falha DNS; a elegibilidade e a mudança incompatível continuam exigindo revisão explícita.

## Evidência e consequências

[Ensaio HTTP](../http-adapter.md) com CA sintética confinada a contêiner sem rede valida o motor intacto, HTTPS, redirects, erro de alvo, interstitial, gzip e prazos. O runner usa o adaptador sob o firewall em rede interna e preserva TLS inválido como observação, sem nota por cobertura insuficiente.

O desenho precisa de revisão explícita: aceita apenas redirects no mesmo hostname; não prova ausência de todos os WAFs; stream limitado não é garantia de RSS exato; caminhos não baseados em fetch exigem o firewall e controles próprios. Testes em IPv6, VM, DNS original e fluxo remoto permanecem pendentes. Não enfraquecer TLS, abrir fallback de DNS ou retirar firewall para ampliar cobertura.
