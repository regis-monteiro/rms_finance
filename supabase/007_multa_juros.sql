-- RMS Finance · Multa e juros por atraso
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run

insert into grupos (nome, natureza, linha_dre_id)
select v.nome, v.natureza::natureza_grupo, l.id
from (values ('Despesas financeiras', 'despesa'), ('Receitas financeiras', 'receita')) v(nome, natureza)
join linhas_dre l on l.nome = 'Resultado financeiro'
on conflict (nome) do nothing;

insert into subgrupos (grupo_id, nome)
select id, 'Multa/juros por atraso' from grupos where nome in ('Despesas financeiras', 'Receitas financeiras')
on conflict do nothing;

-- Valor de multa/juros informado no lançamento e o lançamento separado gerado para ele
alter table lancamentos add column juros_multa numeric(14,2) not null default 0;
alter table lancamentos add column juros_lanc_id bigint references lancamentos(id) on delete set null;
