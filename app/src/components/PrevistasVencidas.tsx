import { useEffect, useState } from 'react';
import DataBR from './DataBR';
import { supabase, type Lancamento } from '../lib/supabase';
import { brl, dataBR, hojeISO } from '../lib/format';

/**
 * Contas com status Previsto cujo vencimento já passou: aviso com botão que abre a
 * confirmação em lote para atualizar as datas (sugere hoje; pode escolher outra, no geral ou por linha).
 */
export default function PrevistasVencidas({ tipo, aoMudar, recarga }: { tipo?: 'entrada' | 'saida'; aoMudar: () => void; recarga?: number }) {
  const hoje = hojeISO();
  const [lista, setLista] = useState<Lancamento[]>([]);
  const [aberto, setAberto] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [datas, setDatas] = useState<Record<number, string>>({});
  const [geral, setGeral] = useState(hoje);
  const [erro, setErro] = useState('');
  const [proc, setProc] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let q = supabase.from('lancamentos').select('*').eq('status', 'previsto').lt('vencimento', hoje).is('fatura_id', null).is('transferencia_id', null);
    if (tipo) q = q.eq('tipo', tipo);
    q.order('vencimento').order('favorecido').range(0, 1999).then(({ data }) => setLista((data as Lancamento[]) || []));
  }, [tipo, versao, recarga]);

  if (!lista.length) return null;
  const abrir = () => { setSel(new Set(lista.map(l => l.id))); setDatas({}); setGeral(hoje); setErro(''); setAberto(true); };
  const dataDe = (l: Lancamento) => datas[l.id] || geral;
  const marcados = lista.filter(l => sel.has(l.id));

  async function confirmar() {
    setErro('');
    const ruins = marcados.filter(l => !dataDe(l));
    if (ruins.length) { setErro('Informe a nova data de todas as selecionadas.'); return; }
    setProc(true);
    const grupos = new Map<string, number[]>();
    marcados.forEach(l => { const d = dataDe(l); grupos.set(d, [...(grupos.get(d) || []), l.id]); });
    for (const [d, ids] of grupos) {
      const { error } = await supabase.from('lancamentos').update({ vencimento: d, atualizado_em: new Date().toISOString() }).in('id', ids);
      if (error) { setErro(error.message); setProc(false); return; }
    }
    setProc(false); setAberto(false); setVersao(v => v + 1); aoMudar();
  }

  const rotulo = tipo === 'entrada' ? 'conta(s) a receber prevista(s)' : tipo === 'saida' ? 'conta(s) a pagar prevista(s)' : 'conta(s) prevista(s)';
  return (
    <>
      <div className="proto" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px', fontSize: 13 }}>
        <b>{lista.length} {rotulo} com vencimento já passado</b> ({brl(lista.reduce((a, l) => a + Number(l.valor), 0))}). Atualize as datas para manter o fluxo e o saldo projetado corretos.
        <span style={{ flex: 1 }} />
        <button className="btn mini" onClick={abrir}>Atualizar datas</button>
      </div>
      {aberto && (
        <div className="modal-bg open">
          <div className="modal" style={{ width: 'min(1000px, 96vw)' }}><h2>Atualizar datas das previstas vencidas</h2>
            <div className="form form4">
              <label>Nova data para as selecionadas<DataBR value={geral} onChange={e => setGeral(e.target.value)} /></label>
              <p className="span3" style={{ margin: '18px 0 0', fontSize: 12, color: 'var(--muted)' }}>Vale para todas as marcadas, exceto as que tiverem data própria na coluna "Nova data". Só o vencimento muda; o status continua Previsto.</p>
            </div>
            <div style={{ maxHeight: '48vh', overflow: 'auto', marginTop: 10 }}>
              <table className="compacta">
                <thead><tr><th className="c"><input type="checkbox" checked={marcados.length === lista.length} onChange={e => setSel(e.target.checked ? new Set(lista.map(l => l.id)) : new Set())} /></th>
                  <th>Vencimento atual</th><th>Tipo</th><th>Fornecedor / Cliente</th><th>Ref.</th><th className="r">Valor</th><th>Nova data (opcional)</th></tr></thead>
                <tbody>{lista.map(l => (
                  <tr key={l.id} style={{ opacity: sel.has(l.id) ? 1 : 0.5 }}>
                    <td className="c"><input type="checkbox" checked={sel.has(l.id)} onChange={e => { const n = new Set(sel); e.target.checked ? n.add(l.id) : n.delete(l.id); setSel(n); }} /></td>
                    <td>{dataBR(l.vencimento)}</td><td>{l.tipo === 'entrada' ? <span className="pos">Entrada</span> : 'Saída'}</td><td>{l.favorecido}</td><td>{l.referencia || '·'}</td>
                    <td className={'r ' + (l.tipo === 'entrada' ? 'pos' : '')}>{brl(l.valor)}</td>
                    <td style={{ width: 170 }}>{sel.has(l.id) && <DataBR value={datas[l.id] || ''} onChange={e => setDatas({ ...datas, [l.id]: e.target.value })} />}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            {erro && <div className="err mt">{erro}</div>}
            <div className="actions">
              <span style={{ marginRight: 'auto', fontSize: 13 }}>{marcados.length} selecionada(s) · {brl(marcados.reduce((a, l) => a + Number(l.valor), 0))}</span>
              <button className="btn ghost" onClick={() => setAberto(false)}>Cancelar</button>
              <button className="btn" disabled={proc || !marcados.length} onClick={confirmar}>{proc ? 'Gravando…' : 'Atualizar datas'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
