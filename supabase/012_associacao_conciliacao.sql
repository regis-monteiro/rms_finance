-- RMS Finance · Associação de lançamentos na conciliação bancária
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
-- Um grupo liga uma ou mais linhas do extrato a um ou mais lançamentos do app (somas iguais).

create table conciliacao_grupos (
  id uuid primary key default gen_random_uuid(),
  conta_id int not null references contas(id),
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);

create table conciliacao_itens (
  id bigserial primary key,
  grupo_id uuid not null references conciliacao_grupos(id) on delete cascade,
  fitid text,                                             -- linha do extrato
  data date, valor numeric(14,2), descricao text,         -- cópia da linha do extrato, para consulta
  lancamento_id bigint references lancamentos(id) on delete cascade, -- lançamento do app
  check ((fitid is null) <> (lancamento_id is null))
);
create index on conciliacao_itens (fitid);
create index on conciliacao_itens (lancamento_id);

alter table conciliacao_grupos enable row level security;
alter table conciliacao_itens enable row level security;
create policy conc_grupos_rw on conciliacao_grupos for all
  using (meu_perfil() in ('diretor', 'financeiro')) with check (meu_perfil() in ('diretor', 'financeiro'));
create policy conc_itens_rw on conciliacao_itens for all
  using (meu_perfil() in ('diretor', 'financeiro')) with check (meu_perfil() in ('diretor', 'financeiro'));

-- Se todos os lançamentos de um grupo forem excluídos, o grupo deixa de existir
create or replace function limpar_grupo_conciliacao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from conciliacao_grupos g
  where g.id = old.grupo_id and not exists (select 1 from conciliacao_itens i where i.grupo_id = g.id and i.lancamento_id is not null);
  return null;
end $$;
create trigger trg_limpar_grupo_conciliacao after delete on conciliacao_itens
for each row when (old.lancamento_id is not null) execute function limpar_grupo_conciliacao();
