import { supabase, type Lancamento } from './supabase';

const r2 = (v: number) => Math.round(v * 100) / 100;
let cache: Record<string, { grupo: number; sub: number | null }> = {};

/** Desconto concedido (recebimento) vai para Despesas financeiras; desconto obtido (pagamento) para Receitas financeiras */
async function classificacao(natureza: 'entrada' | 'saida') {
  const [g, s] = natureza === 'entrada' ? ['Despesas financeiras', 'Descontos concedidos'] : ['Receitas financeiras', 'Descontos obtidos'];
  if (cache[natureza]) return cache[natureza];
  const { data: gr } = await supabase.from('grupos').select('id').eq('nome', g).single();
  if (!gr) throw new Error(`Grupo "${g}" não encontrado. Rode o arquivo 019_descontos.sql no Supabase.`);
  const { data: sg } = await supabase.from('subgrupos').select('id').eq('grupo_id', (gr as { id: number }).id).eq('nome', s).maybeSingle();
  cache[natureza] = { grupo: (gr as { id: number }).id, sub: (sg as { id: number } | null)?.id ?? null };
  return cache[natureza];
}
export const limparCacheDescontos = () => { cache = {}; cacheJ = {}; };
export const rotuloDesconto = (natureza: 'entrada' | 'saida') => (natureza === 'entrada' ? 'desconto concedido' : 'desconto obtido');

/** Dados do lançamento de desconto, de natureza oposta à da conta baixada (mesma data e conta bancária) */
export async function dadosDesconto(natureza: 'entrada' | 'saida', valor: number, data: string, conta: number, favorecido: string, beneficiario: number | null, referencia: string) {
  const c = await classificacao(natureza);
  return { tipo: natureza === 'entrada' ? 'saida' : 'entrada', conta_id: conta, vencimento: data, data_pagamento: data, grupo_id: c.grupo, subgrupo_id: c.sub,
    favorecido, beneficiario_id: beneficiario, referencia, valor: r2(valor), status: 'pago', observacao: rotuloDesconto(natureza), atualizado_em: new Date().toISOString() };
}

/** Grava, atualiza ou remove o desconto de uma conta já baixada (fora de lote) */
export async function sincronizarDesconto(l: Lancamento, valor: number): Promise<string | null> {
  try {
    if (l.status === 'pago' && valor > 0 && l.conta_id && l.data_pagamento) {
      const d = await dadosDesconto(l.tipo, valor, l.data_pagamento, l.conta_id, l.favorecido, l.beneficiario_id, 'Desconto: ' + (l.referencia || l.favorecido));
      if (l.desconto_lanc_id) {
        const r = await supabase.from('lancamentos').update(d).eq('id', l.desconto_lanc_id);
        if (r.error) return r.error.message;
        await supabase.from('lancamentos').update({ desconto: r2(valor) }).eq('id', l.id);
        return null;
      }
      const r = await supabase.from('lancamentos').insert(d).select('id').single();
      if (r.error) return r.error.message;
      const u = await supabase.from('lancamentos').update({ desconto: r2(valor), desconto_lanc_id: r.data.id }).eq('id', l.id);
      return u.error?.message ?? null;
    }
    if (l.desconto_lanc_id) {
      await supabase.from('lancamentos').update({ desconto_lanc_id: null, desconto: 0 }).eq('id', l.id);
      const r = await supabase.from('lancamentos').delete().eq('id', l.desconto_lanc_id);
      return r.error?.message ?? null;
    }
    if (Number(l.desconto || 0) && l.status !== 'pago') await supabase.from('lancamentos').update({ desconto: 0 }).eq('id', l.id);
    return null;
  } catch (e) { return (e as Error).message; }
}

