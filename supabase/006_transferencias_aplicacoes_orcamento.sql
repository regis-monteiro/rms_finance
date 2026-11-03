-- RMS Finance · Transferências, rendimentos de aplicações e orçamento
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run

-- 1. Transferência entre contas: dois lançamentos (saída e entrada) ligados pelo mesmo código
alter table lancamentos add column transferencia_id uuid;
create index on lancamentos (transferencia_id);

-- 2. Aplicações financeiras (produtos dentro das contas de aplicação)
create table aplicacoes (
  id serial primary key,
  conta_id int not null references contas(id),
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (conta_id, nome)
);

-- Posição mensal de cada aplicação, informada pelo extrato
create table aplicacoes_saldos (
  id serial primary key,
  aplicacao_id int not null references aplicacoes(id) on delete cascade,
  competencia date not null,                 -- primeiro dia do mês
  saldo_bruto numeric(14,2) not null,
  saldo_liquido numeric(14,2) not null,
  aporte numeric(14,2) not null default 0,   -- valor aplicado no mês
  resgate numeric(14,2) not null default 0,  -- valor resgatado no mês
  rendimento numeric(14,2),                  -- calculado ao confirmar
  irrf numeric(14,2),                        -- variação de (bruto - líquido) no mês
  data_confirmacao date,
  lanc_rendimento_id bigint references lancamentos(id) on delete set null,
  lanc_irrf_id bigint references lancamentos(id) on delete set null,
  unique (aplicacao_id, competencia)
);

alter table aplicacoes enable row level security;
alter table aplicacoes_saldos enable row level security;
create policy aplic_rw on aplicacoes for all
  using (meu_perfil() in ('diretor', 'financeiro')) with check (meu_perfil() in ('diretor', 'financeiro'));
create policy aplic_saldos_rw on aplicacoes_saldos for all
  using (meu_perfil() in ('diretor', 'financeiro')) with check (meu_perfil() in ('diretor', 'financeiro'));

-- Subgrupo IRRF dentro de Impostos (usado na confirmação)
insert into subgrupos (grupo_id, nome) select id, 'IRRF' from grupos where nome = 'Impostos' on conflict do nothing;

-- 3. Orçamento financeiro por grupo e mês (valor com sinal: receita positiva, despesa negativa)
create table orcamento (
  id serial primary key,
  ano int not null,
  mes int not null check (mes between 1 and 12),
  grupo_id int not null references grupos(id),
  valor numeric(14,2) not null default 0,
  gerado_em timestamptz not null default now(),
  unique (ano, mes, grupo_id)
);
alter table orcamento enable row level security;
create policy orc_ler on orcamento for select using (meu_perfil() is not null);
create policy orc_gravar on orcamento for all using (meu_perfil() = 'diretor') with check (meu_perfil() = 'diretor');

-- Aplicações já movimentadas em 2026 (a partir dos rendimentos e IRRF lançados nas contas de aplicação)
insert into aplicacoes (conta_id, nome)
select distinct l.conta_id, trim(l.favorecido)
from lancamentos l join contas c on c.id = l.conta_id join grupos g on g.id = l.grupo_id
where c.tipo = 'aplicacao' and g.nome in ('Rendimentos', 'Impostos') and trim(l.favorecido) <> '' and l.vencimento >= date '2026-01-01'
on conflict do nothing;

-- Rendimentos e IRRF retidos dentro das aplicações não exigem beneficiário
create or replace function exigir_beneficiario() returns trigger
language plpgsql as $$
begin
  if new.tipo = 'saida' and new.vencimento >= date '2027-01-01' and new.beneficiario_id is null
     and new.fatura_id is null and new.transferencia_id is null
     and not exists (select 1 from grupos g where g.id = new.grupo_id and g.nome in ('Transferências', 'Pagamento de fatura'))
     and not exists (select 1 from contas c where c.id = new.conta_id and c.tipo = 'aplicacao') then
    raise exception 'A partir de 01/01/2027, informe o beneficiário cadastrado para pagamentos.';
  end if;
  return new;
end $$;
