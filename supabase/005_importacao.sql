-- RMS Finance · Lotes de importação do histórico (2017 a 2025)
-- Executar uma única vez no Supabase, ANTES dos arquivos de carga de cada ano.

create table lotes_importacao (
  id serial primary key,
  ano int not null unique,
  arquivo text,
  lancamentos int not null default 0,
  compras int not null default 0,
  saldo_inicial numeric(14,2),
  saldo_final numeric(14,2),
  totais_planilha jsonb,          -- [{mes, entradas, saidas}] calculados direto da planilha
  observacoes text,
  importado_em timestamptz not null default now()
);

alter table lancamentos add column lote_id int references lotes_importacao(id);
alter table compras_cartao add column lote_id int references lotes_importacao(id);
alter table faturas add column lote_id int references lotes_importacao(id);
create index on lancamentos (lote_id);

alter table lotes_importacao enable row level security;
create policy lotes_ler on lotes_importacao for select using (meu_perfil() = 'diretor');

-- Conferência: totais do app por mês, para comparar com os da planilha
create or replace function conferencia_lote(p_lote int)
returns table (mes int, entradas numeric, saidas numeric)
language sql stable security definer set search_path = public as $$
  with l as (select ano from lotes_importacao where id = p_lote and meu_perfil() = 'diretor'),
  mov as (
    select extract(month from vencimento)::int m,
           case when tipo = 'entrada' then valor else 0 end e,
           case when tipo = 'saida' then valor else 0 end s
    from lancamentos where lote_id = p_lote and fatura_id is null
    union all
    select extract(month from f.data_vencimento)::int,
           case when c.valor < 0 then -c.valor else 0 end,
           case when c.valor > 0 then c.valor else 0 end
    from compras_cartao c join faturas f on f.id = c.fatura_id where c.lote_id = p_lote
  )
  select m, round(sum(e), 2), round(sum(s), 2) from mov where exists (select 1 from l) group by m order by m
$$;

-- Desfaz a importação de um ano inteiro (somente Diretor)
create or replace function desfazer_lote(p_lote int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if meu_perfil() is distinct from 'diretor' then raise exception 'Somente Diretor pode desfazer uma importação.'; end if;
  delete from lancamentos where lote_id = p_lote;
  delete from compras_cartao where lote_id = p_lote;
  delete from faturas where lote_id = p_lote;
  delete from lotes_importacao where id = p_lote;
end $$;

grant execute on function conferencia_lote(int), desfazer_lote(int) to authenticated;

-- Contas, cartão e grupo que existiram no passado (inativos)
insert into contas (nome, tipo, ativa, ordem) values
  ('Bradesco (antiga)', 'corrente', false, 20),
  ('CEF', 'corrente', false, 21),
  ('Poupança CEF', 'aplicacao', false, 22),
  ('Itaú', 'corrente', false, 23),
  ('Oportunit', 'corrente', false, 24),
  ('Omiecash', 'corrente', false, 25),
  ('Cheques', 'especie', false, 26)
on conflict (nome) do nothing;

insert into cartoes (nome, dia_vencimento, dia_fechamento, ativo) values ('PJ Bradesco', 20, 13, false)
on conflict (nome) do nothing;

insert into grupos (nome, natureza, linha_dre_id, restrito)
select 'Brasil Canadá', 'movimentacao', id, true from linhas_dre where nome = 'Sócios'
on conflict (nome) do nothing;
