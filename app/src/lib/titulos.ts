import { supabase, type Lancamento } from './supabase';

/** Linha de rateio na digitação */
export interface LinhaRateio { grupo_id: number | null; subgrupo_id: number | null; centro_custo_id: number | null; valor: string; pct: string }
export interface Rateio { id?: number; lancamento_id: number; grupo_id: number; subgrupo_id: number | null; centro_custo_id: number | null; fracao: number; valor: number | null }

const r2 = (v: number) => Math.round(v * 100) / 100;
const agora = () => new Date().toISOString();

export async function carregarRateio(lancamentoId: number): Promise<Rateio[]> {
  const { data } = await supabase.from('lancamento_rateios').select('*').eq('lancamento_id', lancamentoId).order('id');
  return (data as Rateio[]) || [];
}

/** Grava o rateio (duas ou mais linhas). Com menos de duas linhas, o lançamento volta a ter uma classificação só. */
export async function gravarRateio(lancamentoId: number, total: number, linhas: LinhaRateio[]) {
  await supabase.from('lancamento_rateios').delete().eq('lancamento_id', lancamentoId);
  const validas = linhas.filter(l => l.grupo_id && Number(l.valor) > 0);
  if (validas.length < 2) return null;
  const regs = validas.map(l => ({ lancamento_id: lancamentoId, grupo_id: l.grupo_id, subgrupo_id: l.subgrupo_id, centro_custo_id: l.centro_custo_id, fracao: Number(l.valor) / total, valor: r2(Number(l.valor)) }));
  const { error } = await supabase.from('lancamento_rateios').insert(regs);
  return error?.message ?? null;
}

/** Copia o rateio de um lançamento para outro (pagamento parcial herda a mesma divisão) */
async function copiarRateio(de: number, para: number) {
  const r = await carregarRateio(de);
  if (!r.length) return;
  await supabase.from('lancamento_rateios').insert(r.map(({ id: _id, lancamento_id: _l, ...x }) => ({ ...x, lancamento_id: para })));
}

/**
 * Registra um pagamento (ou recebimento) de uma conta.
 * Parcial: cria um lançamento pago ligado à conta e reduz o saldo em aberto; a conta continua a mesma.
 * Total (ou último parcial): a própria conta passa a paga.
 */
export async function registrarPagamento(l: Lancamento, valor: number, data: string, contaId: number, obs?: string): Promise<{ erro: string | null; id: number | null }> {
  const saldo = Number(l.valor);
  if (!(valor > 0) || valor > saldo + 0.004) return { erro: 'O valor deve ser maior que zero e até ' + saldo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + '.', id: null };
  if (valor >= saldo - 0.004) {
    const { error } = await supabase.from('lancamentos').update({ status: 'pago', conta_id: contaId, data_pagamento: data, atualizado_em: agora() }).eq('id', l.id);
    return { erro: error?.message ?? null, id: l.id };
  }
  const { id: _id, criado_em: _c, criado_por: _p, juros_lanc_id: _j, ofx_fitid: _o, ...resto } = l as Lancamento & { criado_em?: string; criado_por?: string };
  const ins = await supabase.from('lancamentos').insert({
    ...resto, valor: r2(valor), status: 'pago', conta_id: contaId, data_pagamento: data, titulo_id: l.id, valor_original: null, juros_multa: 0,
    observacao: [obs, 'pagamento parcial'].filter(Boolean).join('; '), atualizado_em: agora(),
  }).select('id').single();
  if (ins.error) return { erro: ins.error.message, id: null };
  const up = await supabase.from('lancamentos').update({ valor: r2(saldo - valor), valor_original: l.valor_original ?? saldo, atualizado_em: agora() }).eq('id', l.id);
  if (up.error) return { erro: up.error.message, id: null };
  await copiarRateio(l.id, ins.data.id);
  return { erro: null, id: ins.data.id };
}

/** Pagamentos já feitos de uma conta (parciais e, se quitada, o último) */
export async function historicoPagamentos(titulo: Lancamento): Promise<Lancamento[]> {
  const { data } = await supabase.from('lancamentos').select('*').eq('titulo_id', titulo.id).order('data_pagamento').order('id');
  const parciais = (data as Lancamento[]) || [];
  return titulo.status === 'pago' ? [...parciais, titulo] : parciais;
}

/** Estorna um pagamento: o valor volta ao saldo em aberto da conta */
export async function estornarPagamento(titulo: Lancamento, pagamento: Lancamento): Promise<string | null> {
  if (pagamento.id === titulo.id) {
    const { error } = await supabase.from('lancamentos').update({ status: 'confirmado', data_pagamento: null, ofx_fitid: null, atualizado_em: agora() }).eq('id', titulo.id);
    return error?.message ?? null;
  }
  if (titulo.status === 'pago') return 'Estorne primeiro a quitação (último pagamento) para reabrir a conta.';
  const del = await supabase.from('lancamentos').delete().eq('id', pagamento.id);
  if (del.error) return del.error.message;
  const { count } = await supabase.from('lancamentos').select('id', { count: 'exact', head: true }).eq('titulo_id', titulo.id);
  const { error } = await supabase.from('lancamentos').update({ valor: r2(Number(titulo.valor) + Number(pagamento.valor)), valor_original: count ? titulo.valor_original : null, atualizado_em: agora() }).eq('id', titulo.id);
  return error?.message ?? null;
}

export const totalTitulo = (l: Lancamento) => Number(l.valor_original ?? l.valor);
