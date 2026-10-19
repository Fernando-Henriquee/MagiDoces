# Regras financeiras e fórmulas

Todos os números do sistema são calculados **no banco de dados** a partir dos
registros gravados. O navegador mostra prévias com as mesmas regras, mas o valor
que vale é sempre o recalculado pelo banco ao gravar.

## 1. Dinheiro e arredondamento

- Valores em **centavos inteiros** (`integer`/`bigint`). Nunca ponto flutuante.
- Quantidades com até **3 casas decimais** (`numeric(12,3)`), ex.: 1,5 kg.
- Arredondamento: **meio centavo para longe do zero** (função `round()` do
  PostgreSQL), aplicado **uma vez por linha**: `round(quantidade × preço unitário)`.
  Ex.: 1,5 × R$ 0,25 = 37,5 centavos → **R$ 0,38**.
- Custo unitário de receita: calculado com precisão total e arredondado só no
  final, por unidade.

## 2. Venda

```
subtotal da linha   = round(quantidade × preço unitário)
total da linha      = subtotal da linha − desconto da linha        (desconto ≤ subtotal)
total da venda      = Σ subtotais − Σ descontos das linhas − desconto da venda   (≥ 0)
custo da linha      = round(quantidade × custo unitário histórico)
```

- **Preço e custo unitário são copiados para o item no momento da venda.**
  Mudar o preço ou a receita de um produto depois não altera vendas passadas.
- Ao **editar** uma venda, itens mantidos preservam o custo histórico; itens novos
  usam o custo vigente.
- Item sem custo informado entra com custo desconhecido e é contado em
  "itens sem custo" (o lucro fica sinalizado como parcial).

## 3. Recebimentos, saldo e situação

```
recebido líquido = Σ recebimentos válidos − Σ reembolsos válidos
saldo            = total da venda − recebido líquido
```

- Regras garantidas pelo banco (com bloqueio da venda durante a gravação):
  `0 ≤ recebido líquido ≤ total`. Não é possível receber acima do saldo nem
  reembolsar acima do recebido.
- **Estorno** (anulação): para lançamentos feitos por engano. O registro continua
  no histórico (quem, quando, motivo), mas deixa de contar em qualquer total.
- **Reembolso**: devolução real de dinheiro ao cliente; é uma **saída de caixa** na
  data informada.
- **Cancelamento**: a venda deixa de contar no faturamento e nas contas a receber,
  mas continua visível com motivo e autor. Se havia recebimentos, é obrigatório
  escolher entre estorná-los ou registrar o reembolso.

Situação exibida:

| Situação | Regra |
|---|---|
| Paga | saldo = 0 |
| Parcial | recebido > 0 e saldo > 0 |
| Pendente / Prevista | nada recebido; "prevista" quando o vencimento é futuro |
| Vencida | saldo > 0 **e** vencimento < hoje (no fuso do negócio) |
| A confirmar | importada sem informação de pagamento (nunca presumida paga) |
| Cancelada | venda cancelada |

**O vencimento passar nunca quita uma venda.** Só recebimentos registrados quitam.

"Hoje" é calculado no **fuso horário operacional** do negócio (padrão
`America/Sao_Paulo`, ajustável em Configurações).

### Dia 10

O "dia padrão de vencimento" (10, configurável) é usado como sugestão na venda:
**o próximo dia 10 depois da data da venda**. Em meses mais curtos que o dia
configurado (ex.: 31), usa o último dia do mês. No dashboard e em Contas a
receber, "próximo dia 10" inclui o próprio dia 10 quando hoje é dia 10.

## 4. Compras, despesas e pagamentos (contas a pagar)

- **Compra** (insumos, embalagens): o compromisso tem itens;
  `total = Σ round(quantidade × valor unitário) + frete/taxas − desconto`.
- **Despesa** (aluguel, gás, transporte…): valor único; a **data da despesa** é a
  data de competência (quando ocorreu).
- **Pagamentos/parcelas** ficam em registros separados do compromisso:

```
pago        = Σ parcelas pagas válidas
previsto    = Σ parcelas não pagas válidas (com vencimento)
saldo       = total − pago
sem parcela = total − pago − previsto          (vence na data de vencimento do documento)
regra       = pago + previsto ≤ total
```

