-- RMS Finance · Contas a pagar: cliente relacionado (opcional)
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
alter table lancamentos add column if not exists cliente_id int references beneficiarios(id);
create index if not exists lancamentos_cliente_idx on lancamentos (cliente_id);
notify pgrst, 'reload schema';
