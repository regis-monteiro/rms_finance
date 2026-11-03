import { useEffect, useState } from 'react';
import { supabase, type Conta, type Grupo, type Subgrupo, type Cartao, type Beneficiario } from './supabase';

export function useCadastros() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [subgrupos, setSubgrupos] = useState<Subgrupo[]>([]);
  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [beneficiarios, setBeneficiarios] = useState<Beneficiario[]>([]);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    Promise.all([
      supabase.from('contas').select('*').order('ordem'),
      supabase.from('grupos').select('*').eq('ativo', true).order('nome'),
      supabase.from('subgrupos').select('*').eq('ativo', true).order('nome'),
      supabase.from('cartoes').select('*').order('nome'),
      supabase.from('beneficiarios').select('*').order('nome'),
    ]).then(([c, g, s, k, b]) => {
      setContas((c.data as Conta[]) || []);
      setGrupos((g.data as Grupo[]) || []);
      setSubgrupos((s.data as Subgrupo[]) || []);
      setCartoes((k.data as Cartao[]) || []);
      setBeneficiarios((b.data as Beneficiario[]) || []);
    });
  }, [versao]);

  return { contas, grupos, subgrupos, cartoes, beneficiarios, recarregar: () => setVersao(v => v + 1) };
}
