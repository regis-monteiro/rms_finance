import { useEffect, useState } from 'react';
import CampoValor from './CampoValor';
import DataBR from './DataBR';
import { brl, dataBR, hojeISO } from '../lib/format';
import { OpcoesCentro, nomeCentro, centroPadrao } from '../lib/useCadastros';
import type { CentroCusto, Conta, Grupo, Lancamento, Subgrupo } from '../lib/supabase';
import { estornarPagamento, historicoPagamentos, registrarPagamento, type LinhaRateio } from '../lib/titulos';

const r2 = (v: number) => Math.round(v * 100) / 100;
export const linhaVazia = (): LinhaRateio => ({ grupo_id: null, subgrupo_id: null, centro_custo_id: null, valor: '', pct: '' });
export const somaRateio = (l: LinhaRateio[]) => r2(l.reduce((a, x) => a + Number(x.valor || 0), 0));

/** Divide a classificação de um lançamento entre grupos, subgrupos e centros de custo, por valor ou percentual */
export function EditorRateio({ total, linhas, aoMudar, grupos, subgrupos, centros, tipo }: {
  total: number; linhas: LinhaRateio[]; aoMudar: (l: LinhaRateio[]) => void; grupos: Grupo[]; subgrupos: Subgrupo[]; centros: CentroCusto[]; tipo: string;
}) {
  const set = (i: number, campo: keyof LinhaRateio, v: string | number | null) => {
    const n = linhas.map((l, k) => {
      if (k !== i) return l;
      const x = { ...l, [campo]: v } as LinhaRateio;
      if (campo === 'grupo_id') x.subgrupo_id = null;
      if (campo === 'valor') x.pct = total ? String(r2((Number(v || 0) / total) * 100)) : '';
      if (campo === 'pct') x.valor = String(r2((total * Number(v || 0)) / 100));
      return x;
    });
    aoMudar(n);
  };
  const soma = somaRateio(linhas), falta = r2(total - soma);
  const gruposTipo = grupos.filter(g => !['Transferências', 'Pagamento de fatura'].includes(g.nome) && (tipo === 'entrada' ? g.natureza !== 'despesa' : g.natureza !== 'receita'));
  return (
    <div className="full rateio">
      <table className="compacta">
        <thead><tr><th>Grupo</th><th>Subgrupo</th><th>Centro de custo</th><th className="r">Valor (R$)</th><th className="r">%</th><th /></tr></thead>
        <tbody>{linhas.map((l, i) => (
          <tr key={i}>
            <td><select value={l.grupo_id ?? ''} onChange={e => set(i, 'grupo_id', e.target.value ? Number(e.target.value) : null)}><option value="">Selecione</option>{gruposTipo.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select></td>
            <td><select value={l.subgrupo_id ?? ''} onChange={e => set(i, 'subgrupo_id', e.target.value ? Number(e.target.value) : null)}><option value="">·</option>{subgrupos.filter(s => s.grupo_id === l.grupo_id).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></td>
            <td><select value={l.centro_custo_id ?? ''} onChange={e => set(i, 'centro_custo_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">{'Padrão: ' + (nomeCentro(centros, centroPadrao(grupos, subgrupos, l.grupo_id, l.subgrupo_id)) || 'Geral')}</option><OpcoesCentro centros={centros} /></select></td>
            <td className="r"><CampoValor value={l.valor} onChange={e => set(i, 'valor', e.target.value)} style={{ width: 110, textAlign: 'right' }} /></td>
            <td className="r"><input type="number" step="0.01" min="0" max="100" value={l.pct} onChange={e => set(i, 'pct', e.target.value)} style={{ width: 74, textAlign: 'right' }} /></td>
            <td><button type="button" className="btn ghost mini" disabled={linhas.length <= 2} onClick={() => aoMudar(linhas.filter((_, k) => k !== i))}>×</button></td>
          </tr>))}</tbody>
      </table>
      <div className="filters" style={{ margin: '6px 0 0', gap: 14 }}>
        <button type="button" className="btn ghost mini" onClick={() => aoMudar([...linhas, linhaVazia()])}>+ Linha</button>
        {falta !== 0 && linhas.some(l => !l.valor) && <button type="button" className="btn ghost mini" onClick={() => { const i = linhas.findIndex(l => !l.valor); set(i, 'valor', String(falta)); }}>Completar com {brl(falta)}</button>}
        <span style={{ flex: 1 }} />
        <span>Rateado: <b>{brl(soma)}</b> de {brl(total)}</span>
        <span className={Math.abs(falta) < 0.005 ? 'pos' : 'neg'}>{Math.abs(falta) < 0.005 ? '✓ Fechado' : (falta > 0 ? 'Falta ' : 'Excede ') + brl(Math.abs(falta))}</span>
      </div>
    </div>
  );
}

/** Histórico de pagamentos de uma conta, com saldo pela diferença, pagamento parcial e estorno */
export function HistoricoPagamentos({ titulo, contas, aoMudar }: { titulo: Lancamento; contas: Conta[]; aoMudar: () => void }) {
  const [lista, setLista] = useState<Lancamento[]>([]);
  const [novo, setNovo] = useState<{ data: string; conta: string; valor: string } | null>(null);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0);
  useEffect(() => { historicoPagamentos(titulo).then(setLista); }, [titulo.id, titulo.status, titulo.valor, versao]);
  const pago = r2(lista.reduce((a, l) => a + Number(l.valor), 0));
  const total = titulo.status === 'pago' ? pago : r2(pago + Number(titulo.valor));
  const saldo = titulo.status === 'pago' ? 0 : Number(titulo.valor);
  const verbo = titulo.tipo === 'entrada' ? 'Recebido' : 'Pago';
  const nomeConta = (id: number | null) => contas.find(c => c.id === id)?.nome || '·';

  async function registrar() {
    if (!novo) return; setErro('');
    if (!novo.conta) { setErro('Informe a conta.'); return; }
    const r = await registrarPagamento(titulo, Number(novo.valor), novo.data, Number(novo.conta));
    if (r.erro) { setErro(r.erro); return; }
    setNovo(null); setVersao(v => v + 1); aoMudar();
  }
  async function estornar(p: Lancamento) {
    setErro('');
    const e = await estornarPagamento(titulo, p);
    if (e) { setErro(e); return; }
    setVersao(v => v + 1); aoMudar();
  }
  return (
    <div className="full rateio">
      <div className="filters" style={{ margin: 0, gap: 18 }}>
        <b style={{ color: 'var(--navy)' }}>{titulo.tipo === 'entrada' ? 'Recebimentos' : 'Pagamentos'} desta conta</b>
        <span>Total: <b>{brl(total)}</b></span><span>{verbo}: <b className="pos">{brl(pago)}</b></span><span>Saldo {titulo.tipo === 'entrada' ? 'a receber' : 'a pagar'}: <b className={saldo ? 'neg' : 'pos'}>{brl(saldo)}</b></span>
        <span style={{ flex: 1 }} />
        {titulo.status !== 'pago' && !novo && <button type="button" className="btn ghost mini" onClick={() => setNovo({ data: hojeISO(), conta: titulo.conta_id ? String(titulo.conta_id) : '', valor: '' })}>+ {titulo.tipo === 'entrada' ? 'Recebimento' : 'Pagamento'} parcial</button>}
      </div>
      {lista.length > 0 && (
        <table className="compacta" style={{ marginTop: 6 }}><tbody>{lista.map(p => (
          <tr key={p.id}><td>{dataBR(p.data_pagamento)}</td><td>{nomeConta(p.conta_id)}</td><td style={{ color: 'var(--muted)' }}>{p.id === titulo.id ? 'quitação' : 'parcial'}</td>
            <td className="r">{brl(p.valor)}</td><td className="r"><button type="button" className="btn ghost mini" onClick={() => estornar(p)}>Estornar</button></td></tr>))}</tbody></table>
      )}
      {novo && (
        <div className="filters" style={{ margin: '8px 0 0' }}>
          <DataBR value={novo.data} onChange={e => setNovo({ ...novo, data: e.target.value })} style={{ width: 132 }} />
          <select value={novo.conta} onChange={e => setNovo({ ...novo, conta: e.target.value })}><option value="">Conta</option>{contas.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
          <CampoValor value={novo.valor} placeholder={'até ' + brl(saldo)} onChange={e => setNovo({ ...novo, valor: e.target.value })} style={{ width: 130, textAlign: 'right' }} />
          <button type="button" className="btn mini" onClick={registrar}>Registrar</button><button type="button" className="btn ghost mini" onClick={() => setNovo(null)}>Cancelar</button>
        </div>
      )}
      {erro && <div className="err" style={{ marginTop: 6 }}>{erro}</div>}
    </div>
  );
}
