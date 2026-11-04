-- RMS Finance · Centros de custo, plano de contas editável, aplicações (IRRF no resgate) e conciliação OFX
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run

-- =========================================================
-- 1. Centros de custo (não obrigatórios)
--    Certificação, Societário e Geral; o Geral concentra DP, Contábil, Fiscal, Administrativo e Diretoria
-- =========================================================
create table centros_custo (
  id serial primary key,
  nome text not null unique,
  pai_id int references centros_custo(id),
  ordem int not null default 0,
  ativo boolean not null default true
);
insert into centros_custo (nome, ordem) values ('Certificação', 10), ('Societário', 20), ('Geral', 30);
insert into centros_custo (nome, pai_id, ordem)
select v.nome, (select id from centros_custo where nome = 'Geral'), v.ordem
from (values ('Depto Pessoal', 31), ('Contábil', 32), ('Fiscal', 33), ('Administrativo', 34), ('Diretoria', 35)) v(nome, ordem);

alter table centros_custo enable row level security;
create policy centros_ler on centros_custo for select using (meu_perfil() is not null);
create policy centros_gravar on centros_custo for all using (meu_perfil() = 'diretor') with check (meu_perfil() = 'diretor');

-- Centro padrão no plano de contas (subgrupo prevalece sobre o grupo) e ajuste por lançamento
alter table grupos add column centro_custo_id int references centros_custo(id);
alter table subgrupos add column centro_custo_id int references centros_custo(id);
alter table lancamentos add column centro_custo_id int references centros_custo(id);
alter table compras_cartao add column centro_custo_id int references centros_custo(id);
update grupos set centro_custo_id = (select id from centros_custo where nome = 'Certificação') where nome = 'Certificação';

