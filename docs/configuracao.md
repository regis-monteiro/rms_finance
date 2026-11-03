# Configuração do RMS Finance (Supabase + Vercel)

Fazer uma única vez. Tempo estimado: 15 minutos.

## 1. Supabase: criar o projeto

1. Acesse supabase.com e entre com o GitHub.
2. Clique em **New project**.
3. Nome: `rms-finance` · Região: **South America (São Paulo)** · Crie uma senha forte para o banco e guarde-a.
4. Aguarde a criação (cerca de 2 minutos).

## 2. Supabase: criar as tabelas

1. No menu lateral, clique em **SQL Editor** e depois em **New query**.
2. Abra o arquivo `supabase/001_estrutura_inicial.sql` no GitHub, clique em **Copy raw file** e cole no editor.
3. Clique em **Run**. Deve aparecer "Success. No rows returned".

## 3. Supabase: ajustar o login

1. Menu **Authentication > URL Configuration**.
2. Em **Site URL**, coloque o endereço do app no Vercel (passo 5). Pode voltar aqui depois de publicar.

## 4. Supabase: copiar as chaves

1. Menu **Project Settings > API** (ou **Data API**).
2. Copie o **Project URL** e a chave **anon public**.
3. Nunca use nem compartilhe a chave **service_role**.

## 5. Vercel: publicar o app

1. Acesse vercel.com e entre com o GitHub.
2. **Add New > Project** e importe o repositório `rms_finance`.
3. Em **Root Directory**, clique em Edit e escolha a pasta `app`.
4. Em **Environment Variables**, cadastre:
   - `VITE_SUPABASE_URL` = Project URL do passo 4
   - `VITE_SUPABASE_ANON_KEY` = chave anon public do passo 4
5. Clique em **Deploy**. Ao terminar, copie o endereço gerado (ex.: `rms-finance.vercel.app`) e volte ao passo 3.

A partir daí, cada alteração enviada ao GitHub é publicada automaticamente.

## 6. Primeiro acesso

1. Abra o app e clique em **Primeiro acesso**.
2. Cadastre seu nome, e-mail e senha e confirme pelo link recebido por e-mail.
3. O primeiro usuário cadastrado vira **Diretor** automaticamente.
4. Os demais usuários entram bloqueados, como Consulta, até um Diretor liberar o acesso. Enquanto a tela de Usuários não fica pronta, a liberação é feita no Supabase: **Table Editor > usuarios**, marcar `ativo` e escolher o `perfil`.

## Segurança

- As permissões por perfil são aplicadas no próprio banco (Row Level Security). Mesmo que alguém altere o app, o banco não entrega dados que o perfil não pode ver.
- As planilhas com dados financeiros não vão para o GitHub.
