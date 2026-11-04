import { useEffect, useMemo, useState } from 'react';
import CampoValor from './CampoValor';
import DataBR from './DataBR';
import { supabase, type Beneficiario, type CentroCusto, type Conta, type Grupo, type Lancamento, type Subgrupo } from '../lib/supabase';
import { brl, dataBR, hojeISO, statusEfetivo, classeStatus, STATUS_LABEL } from '../lib/format';
import { OpcoesCentro, nomeCentro, centroPadrao } from '../lib/useCadastros';
import { formatarDocumento } from '../lib/documento';
import { usePersistente, limparRascunhos } from '../lib/rascunho';
import { registrarPagamento } from '../lib/titulos';
import { invalidarDicionario } from '../lib/sugestao';

export interface Cad { contas: Conta[]; grupos: Grupo[]; subgrupos: Subgrupo[]; centros: CentroCusto[]; beneficiarios: Beneficiario[] }
export interface Tarifa { houve: boolean; unit: string; benef: string }
const r2 = (v: number) => Math.round(v * 100) / 100;
const rotuloB = (b?: Beneficiario) => (b ? `${b.nome} · ${formatarDocumento(b.documento)}` : '');
const exigeBenefTarifa = (data: string) => data >= '2027-01-01';

/** Lança a tarifa total do lote (quantidade × custo unitário) em Tarifas Bancárias · Cobrança */
export async function lancarTarifa(cad: Cad, n: number, unit: number, data: string, conta: number, benef: number | null) {
  const g = cad.grupos.find(x => x.nome === 'Tarifas Bancárias');
  if (!g) throw new Error('Grupo "Tarifas Bancárias" não encontrado no plano de contas.');
  const sg = cad.subgrupos.find(x => x.grupo_id === g.id && x.nome === 'Cobrança');
  const b = cad.beneficiarios.find(x => x.id === benef);
  const r = await supabase.from('lancamentos').insert({
    tipo: 'saida', conta_id: conta, vencimento: data, data_pagamento: data, grupo_id: g.id, subgrupo_id: sg?.id ?? null, beneficiario_id: b?.id ?? null,
    favorecido: b?.nome || cad.contas.find(c => c.id === conta)?.nome || 'Banco', referencia: `Tarifa de ${n} boleto(s)`, valor: r2(n * unit), status: 'pago',
    forma_pagamento: 'Débito em conta', observacao: `tarifa de ${n} boleto(s) × ${brl(unit)}`,
  }).select('id').single();
  if (r.error) throw new Error('Tarifa: ' + r.error.message);
  return r.data.id as number;
}

export function CamposTarifa({ t, setT, data, cad, n }: { t: Tarifa; setT: (t: Tarifa) => void; data: string; cad: Cad; n: number }) {
  const [txt, setTxt] = useState(rotuloB(cad.beneficiarios.find(b => String(b.id) === t.benef)));
  return (
    <>
      <label className="full" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontWeight: 400 }}>
        <input type="checkbox" checked={t.houve} onChange={e => setT({ ...t, houve: e.target.checked })} style={{ width: 'auto' }} /> Houve tarifa bancária nos boletos recebidos</label>
      {t.houve && <>
        <label>Custo unitário por boleto (R$)<CampoValor value={t.unit} onChange={e => setT({ ...t, unit: e.target.value })} /></label>
        <label>Tarifa total<input disabled value={brl(r2(n * Number(t.unit || 0)))} /></label>
        <label className="span2">Banco (fornecedor da tarifa){exigeBenefTarifa(data) ? ' *' : ' (opcional)'}
          <input list="rec-benef-tarifa" value={txt} placeholder="Nome ou CNPJ do banco" onChange={e => { setTxt(e.target.value); const b = cad.beneficiarios.find(x => rotuloB(x) === e.target.value); setT({ ...t, benef: b ? String(b.id) : '' }); }} />
          <datalist id="rec-benef-tarifa">{cad.beneficiarios.filter(b => b.ativo).map(b => <option key={b.id} value={rotuloB(b)} />)}</datalist></label>
      </>}
    </>
  );
}

