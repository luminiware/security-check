# Adaptador HTTP candidato

**Status:** Proposto em [ADR-008](decisions/008-adaptador-http-limitado.md), com ensaios locais em 08/11/2026. Sujeito a revisão P2/P5/P6/P7; não abre a admissão pública.

## Transporte e evidência

`executor/bounded-fetch.mjs` fornece um adaptador de fetch ao coletor Luminiware. O runner passa a função estática e o coletor por argumento ao Node da imagem upstream intacta. Nenhum arquivo upstream é alterado. Apenas hostname, alvo e limites entram por stdin; credenciais de controle e mounts do host não chegam ao motor.

Cada handler tem um escopo de coleta, com uma chamada inicial de fetch permitida. Redirects são manuais e limitados: só HTTP/HTTPS, porta padrão e mesmo hostname, sem credenciais e sem downgrade de HTTPS. Caminhos de redirects não geram crawling adicional. Outros hosts ficam bloqueados; uma mudança legítima de hostname, como apex→www, pode ficar inconclusiva até revisão de uma política que reserve e proteja cada novo destino.

O adaptador mantém a validação TLS do fetch nativo. Não troca certificados, aceita CA privada automaticamente ou desliga `rejectUnauthorized`. O handler de headers recebe HTTPS no hostname; `http-security` recebe HTTP para observar se a cadeia termina em HTTPS validado. Esse comportamento é proposta explícita de coleta, não uma nova capacidade atribuída ao handler upstream original.

Ao concluir a resposta, o adaptador registra status final, quantidade de redirects, protocolo final e sinal heurístico de interstitial. Usa status 202, headers conhecidos e marcador de body presentes no upstream pesquisado, incluindo body UTF-16 com BOM. Ausência desses sinais não comprova ausência de todo WAF. Falha, status de erro ou interstitial não vira confirmação de transporte adequado.

O body é lido como stream já decodificado pelo fetch, com teto por resposta e total do job. Não se confia em Content-Length comprimido. Excesso cancela a coleta e aborta o transporte; o JSON enviado ao supervisor não contém o body. O buffer entregue ao parser upstream é limitado e tem Content-Encoding/Length removidos para não descrever erroneamente os bytes já decodificados. Encodings desconhecidos ou encadeados são recusados pelo candidato.

Os limites ainda são explícitos e experimentais. Um chunk pode ser alocado antes de sua rejeição e há buffers internos de fetch/zlib. Isso não prova teto exato de memória ou CPU de descompressão. cgroups, prazo rígido, watchdog e orçamento de pacotes permanecem controles externos necessários. O adaptador no processo do motor não substitui o [guardião](guardian.md) nem produz atestação independente contra comprometimento do processo.

## Contrato intermediário

`workload-v1-proposal` mantém checks ordenados e acrescenta `http`, nulo quando não há observação completa. O objeto não contém URLs de redirects ou body:

```json
{
  "http_status": 200,
  "interstitial": false,
  "final_https": true,
  "redirect_count": 1,
  "http_reaches_https": true
}
```

`http_reaches_https` é nulo no check de headers ou quando a observação não permite avaliar transporte. No check HTTP, só vira booleano para resposta final sem erro/interstitial: false para HTTP que permanece HTTP, true para HTTPS final validado. O runner valida campos/estados/coerência antes da normalização.

O callback `normalized-v2-proposal` exige `final_https` nos headers. Assim, informar `http://example.com/` não faz o Worker descartar uma resposta HTTPS efetivamente validada. Ausência/tipo inválido desse campo é rejeitado; false mantém headers inconclusivos. O relatório inclui as versões pinadas do job, sem tomar a versão atual do processo como histórico da coleta. Callbacks de versões anteriores não são aceitos pelo novo validador; jobs locais antigos em andamento precisam expirar ou ser solicitados novamente. Não há migração ou compatibilidade de produção aprovada.

## Ensaio reproduzível

```powershell
npm run test:http
```

Exige Docker Linux, OpenSSL no host e imagem upstream candidata. Usa `network=none`, sem root/capabilities, com fixtures somente em loopback. Mapeia nomes reservados a esses endereços dentro do contêiner. Uma CA sintética temporária é confiada apenas pelo processo desse teste via `NODE_EXTRA_CA_CERTS`; o runner normal não recebe essa CA ou mount. Certificado e chave são removidos ao final.

Dez casos cobrem headers HTTPS/TLS válido, HTTP→HTTPS, HTTP sem upgrade, alvo 503 sob API 200 upstream, interstitial em header/UTF-16, redirect para outro host com controle positivo, teto de redirects, expansão gzip, teto acumulado de body e prazo da leitura. Nenhum socket acessa website real. Relatório agregado: `test-results/http-lab.json`.

Em `test:runner`, a fixture tem certificado inválido e HTTP 200 sem upgrade. O retorno conserva TLS inválido e transporte sem upgrade, com 60% de cobertura e nota nula. OOM, prazo e limpeza também são exercitados. Esses ensaios não aprovam o desenho, heurísticas, parâmetros, redirects entre hosts, IPv6, VM ou produção.

## Fontes

Consultadas em 08/11/2026: [fetch no Node22](https://nodejs.org/download/release/v22.17.0/docs/api/globals.html#fetch), [Undici Fetch](https://github.com/nodejs/undici/blob/main/docs/docs/api/Fetch.md) e [stream/manual redirects](https://github.com/nodejs/undici/blob/main/README.md). O comportamento relevante foi também executado na imagem pinada candidata; uma documentação mais recente não substitui esse ensaio.
