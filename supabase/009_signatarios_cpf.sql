-- RMS Finance · CPF dos signatários (contabilista e sócios), com validação dos dígitos
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
-- Pré-requisito: 008_signatarios.sql

alter table signatarios add column cpf text;

-- Sócios cadastrados antes guardavam o CPF no campo de registro
update signatarios set cpf = regexp_replace(registro, '\D', '', 'g'), registro = null
where tipo = 'socio' and registro is not null and length(regexp_replace(registro, '\D', '', 'g')) = 11;

alter table signatarios add constraint signatarios_cpf_valido
  check (cpf is null or (cpf ~ '^\d{11}$' and documento_valido(cpf)));
