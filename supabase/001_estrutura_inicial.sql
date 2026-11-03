-- RMS Finance · Estrutura inicial do banco de dados
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run

-- =========================================================
-- 1. Tipos
-- =========================================================
create type perfil_usuario as enum ('diretor', 'financeiro', 'consulta');
create type tipo_conta     as enum ('corrente', 'aplicacao', 'especie');
create type tipo_lancamento as enum ('entrada', 'saida');
create type status_lancamento as enum ('previsto', 'confirmado', 'agendado', 'pago');
create type natureza_grupo as enum ('receita', 'despesa', 'movimentacao');

-- =========================================================
-- 2. Usuários e perfis
-- =========================================================
create table usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  email text not null,
  perfil perfil_usuario not null default 'consulta',
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Perfil do usuário logado (nulo se inativo ou inexistente)
create or replace function meu_perfil() returns perfil_usuario
language sql stable security definer set search_path = public as $$
  select perfil from usuarios where id = auth.uid() and ativo
$$;

-- Ao criar login: o primeiro usuário vira Diretor ativo; os demais entram como Consulta,
-- bloqueados até um Diretor liberar o acesso
create or replace function novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare primeiro boolean := (select count(*) from usuarios) = 0;
begin
  insert into usuarios (id, email, nome, perfil, ativo)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    case when primeiro then 'diretor'::perfil_usuario else 'consulta'::perfil_usuario end,
    primeiro
  );
  return new;
end $$;

create trigger trg_novo_usuario after insert on auth.users
for each row execute function novo_usuario();

-- =========================================================
-- 3. Cadastros
-- =========================================================
create table contas (
  id serial primary key,
  nome text not null unique,
  tipo tipo_conta not null,
  saldo_inicial numeric(14,2) not null default 0,
  data_saldo_inicial date not null default date '2026-01-01',
  ativa boolean not null default true,
  ordem int not null default 0
);

create table linhas_dre (
  id serial primary key,
  nome text not null unique,
  ordem int not null,
  no_resultado boolean not null default true  -- false = movimentação de caixa fora do resultado
);

create table grupos (
  id serial primary key,
  nome text not null unique,
  natureza natureza_grupo not null,
  linha_dre_id int references linhas_dre(id),
  restrito boolean not null default false,   -- pessoal, pró-labore, sócios
  ativo boolean not null default true
);

create table subgrupos (
  id serial primary key,
  grupo_id int not null references grupos(id) on delete cascade,
  nome text not null,
  linha_dre_id int references linhas_dre(id), -- sobrepõe a linha do grupo (ex.: Certificação > Custo)
  ativo boolean not null default true,
  unique (grupo_id, nome)
);

create table cartoes (
  id serial primary key,
  nome text not null unique,
  dia_fechamento int not null check (dia_fechamento between 1 and 31),
  dia_vencimento int not null check (dia_vencimento between 1 and 31),
  ativo boolean not null default true
);

-- =========================================================
-- 4. Movimento
-- =========================================================
create table faturas (
  id serial primary key,
  cartao_id int not null references cartoes(id),
  competencia date not null,            -- primeiro dia do mês do vencimento
  data_fechamento date not null,
  data_vencimento date not null,
  unique (cartao_id, competencia)
);

create table compras_cartao (
  id bigserial primary key,
  cartao_id int not null references cartoes(id),
  fatura_id int not null references faturas(id),
  data_compra date not null,
  descricao text not null,
  grupo_id int not null references grupos(id),
  subgrupo_id int references subgrupos(id),
  parcela text,
  valor numeric(14,2) not null,         -- negativo = estorno
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);

create table lancamentos (
  id bigserial primary key,
  tipo tipo_lancamento not null,
  conta_id int references contas(id),   -- pode ficar em branco enquanto Previsto
  vencimento date not null,
  data_pagamento date,
  grupo_id int not null references grupos(id),
  subgrupo_id int references subgrupos(id),
  favorecido text not null default '',
  referencia text,
  documento text,
  valor numeric(14,2) not null check (valor > 0),
  status status_lancamento not null default 'previsto',
  forma_pagamento text,
  fatura_id int references faturas(id), -- preenchido quando é pagamento de fatura de cartão
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint pago_tem_conta check (status <> 'pago' or (conta_id is not null and data_pagamento is not null))
);
create index on lancamentos (vencimento);
create index on lancamentos (status);
create index on lancamentos (grupo_id);

