-- RMS Finance · Integração bancária (Inter e Efí)
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run
-- Indica qual conta do app corresponde a cada banco integrado. As credenciais NÃO ficam no banco de dados:
-- são guardadas como variáveis de ambiente na Vercel.

alter table contas add column integracao text check (integracao in ('inter', 'efi'));
create unique index contas_integracao_unica on contas (integracao) where integracao is not null;

update contas set integracao = 'inter' where nome = 'Inter' and tipo = 'corrente';
update contas set integracao = 'efi' where nome ilike 'Efí%' and tipo = 'corrente';
