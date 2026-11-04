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

Configuração: ver `docs/configuracao.md`.