- Parcelamento: `total ÷ N` em centavos inteiros; a diferença de centavos vai para
  a 1ª parcela. Ex.: R$ 1.000,00 em 3× = 333,34 + 333,33 + 333,33.
- **O total de uma compra nunca é recontado a cada parcela paga.**

## 5. Indicadores (dashboard e relatórios)

Para um período (datas inclusive):

| Indicador | Fórmula | Observação |
|---|---|---|
| **Faturamento** | Σ total das vendas ativas com data no período | após descontos; canceladas não entram |
| **Recebido** | Σ recebimentos − Σ reembolsos com **data de pagamento** no período | inclui vendas antigas pagas agora |
| **CMV estimado** | Σ custo histórico dos itens das vendas do período | itens sem custo são sinalizados |
| **Lucro bruto estimado** | Faturamento − CMV estimado | |
| **Despesas do período** | Σ despesas ativas com **data de competência** no período | |
| **Lucro (resultado) estimado** | Faturamento − CMV estimado − Despesas do período | marcado "parcial" se faltar custo |
| **Compras registradas** | Σ compras ativas com data no período | **não entram no lucro** |
| **Pagamentos feitos** | Σ pagamentos de compras + despesas com data paga no período | |
| **Fluxo de caixa** | Recebido − pagamentos de compras − pagamentos de despesas | dinheiro que entrou menos o que saiu |
| **Contas a receber** | Σ saldos das vendas ativas (posição de hoje) | independente do período |
| **Vencidos** | Σ saldos com vencimento < hoje | |
| **Contas a pagar** | Σ saldos de compras e despesas ativas | |

### Por que compras não entram no lucro

Comprar 10 kg de farinha não é "gastar" 10 kg: a farinha vira produto e o custo
aparece **quando o produto é vendido** (CMV). Subtrair a compra inteira do
faturamento contaria o mesmo dinheiro duas vezes e distorceria o lucro do mês.
O relatório **Resultado** mostra a diferença `compras de insumos − CMV estimado`,
que indica variação de estoque, perdas ou custos não informados.

### Por que o lucro é "estimado"

Ele depende de custos informados (manual ou receita) e de todas as despesas
estarem registradas. Enquanto houver itens sem custo, despesas não lançadas ou
estoque não controlado, o valor é uma estimativa e é rotulado como tal.

## 6. Fluxo de caixa (tela Financeiro)

- **Realizado**: recebimentos, reembolsos e pagamentos de compras/despesas, pela
  data em que o dinheiro entrou ou saiu.
- **Previsto**: saldos de vendas a receber (pelo vencimento), parcelas previstas a
  pagar (pelo vencimento) e saldo sem parcela de compras/despesas (pelo vencimento
  do documento). Itens sem vencimento não aparecem na previsão.
- Cada movimentação aparece **uma única vez**: quando uma parcela é paga, ela sai
  do previsto e entra no realizado.

## 7. Custo de receitas

```
custo por unidade-base do ingrediente = preço pago / (quantidade comprada × fator da unidade × aproveitamento%)
custo do item da receita              = quantidade × fator da unidade × custo por unidade-base
custo do lote                         = Σ itens + Σ custos adicionais declarados
custo por unidade do produto          = round(custo do lote / rendimento)
```

- Unidades-base: **g** (massa), **ml** (volume), **un** (contagem).
  Fatores: mg 0,001 · kg 1.000 · l 1.000 · dúzia 12.
- **Unidades de grandezas diferentes nunca são convertidas** (ex.: kg ↔ l é recusado
  pelo banco).
- O custo inclui apenas ingredientes (com aproveitamento) e os custos adicionais
  listados na receita. Mão de obra e despesas fixas ficam em Despesas.
- Receitas são opcionais: sem receita, o produto usa o custo unitário manual.

## 8. Importação

- Sem informação de pagamento → **pendente de confirmação** (nunca presumida paga).
- Preço ausente → só com **regra de migração explícita** (preço atual do produto ou
  preço informado por produto); os itens ficam marcados como "preço inferido".
- Total da linha sem preço unitário → o preço é deduzido do total quando há um
  único produto; se a divisão não for exata, a diferença vira desconto para
  preservar o total da planilha.
- Linha marcada como paga sem data → só com regra explícita (usar a data da
  venda), marcada como "data inferida".
- O custo de itens importados é o custo **atual** do produto, marcado como
  "estimado na importação".
