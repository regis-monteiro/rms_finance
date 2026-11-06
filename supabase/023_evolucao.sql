-- RMS Finance · Comparativos > Evolução: valores mensais por linha do DRE, grupo e subgrupo, em vários anos
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
create or replace function evolucao_mensal(p_de int, p_ate int, p_conta int default null, p_centro int default null)
returns table (ano int, mes int, linha_dre_id int, grupo_id int, subgrupo_id int, realizado numeric, previsto numeric)
language sql stable security definer set search_path = public as $$
  with perfil as (select meu_perfil() as p),
  geral as (select id from centros_custo where nome = 'Geral' and pai_id is null),
  base_l as (
    select coalesce(s.linha_dre_id, g.linha_dre_id) as linha, g.id as grupo, s.id as sub, g.restrito,
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
    select coalesce(s.linha_dre_id, g.linha_dre_id), g.id, s.id, g.restrito, f.data_vencimento,
           -c.valor * coalesce(pe.w, 0), f.data_vencimento <= current_date,
           coalesce(c.centro_custo_id, s.centro_custo_id, g.centro_custo_id)
    from compras_cartao c
    join faturas f on f.id = c.fatura_id
    join grupos g on g.id = c.grupo_id
    left join subgrupos s on s.id = c.subgrupo_id
    left join peso pe on pe.fatura_id = f.id
  ),
  tudo as (select * from base_l union all select * from base_c)
  select extract(year from data)::int, extract(month from data)::int, linha,
         case when restrito and (select p from perfil) <> 'diretor' then null else grupo end,
         case when restrito and (select p from perfil) <> 'diretor' then null else sub end,
         coalesce(sum(v) filter (where pago), 0),
         coalesce(sum(v) filter (where not pago), 0)
  from tudo
  where extract(year from data) between p_de and p_ate and (select p from perfil) is not null
    and (p_centro is null
         or cc = p_centro
         or exists (select 1 from centros_custo x where x.id = tudo.cc and x.pai_id = p_centro)
         or (tudo.cc is null and p_centro = (select id from geral)))
  group by 1, 2, 3, 4, 5
  having sum(abs(v)) > 0
$$;
grant execute on function evolucao_mensal(int, int, int, int) to authenticated;
notify pgrst, 'reload schema';
