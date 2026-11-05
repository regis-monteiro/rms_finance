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
export const limparCacheDescontos = () => { cache = {}; };
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
