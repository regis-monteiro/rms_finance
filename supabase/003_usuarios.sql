-- RMS Finance · Proteções da tela de Usuários
-- Executar uma única vez no Supabase: SQL Editor > New query > colar este arquivo > Run

-- Impede que o sistema fique sem nenhum Diretor ativo
create or replace function proteger_diretor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (old.perfil = 'diretor' and old.ativo) and (new.perfil <> 'diretor' or not new.ativo)
     and (select count(*) from usuarios where perfil = 'diretor' and ativo and id <> old.id) = 0 then
    raise exception 'É preciso manter pelo menos um Diretor ativo.';
  end if;
  return new;
end $$;

create trigger trg_proteger_diretor before update on usuarios
for each row execute function proteger_diretor();

-- Apenas nome, perfil e situação podem ser alterados pela tela
revoke update on usuarios from authenticated;
grant update (nome, perfil, ativo) on usuarios to authenticated;
