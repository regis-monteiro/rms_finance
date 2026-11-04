import { supabase, type Lancamento } from './supabase';

/** Linha de rateio na digitação */
export interface LinhaRateio { grupo_id: number | null; subgrupo_id: number | null; centro_custo_id: number | null; valor: string; pct: string }
export interface Rateio { id?: number; lancamento_id: number; grupo_id: number; subgrupo_id: number | null; centro_custo_id: number | null; fracao: number; valor: number | null }

const r2 = (v: number) => Math.round(v * 100) / 100;
/** Estado antes da baixa, guardado para poder desfazê-la */
export const anterior = (l: Pick<Lancamento, 'status' | 'conta_id'>) => ({ status: l.status === 'pago' ? 'confirmado' : l.status, conta_id: l.conta_id });
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
    const { error } = await supabase.from('lancamentos').update({ status: 'pago', conta_id: contaId, data_pagamento: data, baixa_anterior: anterior(l), atualizado_em: agora() }).eq('id', l.id);
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
  if (pagamento.id === titulo.id) return desfazerBaixa(titulo);
  if (titulo.status === 'pago') return 'Estorne primeiro a quitação (último pagamento) para reabrir a conta.';
  const del = await supabase.from('lancamentos').delete().eq('id', pagamento.id);
  if (del.error) return del.error.message;
  const { count } = await supabase.from('lancamentos').select('id', { count: 'exact', head: true }).eq('titulo_id', titulo.id);
  const { error } = await supabase.from('lancamentos').update({ valor: r2(Number(titulo.valor) + Number(pagamento.valor)), valor_original: count ? titulo.valor_original : null, atualizado_em: agora() }).eq('id', titulo.id);
  return error?.message ?? null;
}

export const totalTitulo = (l: Lancamento) => Number(l.valor_original ?? l.valor);

/** Tira um lançamento do lote de recebimento e recalcula o total e a tarifa do lote */
async function removerDoLote(lancamentoId: number) {
  const { data: it } = await supabase.from('lotes_recebimento_itens').select('id,lote_id').eq('lancamento_id', lancamentoId);
  for (const x of (it as { id: number; lote_id: number }[]) || []) {
    await supabase.from('lotes_recebimento_itens').delete().eq('id', x.id);
    const { data: lote } = await supabase.from('lotes_recebimento').select('*').eq('id', x.lote_id).single();
    const { data: resto } = await supabase.from('lotes_recebimento_itens').select('valor').eq('lote_id', x.lote_id);
    const n = (resto || []).length, total = r2(((resto as { valor: number }[]) || []).reduce((a, y) => a + Number(y.valor), 0));
    const lt = lote as { lanc_tarifa_id: number | null; tarifa_unitaria: number } | null;
    if (!lt) continue;
    if (!n) {
      if (lt.lanc_tarifa_id) await supabase.from('lancamentos').delete().eq('id', lt.lanc_tarifa_id);
      await supabase.from('lotes_recebimento').delete().eq('id', x.lote_id);
    } else {
      await supabase.from('lotes_recebimento').update({ quantidade: n, total }).eq('id', x.lote_id);
      if (lt.lanc_tarifa_id) await supabase.from('lancamentos').update({ valor: r2(n * Number(lt.tarifa_unitaria)), referencia: `Tarifa de ${n} boleto(s)`, observacao: `tarifa de ${n} boleto(s) × ${Number(lt.tarifa_unitaria).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, atualizado_em: agora() }).eq('id', lt.lanc_tarifa_id);
    }
  }
}

/**
 * Desfaz a baixa sem excluir a conta a pagar ou a receber.
 * Pagamento parcial: o valor volta ao saldo da conta. Pagamento total: a conta volta ao status e à conta bancária anteriores.
 * Também desfaz o que dependia da baixa: multa/juros lançados, transferência (as duas pontas), fatura de cartão, lote de boletos e conciliação.
 */
export async function desfazerBaixa(l: Lancamento): Promise<string | null> {
  if (l.status !== 'pago') return 'Este lançamento não está baixado.';
  if (l.titulo_id) {
    const { data: t } = await supabase.from('lancamentos').select('*').eq('id', l.titulo_id).single();
    if (!t) return 'Conta original não encontrada.';
    const e = await estornarPagamento(t as Lancamento, l);
    if (!e) await removerDoLote(l.id);
    return e;
  }
  const conc = (l.ofx_anterior || {}) as { modo?: string; status?: string; conta_id?: number | null };
  const ant = (l.baixa_anterior || (conc.modo === 'baixa' ? conc : {})) as { status?: string; conta_id?: number | null };
  const volta = { status: ant.status && ant.status !== 'pago' ? ant.status : 'confirmado', data_pagamento: null, baixa_anterior: null, ofx_fitid: null, ofx_anterior: null, atualizado_em: agora() };
  const r = l.transferencia_id
    ? await supabase.from('lancamentos').update(volta).eq('transferencia_id', l.transferencia_id)
    : await supabase.from('lancamentos').update({ ...volta, conta_id: 'conta_id' in ant ? ant.conta_id ?? null : l.conta_id }).eq('id', l.id);
  if (r.error) return r.error.message;
  await removerDoLote(l.id);
  if (l.juros_lanc_id) {
    await supabase.from('lancamentos').update({ juros_lanc_id: null }).eq('id', l.id);
    await supabase.from('lancamentos').delete().eq('id', l.juros_lanc_id);
  }
  if (l.fatura_id) { const { sincronizarFatura } = await import('./faturas'); await sincronizarFatura(l.fatura_id); }
  return null;
}

/** Motivo para não excluir uma conta em aberto (ou null se pode excluir) */
export function bloqueioExclusao(l: Lancamento): string | null {
  if (l.fatura_id) return 'saldo de fatura de cartão: exclua as compras pela tela Cartões';
  if (l.transferencia_id) return 'transferência: exclua pela tela Lançamentos';
  if (l.valor_original != null) return 'tem pagamento parcial registrado: estorne os pagamentos antes de excluir';
  return null;
}

/** Exclui contas a pagar ou a receber (com a multa/juros vinculada), respeitando os bloqueios */
export async function excluirContas(ls: Lancamento[]) {
  let n = 0; const falhas: string[] = [];
  for (const l of ls) {
    const b = bloqueioExclusao(l);
    if (b) { falhas.push(`${l.favorecido}: ${b}`); continue; }
    const { error } = await supabase.from('lancamentos').delete().eq('id', l.id);
    if (error) { falhas.push(`${l.favorecido}: ${error.message}`); continue; }
    if (l.juros_lanc_id) await supabase.from('lancamentos').delete().eq('id', l.juros_lanc_id);
    n++;
  }
  return { n, falhas };
}