create table previsoes_receita (
  id serial primary key,
  ano int not null,
  mes int not null check (mes between 1 and 12),
  grupo_id int not null references grupos(id),
  valor numeric(14,2) not null default 0,
  unique (ano, mes, grupo_id)
);

-- =========================================================
-- 5. Visões de apoio
-- =========================================================
create view saldos_contas as
select c.id, c.nome, c.tipo, c.ordem,
       c.saldo_inicial
       + coalesce(sum(case when l.tipo = 'entrada' then l.valor else -l.valor end)
                  filter (where l.status = 'pago' and l.data_pagamento >= c.data_saldo_inicial), 0) as saldo
from contas c
left join lancamentos l on l.conta_id = c.id
where c.ativa
  and meu_perfil() is not null
  and not (meu_perfil() = 'consulta' and c.tipo = 'aplicacao')
group by c.id;

create view faturas_resumo as
select f.*, ca.nome as cartao,
       coalesce((select sum(valor) from compras_cartao cc where cc.fatura_id = f.id), 0) as total,
       coalesce((select sum(valor) from lancamentos l where l.fatura_id = f.id and l.status = 'pago'), 0) as pago
from faturas f join cartoes ca on ca.id = f.cartao_id
where meu_perfil() in ('diretor', 'financeiro');

-- =========================================================
-- 6. Permissões (Row Level Security)
-- =========================================================
alter table usuarios enable row level security;
alter table contas enable row level security;
alter table linhas_dre enable row level security;
alter table grupos enable row level security;
alter table subgrupos enable row level security;
alter table cartoes enable row level security;
alter table faturas enable row level security;
alter table compras_cartao enable row level security;
alter table lancamentos enable row level security;
alter table previsoes_receita enable row level security;

-- Usuários: cada um vê o próprio registro; Diretor vê e altera todos
create policy usuarios_ler on usuarios for select using (id = auth.uid() or meu_perfil() = 'diretor');
create policy usuarios_alterar on usuarios for update using (meu_perfil() = 'diretor');

-- Cadastros: todos os usuários ativos leem; só Diretor altera
do $$ declare t text; begin
  foreach t in array array['contas','linhas_dre','grupos','subgrupos','cartoes'] loop
    execute format('create policy %1$s_ler on %1$s for select using (meu_perfil() is not null)', t);
    execute format('create policy %1$s_gravar on %1$s for all using (meu_perfil() = ''diretor'') with check (meu_perfil() = ''diretor'')', t);
  end loop;
end $$;

-- Lançamentos: Diretor tudo; Financeiro tudo, exceto grupos restritos; Consulta não acessa
create policy lanc_diretor on lancamentos for all
  using (meu_perfil() = 'diretor') with check (meu_perfil() = 'diretor');
create policy lanc_financeiro on lancamentos for all
  using (meu_perfil() = 'financeiro' and not exists (select 1 from grupos g where g.id = grupo_id and g.restrito))
  with check (meu_perfil() = 'financeiro' and not exists (select 1 from grupos g where g.id = grupo_id and g.restrito));

-- Cartões e faturas: Diretor e Financeiro
create policy faturas_rw on faturas for all
  using (meu_perfil() in ('diretor','financeiro')) with check (meu_perfil() in ('diretor','financeiro'));
create policy compras_rw on compras_cartao for all
  using (meu_perfil() in ('diretor','financeiro')) with check (meu_perfil() in ('diretor','financeiro'));

-- Previsões de receita: todos leem; Diretor e Financeiro gravam
create policy prev_ler on previsoes_receita for select using (meu_perfil() is not null);
create policy prev_gravar on previsoes_receita for all
  using (meu_perfil() in ('diretor','financeiro')) with check (meu_perfil() in ('diretor','financeiro'));

grant select on saldos_contas, faturas_resumo to authenticated;

