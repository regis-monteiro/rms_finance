-- RMS Finance · Funções de análise (DRE, receitas e comparativos)
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
--
-- Regime de caixa: realizado pela data de pagamento; previsto pelo vencimento.
-- Compras de cartão entram no mês de vencimento da fatura e, com filtro por conta,
-- na proporção do que cada conta pagou da fatura.
-- Para Financeiro e Consulta, grupos restritos aparecem só no total da linha (grupo nulo).

create or replace function dre_mensal(p_ano int, p_conta int default null)
returns table (linha_dre_id int, grupo_id int, mes int, realizado numeric, previsto numeric)
language sql stable security definer set search_path = public as $$
  with perfil as (select meu_perfil() as p),
  base_l as (
    select coalesce(s.linha_dre_id, g.linha_dre_id) as linha, g.id as grupo, g.restrito,
           coalesce(case when l.status = 'pago' then l.data_pagamento end, l.vencimento) as data,
           case when l.tipo = 'entrada' then l.valor else -l.valor end as v,
           l.status = 'pago' as pago
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
           -c.valor * coalesce(pe.w, 0), f.data_vencimento <= current_date
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
  group by 1, 2, 3
  having sum(abs(v)) > 0
$$;

-- Entradas por grupo de receita e mês (base do contas a receber)
create or replace function receitas_mensais(p_ano int)
returns table (grupo_id int, mes int, recebido numeric, a_receber numeric)
language sql stable security definer set search_path = public as $$
  select l.grupo_id,
         extract(month from coalesce(case when l.status = 'pago' then l.data_pagamento end, l.vencimento))::int,
         coalesce(sum(l.valor) filter (where l.status = 'pago'), 0),
         coalesce(sum(l.valor) filter (where l.status <> 'pago'), 0)
  from lancamentos l join grupos g on g.id = l.grupo_id
  where l.tipo = 'entrada' and g.natureza = 'receita'
    and extract(year from coalesce(case when l.status = 'pago' then l.data_pagamento end, l.vencimento)) = p_ano
    and meu_perfil() is not null
  group by 1, 2
$$;

-- Anos com movimento, para os filtros
create or replace function anos_disponiveis()
returns table (ano int)
language sql stable security definer set search_path = public as $$
  select distinct extract(year from vencimento)::int from lancamentos where meu_perfil() is not null
  union
  select extract(year from current_date)::int
  order by 1
$$;

grant execute on function dre_mensal(int, int), receitas_mensais(int), anos_disponiveis() to authenticated;

-- Ajuste da carga de 2026: as "Estimativas" da planilha são previsões de honorários
update lancamentos set grupo_id = (select id from grupos where nome = 'Honorários')
where observacao like 'estimativa da planilha%' and tipo = 'entrada';
