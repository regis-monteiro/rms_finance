-- RMS Finance · Histórico de reclassificações (com desfazer) e telefones do cadastro
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run

-- 1. Histórico ----------------------------------------------------------------
create table if not exists reclassificacoes (
  id serial primary key,
  criado_em timestamptz not null default now(),
  usuario_id uuid references usuarios(id) default auth.uid(),
  origem text not null check (origem in ('plano', 'semelhantes', 'lote')),
  descricao text not null,
  de_texto text, para_texto text, filtros text,
  qtd_lancamentos int not null default 0, qtd_compras int not null default 0, qtd_cadastros int not null default 0,
  desfeita_em timestamptz, desfeita_por uuid references usuarios(id), restaurados int, ignorados int
);
create table if not exists reclassificacao_itens (
  id bigserial primary key,
  reclassificacao_id int not null references reclassificacoes(id) on delete cascade,
  tabela text not null check (tabela in ('lancamentos', 'compras_cartao', 'lancamento_rateios', 'beneficiarios')),
  registro_id bigint not null,
  grupo_ant int, sub_ant int, centro_ant int,
  grupo_novo int, sub_novo int, centro_novo int
);
create index if not exists reclassificacao_itens_rid_idx on reclassificacao_itens (reclassificacao_id);
alter table reclassificacoes enable row level security;
alter table reclassificacao_itens enable row level security;
drop policy if exists reclass_ler on reclassificacoes;
create policy reclass_ler on reclassificacoes for select using (meu_perfil() in ('diretor', 'financeiro'));
drop policy if exists reclass_itens_ler on reclassificacao_itens;
create policy reclass_itens_ler on reclassificacao_itens for select using (meu_perfil() in ('diretor', 'financeiro'));

-- Nome legível de uma classificação ("Grupo · Subgrupo")
create or replace function nome_classe(p_grupo int, p_sub int, p_sem_sub boolean default false) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nome from grupos where id = p_grupo), '?')
         || case when p_sub is not null then ' · ' || coalesce((select nome from subgrupos where id = p_sub), '?')
                 when p_sem_sub then ' · (sem subgrupo)' else '' end
$$;

-- Registra no histórico uma reclassificação feita pelo app (semelhantes ou alteração em lote).
-- Grava a classificação atual dos lançamentos; o app faz a alteração em seguida.
create or replace function registrar_reclassificacao(p_origem text, p_descricao text, p_ids bigint[], p_grupo int, p_sub int)
returns int language plpgsql security definer set search_path = public as $$
declare rid int; n int;
begin
  if meu_perfil() not in ('diretor', 'financeiro') then raise exception 'Sem permissão para reclassificar.'; end if;
  select count(*) into n from lancamentos where id = any(p_ids) and (grupo_id is distinct from p_grupo or subgrupo_id is distinct from p_sub);
  if n = 0 then return null; end if;
  insert into reclassificacoes (origem, descricao, para_texto, qtd_lancamentos)
  values (p_origem, p_descricao, nome_classe(p_grupo, p_sub), n) returning id into rid;
  insert into reclassificacao_itens (reclassificacao_id, tabela, registro_id, grupo_ant, sub_ant, centro_ant, grupo_novo, sub_novo, centro_novo)
  select rid, 'lancamentos', id, grupo_id, subgrupo_id, centro_custo_id, p_grupo, p_sub, centro_custo_id
  from lancamentos where id = any(p_ids) and (grupo_id is distinct from p_grupo or subgrupo_id is distinct from p_sub);
  update reclassificacoes set de_texto = (
    select case when count(distinct (grupo_ant, sub_ant)) = 1 then nome_classe(min(grupo_ant), min(sub_ant), min(sub_ant) is null) else 'Várias classificações' end
    from reclassificacao_itens where reclassificacao_id = rid) where id = rid;
  return rid;
end $$;
grant execute on function registrar_reclassificacao(text, text, bigint[], int, int) to authenticated;

