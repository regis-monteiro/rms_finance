import { useEffect, useState } from 'react';
import { supabase, type Conta, type Grupo, type Subgrupo, type Cartao } from './supabase';

export function useCadastros() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [subgrupos, setSubgrupos] = useState<Subgrupo[]>([]);
  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    Promise.all([
      supabase.from('contas').select('*').order('ordem'),
      supabase.from('grupos').select('*').eq('ativo', true).order('nome'),
      supabase.from('subgrupos').select('*').eq('ativo', true).order('nome'),
      supabase.from('cartoes').select('*').order('nome'),
    ]).then(([c, g, s, k]) => {
      setContas((c.data as Conta[]) || []);
      setGrupos((g.data as Grupo[]) || []);
      setSubgrupos((s.data as Subgrupo[]) || []);
      setCartoes((k.data as Cartao[]) || []);
    });
  }, [versao]);

  return { contas, grupos, subgrupos, cartoes, recarregar: () => setVersao(v => v + 1) };
}
