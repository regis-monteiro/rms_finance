import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CampoValor from './CampoValor';
import DataBR from './DataBR';
import { supabase, type Beneficiario, type Lancamento } from '../lib/supabase';
import { brl, dataBR } from '../lib/format';
import { formatarDocumento } from '../lib/documento';
import { estornarPagamento, registrarPagamento } from '../lib/titulos';
import { invalidarDicionario } from '../lib/sugestao';
import { CamposTarifa, lancarTarifa, type Cad, type Tarifa } from './Recebimentos';

interface Lote { id: number; tipo: 'baixa' | 'consolidado'; data: string; conta_id: number; quantidade: number; tarifa_unitaria: number; total: number; lanc_consolidado_id: number | null; lanc_tarifa_id: number | null }
interface Item { id?: number; beneficiario_id: number | null; nome: string | null; valor: number; lancamento_id: number | null }
/** Linha em edição: "orig" guarda o item como estava, para saber o que mudou */
interface Ed { chave: string; cliente: string; valor: string; lanc?: Lancamento; orig?: Item; novoTitulo?: Lancamento }
const r2 = (v: number) => Math.round(v * 100) / 100;
const rotuloB = (b?: Beneficiario) => (b ? `${b.nome} · ${formatarDocumento(b.documento)}` : '');
const agora = () => new Date().toISOString();

