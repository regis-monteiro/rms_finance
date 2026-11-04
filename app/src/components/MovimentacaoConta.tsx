import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CampoValor from './CampoValor';
import DataBR from './DataBR';
import { supabase, type Conta, type Lancamento } from '../lib/supabase';
import { brl, dataBR, hojeISO, somaDias } from '../lib/format';
import { usePersistente, limparRascunhos } from '../lib/rascunho';
import { useAuth } from '../lib/auth';
import { gerarPDF } from '../lib/relatorios';

const r2 = (v: number) => Math.round(v * 100) / 100;
const abrirLancamento = (nav: ReturnType<typeof useNavigate>, id: number) => nav(`/lancamentos?abrir=${id}`);

/** Movimentação de uma conta (ou de todas) com saldo dia a dia, para conferência */
export function ModalMovimentacao({ conta, contas, saldoAtual, aoFechar }: { conta: Conta | null; contas: Conta[]; saldoAtual: number; aoFechar: () => void }) {
  const nav = useNavigate();
  const [periodo, setPeriodo] = useState({ inicio: somaDias(hojeISO(), -30), fim: hojeISO() });
  const [lista, setLista] = useState<Lancamento[]>([]);
  const [saldoIni, setSaldoIni] = useState(0);
  const [aba, setAba] = useState<'mov' | 'caixa'>(conta?.tipo === 'especie' ? 'caixa' : 'mov');
  const [carregando, setCarregando] = useState(true);
  const ids = conta ? [conta.id] : contas.filter(c => c.ativa).map(c => c.id);

  useEffect(() => {
    setCarregando(true);
    (async () => {
      const out: Lancamento[] = [];
      for (let i = 0; ; i += 1000) {
        let q = supabase.from('lancamentos').select('*').eq('status', 'pago').in('conta_id', ids).gte('data_pagamento', periodo.inicio).lte('data_pagamento', periodo.fim);
        if (!conta) q = q.is('transferencia_id', null);
        const { data } = await q.order('data_pagamento').order('id').range(i, i + 999);
        out.push(...((data as Lancamento[]) || []));
        if (!data || data.length < 1000) break;
      }
      const antes = somaDias(periodo.inicio, -1);
      const saldos = await Promise.all(ids.map(id => supabase.rpc('saldo_conta_em', { p_conta: id, p_data: antes })));
      setSaldoIni(saldos.reduce((a, r) => a + Number(r.data || 0), 0));
      setLista(out); setCarregando(false);
    })();
  }, [conta?.id, periodo.inicio, periodo.fim]);

  // Agrupa por dia, do mais recente para o mais antigo, com o saldo no fim de cada dia
  const dias = useMemo(() => {
    let saldo = saldoIni;
    const porDia: { data: string; itens: Lancamento[]; ent: number; sai: number; saldo: number }[] = [];
    for (const l of lista) {
      const d = l.data_pagamento!;
      let g = porDia[porDia.length - 1];
      if (!g || g.data !== d) { g = { data: d, itens: [], ent: 0, sai: 0, saldo }; porDia.push(g); }
      g.itens.push(l);
      if (l.tipo === 'entrada') g.ent += Number(l.valor); else g.sai += Number(l.valor);
      saldo = r2(saldo + (l.tipo === 'entrada' ? Number(l.valor) : -Number(l.valor)));
      g.saldo = saldo;
    }
    return porDia.reverse();
  }, [lista, saldoIni]);
  const saldoFim = dias[0]?.saldo ?? saldoIni;
  const nomeConta = (id: number | null) => contas.find(c => c.id === id)?.nome || '';

  return (
    <div className="modal-bg open">
      <div className="modal" style={{ width: 'min(1040px, 96vw)' }}>
        <h2>{conta ? conta.nome : 'Todas as contas'} <small style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>saldo atual {brl(saldoAtual)}</small></h2>
        {conta?.tipo === 'especie' && (
          <div className="tabs" style={{ marginTop: -4 }}>
            <button className={aba === 'caixa' ? 'on' : ''} onClick={() => setAba('caixa')}>Conferência de caixa</button>
            <button className={aba === 'mov' ? 'on' : ''} onClick={() => setAba('mov')}>Movimentação</button>
          </div>
        )}
        {aba === 'caixa' && conta ? <ConferenciaCaixa conta={conta} saldoApp={saldoAtual} /> : (
          <>
            <div className="filters">
              <span style={{ fontSize: 13 }}>De</span><DataBR value={periodo.inicio} onChange={e => e.target.value && setPeriodo({ ...periodo, inicio: e.target.value })} style={{ width: 132 }} />
              <span style={{ fontSize: 13 }}>a</span><DataBR value={periodo.fim} onChange={e => e.target.value && setPeriodo({ ...periodo, fim: e.target.value })} style={{ width: 132 }} />
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 13 }}>Saldo em {dataBR(somaDias(periodo.inicio, -1))}: <b>{brl(saldoIni)}</b> · em {dataBR(periodo.fim)}: <b>{brl(saldoFim)}</b></span>
            </div>
            {!conta && <p style={{ fontSize: 12, color: 'var(--muted)', margin: '-4px 0 8px' }}>Visão de todas as contas ativas, sem as transferências entre contas da RMS.</p>}
            <div style={{ maxHeight: '58vh', overflow: 'auto' }}>
              {carregando ? <div className="empty">Carregando…</div> : dias.length === 0 ? <div className="empty">Nenhuma movimentação no período.</div> : (
                <table className="compacta">
                  <thead><tr><th>Data</th><th>Descrição</th>{!conta && <th>Conta</th>}<th className="r">Entrada</th><th className="r">Saída</th><th className="r">Saldo do dia</th></tr></thead>
                  <tbody>{dias.map(d => [
                    ...d.itens.map(l => (
                      <tr key={l.id} style={{ cursor: 'pointer' }} title="Abrir o lançamento" onClick={() => abrirLancamento(nav, l.id)}>
                        <td>{dataBR(d.data)}</td><td>{l.favorecido || l.observacao || '(sem nome)'}{l.referencia ? <span style={{ color: 'var(--muted)' }}> · {l.referencia}</span> : null}</td>{!conta && <td>{nomeConta(l.conta_id)}</td>}
                        <td className="r pos">{l.tipo === 'entrada' ? brl(l.valor) : ''}</td><td className="r neg">{l.tipo === 'saida' ? brl(l.valor) : ''}</td><td /></tr>)),
                    <tr key={'s' + d.data} style={{ background: '#FBF9F3', fontWeight: 700 }}><td>{dataBR(d.data)}</td><td>Saldo do dia</td>{!conta && <td />}
                      <td className="r pos">{brl(d.ent)}</td><td className="r neg">{brl(d.sai)}</td><td className={'r ' + (d.saldo < 0 ? 'neg' : '')}>{brl(d.saldo)}</td></tr>,
                  ])}</tbody>
                </table>
              )}
            </div>
          </>
        )}
        <div className="actions">
          {conta && conta.tipo !== 'aplicacao' && conta.tipo !== 'especie' && <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => { try { localStorage.setItem('rms-rascunho:conc:conta', JSON.stringify(String(conta.id))); } catch { /* ignora */ } nav('/conciliacao'); }}>Conciliar com o extrato</button>}
          {conta?.tipo === 'aplicacao' && <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => { try { localStorage.setItem('rms-rascunho:lanc:aba', '"rend"'); } catch { /* ignora */ } nav('/lancamentos'); }}>Ver posição das aplicações</button>}
          <button className="btn" onClick={aoFechar}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Conferência de caixa (fechamento) ---------------- */
