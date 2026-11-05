-- RMS Finance · Descontos na baixa
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
-- Desconto concedido ao cliente (condicional, no recebimento): Despesas financeiras · Descontos concedidos
-- Desconto obtido do fornecedor (no pagamento): Receitas financeiras · Descontos obtidos
-- Base: Decreto-Lei 1.598/1977, art. 12; IN SRF 51/1978, item 4.2; RIR/2018 (Decreto 9.580/2018).

insert into subgrupos (grupo_id, nome)
select g.id, v.sub from grupos g
join (values ('Despesas financeiras', 'Descontos concedidos'), ('Receitas financeiras', 'Descontos obtidos')) v(grupo, sub) on v.grupo = g.nome
where not exists (select 1 from subgrupos s where s.grupo_id = g.id and s.nome = v.sub);

-- Desconto informado na baixa e o lançamento separado gerado para ele
alter table lancamentos add column if not exists desconto numeric(14,2) not null default 0;
alter table lancamentos add column if not exists desconto_lanc_id bigint references lancamentos(id) on delete set null;

-- Lotes: desconto por item e lançamento único com a soma dos descontos do lote
alter table lotes_recebimento add column if not exists desconto numeric(14,2) not null default 0;
alter table lotes_recebimento add column if not exists lanc_desconto_id bigint references lancamentos(id) on delete set null;
alter table lotes_recebimento_itens add column if not exists desconto numeric(14,2) not null default 0;

notify pgrst, 'reload schema';
