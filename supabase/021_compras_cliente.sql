-- RMS Finance · Compras do cartão: cliente relacionado (opcional)
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
alter table compras_cartao add column if not exists cliente_id int references beneficiarios(id);
create index if not exists compras_cartao_cliente_idx on compras_cartao (cliente_id);
notify pgrst, 'reload schema';
