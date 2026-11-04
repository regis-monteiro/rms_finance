-- RMS Finance · Remove a integração por API com o Efí (extratos cobrados pelo banco)
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
-- A conta Efí volta a ser conciliada por arquivo OFX.

update contas set integracao = null where integracao = 'efi';
alter table contas drop constraint if exists contas_integracao_check;
alter table contas add constraint contas_integracao_check check (integracao in ('inter'));
