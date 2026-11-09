import { supabase, type Lancamento } from './supabase';
import { dadosDesconto, dadosJuros, rotuloDesconto, rotuloJuros } from './descontos';

/** Lote de baixas do dia: mesma data, mesma conta, mesma natureza e mesmo grupo/subgrupo */
export interface Chave { data: string; conta_id: number; natureza: 'entrada' | 'saida'; grupo_id: number; subgrupo_id: number | null }
export interface LoteDia { id: number; quantidade: number; total: number; tarifa_unitaria: number; lanc_tarifa_id: number | null }
export interface Candidato { chave: Chave; novos: Lancamento[]; lote: LoteDia | null; avulsos: Lancamento[] }

const r2 = (v: number) => Math.round(v * 100) / 100;
export const chaveDe = (l: Lancamento): Chave => ({ data: l.data_pagamento!, conta_id: l.conta_id!, natureza: l.tipo, grupo_id: l.grupo_id, subgrupo_id: l.subgrupo_id ?? null });
const igual = (a: Chave, b: Chave) => a.data === b.data && a.conta_id === b.conta_id && a.natureza === b.natureza && a.grupo_id === b.grupo_id && (a.subgrupo_id ?? null) === (b.subgrupo_id ?? null);

/** Agrupa lançamentos recém-baixados pela chave do lote do dia */
export function agrupar(ls: Lancamento[]) {
  const out: { chave: Chave; novos: Lancamento[] }[] = [];
  for (const l of ls) {
    if (l.status !== 'pago' || !l.data_pagamento || !l.conta_id || l.transferencia_id || l.fatura_id) continue;
    const k = chaveDe(l), g = out.find(x => igual(x.chave, k));
    if (g) g.novos.push(l); else out.push({ chave: k, novos: [l] });
  }
  return out;
}

/** Lote existente e baixas avulsas (fora de lote) do mesmo dia, conta e classificação */
export async function candidatos(chave: Chave, novos: Lancamento[]): Promise<Candidato> {
  let q = supabase.from('lotes_recebimento').select('id,quantidade,total,tarifa_unitaria,lanc_tarifa_id').eq('tipo', 'baixa').eq('data', chave.data).eq('conta_id', chave.conta_id)
    .eq('natureza', chave.natureza).eq('grupo_id', chave.grupo_id);
  q = chave.subgrupo_id == null ? q.is('subgrupo_id', null) : q.eq('subgrupo_id', chave.subgrupo_id);
  const { data: lotes } = await q.order('id').limit(1);
  let q2 = supabase.from('lancamentos').select('*').eq('status', 'pago').eq('tipo', chave.natureza).eq('data_pagamento', chave.data).eq('conta_id', chave.conta_id)
    .eq('grupo_id', chave.grupo_id).is('transferencia_id', null).is('fatura_id', null);
  q2 = chave.subgrupo_id == null ? q2.is('subgrupo_id', null) : q2.eq('subgrupo_id', chave.subgrupo_id);
  const { data: mesmos } = await q2.range(0, 499);
  const ids = ((mesmos as Lancamento[]) || []).map(l => l.id);
  const { data: emLote } = ids.length ? await supabase.from('lotes_recebimento_itens').select('lancamento_id').in('lancamento_id', ids) : { data: [] };
  const ocupados = new Set(((emLote as { lancamento_id: number }[]) || []).map(x => x.lancamento_id));
  const { data: cons } = ids.length ? await supabase.from('lotes_recebimento').select('lanc_consolidado_id,lanc_tarifa_id,lanc_desconto_id,lanc_juros_id').or(`lanc_consolidado_id.in.(${ids.join(',')}),lanc_tarifa_id.in.(${ids.join(',')}),lanc_desconto_id.in.(${ids.join(',')}),lanc_juros_id.in.(${ids.join(',')})`) : { data: [] };
  for (const x of (cons as { lanc_consolidado_id: number | null; lanc_tarifa_id: number | null; lanc_desconto_id: number | null; lanc_juros_id: number | null }[]) || []) for (const v of [x.lanc_consolidado_id, x.lanc_tarifa_id, x.lanc_desconto_id, x.lanc_juros_id]) if (v) ocupados.add(v);
  const novosIds = new Set(novos.map(n => n.id));
  // itens recém-baixados que já estão num lote (ex.: criado na mesma operação) não entram de novo
  const livres = novos.filter(n => !ocupados.has(n.id));
  const avulsos = ((mesmos as Lancamento[]) || []).filter(l => !ocupados.has(l.id) && !novosIds.has(l.id) && !/^(tarifa de|desconto (concedido|obtido)|juros\/multa recebidos|multa\/juros por atraso)/.test(l.observacao || ''));
  return { chave, novos: livres, lote: ((lotes as LoteDia[]) || [])[0] || null, avulsos };
}

