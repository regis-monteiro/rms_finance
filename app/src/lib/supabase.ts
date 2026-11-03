import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
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
  beneficiario_id: number | null; transferencia_id?: string | null;
}
export interface Beneficiario {
  id: number; nome: string; documento: string; nome_fantasia: string | null; email: string | null; telefone: string | null;
  cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null;
  banco: string | null; agencia: string | null; conta: string | null; pix_tipo: string | null; pix_chave: string | null;
  grupo_id: number | null; subgrupo_id: number | null; observacao: string | null; ativo: boolean;
}
