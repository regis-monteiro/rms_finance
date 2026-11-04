-- RMS Finance · Desfazer baixa
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
-- Guarda o status e a conta que o lançamento tinha antes da baixa, para poder desfazê-la
-- sem excluir a conta a pagar ou a receber. Ex.: {"status":"confirmado","conta_id":null}
alter table lancamentos add column baixa_anterior jsonb;
