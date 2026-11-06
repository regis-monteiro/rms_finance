import { useState } from 'react';
import { supabase, type Lancamento } from '../lib/supabase';
import { brl, dataBR } from '../lib/format';
import { palavras, semelhanca, invalidarDicionario } from '../lib/sugestao';

export interface Grupo { chave: string; nome: string; grupo_id: number; subgrupo_id: number | null; ids: number[]; total: number; de: string; ate: string; exato: boolean }
export interface PedidoReclass { base: Lancamento; grupos: Grupo[] }

const ESPECIAIS = ['Transferências', 'Pagamento de fatura'];
const CHAVE_RECUSA = 'rms-reclass-recusados';
const recusados = (): string[] => { try { return JSON.parse(localStorage.getItem(CHAVE_RECUSA) || '[]'); } catch { return []; } };
const idRecusa = (l: Lancamento, g: Grupo) => `${l.tipo}|${g.nome.toLowerCase()}|${g.grupo_id}|${g.subgrupo_id ?? ''}>${l.grupo_id}|${l.subgrupo_id ?? ''}`;

/**
 * Lançamentos anteriores do mesmo fornecedor/cliente (ou de nome parecido) que estão sem subgrupo
 * ou com classificação diferente da que acabou de ser usada.
 */
export async function buscarSemelhantes(l: Lancamento, nomeGrupo: (id: number) => string): Promise<PedidoReclass | null> {
  if (!l.grupo_id || l.transferencia_id || l.fatura_id || ESPECIAIS.includes(nomeGrupo(l.grupo_id))) return null;
  const nome = (l.favorecido || '').trim(); const pw = palavras(nome);
  if (!nome && !l.beneficiario_id) return null;
  const base = () => supabase.from('lancamentos').select('id,favorecido,beneficiario_id,grupo_id,subgrupo_id,valor,vencimento,data_pagamento,status').eq('tipo', l.tipo).neq('id', l.id).is('transferencia_id', null).is('fatura_id', null);
  const consultas = [];
  if (l.beneficiario_id) consultas.push(base().eq('beneficiario_id', l.beneficiario_id).range(0, 1999));
  if (nome) consultas.push(base().ilike('favorecido', nome).range(0, 1999));
  const chave = [...pw].sort((a, b) => b.length - a.length)[0];
  if (chave) consultas.push(base().ilike('favorecido', `%${chave}%`).range(0, 1999));
  const rs = await Promise.all(consultas);
  const vistos = new Map<number, Lancamento & { exato: boolean }>();
  for (const r of rs) for (const x of ((r.data as Lancamento[]) || [])) {
    if (vistos.has(x.id)) continue;
    const exato = (!!l.beneficiario_id && x.beneficiario_id === l.beneficiario_id) || (x.favorecido || '').trim().toLowerCase() === nome.toLowerCase();
    if (!exato && semelhanca(pw, palavras(x.favorecido)) < 0.5) continue;
    vistos.set(x.id, { ...x, exato });
  }
  // só os que estão sem subgrupo ou com classificação diferente; quem tem rateio fica de fora
  let cand = [...vistos.values()].filter(x => ESPECIAIS.indexOf(nomeGrupo(x.grupo_id)) < 0 && (x.grupo_id !== l.grupo_id || (x.subgrupo_id ?? null) !== (l.subgrupo_id ?? null)) && !(x.grupo_id === l.grupo_id && x.subgrupo_id && !l.subgrupo_id));
  if (!cand.length) return null;
  const { data: rat } = await supabase.from('lancamento_rateios').select('lancamento_id').in('lancamento_id', cand.map(x => x.id).slice(0, 1000));
  const comRateio = new Set(((rat as { lancamento_id: number }[]) || []).map(x => x.lancamento_id));
  cand = cand.filter(x => !comRateio.has(x.id));
  const mapa = new Map<string, Grupo>();
  for (const x of cand) {
    const k = `${(x.favorecido || '').trim().toLowerCase()}|${x.grupo_id}|${x.subgrupo_id ?? ''}`;
    const d = x.status === 'pago' && x.data_pagamento ? x.data_pagamento : x.vencimento;
    const g = mapa.get(k) || { chave: k, nome: (x.favorecido || '').trim(), grupo_id: x.grupo_id, subgrupo_id: x.subgrupo_id ?? null, ids: [], total: 0, de: d, ate: d, exato: x.exato };
    g.ids.push(x.id); g.total = Math.round((g.total + Number(x.valor)) * 100) / 100; if (d < g.de) g.de = d; if (d > g.ate) g.ate = d; g.exato = g.exato || x.exato;
    mapa.set(k, g);
  }
  const rec = new Set(recusados());
  const grupos = [...mapa.values()].filter(g => !rec.has(idRecusa(l, g))).sort((a, b) => Number(b.exato) - Number(a.exato) || b.ids.length - a.ids.length);
  return grupos.length ? { base: l, grupos } : null;
}