/** Recalcula total, quantidade, tarifa e desconto de um lote pelos itens atuais */
export async function recalcularLote(loteId: number) {
  const { data: lote } = await supabase.from('lotes_recebimento').select('*').eq('id', loteId).single();
  const { data: itens } = await supabase.from('lotes_recebimento_itens').select('valor,desconto,juros,beneficiario_id,nome').eq('lote_id', loteId);
  const its = (itens as { valor: number; desconto: number | null; juros: number | null; beneficiario_id: number | null; nome: string | null }[]) || [];
  const n = its.length, total = r2(its.reduce((a, x) => a + Number(x.valor), 0)), desc = r2(its.reduce((a, x) => a + Number(x.desconto || 0), 0)), jur = r2(its.reduce((a, x) => a + Number(x.juros || 0), 0));
  const lt = lote as { data: string; conta_id: number; natureza?: 'entrada' | 'saida'; lanc_tarifa_id: number | null; lanc_desconto_id: number | null; lanc_juros_id?: number | null; tarifa_unitaria: number } | null;
  if (!lt) return;
  let lancDesc = lt.lanc_desconto_id;
  // Descontos do lote: um lançamento só, com a soma
  if (desc > 0) {
    const comDesc = its.filter(x => Number(x.desconto || 0) > 0);
    const d = await dadosDesconto(lt.natureza || 'entrada', desc, lt.data, lt.conta_id, comDesc.length === 1 ? comDesc[0].nome || 'Desconto' : `Descontos do lote (${comDesc.length})`,
      comDesc[0]?.beneficiario_id ?? null, `${rotuloDesconto(lt.natureza || 'entrada')} em lote`);
    if (lancDesc) await supabase.from('lancamentos').update(d).eq('id', lancDesc);
    else { const r = await supabase.from('lancamentos').insert(d).select('id').single(); if (r.error) throw new Error('Desconto: ' + r.error.message); lancDesc = r.data.id; }
  } else if (lancDesc) { await supabase.from('lancamentos').delete().eq('id', lancDesc); lancDesc = null; }
  // Multa/juros do lote: um lançamento só, com a soma
  let lancJur = lt.lanc_juros_id ?? null;
  if (jur > 0) {
    const comJ = its.filter(x => Number(x.juros || 0) > 0);
    const d = await dadosJuros(lt.natureza || 'entrada', jur, lt.data, lt.conta_id, comJ.length === 1 ? comJ[0].nome || 'Multa/juros' : `Multa/juros do lote (${comJ.length})`,
      comJ[0]?.beneficiario_id ?? null, `${rotuloJuros(lt.natureza || 'entrada')} em lote`);
    if (lancJur) await supabase.from('lancamentos').update(d).eq('id', lancJur);
    else { const r = await supabase.from('lancamentos').insert(d).select('id').single(); if (r.error) throw new Error('Multa/juros: ' + r.error.message); lancJur = r.data.id; }
  } else if (lancJur) { await supabase.from('lancamentos').delete().eq('id', lancJur); lancJur = null; }
  await supabase.from('lotes_recebimento').update({ quantidade: n, total, desconto: desc, lanc_desconto_id: lancDesc, ...(jur > 0 || lt.lanc_juros_id ? { juros: jur, lanc_juros_id: lancJur } : {}) }).eq('id', loteId);
  if (lt.lanc_tarifa_id && Number(lt.tarifa_unitaria) > 0)
    await supabase.from('lancamentos').update({ valor: r2(n * Number(lt.tarifa_unitaria)), referencia: `Tarifa de ${n} boleto(s)`,
      observacao: `tarifa de ${n} boleto(s) × ${Number(lt.tarifa_unitaria).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, atualizado_em: new Date().toISOString() }).eq('id', lt.lanc_tarifa_id);
}

/** Inclui as baixas no lote existente ou cria o lote do dia com as baixas avulsas e as novas */
export interface TarifaLote { unit: number; criar: (n: number, data: string, conta: number) => Promise<number> }
export async function reunirNoLote(c: Candidato, comAvulsos = true, tarifa?: TarifaLote | null): Promise<string | null> {
  const itens = [...c.novos, ...(comAvulsos ? c.avulsos : [])];
  if (!itens.length) return null;
  let loteId = c.lote?.id;
  if (!loteId) {
    const r = await supabase.from('lotes_recebimento').insert({ tipo: 'baixa', natureza: c.chave.natureza, data: c.chave.data, conta_id: c.chave.conta_id, grupo_id: c.chave.grupo_id,
      subgrupo_id: c.chave.subgrupo_id, quantidade: 0, tarifa_unitaria: 0, total: 0 }).select('id').single();
    if (r.error) return r.error.message;
    loteId = r.data.id;
  }
  // a coluna de juros só vai quando há juros (todas as linhas com a mesma estrutura)
  const comJuros = itens.some(l => Number(l.juros_multa || 0) > 0);
  const ins = await supabase.from('lotes_recebimento_itens').insert(itens.map(l => ({ lote_id: loteId, beneficiario_id: l.beneficiario_id, nome: l.favorecido, valor: Number(l.valor), desconto: Number(l.desconto || 0), ...(comJuros ? { juros: Number(l.juros_multa || 0) } : {}), lancamento_id: l.id })));
  if (ins.error) return ins.error.message;
  // descontos lançados avulsos passam a fazer parte do lançamento único de descontos do lote
  for (const l of itens) if (l.desconto_lanc_id) {
    await supabase.from('lancamentos').update({ desconto_lanc_id: null }).eq('id', l.id);
    await supabase.from('lancamentos').delete().eq('id', l.desconto_lanc_id);
  }
  // o mesmo com a multa/juros
  for (const l of itens) if (l.juros_lanc_id) {
    await supabase.from('lancamentos').update({ juros_lanc_id: null }).eq('id', l.id);
    await supabase.from('lancamentos').delete().eq('id', l.juros_lanc_id);
  }
  if (tarifa && tarifa.unit > 0 && c.chave.natureza === 'entrada') {
    const { data: lt } = await supabase.from('lotes_recebimento').select('lanc_tarifa_id').eq('id', loteId).single();
    if (!(lt as { lanc_tarifa_id: number | null } | null)?.lanc_tarifa_id) {
      // lote sem tarifa: lança a tarifa para todos os itens do lote com o custo informado agora
      const { count } = await supabase.from('lotes_recebimento_itens').select('id', { count: 'exact', head: true }).eq('lote_id', loteId);
      try {
        const id = await tarifa.criar(count || itens.length, c.chave.data, c.chave.conta_id);
        await supabase.from('lotes_recebimento').update({ tarifa_unitaria: tarifa.unit, lanc_tarifa_id: id }).eq('id', loteId);
      } catch (e) { return (e as Error).message; }
    }
  }
  try { await recalcularLote(loteId!); } catch (e) { return (e as Error).message; }
  return null;
}

export async function carregarPagos(ids: number[]) {
  if (!ids.length) return [] as Lancamento[];
  const { data } = await supabase.from('lancamentos').select('*').in('id', ids);
  return (data as Lancamento[]) || [];
}

/** Grupos do dia com lote existente ou baixas avulsas para reunir (os demais não pedem confirmação) */
export async function pendenciasDeLote(ids: number[]) {
  const gs = agrupar(await carregarPagos(ids));
  const cs = await Promise.all(gs.map(g => candidatos(g.chave, g.novos)));
  return cs.filter(c => c.novos.length);
}
export const temOQueReunir = (c: Candidato) => !!c.lote || c.avulsos.length > 0;
