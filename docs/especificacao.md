# Especificação funcional: RMS Finance

Versão 0.1 · 03/11/2026 · Base: planilha "RMS - Fluxo de Caixa 2026" (abas Fluxo de caixa e Análise Fluxo)

## 1. Conceitos

### 1.1 Contas financeiras

| Conta | Tipo |
|---|---|
| Bradesco | Conta corrente |
| Inter | Conta corrente |
| Gerencianet (Efí) | Conta corrente |
| AF Bradesco | Aplicação financeira |
| AF Inter | Aplicação financeira |
| Caixa | Dinheiro em espécie |

Cada conta tem saldo inicial do ano. O saldo do dia é saldo inicial + lançamentos pagos.

### 1.2 Lançamento (equivale a uma linha da aba Fluxo de caixa)

| Campo | Planilha | Observação |
|---|---|---|
| Tipo | Tipo | Entrada ou Saída |
| Conta | Banco | Conta financeira de saída ou entrada |
| Vencimento | Mês + Dia do Mês | Passa a ser uma data completa |
| Data de pagamento | (cor verde) | Preenchida quando o status vira Pago |
| Grupo | Grupo | Plano de contas, nível 1 |
| Subgrupo | Sub-Grupo | Plano de contas, nível 2 |
| Referência | Transação | Parcela ("02 de 10"), competência ou observação |
| Favorecido / Pagador | Descrição | |
| Documento | Docto | Campo livre |
| Valor | Lançamento | Positivo; o sinal vem do Tipo |
| Status | Cor da célula | Ver 1.3 |
| Forma de pagamento | Legenda Espécie/Débito | Boleto, PIX, débito em conta, espécie, cartão |
| Recorrência | (novo) | Mensal, parcelado ou único, para gerar previsões |

### 1.3 Status

| Status | Cor na planilha | Significado |
|---|---|---|
| Previsto | Sem cor | Valor estimado, boleto não recebido |
| Confirmado | Amarelo | Valor confirmado, boleto salvo |
| Agendado | Azul | Pagamento agendado no banco |
| Pago (realizado) | Verde | Pagamento efetuado |

"Espécie" e "Débito em conta" deixam de ser status e passam para o campo Forma de pagamento.

### 1.4 Cartões de crédito empresariais

Cartões: Itaucard, Porto, PJ Inter, Efí.

- Cada cartão tem dia de fechamento, dia de vencimento e conta bancária padrão de pagamento.
- A compra é lançada na data em que ocorreu, com grupo, subgrupo, favorecido e parcelas.
- O app agrupa automaticamente a compra na fatura correta, pelo fechamento. Compras parceladas geram uma parcela em cada fatura.
- A fatura gera um único lançamento de saída na conta bancária (status Previsto, Confirmado, Agendado, Pago).
- No DRE e nos relatórios por grupo, contam as compras (pela despesa real); no saldo bancário, conta o pagamento da fatura. Isso evita contar a mesma despesa duas vezes.

### 1.5 Contas a receber (sintético)

- Previsão mensal por grupo de receita (Honorários, IRPF, Certificação, Comissões, Rendimentos), sem detalhar cliente.
- O realizado vem dos lançamentos de entrada pagos.
- Indicadores: previsto, recebido, diferença em R$ e %.

### 1.6 Contas a pagar (detalhado)

- Todos os lançamentos de saída não pagos, um a um, com vencimento, favorecido, valor e status.
- Filtros: período, conta, grupo, status, vencidos.

## 2. Plano de contas e estrutura do DRE (proposta para validação)

Regime de caixa, igual à planilha. Grupos atuais classificados assim:

