-- RMS Finance · Conferência de caixa e detalhamento do DRE
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run

-- =========================================================
-- 1. Conferência de caixa (só registro; a diferença não gera lançamento)
-- =========================================================
create table caixa_conferencias (
  id serial primary key,
  conta_id int not null references contas(id),
  data date not null default current_date,
  contagem jsonb not null,          -- {"cedulas":{"200":65,...},"moedas":{"1":10,...},"vales":[{"nome":"...","valor":0}]}
  total_especie numeric(14,2) not null,
  saldo_app numeric(14,2) not null,
  diferenca numeric(14,2) not null,
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
alter table caixa_conferencias enable row level security;
create policy caixa_conf_rw on caixa_conferencias for all
  using (meu_perfil() in ('diretor', 'financeiro')) with check (meu_perfil() in ('diretor', 'financeiro'));

-- =========================================================
-- 2. Detalhe de um valor do DRE: lançamentos e compras de cartão de um grupo (ou linha) num mês
--    Mesmas regras do dre_mensal (regime de caixa, rateio, cartões pelo vencimento da fatura, centro de custo)
-- =========================================================
create or replace function dre_detalhe(p_ano int, p_mes int, p_linha int, p_grupo int default null,
                                      p_conta int default null, p_centro int default null)
returns table (origem text, id bigint, data date, descricao text, grupo text, subgrupo text, conta text,
               valor numeric, pago boolean)
language sql stable security definer set search_path = public as $$
  with perfil as (select meu_perfil() as p),
  geral as (select id from centros_custo where nome = 'Geral' and pai_id is null),
  base_l as (
    select 'lancamento'::text as origem, l.id::bigint as id,
           coalesce(case when l.status = 'pago' then l.data_pagamento end, l.vencimento) as data,
           coalesce(nullif(trim(l.favorecido), ''), nullif(l.observacao, ''), '(sem nome)') || coalesce(' · ' || l.referencia, '') as descricao,
           g.id as gid, g.nome as gnome, g.restrito, s.nome as snome, c.nome as cnome,
           coalesce(s.linha_dre_id, g.linha_dre_id) as linha,
           round((case when l.tipo = 'entrada' then l.valor else -l.valor end) * coalesce(r.fracao, 1), 2) as v,
           l.status = 'pago' as pago,
           case when r.id is not null then coalesce(r.centro_custo_id, s.centro_custo_id, g.centro_custo_id)
                else coalesce(l.centro_custo_id, s.centro_custo_id, g.centro_custo_id) end as cc
    from lancamentos l
    left join lancamento_rateios r on r.lancamento_id = l.id
    join grupos g on g.id = coalesce(r.grupo_id, l.grupo_id)
    left join subgrupos s on s.id = case when r.id is not null then r.subgrupo_id else l.subgrupo_id end
    left join contas c on c.id = l.conta_id
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
    select 'cartao'::text, cc.id::bigint, f.data_vencimento,
           ca.nome || ' · ' || cc.descricao || coalesce(' · ' || cc.parcela, ''),
           g.id, g.nome, g.restrito, s.nome, ca.nome,
           coalesce(s.linha_dre_id, g.linha_dre_id),
           round(-cc.valor * coalesce(pe.w, 0), 2), f.data_vencimento <= current_date,
           coalesce(cc.centro_custo_id, s.centro_custo_id, g.centro_custo_id)
    from compras_cartao cc
    join faturas f on f.id = cc.fatura_id
    join cartoes ca on ca.id = cc.cartao_id
    join grupos g on g.id = cc.grupo_id
    left join subgrupos s on s.id = cc.subgrupo_id
    left join peso pe on pe.fatura_id = f.id
  ),
  tudo as (select * from base_l union all select * from base_c)
  select origem, id, data, descricao, gnome, snome, cnome, v, pago
  from tudo
  where extract(year from data) = p_ano and extract(month from data) = p_mes
    and linha = p_linha
    and (p_grupo is null or gid = p_grupo)
    and abs(v) > 0
    and (select p from perfil) is not null
    and (not restrito or (select p from perfil) = 'diretor')
    and (p_centro is null
         or cc = p_centro
         or exists (select 1 from centros_custo x where x.id = tudo.cc and x.pai_id = p_centro)
         or (tudo.cc is null and p_centro = (select id from geral)))
  order by data, abs(v) desc
$$;
grant execute on function dre_detalhe(int, int, int, int, int, int) to authenticated;
