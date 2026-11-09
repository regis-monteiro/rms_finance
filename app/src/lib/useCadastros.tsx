import { useEffect, useState } from 'react';
import { supabase, type Conta, type Grupo, type Subgrupo, type Cartao, type Beneficiario, type CentroCusto } from './supabase';

export function useCadastros() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [subgrupos, setSubgrupos] = useState<Subgrupo[]>([]);
  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [beneficiarios, setBeneficiarios] = useState<Beneficiario[]>([]);
  const [todosSub, setTodosSub] = useState<Subgrupo[]>([]);
  const [todosGrupos, setTodosGrupos] = useState<Grupo[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    Promise.all([
      supabase.from('contas').select('*').order('ordem'),
      supabase.from('grupos').select('*').order('nome'),
      supabase.from('subgrupos').select('*').order('nome'),
      supabase.from('cartoes').select('*').order('nome'),
      supabase.from('beneficiarios').select('*').order('nome'),
      supabase.from('centros_custo').select('*').eq('ativo', true).order('ordem'),
    ]).then(([c, g, s, k, b, cc]) => {
      setCentros((cc.data as CentroCusto[]) || []);
      setContas((c.data as Conta[]) || []);
      // telas de lançamento só oferecem grupos ativos; todosGrupos serve para mostrar nomes de lançamentos antigos
      setTodosGrupos((g.data as Grupo[]) || []); setGrupos(((g.data as Grupo[]) || []).filter(x => x.ativo));
      setTodosSub((s.data as Subgrupo[]) || []); setSubgrupos(((s.data as Subgrupo[]) || []).filter(x => x.ativo !== false));
      setCartoes((k.data as Cartao[]) || []);
      setBeneficiarios((b.data as Beneficiario[]) || []);
    });
  }, [versao]);

  return { todosGrupos, todosSub, centros, contas, grupos, subgrupos, cartoes, beneficiarios, recarregar: () => setVersao(v => v + 1) };
}

/** Rótulo do centro de custo; os subcentros do Geral aparecem como "Geral · Fiscal" */
export function nomeCentro(centros: CentroCusto[], id: number | null | undefined) {
  const c = centros.find(x => x.id === id); if (!c) return '';
  const pai = centros.find(x => x.id === c.pai_id);
  return pai ? `${pai.nome} · ${c.nome}` : c.nome;
}

/** Centro padrão do plano de contas: o do subgrupo prevalece sobre o do grupo */
export function centroPadrao(grupos: Grupo[], subgrupos: Subgrupo[], grupo: number | null | undefined, sub: number | null | undefined) {
  return subgrupos.find(s => s.id === sub)?.centro_custo_id ?? grupos.find(g => g.id === grupo)?.centro_custo_id ?? null;
}

/** Opções de centro de custo para listas: principais e, dentro do Geral, os subcentros */
export function OpcoesCentro({ centros }: { centros: CentroCusto[] }) {
  return <>{centros.filter(c => !c.pai_id).map(c => [
    <option key={c.id} value={c.id}>{c.nome}</option>,
    ...centros.filter(f => f.pai_id === c.id).map(f => <option key={f.id} value={f.id}>{'   '}{c.nome} · {f.nome}</option>),
  ])}</>;
}