-- =========================================================
-- 2. DRE com filtro por centro de custo
--    Centro efetivo = do lançamento; se vazio, do subgrupo; se vazio, do grupo; sem centro conta como Geral
-- =========================================================
drop function if exists dre_mensal(int, int);
create or replace function dre_mensal(p_ano int, p_conta int default null, p_centro int default null)
returns table (linha_dre_id int, grupo_id int, mes int, realizado numeric, previsto numeric)
language sql stable security definer set search_path = public as $$
  with perfil as (select meu_perfil() as p),
  geral as (select id from centros_custo where nome = 'Geral' and pai_id is null),
  base_l as (
    select coalesce(s.linha_dre_id, g.linha_dre_id) as linha, g.id as grupo, g.restrito,
           coalesce(case when l.status = 'pago' then l.data_pagamento end, l.vencimento) as data,
           case when l.tipo = 'entrada' then l.valor else -l.valor end as v,
           l.status = 'pago' as pago,
           coalesce(l.centro_custo_id, s.centro_custo_id, g.centro_custo_id) as cc
    from lancamentos l
    join grupos g on g.id = l.grupo_id
    left join subgrupos s on s.id = l.subgrupo_id
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

-- =========================================================
-- 3. Plano de contas editável
-- =========================================================
-- Ao mover um subgrupo para outro grupo, os lançamentos, compras e beneficiários acompanham
create or replace function subgrupo_movido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.grupo_id <> old.grupo_id then
    update lancamentos set grupo_id = new.grupo_id where subgrupo_id = new.id;
    update compras_cartao set grupo_id = new.grupo_id where subgrupo_id = new.id;
    update beneficiarios set grupo_id = new.grupo_id where subgrupo_id = new.id;
  end if;
  return new;
end $$;
create trigger trg_subgrupo_movido after update of grupo_id on subgrupos
for each row execute function subgrupo_movido();

-- Reclassificação de lançamentos anteriores (somente Diretor)
--   p_de_sub: null = todos os subgrupos do grupo; 0 = apenas sem subgrupo
--   p_para_sub: null = sem subgrupo
--   p_centro: null = não altera; 0 = volta ao padrão do plano; >0 = define o centro
--   p_aplicar = false apenas conta o que seria alterado
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
    if nb > 0 then
      update beneficiarios set grupo_id = p_para_grupo, subgrupo_id = p_para_sub
      where grupo_id = p_de_grupo and (p_de_sub is null or (p_de_sub = 0 and subgrupo_id is null) or subgrupo_id = p_de_sub);
    end if;
  end if;
  return query select nl, nc, nb;
end $$;
grant execute on function reclassificar(int, int, int, int, date, date, text, int, boolean) to authenticated;

-- =========================================================
-- 4. Aplicações: rendimento no último dia do mês; IRRF só no resgate ou vencimento
-- =========================================================
alter table aplicacoes add column vencimento date;
alter table aplicacoes_saldos add column irrf_retido numeric(14,2);   -- IR retido informado pelo extrato
alter table aplicacoes_saldos add column data_irrf date;              -- data do resgate / vencimento

-- Projeção por conta: rendimentos ainda não confirmados e IRRF ainda não retido
create or replace view aplicacoes_projecao as
with pos as (
  select s.*, a.conta_id, a.ativo,
         lag(s.saldo_bruto) over (partition by s.aplicacao_id order by s.competencia) as bruto_ant,
         row_number() over (partition by s.aplicacao_id order by s.competencia desc) as rn
  from aplicacoes_saldos s join aplicacoes a on a.id = s.aplicacao_id
)
select conta_id,
       coalesce(sum(saldo_bruto - bruto_ant - aporte + resgate) filter (where data_confirmacao is null and bruto_ant is not null), 0) as rendimento_pendente,
       coalesce(sum(saldo_bruto - saldo_liquido) filter (where rn = 1), 0)
         - coalesce(sum(irrf) filter (where lanc_irrf_id is not null and irrf_retido is null), 0) as irrf_pendente
from pos
where meu_perfil() in ('diretor', 'financeiro')
group by conta_id;
grant select on aplicacoes_projecao to authenticated;

-- =========================================================
-- 5. Conciliação bancária (OFX)
-- =========================================================
alter table lancamentos add column ofx_fitid text;   -- identificador da transação no extrato
create index on lancamentos (conta_id, ofx_fitid);

-- Saldo de uma conta numa data (lançamentos pagos)
create or replace function saldo_conta_em(p_conta int, p_data date)
returns numeric language sql stable security definer set search_path = public as $$
  select c.saldo_inicial
         + coalesce((select sum(case when l.tipo = 'entrada' then l.valor else -l.valor end)
                     from lancamentos l
                     where l.conta_id = c.id and l.status = 'pago'
                       and l.data_pagamento >= c.data_saldo_inicial and l.data_pagamento <= p_data), 0)
  from contas c
  where c.id = p_conta and meu_perfil() in ('diretor', 'financeiro')
$$;
grant execute on function saldo_conta_em(int, date) to authenticated;

-- Histórico resumido de classificações, base das sugestões ao lançar e ao conciliar
create or replace function dicionario_classificacao()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('t', tipo, 'f', fav, 'b', beneficiario_id, 'g', grupo_id, 's', subgrupo_id, 'c', centro_custo_id, 'n', n, 'd', ult)), '[]'::jsonb)
  from (
    select l.tipo, lower(trim(l.favorecido)) as fav, l.beneficiario_id, l.grupo_id, l.subgrupo_id, l.centro_custo_id,
           count(*) as n, max(l.vencimento) as ult
    from lancamentos l
    join grupos g on g.id = l.grupo_id
    left join subgrupos s on s.id = l.subgrupo_id
    where l.vencimento >= current_date - interval '5 years'
      and l.transferencia_id is null and l.fatura_id is null
      and coalesce(l.observacao, '') not in ('rendimento de aplicação', 'multa/juros por atraso')
      and g.ativo and (s.id is null or s.ativo)
      and (meu_perfil() = 'diretor' or (meu_perfil() = 'financeiro' and not g.restrito))
    group by 1, 2, 3, 4, 5, 6
  ) x
$$;
grant execute on function dicionario_classificacao() to authenticated;

-- Quantidade de lançamentos e compras por grupo/subgrupo (tela do plano de contas)
create or replace function uso_plano()
returns table (grupo_id int, subgrupo_id int, n bigint)
language sql stable security definer set search_path = public as $$
  select grupo_id, subgrupo_id, count(*)
  from (select grupo_id, subgrupo_id from lancamentos union all select grupo_id, subgrupo_id from compras_cartao) x
  where meu_perfil() = 'diretor'
  group by 1, 2
$$;
grant execute on function uso_plano() to authenticated;
