import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface LinhaDRE { id: number; nome: string; ordem: number; no_resultado: boolean }
export interface PontoDRE { linha_dre_id: number; grupo_id: number | null; mes: number; realizado: number; previsto: number }
export type Modo = 'real' | 'prev' | 'comb';

export const valorModo = (p: PontoDRE, m: Modo) => Number(m === 'real' ? p.realizado : m === 'prev' ? p.previsto : Number(p.realizado) + Number(p.previsto));

/** Subtotais exibidos depois da linha de ordem indicada */
export const SUBTOTAIS: [number, string][] = [[20, 'Margem de contribuição'], [60, 'Resultado operacional'], [80, 'Resultado líquido']];

export function useLinhasDRE() {
  const [linhas, setLinhas] = useState<LinhaDRE[]>([]);
  useEffect(() => { supabase.from('linhas_dre').select('*').order('ordem').then(({ data }) => setLinhas((data as LinhaDRE[]) || [])); }, []);
  return linhas;
}

export function useAnos() {
  const [anos, setAnos] = useState<number[]>([new Date().getFullYear()]);
  useEffect(() => { supabase.rpc('anos_disponiveis').then(({ data }) => data && setAnos((data as { ano: number }[]).map(a => a.ano))); }, []);
  return anos;
}

export async function carregarDRE(ano: number, conta: number | null) {
  const { data, error } = await supabase.rpc('dre_mensal', { p_ano: ano, p_conta: conta });
  if (error) throw error;
  return (data as PontoDRE[]) || [];
}

/** Resultado (soma das linhas do resultado) por mês, 12 posições */
export function resultadoMensal(pontos: PontoDRE[], linhas: LinhaDRE[], modo: Modo, ateOrdem = 999) {
  const ok = new Set(linhas.filter(l => l.no_resultado && l.ordem <= ateOrdem).map(l => l.id));
  const r = Array(12).fill(0);
  pontos.forEach(p => { if (ok.has(p.linha_dre_id)) r[p.mes - 1] += valorModo(p, modo); });
  return r as number[];
}

export function linhaMensal(pontos: PontoDRE[], linhaId: number | undefined, modo: Modo) {
  const r = Array(12).fill(0);
  pontos.forEach(p => { if (p.linha_dre_id === linhaId) r[p.mes - 1] += valorModo(p, modo); });
  return r as number[];
}

export const pct = (v: number) => (v > 0 ? '+' : '') + (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
export const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