/* ---------------- Multa e juros na baixa ---------------- */
let cacheJ: Record<string, { grupo: number; sub: number | null }> = {};
/** Recebidos de clientes: Receitas financeiras · Juros e multas recebidos. Pagos: Despesas financeiras · Multa/juros por atraso */
async function classificacaoJuros(natureza: 'entrada' | 'saida') {
  const [g, s] = natureza === 'entrada' ? ['Receitas financeiras', 'Juros e multas recebidos'] : ['Despesas financeiras', 'Multa/juros por atraso'];
  if (cacheJ[natureza]) return cacheJ[natureza];
  const { data: gr } = await supabase.from('grupos').select('id').eq('nome', g).single();
  if (!gr) throw new Error(`Grupo "${g}" não encontrado. Rode o arquivo 025_juros_na_baixa.sql no Supabase.`);
  const { data: sg } = await supabase.from('subgrupos').select('id').eq('grupo_id', (gr as { id: number }).id).eq('nome', s).maybeSingle();
  cacheJ[natureza] = { grupo: (gr as { id: number }).id, sub: (sg as { id: number } | null)?.id ?? null };
  return cacheJ[natureza];
}
export const rotuloJuros = (natureza: 'entrada' | 'saida') => (natureza === 'entrada' ? 'juros/multa recebidos' : 'multa/juros por atraso');

/** Lançamento de multa/juros: mesma natureza da conta baixada (soma ao que entrou ou saiu), mesma data e conta bancária */
export async function dadosJuros(natureza: 'entrada' | 'saida', valor: number, data: string, conta: number, favorecido: string, beneficiario: number | null, referencia: string) {
  const c = await classificacaoJuros(natureza);
  return { tipo: natureza, conta_id: conta, vencimento: data, data_pagamento: data, grupo_id: c.grupo, subgrupo_id: c.sub,
    favorecido, beneficiario_id: beneficiario, referencia, valor: r2(valor), status: 'pago', observacao: rotuloJuros(natureza), atualizado_em: new Date().toISOString() };
}

/** Grava, atualiza ou remove a multa/juros de uma conta já baixada (fora de lote) */
export async function sincronizarJuros(l: Lancamento, valor: number): Promise<string | null> {
  try {
    if (l.status === 'pago' && valor > 0 && l.conta_id && l.data_pagamento) {
      const d = await dadosJuros(l.tipo, valor, l.data_pagamento, l.conta_id, l.favorecido, l.beneficiario_id, 'Multa/juros: ' + (l.referencia || l.favorecido));
      if (l.juros_lanc_id) {
        const r = await supabase.from('lancamentos').update(d).eq('id', l.juros_lanc_id);
        if (r.error) return r.error.message;
        await supabase.from('lancamentos').update({ juros_multa: r2(valor) }).eq('id', l.id);
        return null;
      }
      const r = await supabase.from('lancamentos').insert(d).select('id').single();
      if (r.error) return r.error.message;
      const u = await supabase.from('lancamentos').update({ juros_multa: r2(valor), juros_lanc_id: r.data.id }).eq('id', l.id);
      return u.error?.message ?? null;
    }
    if (l.juros_lanc_id) {
      await supabase.from('lancamentos').update({ juros_lanc_id: null, juros_multa: 0 }).eq('id', l.id);
      const r = await supabase.from('lancamentos').delete().eq('id', l.juros_lanc_id);
      return r.error?.message ?? null;
    }
    return null;
  } catch (e) { return (e as Error).message; }
}

/**
 * Valor efetivamente recebido/pago comparado ao em aberto:
 * menor = desconto (quita a conta) ou pagamento parcial, se marcado; maior = multa/juros.
 */
export function interpretarBaixa(aberto: number, efetivo: number, parcial = false) {
  const a = r2(aberto), v = r2(efetivo);
  if (!(v > 0)) return { erro: 'Informe um valor maior que zero.' } as const;
  if (v < a && parcial) return { bruto: v, desconto: 0, juros: 0, parcial: true } as const;
  return { bruto: a, desconto: v < a ? r2(a - v) : 0, juros: v > a ? r2(v - a) : 0, parcial: false } as const;
}