-- =========================================================
-- 7. Dados iniciais
-- =========================================================
insert into contas (nome, tipo, ordem) values
  ('Inter', 'corrente', 1), ('Efí (Gerencianet)', 'corrente', 2), ('Bradesco', 'corrente', 3),
  ('AF Inter', 'aplicacao', 4), ('AF Bradesco', 'aplicacao', 5), ('Caixa', 'especie', 6);

-- Fechamento provisório: 7 dias antes do vencimento (ajustar em Cadastros)
insert into cartoes (nome, dia_vencimento, dia_fechamento) values
  ('Itaucard', 11, 4), ('PJ Inter', 10, 3), ('Efí', 13, 6), ('Porto', 20, 13);

insert into linhas_dre (nome, ordem, no_resultado) values
  ('Receita de serviços', 10, true),
  ('Custos diretos', 20, true),
  ('Despesas com pessoal', 30, true),
  ('Despesas administrativas', 40, true),
  ('Despesas não previstas', 50, true),
  ('Impostos e taxas', 60, true),
  ('Resultado financeiro', 70, true),
  ('Remuneração dos sócios', 80, true),
  ('Investimentos em ativos', 110, false),
  ('Sócios', 120, false),
  ('Financiamentos', 130, false),
  ('Entre contas', 140, false);

insert into grupos (nome, natureza, linha_dre_id, restrito)
select g.nome, g.natureza::natureza_grupo, l.id, g.restrito
from (values
  ('Honorários','receita','Receita de serviços',false),
  ('IRPF','receita','Receita de serviços',false),
  ('Certificação','receita','Receita de serviços',false),
  ('Comissões','receita','Receita de serviços',false),
  ('Operação','despesa','Custos diretos',false),
  ('Clientes','despesa','Custos diretos',false),
  ('VGP','despesa','Custos diretos',false),
  ('Funcionários','despesa','Despesas com pessoal',true),
  ('Treinamentos','despesa','Despesas com pessoal',false),
  ('Endomarketing','despesa','Despesas com pessoal',false),
  ('Administrativas','despesa','Despesas administrativas',false),
  ('Alimentação','despesa','Despesas administrativas',false),
  ('Informática','despesa','Despesas administrativas',false),
  ('Imóveis','despesa','Despesas administrativas',false),
  ('Locomoção','despesa','Despesas administrativas',false),
  ('Manut Equipamentos','despesa','Despesas administrativas',false),
  ('Manut. Instalações','despesa','Despesas administrativas',false),
  ('Manutenção Predial','despesa','Despesas administrativas',false),
  ('Material Escritório','despesa','Despesas administrativas',false),
  ('Material Limpeza/Copa','despesa','Despesas administrativas',false),
  ('Marketing','despesa','Despesas administrativas',false),
  ('Não previstas','despesa','Despesas não previstas',false),
  ('Impostos','despesa','Impostos e taxas',false),
  ('Rendimentos','receita','Resultado financeiro',false),
  ('Juros Bancários','despesa','Resultado financeiro',false),
  ('Tarifas Bancárias','despesa','Resultado financeiro',false),
  ('Tarifas Diversas','despesa','Resultado financeiro',false),
  ('Pró-labore','despesa','Remuneração dos sócios',true),
  ('Equipamentos','movimentacao','Investimentos em ativos',false),
  ('Mobiliário','movimentacao','Investimentos em ativos',false),
  ('Investimento','movimentacao','Investimentos em ativos',false),
  ('Distribuição de lucros','movimentacao','Sócios',true),
  ('Sócios','movimentacao','Sócios',true),
  ('Empréstimos','movimentacao','Financiamentos',false),
  ('Transferências','movimentacao','Entre contas',false),
  ('Pagamento de fatura','movimentacao','Entre contas',false)
) as g(nome, natureza, linha, restrito)
join linhas_dre l on l.nome = g.linha;

-- Certificação: o subgrupo Custo vai para Custos diretos
insert into subgrupos (grupo_id, nome, linha_dre_id)
select g.id, s.nome, case when s.nome = 'Custo' then (select id from linhas_dre where nome = 'Custos diretos') end
from grupos g, (values ('Receita'), ('Mensalidade'), ('Custo')) s(nome)
where g.nome = 'Certificação';
