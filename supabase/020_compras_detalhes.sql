-- RMS Finance · Compras do cartão: estabelecimento cadastrado (opcional) e observações
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
alter table compras_cartao add column if not exists beneficiario_id int references beneficiarios(id);
alter table compras_cartao add column if not exists observacao text;
create index if not exists compras_cartao_beneficiario_idx on compras_cartao (beneficiario_id);
notify pgrst, 'reload schema';
