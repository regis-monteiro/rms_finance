-- RMS Finance · Pagamento parcial com histórico, rateio de classificações e lotes de recebimento
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run

-- =========================================================
-- 1. Conta única com histórico de pagamentos
--    A conta (título) guarda o saldo em aberto em "valor" e o total em "valor_original".
--    Cada pagamento parcial é um lançamento pago ligado a ela por "titulo_id".
-- =========================================================
alter table lancamentos add column titulo_id bigint references lancamentos(id) on delete cascade;
alter table lancamentos add column valor_original numeric(14,2);
create index on lancamentos (titulo_id);

-- =========================================================
-- 2. Rateio das classificações dentro de um lançamento
--    "fracao" é a parte do valor do lançamento (a soma das linhas é 1); vale também para os pagamentos parciais.
-- =========================================================
create table lancamento_rateios (
  id bigserial primary key,
  lancamento_id bigint not null references lancamentos(id) on delete cascade,
  grupo_id int not null references grupos(id),
  subgrupo_id int references subgrupos(id),
  centro_custo_id int references centros_custo(id),
  fracao numeric(12,9) not null check (fracao > 0 and fracao <= 1),
  valor numeric(14,2)              -- valor informado na digitação, para referência
);
create index on lancamento_rateios (lancamento_id);
alter table lancamento_rateios enable row level security;
-- Quem acessa o lançamento acessa o rateio dele
create policy rateios_rw on lancamento_rateios for all
  using (exists (select 1 from lancamentos l where l.id = lancamento_id))
  with check (exists (select 1 from lancamentos l where l.id = lancamento_id));

-- DRE considerando o rateio
drop function if exists dre_mensal(int, int, int);
create or replace function dre_mensal(p_ano int, p_conta int default null, p_centro int default null)
returns table (linha_dre_id int, grupo_id int, mes int, realizado numeric, previsto numeric)
language sql stable security definer set search_path = public as $$
  with perfil as (select meu_perfil() as p),
  geral as (select id from centros_custo where nome = 'Geral' and pai_id is null),
  base_l as (
    select coalesce(s.linha_dre_id, g.linha_dre_id) as linha, g.id as grupo, g.restrito,
           coalesce(case when l.status = 'pago' then l.data_pagamento end, l.vencimento) as data,
           round((case when l.tipo = 'entrada' then l.valor else -l.valor end) * coalesce(r.fracao, 1), 2) as v,
           l.status = 'pago' as pago,
           case when r.id is not null then coalesce(r.centro_custo_id, s.centro_custo_id, g.centro_custo_id)
                else coalesce(l.centro_custo_id, s.centro_custo_id, g.centro_custo_id) end as cc
    from lancamentos l
    left join lancamento_rateios r on r.lancamento_id = l.id
    join grupos g on g.id = coalesce(r.grupo_id, l.grupo_id)
    left join subgrupos s on s.id = case when r.id is not null then r.subgrupo_id else l.subgrupo_id end
    where l.fatura_id is null and (p_conta is null or l.conta_id = p_conta)
  ),
  peso as (
    select f.id as fatura_id,
           case when p_conta is null then 1
                else coalesce(sum(l.valor) filter (where l.conta_id = p_conta), 0) / nullif(sum(l.valor), 0) end as w
    from faturas f left join lancamentos l on l.fatura_id = f.id
    group by f.id
  ),
  base_c as (
    select coalesce(s.linha_dre_id, g.linha_dre_id), g.id, g.restrito, f.data_vencimento,
           -c.valor * coalesce(pe.w, 0), f.data_vencimento <= current_date,
           coalesce(c.centro_custo_id, s.centro_custo_id, g.centro_custo_id)
    from compras_cartao c
    join faturas f on f.id = c.fatura_id
    join grupos g on g.id = c.grupo_id
    left join subgrupos s on s.id = c.subgrupo_id
    left join peso pe on pe.fatura_id = f.id
  ),
  tudo as (select * from base_l union all select * from base_c)
  select linha,
         case when restrito and (select p from perfil) <> 'diretor' then null else grupo end,
         extract(month from data)::int,
         coalesce(sum(v) filter (where pago), 0),
         coalesce(sum(v) filter (where not pago), 0)
  from tudo
  where extract(year from data) = p_ano and (select p from perfil) is not null
    and (p_centro is null
         or cc = p_centro
         or exists (select 1 from centros_custo x where x.id = tudo.cc and x.pai_id = p_centro)
         or (tudo.cc is null and p_centro = (select id from geral)))
  group by 1, 2, 3
  having sum(abs(v)) > 0
