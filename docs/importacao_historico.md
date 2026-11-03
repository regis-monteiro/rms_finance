# Importação do histórico (2016 a 2025)

Registro das diferenças encontradas em cada planilha e das decisões tomadas. A tela de Importação usa estas regras.

## Regras gerais

- Anos encerrados (2016 a 2025): todos os lançamentos entram como **Pago**, independentemente da cor da célula. Data de pagamento = data de vencimento.
- Nomes de bancos são comparados sem diferença de maiúsculas e minúsculas (ex.: "inter" = "Inter").
- Os anos anteriores não alteram os saldos atuais, que partem de 01/01/2026.
- Cada ano importado é um lote, que pode ser desfeito e importado de novo.
- Os mapeamentos podem valer só para um ano (ex.: "Bradesco" em 2024 é uma conta antiga).
- Subgrupos que começam com "CC " indicam cartão. Outros subgrupos com "CC" no nome (ex.: "CCM") são subgrupos comuns.
- Compras de cartão sem grupo entram em Administrativas, com observação.
- Planilhas protegidas por senha são abertas só para a importação; a senha não é gravada.
- Formatos aceitos: .xlsx, .xlsm e .xlsb. A aba pode se chamar "Fluxo de caixa" ou "Fluxo Caixa". A linha de cabeçalho é localizada pelo nome das colunas (em 2023 fica na linha 2).
- Nomes de grupos são comparados sem diferença de maiúsculas e minúsculas (ex.: "Distribuição de Lucros" = "Distribuição de lucros").

## Mapeamentos

| Na planilha | No app | Desde |
|---|---|---|
| Banco "Gerencianet" | Conta Efí (Gerencianet) | 2025 |
| Banco "inter" | Conta Inter | 2025 |
| Subgrupo "CC Inter" | Cartão PJ Inter | 2025 |
| Subgrupo "CC PJ Bradesco" | Cartão PJ Bradesco (novo, inativo, vencimento dia 20) | 2025 |
| Grupo "Brasil Canadá" | Grupo novo "Brasil Canadá", bloco Sócios (fora do resultado) | 2025 |
| Banco "RMS Bradesco" | Conta Bradesco | 2024 |
| Banco "Bradesco" (só em 2024) | Conta nova "Bradesco (antiga)", corrente, inativa | 2024 |
| Banco "CEF" | Conta nova "CEF", corrente, inativa | 2024 |
| Banco "Poupança" | Conta nova "Poupança CEF", aplicação, inativa | 2023 e 2024 |
| Banco "Reginaldo" | Não importar (movimentação pessoal) | 2023 |
| Banco "Bloqueio Judicial" | Não importar, inclusive o saldo inicial | 2022 e 2023 |
| Banco "Itaú" | Conta nova "Itaú", corrente, inativa | 2022 |
| Banco "Outros" | Não importar (sem movimento) | 2022 |
| Grupo "Elaine" | Grupo Administrativas | 2022 |
| Banco "Omiecash" | Conta nova "Omiecash", corrente, inativa | 2020 |
| Grupo "Nota Fiscal Paulista" | Grupo Sócios (fora do resultado) | 2020 |
| Grupo "Fornecedores" (cartório) | Grupo Operação | 2020 |
| Banco "Cheques" | Não importar (sem movimento) | 2023 |
| Subgrupo "CC Bradesco" | Cartão PJ Bradesco | 2023 |
| Subgrupo "CC RMS Bradesco" | Cartão PJ Bradesco | 2021 |
| Grupo "Osasco" | Grupo Não previstas | 2023 |
| Grupo "QuickFy" | Grupo Informática | 2023 |

## Conferência por ano

| Ano | Lançamentos | Compras de cartão | Saldo final da planilha | Saldo inicial do ano seguinte | Diferença |
|---|---|---|---|---|---|
| 2025 | 3.387 | 708 | R$ 330.655,34 | R$ 330.644,57 | Bradesco: R$ 10,77 a mais em 31/12/2025 do que em 01/01/2026 |
| 2024 | 3.484 | 735 | R$ 153.513,63 | R$ 153.513,62 | Bradesco: R$ 0,01 (arredondamento) |
| 2020 | 3.500 | 186 | R$ 143.507,89 | R$ 143.506,34 | RMS Bradesco: R$ 1,55 a mais em 31/12/2020; Bloqueio Judicial (+R$ 45,13) e Bradesco antiga (−R$ 45,13) se compensam |
| 2021 | 3.393 | 409 | R$ 71.396,93 | R$ 71.396,93 | Nenhuma |
| 2022 | 3.549 | 428 | R$ 78.661,97 | R$ 78.661,97 | Nenhuma |
| 2023 | 3.555 | 481 | R$ 68.295,79 | R$ 63.609,40 | R$ 4.686,39 da conta Bloqueio Judicial, que não passa para 2024 |

## Decisões registradas

- 03/11/2026: anos encerrados com todos os lançamentos como Pago.
- 03/11/2026: "Brasil Canadá" fora do resultado, no bloco Sócios.
- 03/11/2026: "CC PJ Bradesco" como cartão antigo inativo.
- 03/11/2026: "CC Inter" é o cartão PJ Inter.
- 03/11/2026: em 2024, "RMS Bradesco" é a conta Bradesco atual; "Bradesco" é uma conta antiga, inativa.
- 03/11/2026: "CEF" e "Poupança" viram duas contas antigas, inativas.
- 03/11/2026: em 2020, "Nota Fiscal Paulista" no bloco Sócios; conta "Omiecash" antiga e inativa; "Fornecedores" (cartório) em Operação.
- 03/11/2026: em 2021, sem decisões novas ("Pró-Labore" e "Não Previstas" com maiúscula são os grupos de sempre; "CC RMS Bradesco" é o cartão PJ Bradesco).
- 03/11/2026: em 2022, conta "Itaú" antiga e inativa; grupo "Elaine" (compra no cartão) como despesa Administrativa.
- 03/11/2026: em 2023, contas "Reginaldo" e "Bloqueio Judicial" não são importadas; "Osasco" vai para Não previstas; "CC Bradesco" é o cartão PJ Bradesco.
