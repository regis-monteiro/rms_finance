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
- Próximas telas: contas a receber, DRE, comparativos e importação.

Configuração: ver `docs/configuracao.md`.
