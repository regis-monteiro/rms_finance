import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configurado = Boolean(url && key);
export const supabase = createClient(url || 'http://localhost', key || 'sem-chave');

export type Perfil = 'diretor' | 'financeiro' | 'consulta';
export type Status = 'previsto' | 'confirmado' | 'agendado' | 'pago';

export interface Conta { id: number; nome: string; tipo: 'corrente' | 'aplicacao' | 'especie'; saldo_inicial: number; data_saldo_inicial: string; ativa: boolean; ordem: number }
export interface Grupo { id: number; nome: string; natureza: 'receita' | 'despesa' | 'movimentacao'; linha_dre_id: number | null; restrito: boolean; ativo: boolean }
export interface Subgrupo { id: number; grupo_id: number; nome: string }
export interface Cartao { id: number; nome: string; dia_fechamento: number; dia_vencimento: number; ativo: boolean }
export interface Lancamento {
  id: number; tipo: 'entrada' | 'saida'; conta_id: number | null; vencimento: string; data_pagamento: string | null;
  grupo_id: number; subgrupo_id: number | null; favorecido: string; referencia: string | null; documento: string | null;
  valor: number; status: Status; forma_pagamento: string | null; fatura_id: number | null; observacao: string | null;
}
