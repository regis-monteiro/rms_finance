-- RMS Finance · Desfazer conciliação
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
-- Guarda como o lançamento estava antes de ser conciliado, para poder desfazer.
--   {"modo":"auto"}                                  conciliação automática (só o vínculo)
--   {"modo":"manual","data_pagamento":"..."}         conciliado ajustando a data
--   {"modo":"baixa","status":"...","data_pagamento":null,"conta_id":...}  previsão baixada pela conciliação
--   {"modo":"criado"}                                lançamento criado a partir do extrato
alter table lancamentos add column ofx_anterior jsonb;
