# Importação do histórico (2016 a 2025)

Registro das diferenças encontradas em cada planilha e das decisões tomadas. A tela de Importação usa estas regras.

## Regras gerais

- Anos encerrados (2016 a 2025): todos os lançamentos entram como **Pago**, independentemente da cor da célula. Data de pagamento = data de vencimento.
- Nomes de bancos são comparados sem diferença de maiúsculas e minúsculas (ex.: "inter" = "Inter").
- Os anos anteriores não alteram os saldos atuais, que partem de 01/01/2026.
- Cada ano importado é um lote, que pode ser desfeito e importado de novo.

## Mapeamentos

| Na planilha | No app | Desde |
|---|---|---|
| Banco "Gerencianet" | Conta Efí (Gerencianet) | 2025 |
| Banco "inter" | Conta Inter | 2025 |
| Subgrupo "CC Inter" | Cartão PJ Inter | 2025 |
| Subgrupo "CC PJ Bradesco" | Cartão PJ Bradesco (novo, inativo, vencimento dia 20) | 2025 |
| Grupo "Brasil Canadá" | Grupo novo "Brasil Canadá", bloco Sócios (fora do resultado) | 2025 |

## Conferência por ano

| Ano | Lançamentos | Compras de cartão | Saldo final da planilha | Saldo inicial do ano seguinte | Diferença |
|---|---|---|---|---|---|
| 2025 | 3.387 | 708 | R$ 330.655,34 | R$ 330.644,57 | Bradesco: R$ 10,77 a mais em 31/12/2025 do que em 01/01/2026 |

## Decisões registradas

- 03/11/2026: anos encerrados com todos os lançamentos como Pago.
- 03/11/2026: "Brasil Canadá" fora do resultado, no bloco Sócios.
- 03/11/2026: "CC PJ Bradesco" como cartão antigo inativo.
- 03/11/2026: "CC Inter" é o cartão PJ Inter.