export default function ReclassificarSemelhantes({ pedido, nomeGrupo, nomeSub, aoFechar }: { pedido: PedidoReclass; nomeGrupo: (id: number) => string; nomeSub: (id: number | null) => string; aoFechar: (n: number) => void }) {
  const { base, grupos } = pedido;
  const [marc, setMarc] = useState<Set<string>>(new Set(grupos.filter(g => g.exato).map(g => g.chave)));
  const [proc, setProc] = useState(false);
  const [erro, setErro] = useState('');
  const classe = (g: number, s: number | null) => nomeGrupo(g) + (s ? ' · ' + nomeSub(s) : ' · (sem subgrupo)');
  const sel = grupos.filter(g => marc.has(g.chave));

  async function aplicar() {
    setProc(true); setErro('');
    const ids = sel.flatMap(g => g.ids);
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from('lancamentos').update({ grupo_id: base.grupo_id, subgrupo_id: base.subgrupo_id ?? null, atualizado_em: new Date().toISOString() }).in('id', ids.slice(i, i + 200));
      if (error) { setErro(error.message); setProc(false); return; }
    }
    lembrarRecusa(grupos.filter(g => !marc.has(g.chave)));
    invalidarDicionario(); setProc(false); aoFechar(ids.length);
  }
  function lembrarRecusa(gs: Grupo[]) {
    try { localStorage.setItem(CHAVE_RECUSA, JSON.stringify([...new Set([...recusados(), ...gs.map(g => idRecusa(base, g))])].slice(-500))); } catch { /* ignora */ }
  }

  return (
    <div className="modal-bg open">
      <div className="modal" style={{ width: 'min(900px, 96vw)' }}>
        <h2>Reclassificar lançamentos semelhantes?</h2>
        <p style={{ fontSize: 13, margin: '0 0 10px' }}>Você classificou <b>{base.favorecido}</b> em <b>{classe(base.grupo_id, base.subgrupo_id ?? null)}</b>. Há lançamentos anteriores semelhantes com outra classificação. Marque os que devem passar para a nova.</p>
        <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
          <table className="compacta">
            <thead><tr><th className="c"><input type="checkbox" checked={sel.length === grupos.length} onChange={e => setMarc(new Set(e.target.checked ? grupos.map(g => g.chave) : []))} /></th>
              <th>Fornecedor / Cliente</th><th>Classificação atual</th><th>Período</th><th className="r">Qtd.</th><th className="r">Total</th></tr></thead>
            <tbody>{grupos.map(g => (
              <tr key={g.chave} className="clicavel" onClick={() => { const n = new Set(marc); n.has(g.chave) ? n.delete(g.chave) : n.add(g.chave); setMarc(n); }}>
                <td className="c"><input type="checkbox" readOnly checked={marc.has(g.chave)} /></td>
                <td>{g.nome}{!g.exato && <div><span className="tag" style={{ background: '#FFF4D6', color: '#8A6A12' }}>nome parecido</span></div>}</td>
                <td>{classe(g.grupo_id, g.subgrupo_id)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{g.de === g.ate ? dataBR(g.de) : `${dataBR(g.de)} a ${dataBR(g.ate)}`}</td>
                <td className="r">{g.ids.length}</td><td className="r">{brl(g.total)}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 0' }}>Muda grupo e subgrupo dos lançamentos marcados, inclusive pagos e de anos anteriores, e o DRE passa a refletir a nova classificação. Lançamentos com rateio não aparecem aqui. As combinações não marcadas não serão sugeridas de novo.</p>
        {erro && <div className="err mt">{erro}</div>}
        <div className="actions">
          <button className="btn ghost" disabled={proc} onClick={() => { lembrarRecusa(grupos); aoFechar(0); }}>Não reclassificar</button>
          <button className="btn" disabled={proc || !sel.length} onClick={aplicar}>{proc ? 'Reclassificando…' : `Reclassificar ${sel.reduce((a, g) => a + g.ids.length, 0)} lançamento(s)`}</button>
        </div>
      </div>
    </div>
  );
}
