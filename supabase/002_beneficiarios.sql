-- RMS Finance · Cadastro de fornecedores/beneficiários
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run

-- Valida CPF (11 dígitos) ou CNPJ (14 dígitos) pelos dígitos verificadores
create or replace function documento_valido(doc text) returns boolean
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(doc, ''), '\D', '', 'g'); s int; r int; i int;
  p1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; p2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if d ~ '^(\d)\1+$' then return false; end if;
  if length(d) = 11 then
    for k in 0..1 loop
      s := 0;
      for i in 1..9 + k loop s := s + substr(d, i, 1)::int * (11 + k - i); end loop;
      r := (s * 10) % 11; if r = 10 then r := 0; end if;
      if r <> substr(d, 10 + k, 1)::int then return false; end if;
    end loop;
    return true;
  elsif length(d) = 14 then
    s := 0; for i in 1..12 loop s := s + substr(d, i, 1)::int * p1[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    if r <> substr(d, 13, 1)::int then return false; end if;
    s := 0; for i in 1..13 loop s := s + substr(d, i, 1)::int * p2[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    return r = substr(d, 14, 1)::int;
  end if;
  return false;
end $$;

create table beneficiarios (
  id serial primary key,
  nome text not null check (length(trim(nome)) > 0),
  documento text not null unique check (documento ~ '^\d{11}$|^\d{14}$' and documento_valido(documento)),
  nome_fantasia text,
  email text,
  telefone text,
  cep text, logradouro text, numero text, complemento text, bairro text, cidade text, uf text,
  banco text, agencia text, conta text,
  pix_tipo text check (pix_tipo in ('cpf_cnpj', 'email', 'telefone', 'aleatoria')),
  pix_chave text,
  grupo_id int references grupos(id),
  subgrupo_id int references subgrupos(id),
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index on beneficiarios (lower(nome));

alter table lancamentos add column beneficiario_id int references beneficiarios(id);
create index on lancamentos (beneficiario_id);

-- A partir de 01/01/2027, toda saída precisa de beneficiário cadastrado
-- (exceto pagamento de fatura de cartão e transferências entre contas da RMS)
create or replace function exigir_beneficiario() returns trigger
language plpgsql as $$
begin
  if new.tipo = 'saida' and new.vencimento >= date '2027-01-01' and new.beneficiario_id is null
     and new.fatura_id is null
     and not exists (select 1 from grupos g where g.id = new.grupo_id and g.nome in ('Transferências', 'Pagamento de fatura')) then
    raise exception 'A partir de 01/01/2027, informe o beneficiário cadastrado para pagamentos.';
  end if;
  return new;
end $$;

create trigger trg_exigir_beneficiario before insert or update on lancamentos
for each row execute function exigir_beneficiario();

-- Permissões: Diretor e Financeiro consultam e cadastram
alter table beneficiarios enable row level security;
create policy benef_rw on beneficiarios for all
  using (meu_perfil() in ('diretor', 'financeiro')) with check (meu_perfil() in ('diretor', 'financeiro'));