| Linha do DRE | Grupos |
|---|---|
| (+) Receita de serviços | Honorários, IRPF, Certificação (subgrupos Receita e Mensalidade), Comissões |
| (-) Custos diretos | Certificação (subgrupo Custo), Operação, Clientes, VGP |
| **= Margem de contribuição** | |
| (-) Despesas com pessoal | Funcionários, Treinamentos, Endomarketing |
| (-) Despesas administrativas | Administrativas, Alimentação, Informática, Imóveis, Locomoção, Manut Equipamentos, Manut. Instalações, Manutenção Predial, Material Escritório, Material Limpeza/Copa, Marketing |
| (-) Despesas não previstas | Não previstas |
| (-) Impostos e taxas | Impostos |
| **= Resultado operacional** | |
| (+/-) Resultado financeiro | Rendimentos, Juros Bancários, Tarifas Bancárias, Tarifas Diversas |
| (-) Remuneração dos sócios | Pró-labore |
| **= Resultado líquido** | |

Movimentações que afetam o caixa, mas não o resultado (exibidas abaixo do DRE):

| Bloco | Grupos |
|---|---|
| Investimentos em ativos | Equipamentos, Mobiliário, Investimento (consórcio) |
| Sócios | Distribuição de lucros, Sócios |
| Financiamentos | Empréstimos |
| Entre contas | Transferências, aplicações e resgates |

Grupos "Estimativa" e "Saldo Anterior" deixam de existir: estimativas viram lançamentos com status Previsto e o saldo anterior vira saldo inicial da conta.

## 3. Telas

1. **Dashboard**
   - Saldo atual de cada conta e saldo total
   - Projeção de saldo até o fim do ano (equivale à "Projeção para 31/12")
   - Contas a pagar: vencidos, próximos 7 dias e mês, com lista
   - Contas a receber: previsto x recebido do mês por grupo
   - Cartões: fatura aberta e próxima fatura de cada cartão, com status do pagamento
   - Resultado do mês e acumulado do ano
2. **Lançamentos** (equivale à aba Fluxo de caixa): lista com filtros, inclusão, edição, baixa em lote e cores por status
3. **Contas a pagar**: lista detalhada dos itens em aberto
4. **Contas a receber**: previsão por grupo e mês, previsto x realizado
5. **Cartões**: compras por cartão, faturas por mês, gastos por grupo, pagamento da fatura
6. **DRE / Análise do fluxo** (equivale à aba Análise Fluxo): grupos x meses, com filtro por conta, previsto e realizado, expansão por subgrupo
7. **Comparativos**: mês x mês anterior, mês x mesmo mês do ano anterior, acumulado ano x ano anterior; gráficos de evolução e tendência; diferenças em R$ e %
8. **Cadastros**: contas, cartões, grupos e subgrupos, linhas do DRE
9. **Usuários e permissões**
10. **Importação**: carga das planilhas de anos anteriores

## 4. Perfis de acesso

| Recurso | Diretor | Financeiro | Consulta |
|---|---|---|---|
| Dashboard | Completo | Completo | Sem saldos de aplicação |
| Lançamentos e contas a pagar | Edita | Edita | Não acessa |
| Cartões | Edita | Edita | Não acessa |
| DRE e comparativos | Completo | Completo | Somente relatórios liberados |
| Pessoal, pró-labore e sócios | Vê detalhe | Vê só totais | Não vê |
| Cadastros e usuários | Edita | Não acessa | Não acessa |

## 5. Importação da planilha

- Uma linha da aba Fluxo de caixa com Tipo Entrada ou Saída vira um lançamento.
- Linhas de Saldo Inicial viram saldo inicial das contas; linhas de Saldo final e linhas vazias são ignoradas.
- Status pela cor da célula de valor: verde = Pago, amarelo = Confirmado, azul = Agendado, sem cor = Previsto.
- Linhas com subgrupo "CC ..." viram compras do cartão correspondente, ligadas à fatura do mês.
- A planilha original não é guardada no repositório.

## 6. Pontos em aberto

- Validar a classificação do DRE (item 2).
- Faturas de cartão aparecem pagas pela conta "Caixa" (espécie). Confirmar a conta correta de pagamento de cada cartão.
- Dia de fechamento e vencimento de cada cartão.
- Validar a matriz de permissões (item 4).
