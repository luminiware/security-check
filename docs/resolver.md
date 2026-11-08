# Resolução DNS candidata

**Status:** Proposto para revisão P2/P7, implementado e testado localmente em 08/11/2026. Complementa o [guardião](guardian.md) e o [runner](runner.md); não abre admissão pública.

`executor/resolver.mjs` exige IP público literal do resolvedor e limites explícitos. Usa somente TCP/53 nesse IP, confere o peer conectado e vincula ID, nome, tipo e classe da resposta à pergunta. Não consulta DNS do sistema, não usa search domains e não tenta outro resolvedor quando há falha. A função de transporte aceita loopback apenas no ensaio separado, dentro de contêiner `network=none`; a factory pública rejeita endereços especiais.

O coletor consulta CNAME de cada nome até o terminal, com teto de saltos e detecção de ciclo/ambiguidade; depois consulta A e AAAA. Falha em qualquer família impede a reserva. Mudança para CNAME durante a coleta de endereços também impede a reserva. Resposta mista com endereço proibido é rejeitada por inteiro, inclusive quando o endereço aparece na seção adicional. Nomes, compressão, contagens, comprimentos e tamanho da mensagem têm validação limitada e conservadora.

A reserva contém o hostname original, todos os endereços permitidos e expiração pelo menor TTL observado na cadeia, limitada pelo teto configurado. TTL zero, conjunto vazio, excesso de endereços, NXDOMAIN, resposta truncada ou inconsistente não produzem reserva. O TTL parte do início de cada consulta, sem acrescentar seu tempo de transporte. A resolução não é um cache durável.

TCP não autentica criptograficamente o resolvedor nem transforma a resposta em validação DNSSEC. O componente depende de um resolvedor recursivo escolhido e de rede de controle protegida. Escolha do provedor/IP, política DNSSEC, origem operacional, acesso TCP/53, desempenho e ensaio em VM continuam pendentes. O código não afirma que um resolvedor público foi consultado nos testes.

## Evidência reproduzível

```powershell
npm test
npm run test:resolver
```

Os testes puros exercitam contratos, CNAME/TTL, respostas mistas e malformadas sem abrir sockets. O laboratório exige a imagem local `security-check-guardian:lab`, criada por `npm run test:egress` ou `npm run test:runner`. Monta somente os arquivos de código de teste necessários, read-only; não monta o repositório inteiro ou arquivos de configuração/segredos.

O contêiner roda sem rede externa, root ou capabilities e serve DNS TCP em seu próprio loopback. Nove casos cobrem framing fragmentado, CNAME e duas famílias, menor TTL, resposta com metadata, ID errado, mensagem excessiva, stream incompleto, timeout e cancelamento. Endereços globais nos pacotes são dados sintéticos; nenhum socket é aberto para eles. O relatório agregado é `test-results/resolver-lab.json`, ignorado pelo Git.

Isso não comprova DNS público original, ausência de rebinding em todos os caminhos, IPv6 conectado, redirects ou associação de cada conexão à reserva. O runner de laboratório ainda injeta sua fixture diretamente. A ligação revisada entre `createPublicResolver` e o runner real permanece P2.

## Fontes técnicas

Consultadas em 08/11/2026: [RFC1035](https://www.rfc-editor.org/rfc/rfc1035), [RFC2181](https://www.rfc-editor.org/rfc/rfc2181) e [RFC7766](https://www.rfc-editor.org/rfc/rfc7766). São referências do formato, TTL/CNAME e transporte; não aprovam os parâmetros candidatos ou a implementação.
