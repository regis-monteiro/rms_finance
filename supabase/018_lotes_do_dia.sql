-- RMS Finance · Lotes de baixa do dia (recebimentos e pagamentos)
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
-- As baixas do mesmo dia, na mesma conta e com o mesmo grupo e subgrupo podem ser reunidas num lote.
alter table lotes_recebimento add column natureza text not null default 'entrada' check (natureza in ('entrada', 'saida'));
alter table lotes_recebimento add column grupo_id int references grupos(id);
alter table lotes_recebimento add column subgrupo_id int references subgrupos(id);
create index on lotes_recebimento (data, conta_id, natureza);

-- Lotes de baixa já existentes: grupo e subgrupo quando todos os itens têm a mesma classificação
update lotes_recebimento lr set grupo_id = x.g, subgrupo_id = x.s
from (select i.lote_id, min(l.grupo_id) as g, min(l.subgrupo_id) as s,
             count(distinct l.grupo_id) as ng, count(distinct coalesce(l.subgrupo_id, 0)) as ns
      from lotes_recebimento_itens i join lancamentos l on l.id = i.lancamento_id group by 1) x
where x.lote_id = lr.id and x.ng = 1 and x.ns = 1 and lr.tipo = 'baixa';