/** Abre o lote de recebimentos (digitados ou baixa de boletos) para alterar data, conta, tarifa e itens */
export function ModalEditarLote({ loteId, cad, aoFechar, aoSalvar }: { loteId: number; cad: Cad; aoFechar: () => void; aoSalvar: (m: string) => void }) {
  const nav = useNavigate();
  const [lote, setLote] = useState<Lote | null>(null);
  const [f, setF] = useState<{ data: string; conta: string; tarifa: Tarifa }>({ data: '', conta: '', tarifa: { houve: false, unit: '', benef: '' } });
  const [linhas, setLinhas] = useState<Ed[]>([]);
  const [abertos, setAbertos] = useState<Lancamento[]>([]);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState('');
  const [proc, setProc] = useState(false);
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: l } = await supabase.from('lotes_recebimento').select('*').eq('id', loteId).single();
      const lt = l as Lote; setLote(lt);
      const { data: it } = await supabase.from('lotes_recebimento_itens').select('*').eq('lote_id', loteId).order('id');
      const itens = (it as Item[]) || [];
      const ids = itens.map(x => x.lancamento_id).filter(Boolean) as number[];
      const { data: ls } = ids.length ? await supabase.from('lancamentos').select('*').in('id', ids) : { data: [] };
      const tarifa = lt.lanc_tarifa_id ? (await supabase.from('lancamentos').select('beneficiario_id').eq('id', lt.lanc_tarifa_id).single()).data as { beneficiario_id: number | null } | null : null;
      setF({ data: lt.data, conta: String(lt.conta_id), tarifa: { houve: Number(lt.tarifa_unitaria) > 0, unit: Number(lt.tarifa_unitaria) > 0 ? String(lt.tarifa_unitaria) : '', benef: tarifa?.beneficiario_id ? String(tarifa.beneficiario_id) : '' } });
      setLinhas(itens.map((x, i) => ({ chave: 'o' + i, cliente: rotuloB(cad.beneficiarios.find(b => b.id === x.beneficiario_id)) || x.nome || '', valor: String(x.valor), orig: x,
        lanc: ((ls as Lancamento[]) || []).find(y => y.id === x.lancamento_id) })));
      if (lt.tipo === 'baixa') {
        const { data: ab } = await supabase.from('lancamentos').select('*').eq('tipo', 'entrada').neq('status', 'pago').is('transferencia_id', null).order('vencimento').range(0, 1999);
        setAbertos((ab as Lancamento[]) || []);
      }
    })().catch(e => setErro((e as Error).message));
  }, [loteId]);

  const ativos = linhas.filter(l => Number(l.valor) > 0);
  const total = r2(ativos.reduce((a, l) => a + Number(l.valor), 0)), n = ativos.length;
  const tarifaTotal = f.tarifa.houve ? r2(n * Number(f.tarifa.unit || 0)) : 0;
  const usados = new Set(linhas.map(l => l.novoTitulo?.id).filter(Boolean));
  const candidatos = useMemo(() => abertos.filter(a => !usados.has(a.id) && (!busca || a.favorecido.toLowerCase().includes(busca.toLowerCase()))).slice(0, 30), [abertos, busca, linhas]);
  const set = (k: string, campo: 'cliente' | 'valor', v: string) => setLinhas(linhas.map(l => (l.chave === k ? { ...l, [campo]: v } : l)));

  /** Título (conta original) de um pagamento: o próprio lançamento ou a conta da qual ele é parcial */
  async function tituloDe(l: Lancamento) {
    if (!l.titulo_id) { const { data } = await supabase.from('lancamentos').select('*').eq('id', l.id).single(); return data as Lancamento; }
    const { data } = await supabase.from('lancamentos').select('*').eq('id', l.titulo_id).single(); return data as Lancamento;
  }
  async function estornar(l: Lancamento) {
    const t = await tituloDe(l);
    const e = await estornarPagamento(t, l.titulo_id ? l : t);
    if (e) throw new Error(`${l.favorecido}: ${e}`);
    return t.id;
  }

  async function salvar() {
    if (!lote) return; setErro('');
    const unit = Number(f.tarifa.unit || 0), conta = Number(f.conta);
    if (!n) { setErro('O lote precisa de ao menos um item com valor. Para desfazer tudo, use "Excluir lote".'); return; }
    if (!f.conta || !f.data) { setErro('Informe a data e a conta.'); return; }
    if (f.tarifa.houve && !(unit > 0)) { setErro('Informe o custo unitário da tarifa.'); return; }
    if (f.tarifa.houve && f.data >= '2027-01-01' && !f.tarifa.benef) { setErro('A partir de 01/01/2027, informe o banco cadastrado como fornecedor da tarifa.'); return; }
    setProc(true);
    try {
      const novos: Item[] = [];
      if (lote.tipo === 'consolidado') {
        novos.push(...ativos.map(l => { const b = cad.beneficiarios.find(x => rotuloB(x) === l.cliente || x.nome === l.cliente); return { beneficiario_id: b?.id ?? null, nome: b?.nome || l.cliente.trim() || null, valor: r2(Number(l.valor)), lancamento_id: null }; }));
        const r = await supabase.from('lancamentos').update({ valor: total, vencimento: f.data, data_pagamento: f.data, conta_id: conta, favorecido: `Recebimento de boletos (${n})`, referencia: `Lote de ${n} boleto(s)`, atualizado_em: agora() }).eq('id', lote.lanc_consolidado_id!);
        if (r.error) throw new Error(r.error.message);
      } else {
        for (const l of linhas) {
          const v = r2(Number(l.valor || 0));
          if (l.lanc) {
            const mudouValor = !(v > 0) || Math.abs(v - Number(l.lanc.valor)) >= 0.005;
            if (mudouValor) {
              const tid = await estornar(l.lanc);
              if (v > 0) {
                const { data: t } = await supabase.from('lancamentos').select('*').eq('id', tid).single();
                const r = await registrarPagamento(t as Lancamento, v, f.data, conta);
                if (r.erro) throw new Error(`${l.lanc.favorecido}: ${r.erro}`);
                novos.push({ beneficiario_id: l.lanc.beneficiario_id, nome: l.lanc.favorecido, valor: v, lancamento_id: r.id });
              }
            } else {
              if (l.lanc.data_pagamento !== f.data || l.lanc.conta_id !== conta) {
                const r = await supabase.from('lancamentos').update({ data_pagamento: f.data, conta_id: conta, atualizado_em: agora() }).eq('id', l.lanc.id);
                if (r.error) throw new Error(r.error.message);
              }
              novos.push({ beneficiario_id: l.lanc.beneficiario_id, nome: l.lanc.favorecido, valor: v, lancamento_id: l.lanc.id });
            }
          } else if (l.novoTitulo && v > 0) {
            const r = await registrarPagamento(l.novoTitulo, v, f.data, conta);
            if (r.erro) throw new Error(`${l.novoTitulo.favorecido}: ${r.erro}`);
            novos.push({ beneficiario_id: l.novoTitulo.beneficiario_id, nome: l.novoTitulo.favorecido, valor: v, lancamento_id: r.id });
          }
        }
      }
      // Tarifa do lote: recalculada pela quantidade de itens
      let idTarifa = lote.lanc_tarifa_id;
      if (f.tarifa.houve) {
        const b = cad.beneficiarios.find(x => String(x.id) === f.tarifa.benef);
        if (idTarifa) {
          const r = await supabase.from('lancamentos').update({ valor: tarifaTotal, vencimento: f.data, data_pagamento: f.data, conta_id: conta, beneficiario_id: b?.id ?? null,
            referencia: `Tarifa de ${n} boleto(s)`, observacao: `tarifa de ${n} boleto(s) × ${brl(unit)}`, atualizado_em: agora() }).eq('id', idTarifa);
          if (r.error) throw new Error('Tarifa: ' + r.error.message);
        } else idTarifa = await lancarTarifa(cad, n, unit, f.data, conta, b?.id ?? null);
      } else if (idTarifa) { await supabase.from('lancamentos').delete().eq('id', idTarifa); idTarifa = null; }
      await supabase.from('lotes_recebimento_itens').delete().eq('lote_id', lote.id);
      const ri = await supabase.from('lotes_recebimento_itens').insert(novos.map(x => ({ ...x, lote_id: lote.id })));
      if (ri.error) throw new Error(ri.error.message);
      const u = await supabase.from('lotes_recebimento').update({ data: f.data, conta_id: conta, quantidade: novos.length, tarifa_unitaria: f.tarifa.houve ? unit : 0, total: r2(novos.reduce((a, x) => a + x.valor, 0)), lanc_tarifa_id: idTarifa }).eq('id', lote.id);
      if (u.error) throw new Error(u.error.message);
      invalidarDicionario();
      aoSalvar(`Lote alterado: ${novos.length} item(ns), total ${brl(r2(novos.reduce((a, x) => a + x.valor, 0)))}${f.tarifa.houve ? `, tarifa ${brl(tarifaTotal)}` : ''}.`);
    } catch (e) { setErro('Alteração interrompida: ' + (e as Error).message); }
    setProc(false);
  }

  async function excluir() {
    if (!lote) return; setErro(''); setProc(true);
    try {
      if (lote.tipo === 'consolidado' && lote.lanc_consolidado_id) await supabase.from('lancamentos').delete().eq('id', lote.lanc_consolidado_id);
      if (lote.tipo === 'baixa') for (const l of linhas) if (l.lanc) await estornar(l.lanc);
      if (lote.lanc_tarifa_id) await supabase.from('lancamentos').delete().eq('id', lote.lanc_tarifa_id);
      await supabase.from('lotes_recebimento').delete().eq('id', lote.id);
      aoSalvar(lote.tipo === 'baixa' ? 'Lote excluído: os boletos voltaram a ficar em aberto e a tarifa foi removida.' : 'Lote excluído, com o recebimento consolidado e a tarifa.');
    } catch (e) { setErro('Exclusão interrompida: ' + (e as Error).message); }
    setProc(false);
  }

  if (!lote) return <div className="modal-bg open"><div className="modal"><div className="empty">{erro || 'Carregando o lote…'}</div><div className="actions"><button className="btn ghost" onClick={aoFechar}>Fechar</button></div></div></div>;
  const baixa = lote.tipo === 'baixa';
  return (
    <div className="modal-bg open">
      <div className="modal" style={{ width: 'min(1080px, 96vw)' }}><h2>{baixa ? 'Recebimento em lote de boletos' : 'Recebimentos digitados (consolidado)'}</h2>
        <div className="form form4">
          <label>Data do recebimento<DataBR value={f.data} onChange={e => setF({ ...f, data: e.target.value })} /></label>
          <label>Conta<select value={f.conta} onChange={e => setF({ ...f, conta: e.target.value })}>{cad.contas.filter(c => c.ativa || String(c.id) === f.conta).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
          <label className="span2">Total<input disabled value={`${brl(total)} em ${n} item(ns)`} /></label>
          <CamposTarifa t={f.tarifa} setT={t => setF({ ...f, tarifa: t })} data={f.data} cad={cad} n={n} />
        </div>
        <datalist id="editar-lote-clientes">{cad.beneficiarios.filter(b => b.ativo).map(b => <option key={b.id} value={rotuloB(b)} />)}</datalist>
        <div style={{ maxHeight: '38vh', overflow: 'auto', marginTop: 10 }}>
          <table className="compacta lote-contas">
            <thead><tr><th>#</th><th>Cliente</th>{baixa && <th>Vencimento</th>}<th className="r">Valor recebido</th><th /></tr></thead>
            <tbody>{linhas.map((l, i) => (
              <tr key={l.chave} style={{ opacity: Number(l.valor) > 0 ? 1 : 0.45 }}>
                <td style={{ color: 'var(--muted)' }}>{i + 1}</td>
                <td>{baixa ? <span className={l.lanc ? 'clicavel' : ''} title={l.lanc ? 'Abrir o lançamento' : ''} onClick={() => l.lanc && nav(`/lancamentos?abrir=${l.lanc.titulo_id || l.lanc.id}`)}>{l.lanc?.favorecido || l.novoTitulo?.favorecido}</span>
                  : <input list="editar-lote-clientes" value={l.cliente} onChange={e => set(l.chave, 'cliente', e.target.value)} style={{ width: '100%' }} />}</td>
                {baixa && <td>{dataBR((l.lanc || l.novoTitulo)?.vencimento || null)}</td>}
                <td className="r"><CampoValor value={l.valor} onChange={e => set(l.chave, 'valor', e.target.value)} style={{ width: 120, textAlign: 'right' }} /></td>
                <td><button className="btn ghost mini" title={baixa ? 'Tirar do lote (o boleto volta a ficar em aberto)' : 'Excluir item'} onClick={() => set(l.chave, 'valor', '')}>×</button></td>
              </tr>))}</tbody>
          </table>
        </div>
        {baixa ? (
          <div className="mt" style={{ fontSize: 13 }}>
            <b style={{ color: 'var(--navy)' }}>Incluir boleto em aberto</b>{' '}
            <input placeholder="Buscar cliente" value={busca} onChange={e => setBusca(e.target.value)} style={{ width: 240, marginLeft: 8 }} />
            {busca && <div style={{ maxHeight: 150, overflow: 'auto', marginTop: 6 }}><table className="compacta"><tbody>{candidatos.map(a => (
              <tr key={a.id} className="clicavel" onClick={() => { setLinhas([...linhas, { chave: 'n' + a.id, cliente: a.favorecido, valor: String(a.valor), novoTitulo: a }]); setBusca(''); }}>
                <td>{a.favorecido}</td><td>{dataBR(a.vencimento)}</td><td className="r">{brl(a.valor)}</td><td className="r"><span className="tag">incluir</span></td></tr>))}</tbody></table></div>}
          </div>
        ) : <button className="btn ghost mini mt" onClick={() => setLinhas([...linhas, { chave: 'n' + Date.now(), cliente: '', valor: '' }])}>+ Item</button>}
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 0' }}>
          {baixa ? 'Zerar o valor (ou ×) tira o boleto do lote e ele volta a ficar em aberto. Valor menor que o do boleto registra recebimento parcial.' : 'O total do lançamento consolidado é recalculado pela soma dos itens.'} A tarifa é recalculada pela quantidade de itens.
        </p>
        {erro && <div className="err mt">{erro}</div>}
        <div className="actions">
          {!confirmaExcluir ? <button className="btn ghost" style={{ marginRight: 'auto', color: 'var(--neg)' }} disabled={proc} onClick={() => setConfirmaExcluir(true)}>{baixa ? 'Desfazer baixa do lote' : 'Excluir lote'}</button>
            : <span style={{ marginRight: 'auto', display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>Confirma? {baixa ? 'Os boletos voltam a ficar em aberto.' : 'O recebimento consolidado será excluído.'}
              <button className="btn mini" style={{ background: 'var(--neg)', borderColor: 'var(--neg)' }} disabled={proc} onClick={excluir}>Sim, excluir</button><button className="btn ghost mini" onClick={() => setConfirmaExcluir(false)}>Não</button></span>}
          <button className="btn ghost" onClick={aoFechar}>Cancelar</button>
          <button className="btn" disabled={proc} onClick={salvar}>{proc ? 'Gravando…' : 'Salvar alterações'}</button>
        </div>
      </div>
    </div>
  );
}