const CEDULAS = [200, 100, 50, 20, 10, 5, 2];
const MOEDAS = [1, 0.5, 0.25, 0.1, 0.05, 0.01];
interface Contagem { cedulas: Record<string, string>; moedas: Record<string, string>; vales: { nome: string; valor: string }[] }
const vazia = (): Contagem => ({ cedulas: {}, moedas: {}, vales: Array.from({ length: 8 }, () => ({ nome: '', valor: '' })) });
interface Conferencia { id: number; data: string; contagem: Contagem; total_especie: number; saldo_app: number; diferenca: number; criado_em: string }

function ConferenciaCaixa({ conta, saldoApp }: { conta: Conta; saldoApp: number }) {
  const { usuario } = useAuth();
  const [c, setC] = usePersistente<Contagem>('caixa:contagem:' + conta.id, vazia);
  const [hist, setHist] = useState<Conferencia[]>([]);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [versao, setVersao] = useState(0);
  useEffect(() => { supabase.from('caixa_conferencias').select('*').eq('conta_id', conta.id).order('criado_em', { ascending: false }).limit(10).then(({ data }) => setHist((data as Conferencia[]) || [])); }, [versao]);

  const tCed = CEDULAS.map(v => r2(v * Number(c.cedulas[v] || 0))), tMoe = MOEDAS.map(v => r2(v * Number(c.moedas[v] || 0)));
  const tVal = c.vales.map(v => r2(Number(v.valor || 0)));
  const soma = (a: number[]) => r2(a.reduce((x, y) => x + y, 0));
  const total = r2(soma(tCed) + soma(tMoe) + soma(tVal)), dif = r2(total - saldoApp);
  const qtd = (k: 'cedulas' | 'moedas', v: number, q: string) => setC({ ...c, [k]: { ...c[k], [v]: q.replace(/\D/g, '') } });
  const vale = (i: number, campo: 'nome' | 'valor', v: string) => setC({ ...c, vales: c.vales.map((x, j) => (j === i ? { ...x, [campo]: v } : x)) });
  const fmtV = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  async function salvar() {
    const { error } = await supabase.from('caixa_conferencias').insert({ conta_id: conta.id, data: hojeISO(), contagem: c, total_especie: total, saldo_app: r2(saldoApp), diferenca: dif });
    setMsg(error ? { t: 'err', m: error.message } : { t: 'ok', m: 'Conferência registrada.' }); setTimeout(() => setMsg(null), 4000); setVersao(v => v + 1);
  }
  async function pdf() {
    const linhas = [
      ...CEDULAS.map((v, i) => ({ g: 'Cédulas', d: fmtV(v), q: Number(c.cedulas[v] || 0), t: tCed[i] })),
      ...MOEDAS.map((v, i) => ({ g: 'Moedas', d: fmtV(v), q: Number(c.moedas[v] || 0), t: tMoe[i] })),
      ...c.vales.filter(v => v.nome || Number(v.valor)).map((v, i) => ({ g: 'Vales', d: v.nome || '·', q: '', t: tVal[c.vales.indexOf(v)] ?? i })),
      { g: 'Em espécie', t: total, _estilo: 'sub' as const }, { g: 'Saldo no app', t: r2(saldoApp), _estilo: 'sub' as const }, { g: 'Diferença', t: dif, _estilo: 'total' as const },
    ];
    await gerarPDF({ titulo: 'Conferência de caixa', arquivo: `conferencia_caixa_${hojeISO()}`, periodo: dataBR(hojeISO()), usuario: usuario?.nome || usuario?.email || '', filtros: conta.nome,
      secoes: [{ colunas: [{ titulo: 'Tipo', chave: 'g' }, { titulo: 'Valor / vale', chave: 'd' }, { titulo: 'Qtde', chave: 'q', tipo: 'numero' }, { titulo: 'Total', chave: 't', tipo: 'moeda' }], linhas }] });
  }

  const bloco = (titulo: string, k: 'cedulas' | 'moedas', vals: number[], tot: number[]) => (
    <table className="compacta caixa"><thead><tr><th>{titulo}</th><th className="c">Qtde</th><th className="r">Total</th></tr></thead>
      <tbody>{vals.map((v, i) => (
        <tr key={v}><td>{fmtV(v)}</td><td className="c"><input inputMode="numeric" value={c[k][v] || ''} onChange={e => qtd(k, v, e.target.value)} style={{ width: 70, textAlign: 'center' }} /></td>
          <td className="r">{tot[i] ? fmtV(tot[i]) : '·'}</td></tr>))}
        <tr style={{ fontWeight: 700, background: '#FBF9F3' }}><td colSpan={2}>Subtotal</td><td className="r">{fmtV(soma(tot))}</td></tr></tbody></table>
  );
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 14, alignItems: 'start' }}>
        {bloco('Cédulas', 'cedulas', CEDULAS, tCed)}
        {bloco('Moedas', 'moedas', MOEDAS, tMoe)}
        <table className="compacta caixa"><thead><tr><th>Vales</th><th className="r">Valor</th></tr></thead>
          <tbody>{c.vales.map((v, i) => (
            <tr key={i}><td><input value={v.nome} placeholder="Nome" onChange={e => vale(i, 'nome', e.target.value)} style={{ width: '100%' }} /></td>
              <td className="r"><CampoValor value={v.valor} onChange={e => vale(i, 'valor', e.target.value)} style={{ width: 110, textAlign: 'right' }} /></td></tr>))}
            <tr><td colSpan={2}><button className="btn ghost mini" onClick={() => setC({ ...c, vales: [...c.vales, { nome: '', valor: '' }] })}>+ Vale</button></td></tr>
            <tr style={{ fontWeight: 700, background: '#FBF9F3' }}><td>Subtotal</td><td className="r">{fmtV(soma(tVal))}</td></tr></tbody></table>
      </div>
      <div className="grid g3 mt">
        <div className="card kpi"><div className="lbl">Em espécie (contado)</div><div className="val">{brl(total)}</div></div>
        <div className="card kpi"><div className="lbl">Saldo no fluxo (app)</div><div className="val">{brl(saldoApp)}</div></div>
        <div className="card kpi"><div className="lbl">Diferença</div><div className={'val ' + (Math.abs(dif) < 0.005 ? 'pos' : 'neg')}>{brl(dif)}</div><div className="sub">{Math.abs(dif) < 0.005 ? 'Caixa conferido' : dif < 0 ? 'Falta dinheiro em relação ao app' : 'Sobra dinheiro em relação ao app'}</div></div>
      </div>
      <div className="filters" style={{ margin: '10px 0 0' }}>
        <button className="btn ghost" onClick={() => { limparRascunhos('caixa:contagem:' + conta.id); setC(vazia()); }}>Limpar contagem</button>
        <button className="btn ghost" onClick={pdf}>PDF</button>
        <button className="btn gold" onClick={salvar}>Registrar conferência</button>
        {msg && <span className={msg.t}>{msg.m}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Só para conferência: a diferença não gera lançamento.</span>
      </div>
      {hist.length > 0 && (
        <div className="mt"><b style={{ fontSize: 13, color: 'var(--navy)' }}>Últimas conferências</b>
          <table className="compacta" style={{ marginTop: 4 }}><tbody>{hist.map(h => (
            <tr key={h.id} style={{ cursor: 'pointer' }} title="Carregar esta contagem" onClick={() => setC(h.contagem)}>
              <td>{dataBR(h.data)} {new Date(h.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td><td className="r">Contado {brl(h.total_especie)}</td><td className="r">App {brl(h.saldo_app)}</td>
              <td className={'r ' + (Math.abs(Number(h.diferenca)) < 0.005 ? 'pos' : 'neg')}>Diferença {brl(h.diferenca)}</td></tr>))}</tbody></table>
        </div>
      )}
    </>
  );
}
