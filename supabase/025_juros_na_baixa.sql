-- RMS Finance · Multa e juros na baixa (recebimentos e pagamentos), também nos lotes
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
-- Recebidos de clientes: Receitas financeiras · Juros e multas recebidos
-- Pagos a fornecedores: Despesas financeiras · Multa/juros por atraso (já existente)

insert into subgrupos (grupo_id, nome)
select g.id, 'Juros e multas recebidos' from grupos g
where g.nome = 'Receitas financeiras'
  and not exists (select 1 from subgrupos s where s.grupo_id = g.id and s.nome = 'Juros e multas recebidos');
insert into subgrupos (grupo_id, nome)
select g.id, 'Multa/juros por atraso' from grupos g
where g.nome = 'Despesas financeiras'
  and not exists (select 1 from subgrupos s where s.grupo_id = g.id and s.nome = 'Multa/juros por atraso');

-- Lotes: juros por item e lançamento único com a soma dos juros do lote
alter table lotes_recebimento add column if not exists juros numeric(14,2) not null default 0;
alter table lotes_recebimento add column if not exists lanc_juros_id bigint references lancamentos(id) on delete set null;
alter table lotes_recebimento_itens add column if not exists juros numeric(14,2) not null default 0;

notify pgrst, 'reload schema';