/* ---------------- Contas a receber em aberto, com baixa em lote ---------------- */
export function AbaEmAberto({ cad, ano, mes, aoMudar }: { cad: Cad; ano: number; mes: number; aoMudar: () => void }) {
  const [lista, setLista] = useState<Lancamento[]>([]);
  const [busca, setBusca] = useState('');
  const [vencidas, setVencidas] = useState(true);
  const [sel, setSel] = usePersistente<number[]>('rec:sel', []);
  const [baixa, setBaixa] = usePersistente<{ data: string; conta: string; valores: Record<number, string>; tarifa: Tarifa } | null>('rec:baixa', null);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [proc, setProc] = useState(false);
  const [versao, setVersao] = useState(0);
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`, ini = `${ano}-${String(mes).padStart(2, '0')}-01`;

  useEffect(() => {
    let q = supabase.from('lancamentos').select('*').eq('tipo', 'entrada').neq('status', 'pago').is('transferencia_id', null).lte('vencimento', fim);
    if (!vencidas) q = q.gte('vencimento', ini);
    q.order('vencimento').order('favorecido').range(0, 2999).then(({ data }) => setLista((data as Lancamento[]) || []));
  }, [ano, mes, vencidas, versao]);

  const linhas = useMemo(() => lista.filter(l => !busca || l.favorecido.toLowerCase().includes(busca.toLowerCase())), [lista, busca]);
  const marcados = lista.filter(l => sel.includes(l.id));
  const nomeG = (id: number) => cad.grupos.find(g => g.id === id)?.nome || '';
  const hoje = hojeISO();

  async function confirmar(e: React.FormEvent) {
    e.preventDefault(); if (!baixa) return; setErro('');
    const unit = Number(baixa.tarifa.unit || 0);
    if (!baixa.conta) { setErro('Informe a conta do recebimento.'); return; }
    if (baixa.tarifa.houve && !(unit > 0)) { setErro('Informe o custo unitário da tarifa.'); return; }
    if (baixa.tarifa.houve && exigeBenefTarifa(baixa.data) && !baixa.tarifa.benef) { setErro('A partir de 01/01/2027, informe o banco cadastrado como fornecedor da tarifa.'); return; }
    setProc(true);
    try {
      const conta = Number(baixa.conta), itens: { beneficiario_id: number | null; nome: string; valor: number; lancamento_id: number | null }[] = [];
      for (const l of marcados) {
        const v = Number(baixa.valores[l.id] ?? l.valor);
        const r = await registrarPagamento(l, v, baixa.data, conta);
        if (r.erro) throw new Error(`${l.favorecido}: ${r.erro}`);
        itens.push({ beneficiario_id: l.beneficiario_id, nome: l.favorecido, valor: r2(v), lancamento_id: r.id });
      }
      const idTarifa = baixa.tarifa.houve ? await lancarTarifa(cad, itens.length, unit, baixa.data, conta, baixa.tarifa.benef ? Number(baixa.tarifa.benef) : null) : null;
      const lote = await supabase.from('lotes_recebimento').insert({ tipo: 'baixa', data: baixa.data, conta_id: conta, quantidade: itens.length, tarifa_unitaria: baixa.tarifa.houve ? unit : 0,
        total: r2(itens.reduce((a, x) => a + x.valor, 0)), lanc_tarifa_id: idTarifa }).select('id').single();
      if (!lote.error) await supabase.from('lotes_recebimento_itens').insert(itens.map(x => ({ ...x, lote_id: lote.data.id })));
      try { localStorage.setItem('rms-tarifa-boleto', JSON.stringify({ unit: baixa.tarifa.unit, benef: baixa.tarifa.benef })); } catch { /* ignora */ }
      setMsg(`${itens.length} recebimento(s) baixado(s)${idTarifa ? ` e tarifa de ${brl(r2(itens.length * unit))} lançada` : ''}.`);
      setBaixa(null); setSel([]); setVersao(v => v + 1); aoMudar();
    } catch (err) { setErro((err as Error).message); }
    setProc(false);
  }

  const abrirBaixa = () => {
    setErro(''); setMsg('');
    let ult: { unit?: string; benef?: string } = {};
    try { ult = JSON.parse(localStorage.getItem('rms-tarifa-boleto') || '{}'); } catch { /* ignora */ }
    const contaPadrao = marcados.find(l => l.conta_id)?.conta_id;
    setBaixa({ data: hoje, conta: contaPadrao ? String(contaPadrao) : '', valores: {}, tarifa: { houve: !!ult.unit, unit: ult.unit || '', benef: ult.benef || '' } });
  };
  const totalSel = marcados.reduce((a, l) => a + Number(baixa?.valores[l.id] ?? l.valor), 0);

  return (
    <div className="card">
      <div className="filters">
        <input placeholder="Buscar cliente" value={busca} onChange={e => setBusca(e.target.value)} style={{ minWidth: 240 }} />
        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={vencidas} onChange={e => setVencidas(e.target.checked)} /> Incluir vencidas de meses anteriores</label>
        <span style={{ flex: 1 }} />
        {msg && <span className="ok">{msg}</span>}
        {sel.length > 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{sel.length} selecionada(s): {brl(marcados.reduce((a, l) => a + Number(l.valor), 0))}</span>}
        <button className="btn" disabled={!marcados.length} onClick={abrirBaixa}>Baixar selecionadas</button>
      </div>
      {linhas.length === 0 ? <div className="empty">Nenhuma conta a receber em aberto até {dataBR(fim)}.</div> : (
        <table className="compacta">
          <thead><tr><th className="c"><input type="checkbox" checked={linhas.every(l => sel.includes(l.id))} onChange={e => setSel(e.target.checked ? [...new Set([...sel, ...linhas.map(l => l.id)])] : sel.filter(id => !linhas.some(l => l.id === id)))} /></th>
            <th>Vencimento</th><th>Cliente / Origem</th><th>Grupo</th><th>Ref.</th><th className="r">Valor</th><th>Status</th></tr></thead>
          <tbody>{linhas.map(l => { const s = statusEfetivo(l.status, l.vencimento); return (
            <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => setSel(sel.includes(l.id) ? sel.filter(x => x !== l.id) : [...sel, l.id])}>
              <td className="c"><input type="checkbox" readOnly checked={sel.includes(l.id)} /></td>
              <td>{dataBR(l.vencimento)}</td><td>{l.favorecido}</td><td>{nomeG(l.grupo_id)}</td><td>{l.referencia || '·'}</td>
              <td className="r pos">{brl(l.valor)}{l.valor_original != null && <div style={{ fontSize: 11, color: 'var(--muted)' }}>saldo de {brl(l.valor_original)}</div>}</td>
              <td><span className={'st ' + classeStatus(s)}>{STATUS_LABEL[s]}</span></td></tr>); })}</tbody>
        </table>
      )}

      {baixa && (
        <div className="modal-bg open">
          <div className="modal" style={{ width: 'min(860px, 96vw)' }}><h2>Baixar {marcados.length} recebimento(s)</h2>
            <form className="form form4" onSubmit={confirmar}>
              <label>Data do recebimento<DataBR required value={baixa.data} onChange={e => setBaixa({ ...baixa, data: e.target.value })} /></label>
              <label>Conta<select required value={baixa.conta} onChange={e => setBaixa({ ...baixa, conta: e.target.value })}><option value="" disabled>Selecione</option>{cad.contas.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
              <label className="span2">Total recebido<input disabled value={brl(totalSel)} /></label>
              <CamposTarifa t={baixa.tarifa} setT={t => setBaixa({ ...baixa, tarifa: t })} data={baixa.data} cad={cad} n={marcados.length} />
              <div className="full" style={{ maxHeight: '34vh', overflow: 'auto' }}>
                <table className="compacta"><thead><tr><th>Cliente</th><th>Vencimento</th><th className="r">Em aberto</th><th className="r">Recebido</th></tr></thead>
                  <tbody>{marcados.map(l => (
                    <tr key={l.id}><td>{l.favorecido}</td><td>{dataBR(l.vencimento)}</td><td className="r">{brl(l.valor)}</td>
                      <td className="r"><CampoValor value={baixa.valores[l.id] ?? String(l.valor)} onChange={e => setBaixa({ ...baixa, valores: { ...baixa.valores, [l.id]: e.target.value } })} style={{ width: 120, textAlign: 'right' }} /></td></tr>))}</tbody></table>
              </div>
              <p className="full" style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Valor menor que o em aberto registra recebimento parcial; a diferença continua a receber na mesma conta.{baixa.tarifa.houve ? ' A tarifa é lançada de forma consolidada, ligada a este lote.' : ''}</p>
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setBaixa(null)}>Cancelar</button><button className="btn" disabled={proc}>{proc ? 'Gravando…' : 'Confirmar baixa'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Lançar recebimentos (lote consolidado, até 50 valores) ---------------- */
interface LinhaRec { cliente: string; valor: string }
const LINHAS = 50;
export function ModalLancarRecebimentos({ cad, aoFechar, aoSalvar }: { cad: Cad; aoFechar: () => void; aoSalvar: (m: string) => void }) {
  const honor = cad.grupos.find(g => g.nome === 'Honorários');
  const [f, setF] = usePersistente('rec:lote', () => {
    let ult: { unit?: string; benef?: string } = {};
    try { ult = JSON.parse(localStorage.getItem('rms-tarifa-boleto') || '{}'); } catch { /* ignora */ }
    return { data: hojeISO(), conta: '', grupo: honor ? String(honor.id) : '', sub: '', centro: '', tarifa: { houve: !!ult.unit, unit: ult.unit || '', benef: ult.benef || '' } as Tarifa,
      linhas: Array.from({ length: LINHAS }, () => ({ cliente: '', valor: '' })) as LinhaRec[] };
  });
  const [erro, setErro] = useState('');
  const [proc, setProc] = useState(false);
  const preenchidas = f.linhas.filter(l => Number(l.valor) > 0);
  const total = r2(preenchidas.reduce((a, l) => a + Number(l.valor), 0)), n = preenchidas.length;
  const tarifa = f.tarifa.houve ? r2(n * Number(f.tarifa.unit || 0)) : 0;
  const setL = (i: number, k: keyof LinhaRec, v: string) => setF({ ...f, linhas: f.linhas.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  const fechar = () => { limparRascunhos('rec:lote'); aoFechar(); };

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    const unit = Number(f.tarifa.unit || 0);
    if (!n) { setErro('Informe ao menos um valor recebido.'); return; }
    if (!f.conta || !f.grupo) { setErro('Informe a conta e o grupo.'); return; }
    if (f.tarifa.houve && !(unit > 0)) { setErro('Informe o custo unitário da tarifa.'); return; }
    if (f.tarifa.houve && exigeBenefTarifa(f.data) && !f.tarifa.benef) { setErro('A partir de 01/01/2027, informe o banco cadastrado como fornecedor da tarifa.'); return; }
    setProc(true);
    try {
      const conta = Number(f.conta);
      const r = await supabase.from('lancamentos').insert({
        tipo: 'entrada', conta_id: conta, vencimento: f.data, data_pagamento: f.data, grupo_id: Number(f.grupo), subgrupo_id: f.sub ? Number(f.sub) : null, centro_custo_id: f.centro ? Number(f.centro) : null,
        favorecido: `Recebimento de boletos (${n})`, referencia: `Lote de ${n} boleto(s)`, valor: total, status: 'pago', forma_pagamento: 'Boleto', observacao: 'lote de recebimentos',
      }).select('id').single();
      if (r.error) throw new Error(r.error.message);
      const idTarifa = f.tarifa.houve ? await lancarTarifa(cad, n, unit, f.data, conta, f.tarifa.benef ? Number(f.tarifa.benef) : null) : null;
      const lote = await supabase.from('lotes_recebimento').insert({ tipo: 'consolidado', data: f.data, conta_id: conta, quantidade: n, tarifa_unitaria: f.tarifa.houve ? unit : 0, total, lanc_consolidado_id: r.data.id, lanc_tarifa_id: idTarifa }).select('id').single();
      if (lote.error) throw new Error(lote.error.message);
      const itens = preenchidas.map(l => { const b = cad.beneficiarios.find(x => rotuloB(x) === l.cliente || x.nome === l.cliente); return { lote_id: lote.data.id, beneficiario_id: b?.id ?? null, nome: b?.nome || l.cliente.trim() || null, valor: r2(Number(l.valor)) }; });
      const ri = await supabase.from('lotes_recebimento_itens').insert(itens);
      if (ri.error) throw new Error(ri.error.message);
      try { localStorage.setItem('rms-tarifa-boleto', JSON.stringify({ unit: f.tarifa.unit, benef: f.tarifa.benef })); } catch { /* ignora */ }
      invalidarDicionario(); limparRascunhos('rec:lote');
      aoSalvar(`Lançado o recebimento consolidado de ${brl(total)} (${n} boleto(s))${idTarifa ? ` e a tarifa de ${brl(tarifa)}` : ''}.`);
    } catch (err) { setErro((err as Error).message); }
    setProc(false);
  }

  const metade = Math.ceil(LINHAS / 2);
  const coluna = (de: number) => (
    <table className="compacta"><thead><tr><th style={{ width: 26 }}>#</th><th>Cliente (opcional)</th><th className="r">Valor (R$)</th></tr></thead>
      <tbody>{f.linhas.slice(de, de + metade).map((l, k) => { const i = de + k; return (
        <tr key={i}><td style={{ color: 'var(--muted)' }}>{i + 1}</td>
          <td><input list="rec-clientes" value={l.cliente} onChange={e => setL(i, 'cliente', e.target.value)} style={{ width: '100%' }} /></td>
          <td className="r"><CampoValor value={l.valor} onChange={e => setL(i, 'valor', e.target.value)} style={{ width: 110, textAlign: 'right' }} /></td></tr>); })}</tbody></table>
  );
  return (
    <div className="modal-bg open">
      <div className="modal" style={{ width: 'min(1100px, 96vw)' }}><h2>Lançar recebimentos de boletos</h2>
        <form className="form form4" onSubmit={salvar}>
          <label>Data do recebimento<DataBR required value={f.data} onChange={e => setF({ ...f, data: e.target.value })} /></label>
          <label>Conta<select required value={f.conta} onChange={e => setF({ ...f, conta: e.target.value })}><option value="" disabled>Selecione</option>{cad.contas.filter(c => c.ativa && c.tipo !== 'aplicacao').map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
          <label>Grupo<select required value={f.grupo} onChange={e => setF({ ...f, grupo: e.target.value, sub: '' })}><option value="" disabled>Selecione</option>{cad.grupos.filter(g => g.natureza === 'receita').map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select></label>
          <label>Subgrupo<select value={f.sub} onChange={e => setF({ ...f, sub: e.target.value })}><option value="">·</option>{cad.subgrupos.filter(s => s.grupo_id === Number(f.grupo)).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
          <label className="span2">Centro de custo<select value={f.centro} onChange={e => setF({ ...f, centro: e.target.value })}>
            <option value="">{'Padrão do plano: ' + (nomeCentro(cad.centros, centroPadrao(cad.grupos, cad.subgrupos, Number(f.grupo), Number(f.sub))) || 'Geral')}</option><OpcoesCentro centros={cad.centros} /></select></label>
          <span className="span2" />
          <CamposTarifa t={f.tarifa} setT={t => setF({ ...f, tarifa: t })} data={f.data} cad={cad} n={n} />
          <datalist id="rec-clientes">{cad.beneficiarios.filter(b => b.ativo).map(b => <option key={b.id} value={rotuloB(b)} />)}</datalist>
          <div className="full" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxHeight: '40vh', overflow: 'auto' }}>{coluna(0)}{coluna(metade)}</div>
          <div className="full filters" style={{ justifyContent: 'flex-end', gap: 18, margin: 0 }}>
            <span>Boletos: <b>{n}</b></span><span>Total recebido: <b className="pos">{brl(total)}</b></span>
            {f.tarifa.houve && <><span>Tarifa: <b className="neg">−{brl(tarifa)}</b></span><span>Líquido: <b>{brl(r2(total - tarifa))}</b></span></>}
          </div>
          <p className="full" style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Gera um lançamento de entrada com o total e, se houver, um lançamento de tarifa. Ao abrir qualquer um deles em Lançamentos, aparece o detalhamento dos valores digitados.</p>
          {erro && <div className="err full">{erro}</div>}
          <div className="actions full"><button type="button" className="btn ghost" onClick={fechar}>Cancelar</button><button className="btn" disabled={proc}>{proc ? 'Gravando…' : 'Lançar recebimentos'}</button></div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- Detalhamento do lote (aberto a partir do lançamento) ---------------- */
interface Lote { id: number; tipo: string; data: string; quantidade: number; tarifa_unitaria: number; total: number; lanc_consolidado_id: number | null; lanc_tarifa_id: number | null }
interface ItemLote { id: number; nome: string | null; valor: number; lancamento_id: number | null }
export function DetalheLote({ lancamentoId, aoEditar }: { lancamentoId: number; aoEditar?: (loteId: number) => void }) {
  const [lote, setLote] = useState<Lote | null>(null);
  const [itens, setItens] = useState<ItemLote[]>([]);
  useEffect(() => {
    (async () => {
      let { data } = await supabase.from('lotes_recebimento').select('*').or(`lanc_consolidado_id.eq.${lancamentoId},lanc_tarifa_id.eq.${lancamentoId}`).limit(1);
      if (!data?.length) {
        const it = await supabase.from('lotes_recebimento_itens').select('lote_id').eq('lancamento_id', lancamentoId).limit(1);
        if (it.data?.length) ({ data } = await supabase.from('lotes_recebimento').select('*').eq('id', (it.data[0] as { lote_id: number }).lote_id));
      }
      const l = (data?.[0] as Lote) || null; setLote(l);
      if (l) { const r = await supabase.from('lotes_recebimento_itens').select('*').eq('lote_id', l.id).order('id'); setItens((r.data as ItemLote[]) || []); }
    })().catch(() => setLote(null));
  }, [lancamentoId]);
  if (!lote) return null;
  const tarifa = r2(lote.quantidade * Number(lote.tarifa_unitaria));
  return (
    <div className="full rateio">
      <div className="filters" style={{ margin: 0, gap: 16 }}>
        <b style={{ color: 'var(--navy)' }}>{lote.tipo === 'consolidado' ? 'Detalhamento do recebimento consolidado' : 'Lote de baixa de boletos'}</b>
        <span>{dataBR(lote.data)}</span><span>Boletos: <b>{lote.quantidade}</b></span><span>Total: <b className="pos">{brl(lote.total)}</b></span>
        {Number(lote.tarifa_unitaria) > 0 && <span>Tarifa: <b className="neg">{lote.quantidade} × {brl(lote.tarifa_unitaria)} = {brl(tarifa)}</b></span>}
        <span style={{ flex: 1 }} />
        {aoEditar && <button type="button" className="btn ghost mini" onClick={() => aoEditar(lote.id)}>Editar lote</button>}
      </div>
      <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 6 }}>
        <table className="compacta"><tbody>{itens.map((x, i) => <tr key={x.id} style={{ background: x.lancamento_id === lancamentoId ? '#FFF8E6' : undefined }}><td style={{ color: 'var(--muted)', width: 30 }}>{i + 1}</td><td>{x.nome || 'Cliente não informado'}</td><td className="r">{brl(x.valor)}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