-- Desfaz: volta a classificação anterior só dos registros que ainda estão como a reclassificação deixou
create or replace function desfazer_reclassificacao(p_id int)
returns table (restaurados int, ignorados int) language plpgsql security definer set search_path = public as $$
declare r reclassificacoes; ok int := 0; tot int; x int;
begin
  select * into r from reclassificacoes where id = p_id;
  if r.id is null then raise exception 'Reclassificação não encontrada.'; end if;
  if r.desfeita_em is not null then raise exception 'Esta reclassificação já foi desfeita.'; end if;
  if r.origem = 'plano' and meu_perfil() is distinct from 'diretor' then raise exception 'Somente o Diretor pode desfazer reclassificações do plano de contas.'; end if;
  if meu_perfil() not in ('diretor', 'financeiro') then raise exception 'Sem permissão.'; end if;
  select count(*) into tot from reclassificacao_itens where reclassificacao_id = p_id;

  update lancamentos l set grupo_id = i.grupo_ant, subgrupo_id = i.sub_ant, centro_custo_id = i.centro_ant, atualizado_em = now()
  from reclassificacao_itens i
  where i.reclassificacao_id = p_id and i.tabela = 'lancamentos' and l.id = i.registro_id
    and l.grupo_id = i.grupo_novo and l.subgrupo_id is not distinct from i.sub_novo and l.centro_custo_id is not distinct from i.centro_novo;
  get diagnostics x = row_count; ok := ok + x;
  update compras_cartao c set grupo_id = i.grupo_ant, subgrupo_id = i.sub_ant, centro_custo_id = i.centro_ant
  from reclassificacao_itens i
  where i.reclassificacao_id = p_id and i.tabela = 'compras_cartao' and c.id = i.registro_id
    and c.grupo_id = i.grupo_novo and c.subgrupo_id is not distinct from i.sub_novo and c.centro_custo_id is not distinct from i.centro_novo;
  get diagnostics x = row_count; ok := ok + x;
  update lancamento_rateios t set grupo_id = i.grupo_ant, subgrupo_id = i.sub_ant, centro_custo_id = i.centro_ant
  from reclassificacao_itens i
  where i.reclassificacao_id = p_id and i.tabela = 'lancamento_rateios' and t.id = i.registro_id
    and t.grupo_id = i.grupo_novo and t.subgrupo_id is not distinct from i.sub_novo and t.centro_custo_id is not distinct from i.centro_novo;
  get diagnostics x = row_count; ok := ok + x;
  update beneficiarios b set grupo_id = i.grupo_ant, subgrupo_id = i.sub_ant
  from reclassificacao_itens i
  where i.reclassificacao_id = p_id and i.tabela = 'beneficiarios' and b.id = i.registro_id
    and b.grupo_id is not distinct from i.grupo_novo and b.subgrupo_id is not distinct from i.sub_novo;
  get diagnostics x = row_count; ok := ok + x;

  update reclassificacoes set desfeita_em = now(), desfeita_por = auth.uid(), restaurados = ok, ignorados = tot - ok where id = p_id;
  return query select ok, tot - ok;
end $$;
grant execute on function desfazer_reclassificacao(int) to authenticated;

-- 2. Reclassificação pelo plano de contas passa a gravar o histórico ---------
create or replace function reclassificar(
  p_de_grupo int, p_de_sub int, p_para_grupo int, p_para_sub int,
  p_inicio date default null, p_fim date default null, p_texto text default null,
  p_centro int default null, p_aplicar boolean default false)
