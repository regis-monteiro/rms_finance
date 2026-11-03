-- RMS Finance · Signatários dos relatórios (contabilista e sócios)
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run

create table signatarios (
  id serial primary key,
  nome text not null,
  cargo text not null,                         -- ex.: Contador responsável, Sócio-diretor
  tipo text not null check (tipo in ('contabilista', 'socio')),
  registro text,                               -- CRC (contabilista) ou CPF (sócio)
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table signatarios enable row level security;
create policy sign_ler on signatarios for select using (meu_perfil() is not null);
create policy sign_gravar on signatarios for all using (meu_perfil() = 'diretor') with check (meu_perfil() = 'diretor');
