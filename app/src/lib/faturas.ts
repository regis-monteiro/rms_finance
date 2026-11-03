import { supabase, type Cartao } from './supabase';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dia = (a: number, m: number, d: number) => { const ult = new Date(a, m + 1, 0).getDate(); return new Date(a, m, Math.min(d, ult)); };

/** Datas da fatura em que entra uma compra feita em `dataCompra` (AAAA-MM-DD). */
export function datasFatura(c: Cartao, dataCompra: string, deslocamentoMeses = 0) {
  const [a, m, d] = dataCompra.split('-').map(Number);
  let mesFech = m - 1 + (d > c.dia_fechamento ? 1 : 0) + deslocamentoMeses;
  const fech = dia(a, mesFech, c.dia_fechamento);
  const mesVenc = c.dia_vencimento > c.dia_fechamento ? fech.getMonth() : fech.getMonth() + 1;
  const venc = dia(fech.getFullYear(), mesVenc, c.dia_vencimento);
  return { competencia: iso(new Date(venc.getFullYear(), venc.getMonth(), 1)), data_fechamento: iso(fech), data_vencimento: iso(venc) };
}

/** Busca a fatura do cartão na competência ou cria. */
export async function obterFatura(c: Cartao, datas: ReturnType<typeof datasFatura>) {
  const { data } = await supabase.from('faturas').select('id').eq('cartao_id', c.id).eq('competencia', datas.competencia).maybeSingle();
  if (data) return data.id as number;
  const { data: nova, error } = await supabase.from('faturas').insert({ cartao_id: c.id, ...datas }).select('id').single();
  if (error) throw error;
  return nova.id as number;
}

/**
 * Mantém um único lançamento "em aberto" por fatura, com o saldo ainda não pago.
 * Assim contas a pagar e a projeção de saldo enxergam o valor correto da fatura.
 */
export async function sincronizarFatura(faturaId: number) {
  const { data: f } = await supabase.from('faturas_resumo').select('*').eq('id', faturaId).single();
  if (!f) return;
  const { data: abertos } = await supabase.from('lancamentos').select('id,valor,status').eq('fatura_id', faturaId).neq('status', 'pago').order('id');
  const agendado = (abertos || []).filter(l => l.status === 'agendado').reduce((a, l) => a + Number(l.valor), 0);
  const lista = (abertos || []).filter(l => l.status !== 'agendado');
  const aberto = Math.round((Number(f.total) - Number(f.pago) - agendado) * 100) / 100;
  if (aberto <= 0) {
    if (lista.length) await supabase.from('lancamentos').delete().in('id', lista.map(l => l.id));
    return;
  }
  if (lista.length) {
    await supabase.from('lancamentos').update({ valor: aberto, atualizado_em: new Date().toISOString() }).eq('id', lista[0].id);
    if (lista.length > 1) await supabase.from('lancamentos').delete().in('id', lista.slice(1).map(l => l.id));
  } else {
    const { data: g } = await supabase.from('grupos').select('id').eq('nome', 'Pagamento de fatura').single();
    await supabase.from('lancamentos').insert({
      tipo: 'saida', vencimento: f.data_vencimento, grupo_id: g!.id, favorecido: 'Fatura ' + f.cartao,
      referencia: f.competencia.slice(5, 7) + '/' + f.competencia.slice(0, 4), valor: aberto, status: 'previsto', fatura_id: faturaId,
    });
  }
}

export function situacaoFatura(f: { total: number; pago: number; data_fechamento: string }, hoje: string) {
  const total = Number(f.total), pago = Number(f.pago);
  if (total > 0 && pago >= total - 0.004) return { txt: 'Paga', cls: 'pago' };
  if (pago > 0) return { txt: 'Paga parcialmente', cls: 'parc' };
  if (hoje <= f.data_fechamento) return { txt: 'Aberta', cls: 'prev' };
  return { txt: 'Fechada', cls: 'conf' };
}
