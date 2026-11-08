# Métricas locais candidatas

**Status:** Proposto para revisão P7/P8, com consultas/testes locais em 08/11/2026. Avança RF-13 sem aprovar retenção, metas comerciais, orçamento ou instrumentação de produção.

```powershell
npm run metrics:local
```

O comando usa o Wrangler instalado e `--local`, lendo o D1 da demonstração em `.wrangler/state/`. Exige as migrações locais aplicadas. Não provisiona recursos, consulta conta remota ou altera CRM. [S26 em fontes](sources.md) registra a referência de CLI e a ajuda instalada consultadas.

`scripts/metrics.sql` contém cinco consultas de leitura. A saída traz somente agregados, rótulos, dia UTC e tempos; não seleciona domínio, contato, cookie, token, ID de job ou corpo do relatório. Estados/score/cobertura vêm dos dados persistidos, sem considerar uma coleta malformada como concluída.

| Grupo | Definição |
|---|---|
| Eventos retidos | Contagem por evento deduplicado; não representa uma série comercial permanente |
| Jobs retidos | Contagem por estado e modo sintético/real, com nota, parcial e inconclusivo |
| Leads retidos | Contagem por estado e modo, por pedido semântico persistido; aliases de idempotência não multiplicam |
| Latência | Amostra, média, p50/p95 por coorte de criação UTC, modo e métrica |
| Funil local | Iniciadas/concluídas/falhas/expiradas/ativas e leads acumulados por coorte de criação do job |

`queue_ms` vai da criação ao primeiro claim registrado em `attempts`, sem contar espera de retry como fila inicial. `total_ms` vai da criação ao terminal, incluindo falhas/deadlines. `last_attempt_window_ms` cobre a janela da última tentativa até o terminal; não é tempo de CPU nem comprova que um processo abandonado terminou nesse instante. Tempos nulos/negativos não entram na respectiva amostra.

Percentil usa nearest rank: ordenar os N valores e selecionar a posição `ceil(p × N)`, iniciando em 1. Cada métrica informa N; amostra pequena ou sintética não é benchmark da VM. Não há amostragem oculta ou p95 inventado a partir da média. Ausência de amostras retorna conjunto vazio. Conversão sem concluídas usa null.

As coortes de jobs incluem apenas linhas ainda retidas com alvo ativo. Leads são acumulados para esses jobs, não somente os recebidos naquele dia. Exclusão/retenção pode reduzir esse conjunto. Eventos e jobs têm escopos diferentes; não comparar seus totais como se fossem o mesmo denominador. O comando é uma leitura operacional, sem promessa de snapshot atômico entre as cinco consultas.

## Evidência e pendências

O teste em workerd/SQLite usa callbacks repetidos, retry após perda de lease, lead com duas chaves, dias/modos diferentes e DNS informativo inconclusivo. Confere p50/p95 conhecidos, contagens/dedup, denominador zero, preservação das linhas e ausência de identificadores/contatos na saída. Dados marcados como modo real também são inteiramente sintéticos nesse teste, sem scanner ou tráfego externo.

`funnelMetrics` calcula conversão e margem somente a partir de números fornecidos, em unidade monetária consistente. Não atribui qualificação, proposta, contrato ou receita ao HubSpot por inferência. Conta, custos e origem comercial continuam necessários.

Pendentes: retenção e método de agregação após exclusões; janelas comparáveis e coleta periódica; limites/custo/índices das consultas sob carga; CPU/RAM e disponibilidade do executor; fontes de qualificação/propostas/contratos/receita; benchmark e limiares aprovados. Não há novo dashboard, serviço ou banco.