returns table (lancamentos int, compras int, beneficiarios int)
language plpgsql security definer set search_path = public as $$
declare nl int; nc int; nb int := 0; txt text := nullif(trim(coalesce(p_texto, '')), ''); rid int; nr int;
begin
  if meu_perfil() is distinct from 'diretor' then raise exception 'Somente o Diretor pode reclassificar lançamentos.'; end if;
  if p_para_sub is not null and not exists (select 1 from subgrupos where id = p_para_sub and grupo_id = p_para_grupo) then
    raise exception 'O subgrupo de destino não pertence ao grupo de destino.';
  end if;

  create temp table _l on commit drop as
  select l.id from lancamentos l
  where l.grupo_id = p_de_grupo
    and (p_de_sub is null or (p_de_sub = 0 and l.subgrupo_id is null) or l.subgrupo_id = p_de_sub)
    and l.transferencia_id is null and l.fatura_id is null
    and (p_inicio is null or coalesce(l.data_pagamento, l.vencimento) >= p_inicio)
    and (p_fim is null or coalesce(l.data_pagamento, l.vencimento) <= p_fim)
    and (txt is null or l.favorecido ilike '%' || txt || '%' or coalesce(l.referencia, '') ilike '%' || txt || '%');
  create temp table _c on commit drop as
  select c.id from compras_cartao c
  where c.grupo_id = p_de_grupo
    and (p_de_sub is null or (p_de_sub = 0 and c.subgrupo_id is null) or c.subgrupo_id = p_de_sub)
    and (p_inicio is null or c.data_compra >= p_inicio)
    and (p_fim is null or c.data_compra <= p_fim)
    and (txt is null or c.descricao ilike '%' || txt || '%');
  select count(*) into nl from _l;
  select count(*) into nc from _c;
  if p_inicio is null and p_fim is null and txt is null then
    select count(*) into nb from beneficiarios b
    where b.grupo_id = p_de_grupo and (p_de_sub is null or (p_de_sub = 0 and b.subgrupo_id is null) or b.subgrupo_id = p_de_sub);
  end if;

  create temp table _r on commit drop as
  select r.id from lancamento_rateios r join lancamentos l on l.id = r.lancamento_id
  where r.grupo_id = p_de_grupo
    and (p_de_sub is null or (p_de_sub = 0 and r.subgrupo_id is null) or r.subgrupo_id = p_de_sub)
    and (p_inicio is null or coalesce(l.data_pagamento, l.vencimento) >= p_inicio)
    and (p_fim is null or coalesce(l.data_pagamento, l.vencimento) <= p_fim)
    and (txt is null or l.favorecido ilike '%' || txt || '%' or coalesce(l.referencia, '') ilike '%' || txt || '%');

  if p_aplicar then
    -- histórico com a classificação anterior de cada registro, para poder desfazer
    insert into reclassificacoes (origem, descricao, de_texto, para_texto, filtros, usuario_id)
    values ('plano', 'Reclassificação pelo plano de contas', nome_classe(p_de_grupo, nullif(p_de_sub, 0), p_de_sub = 0), nome_classe(p_para_grupo, p_para_sub, false),
            concat_ws(' · ', case when p_inicio is not null or p_fim is not null then 'período ' || coalesce(to_char(p_inicio, 'DD/MM/YYYY'), 'início') || ' a ' || coalesce(to_char(p_fim, 'DD/MM/YYYY'), 'hoje') end,
                      case when txt is not null then 'texto "' || txt || '"' end), auth.uid())
    returning id into rid;
    insert into reclassificacao_itens (reclassificacao_id, tabela, registro_id, grupo_ant, sub_ant, centro_ant, grupo_novo, sub_novo, centro_novo)
    select rid, 'lancamentos', l.id, l.grupo_id, l.subgrupo_id, l.centro_custo_id, p_para_grupo, p_para_sub,
           case when p_centro is null then l.centro_custo_id when p_centro = 0 then null else p_centro end
    from lancamentos l where l.id in (select id from _l)
    union all
    select rid, 'compras_cartao', c.id, c.grupo_id, c.subgrupo_id, c.centro_custo_id, p_para_grupo, p_para_sub,
           case when p_centro is null then c.centro_custo_id when p_centro = 0 then null else p_centro end
    from compras_cartao c where c.id in (select id from _c)
    union all
    select rid, 'lancamento_rateios', r.id, r.grupo_id, r.subgrupo_id, r.centro_custo_id, p_para_grupo, p_para_sub,
           case when p_centro is null then r.centro_custo_id when p_centro = 0 then null else p_centro end
    from lancamento_rateios r where r.id in (select id from _r)
    union all
    select rid, 'beneficiarios', b.id, b.grupo_id, b.subgrupo_id, null, p_para_grupo, p_para_sub, null
    from beneficiarios b
    where nb > 0 and b.grupo_id = p_de_grupo and (p_de_sub is null or (p_de_sub = 0 and b.subgrupo_id is null) or b.subgrupo_id = p_de_sub);
    select count(*) into nr from _r;
    update reclassificacoes set qtd_lancamentos = nl + nr, qtd_compras = nc, qtd_cadastros = nb where id = rid;

    update lancamentos set grupo_id = p_para_grupo, subgrupo_id = p_para_sub,
           centro_custo_id = case when p_centro is null then centro_custo_id when p_centro = 0 then null else p_centro end,
           atualizado_em = now()
    where id in (select id from _l);
    update compras_cartao set grupo_id = p_para_grupo, subgrupo_id = p_para_sub,
           centro_custo_id = case when p_centro is null then centro_custo_id when p_centro = 0 then null else p_centro end
    where id in (select id from _c);
    -- linhas de rateio com a classificação de origem
    update lancamento_rateios r set grupo_id = p_para_grupo, subgrupo_id = p_para_sub,
           centro_custo_id = case when p_centro is null then r.centro_custo_id when p_centro = 0 then null else p_centro end
    where r.id in (select id from _r);
    if nb > 0 then
      update beneficiarios set grupo_id = p_para_grupo, subgrupo_id = p_para_sub
      where grupo_id = p_de_grupo and (p_de_sub is null or (p_de_sub = 0 and subgrupo_id is null) or subgrupo_id = p_de_sub);
    end if;
  end if;
  return query select nl, nc, nb;
end $$;

grant execute on function reclassificar(int, int, int, int, date, date, text, int, boolean) to authenticated;

-- 3. Telefones: vários por cadastro, com descrição e um principal -------------
alter table beneficiarios add column if not exists telefones jsonb not null default '[]'::jsonb;
update beneficiarios set telefones = jsonb_build_array(jsonb_build_object('numero', regexp_replace(telefone, '\D', '', 'g'), 'descricao', '', 'principal', true))
where coalesce(trim(telefone), '') <> '' and telefones = '[]'::jsonb;

notify pgrst, 'reload schema';