$$;
grant execute on function dre_mensal(int, int, int) to authenticated;

-- Contas a receber por grupo, considerando o rateio
create or replace function receitas_mensais(p_ano int)
returns table (grupo_id int, mes int, recebido numeric, a_receber numeric)
language sql stable security definer set search_path = public as $$
  select g.id,
         extract(month from coalesce(case when l.status = 'pago' then l.data_pagamento end, l.vencimento))::int,
         coalesce(sum(round(l.valor * coalesce(r.fracao, 1), 2)) filter (where l.status = 'pago'), 0),
         coalesce(sum(round(l.valor * coalesce(r.fracao, 1), 2)) filter (where l.status <> 'pago'), 0)
  from lancamentos l
  left join lancamento_rateios r on r.lancamento_id = l.id
  join grupos g on g.id = coalesce(r.grupo_id, l.grupo_id)
  where l.tipo = 'entrada' and g.natureza = 'receita'
    and extract(year from coalesce(case when l.status = 'pago' then l.data_pagamento end, l.vencimento)) = p_ano
    and meu_perfil() is not null
  group by 1, 2
$$;
grant execute on function receitas_mensais(int) to authenticated;

-- =========================================================
-- 3. Lotes de recebimento (baixa de boletos e lançamento consolidado de recebimentos)
-- =========================================================
create table lotes_recebimento (
  id serial primary key,
  tipo text not null check (tipo in ('baixa', 'consolidado')),
  data date not null,
  conta_id int not null references contas(id),
  quantidade int not null,
  tarifa_unitaria numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  lanc_consolidado_id bigint references lancamentos(id) on delete set null,  -- recebimento consolidado (tipo consolidado)
  lanc_tarifa_id bigint references lancamentos(id) on delete set null,       -- tarifa total do lote
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create table lotes_recebimento_itens (
  id bigserial primary key,
  lote_id int not null references lotes_recebimento(id) on delete cascade,
  beneficiario_id int references beneficiarios(id),
  nome text,
  valor numeric(14,2) not null,
  lancamento_id bigint references lancamentos(id) on delete set null       -- conta a receber baixada (tipo baixa)
);
create index on lotes_recebimento (lanc_consolidado_id);
create index on lotes_recebimento (lanc_tarifa_id);
create index on lotes_recebimento_itens (lancamento_id);
alter table lotes_recebimento enable row level security;
alter table lotes_recebimento_itens enable row level security;
create policy lotes_rec_rw on lotes_recebimento for all
  using (meu_perfil() in ('diretor', 'financeiro')) with check (meu_perfil() in ('diretor', 'financeiro'));
create policy lotes_rec_itens_rw on lotes_recebimento_itens for all
  using (meu_perfil() in ('diretor', 'financeiro')) with check (meu_perfil() in ('diretor', 'financeiro'));

-- Subgrupo usado para a tarifa de boletos
insert into subgrupos (grupo_id, nome) select id, 'Cobrança' from grupos where nome = 'Tarifas Bancárias' on conflict do nothing;

-- Reclassificação também alcança as linhas de rateio
create or replace function reclassificar(
  p_de_grupo int, p_de_sub int, p_para_grupo int, p_para_sub int,
  p_inicio date default null, p_fim date default null, p_texto text default null,
  p_centro int default null, p_aplicar boolean default false)
returns table (lancamentos int, compras int, beneficiarios int)
language plpgsql security definer set search_path = public as $$
declare nl int; nc int; nb int := 0; txt text := nullif(trim(coalesce(p_texto, '')), '');
begin
  if meu_perfil() is distinct from 'diretor' then raise exception 'Somente o Diretor pode reclassificar lançamentos.'; end if;
  if p_para_sub is not null and not exists (select 1 from subgrupos where id = p_para_sub and grupo_id = p_para_grupo) then
    raise exception 'O subgrupo de destino não pertence ao grupo de destino.';
  end if;

  create temp table _l on commit drop as
  select l.id from lancamentos l
  where l.grupo_id = p_de_grupo
    and (p_de_sub is null or (p_de_sub = 0 and l.subgrupo_id is null) or l.subgrupo_id = p_de_sub)
    and l.transferencia_id is null and l.fatura_id is null
    and (p_inicio is null or coalesce(l.data_pagamento, l.vencimento) >= p_inicio)
    and (p_fim is null or coalesce(l.data_pagamento, l.vencimento) <= p_fim)
    and (txt is null or l.favorecido ilike '%' || txt || '%' or coalesce(l.referencia, '') ilike '%' || txt || '%');
  create temp table _c on commit drop as
  select c.id from compras_cartao c
  where c.grupo_id = p_de_grupo
    and (p_de_sub is null or (p_de_sub = 0 and c.subgrupo_id is null) or c.subgrupo_id = p_de_sub)
    and (p_inicio is null or c.data_compra >= p_inicio)
    and (p_fim is null or c.data_compra <= p_fim)
    and (txt is null or c.descricao ilike '%' || txt || '%');
  select count(*) into nl from _l;
  select count(*) into nc from _c;
  if p_inicio is null and p_fim is null and txt is null then
    select count(*) into nb from beneficiarios b
    where b.grupo_id = p_de_grupo and (p_de_sub is null or (p_de_sub = 0 and b.subgrupo_id is null) or b.subgrupo_id = p_de_sub);
  end if;

  if p_aplicar then
    update lancamentos set grupo_id = p_para_grupo, subgrupo_id = p_para_sub,
           centro_custo_id = case when p_centro is null then centro_custo_id when p_centro = 0 then null else p_centro end,
           atualizado_em = now()
    where id in (select id from _l);
    update compras_cartao set grupo_id = p_para_grupo, subgrupo_id = p_para_sub,
           centro_custo_id = case when p_centro is null then centro_custo_id when p_centro = 0 then null else p_centro end
    where id in (select id from _c);
    -- linhas de rateio com a classificação de origem
    update lancamento_rateios r set grupo_id = p_para_grupo, subgrupo_id = p_para_sub,
           centro_custo_id = case when p_centro is null then r.centro_custo_id when p_centro = 0 then null else p_centro end
    from lancamentos l
    where l.id = r.lancamento_id and r.grupo_id = p_de_grupo
      and (p_de_sub is null or (p_de_sub = 0 and r.subgrupo_id is null) or r.subgrupo_id = p_de_sub)
      and (p_inicio is null or coalesce(l.data_pagamento, l.vencimento) >= p_inicio)
      and (p_fim is null or coalesce(l.data_pagamento, l.vencimento) <= p_fim)
      and (txt is null or l.favorecido ilike '%' || txt || '%' or coalesce(l.referencia, '') ilike '%' || txt || '%');
    if nb > 0 then
      update beneficiarios set grupo_id = p_para_grupo, subgrupo_id = p_para_sub
      where grupo_id = p_de_grupo and (p_de_sub is null or (p_de_sub = 0 and subgrupo_id is null) or subgrupo_id = p_de_sub);
    end if;
  end if;
  return query select nl, nc, nb;
end $$;
grant execute on function reclassificar(int, int, int, int, date, date, text, int, boolean) to authenticated;
