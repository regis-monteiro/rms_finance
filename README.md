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

## Status

Em planejamento. A estrutura de dados será definida após a análise da planilha atual.
