# RMS Finance

Aplicativo de controle financeiro interno da RMS Organização Contábil.

## Escopo da primeira versão

- Contas a pagar
- Contas a receber
- Fluxo de caixa
- DRE (Demonstração do Resultado do Exercício)
- Comparativos com meses e anos anteriores
- Importação dos dados da planilha Excel usada hoje

## Perfis de acesso

| Perfil | Permissões |
|---|---|
| Diretor | Vê e edita tudo, gerencia usuários |
| Financeiro | Lança e baixa contas a pagar e a receber |
| Consulta | Visualiza apenas os relatórios liberados |

## Arquitetura

- Acesso pela internet, via navegador, com login
- Banco de dados e autenticação: Supabase
- Hospedagem do site: Vercel

## Estrutura do repositório

| Pasta | Conteúdo |
|---|---|
| `app/` | Aplicativo (React + Vite + Supabase) |
| `supabase/` | Scripts SQL do banco de dados |
| `docs/` | Especificação funcional e guia de configuração |
| `prototipo/` | Protótipo navegável aprovado |

## Status

- Versão 0.1: login, perfis, dashboard (saldos, contas a pagar, faturas), lançamentos e cadastros.
- Versão 0.2: contas a pagar, cartões, beneficiários e usuários.
- Versão 0.3: contas a receber, DRE, comparativos e resultado no dashboard.
- Versão 0.4: importação do histórico 2017 a 2025, com conferência e opção de desfazer.
- Versão 0.5: transferências entre contas, rendimentos de aplicações, previsões e alteração em lote, orçamento automático e datas dd/mm/aaaa.
- Versão 0.6: relatórios em PDF e Excel no padrão MIV, assinatura no DRE e no Dashboard, números no formato 0,00.
- Versão 0.7: centros de custo no plano de contas e no DRE, plano de contas editável com reclassificação, conciliação bancária por OFX, sugestão de classificação pelo histórico, IRRF de aplicações lançado só no resgate ou vencimento e rascunho automático dos formulários (script `supabase/010_centros_plano_conciliacao.sql`).
- Versão 0.8: busca automática do extrato nas APIs do Inter e do Efí (CNAB 240 e Pix do dia), com conciliação automática dos itens idênticos (script `supabase/011_integracao_bancaria.sql`; guia em `docs/integracao_bancaria.md`).
- Versão 0.9.1: integração por API com o Efí retirada (extratos cobrados); conta Efí conciliada por OFX (script `supabase/013_remover_integracao_efi.sql`).
- Versão 1.0: pagamento e recebimento parcial com histórico e saldo na mesma conta, rateio de classificações por valor ou percentual (refletido no DRE), contas a receber por cliente com baixa em lote e tarifa de boletos, lançamento consolidado de recebimentos com detalhamento, só contas ativas nas seleções e conferência do nome antes da conciliação automática (script `supabase/014_parcial_rateio_recebimentos.sql`).
- Versão 1.1: Dashboard clicável (movimentação com saldo diário por conta, conferência de caixa, contas a pagar e faturas direto na tela de baixa), detalhamento dos valores do DRE e fluxo de caixa projetado de 12 meses com orçamento (script `supabase/016_caixa_detalhe_dre.sql`).
- Versão 1.2: lançamento manual em lote, coluna e ordem por data de pagamento, lotes de recebimento editáveis e desfazer baixa sem excluir a conta (script `supabase/017_desfazer_baixa.sql`).
- Versão 1.3: lote do dia: baixas do mesmo dia, na mesma conta e com o mesmo grupo e subgrupo (recebimentos e pagamentos) entram no lote existente, mediante confirmação (script `supabase/018_lotes_do_dia.sql`).
- Versão 1.4: seleção com barra de ações (alterar, baixar, excluir) em Contas a pagar, Contas a receber e compras do cartão; clique na linha abre a edição. Exclusão bloqueada para contas com pagamento parcial, saldos de fatura e transferências.
- Versão 0.9: associação de várias linhas do extrato a um lançamento do app (e o contrário) na conciliação, com somas iguais; rótulos Fornecedor / Beneficiário nos pagamentos e Cliente / Origem nos recebimentos (script `supabase/012_associacao_conciliacao.sql`).

Configuração: ver `docs/configuracao.md`.
