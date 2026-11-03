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
| Banco "Poupança" | Conta nova "Poupança CEF", aplicação, inativa | 2024 |

## Conferência por ano

| Ano | Lançamentos | Compras de cartão | Saldo final da planilha | Saldo inicial do ano seguinte | Diferença |
|---|---|---|---|---|---|
| 2025 | 3.387 | 708 | R$ 330.655,34 | R$ 330.644,57 | Bradesco: R$ 10,77 a mais em 31/12/2025 do que em 01/01/2026 |
| 2024 | 3.484 | 735 | R$ 153.513,63 | R$ 153.513,62 | Bradesco: R$ 0,01 (arredondamento) |

## Decisões registradas

- 03/11/2026: anos encerrados com todos os lançamentos como Pago.
- 03/11/2026: "Brasil Canadá" fora do resultado, no bloco Sócios.
- 03/11/2026: "CC PJ Bradesco" como cartão antigo inativo.
- 03/11/2026: "CC Inter" é o cartão PJ Inter.
- 03/11/2026: em 2024, "RMS Bradesco" é a conta Bradesco atual; "Bradesco" é uma conta antiga, inativa.
- 03/11/2026: "CEF" e "Poupança" viram duas contas antigas, inativas.
