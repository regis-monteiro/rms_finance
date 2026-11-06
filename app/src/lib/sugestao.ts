import { supabase } from './supabase';

/** Classificação usada em lançamentos anteriores (resumo vindo do banco) */
interface Entrada { t: 'entrada' | 'saida'; f: string; b: number | null; g: number; s: number | null; c: number | null; n: number; d: string; k: string[] }
export interface Opcao { grupo_id: number; subgrupo_id: number | null; centro_custo_id: number | null; peso: number; n: number; ultima: string }
export interface Sugestao { opcoes: Opcao[]; beneficiario_id: number | null; total: number }

const STOP = new Set(['pix', 'ted', 'doc', 'tef', 'pagamento', 'pagto', 'pgto', 'pag', 'transferencia', 'transf', 'enviado', 'enviada', 'envio',
  'recebido', 'recebida', 'recebimento', 'boleto', 'compra', 'debito', 'credito', 'deb', 'cred', 'ltda', 'eireli', 'epp', 'the', 'por', 'via',
  'para', 'com', 'dos', 'das', 'que', 'conta', 'ref', 'liquidacao', 'titulo', 'pagar', 'receber', 'favorecido', 'pagador', 'banco', 'agencia',
  'dinheiro', 'mesma', 'titularidade', 'qrcode', 'qr', 'code', 'chave', 'outros', 'outras', 'cpf', 'cnpj']);

export function palavras(s: string | null | undefined) {
  return [...new Set((s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter(w => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w)))];
}

/** Semelhança entre os textos (coeficiente de Dice sobre as palavras significativas) */
export function semelhanca(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b); const comuns = a.filter(w => sb.has(w)).length;
  return (2 * comuns) / (a.length + b.length);
}

let cache: Promise<Entrada[]> | null = null, quando = 0;
export function carregarDicionario(): Promise<Entrada[]> {
  if (!cache || Date.now() - quando > 10 * 60 * 1000) {
    quando = Date.now();
    cache = Promise.resolve(supabase.rpc('dicionario_classificacao')).then(r => (r.error || !Array.isArray(r.data) ? [] : (r.data as Entrada[]).map(e => ({ ...e, k: palavras(e.f) }))));
  }
  return cache;
}
export const invalidarDicionario = () => { cache = null; };

export function sugerir(dic: Entrada[], q: { tipo: string; beneficiario_id?: number | null; texto?: string | null }): Sugestao {
  const alvo = palavras(q.texto);
  const mapa = new Map<string, Opcao>(), benef = new Map<number, number>();
  let total = 0;
  for (const e of dic) {
    if (e.t !== q.tipo) continue;
    let w = 0;
    if (q.beneficiario_id && e.b === q.beneficiario_id) w = 2;
    else { const s = semelhanca(alvo, e.k); if (s >= 0.5) w = s; }
    if (!w) continue;
    const peso = w * e.n; total += e.n;
    const k = `${e.g}|${e.s ?? ''}`;
    const o = mapa.get(k) || { grupo_id: e.g, subgrupo_id: e.s, centro_custo_id: null, peso: 0, n: 0, ultima: '' };
    o.peso += peso; o.n += e.n; if (e.d > o.ultima) o.ultima = e.d;
    if (e.c && !o.centro_custo_id) o.centro_custo_id = e.c;
    mapa.set(k, o);
    if (e.b) benef.set(e.b, (benef.get(e.b) || 0) + peso);
  }
  const opcoes = [...mapa.values()].sort((a, b) => b.peso - a.peso || (b.ultima > a.ultima ? 1 : -1));
  const b = [...benef.entries()].sort((x, y) => y[1] - x[1])[0];
  return { opcoes, beneficiario_id: b ? b[0] : null, total };
}

/** Há classificações diferentes relevantes (a segunda tem ao menos 10% do peso) */
export const divergente = (s: Sugestao) => s.opcoes.length > 1 && s.opcoes[1].peso >= 0.1 * s.opcoes[0].peso;
