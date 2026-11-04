import { useEffect, useMemo, useRef, useState } from 'react';
import DataBR from '../components/DataBR';
import { Cabecalho } from '../components/Layout';
import { supabase, type Lancamento } from '../lib/supabase';
import { brl, dataBR, hojeISO, somaDias } from '../lib/format';
import { useCadastros, OpcoesCentro, nomeCentro, centroPadrao } from '../lib/useCadastros';
import { usePersistente, limparRascunhos } from '../lib/rascunho';
import { buscarExtratoBanco, decodificar, descricaoOFX, lerOFX, type ExtratoOFX, type TransacaoOFX } from '../lib/ofx';
import { carregarDicionario, divergente, invalidarDicionario, sugerir, type Sugestao } from '../lib/sugestao';
import { formatarDocumento } from '../lib/documento';

type Situacao = 'conciliado' | 'pago' | 'aberto' | 'novo';
interface Par { t: TransacaoOFX; sit: Situacao; l?: Lancamento }
interface Dec { marcado: boolean; grupo: string; sub: string; centro: string; benef: string; fav: string; ajustarData: boolean }
const ESPECIAIS = ['Transferências', 'Pagamento de fatura'];
const SIT = { conciliado: 'Já conciliado', pago: 'Encontrado (pago)', aberto: 'Em aberto no app', novo: 'Não está no app' } as Record<Situacao, string>;
const dias = (a: string, b: string) => Math.round((new Date(a + 'T12:00:00').getTime() - new Date(b + 'T12:00:00').getTime()) / 86400000);

async function buscarTodos(q: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }) {
  const out: Lancamento[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await q().range(i, i + 999);
    if (error) throw new Error(error.message);
    out.push(...((data as Lancamento[]) || []));
    if (!Array.isArray(data) || data.length < 1000) return out;
  }
}

/** Casamento do extrato com o app: identificador, depois valor e data próxima */
function casarExtrato(ext: ExtratoOFX, app: { pagos: Lancamento[]; abertos: Lancamento[] }): Par[] {
  const usados = new Set<number>();
  const fits = new Set(ext.transacoes.map(t => t.fitid));
  const porFit = new Map(app.pagos.filter(l => l.ofx_fitid).map(l => [l.ofx_fitid!, l]));
  const r: Par[] = ext.transacoes.map(t => {
    const l = porFit.get(t.fitid); if (l) { usados.add(l.id); return { t, sit: 'conciliado' as Situacao, l }; }
    return { t, sit: 'novo' as Situacao };
  });
  // Conciliado antes por um Pix do dia (provisório) pode ser casado de novo com a linha definitiva do extrato
  const livre = (l: Lancamento) => !l.ofx_fitid || (l.ofx_fitid.startsWith('efipix:') && !fits.has(l.ofx_fitid));
  const casar = (lista: Lancamento[], sit: Situacao, data: (l: Lancamento) => string, tol: number) => r.forEach(p => {
    if (p.sit !== 'novo') return;
    const c = lista.filter(l => !usados.has(l.id) && livre(l) && l.tipo === p.t.tipo && Math.abs(Number(l.valor) - p.t.valor) < 0.005 && Math.abs(dias(data(l), p.t.data)) <= tol)
      .sort((a, b) => Math.abs(dias(data(a), p.t.data)) - Math.abs(dias(data(b), p.t.data)))[0];
    if (c) { usados.add(c.id); p.sit = sit; p.l = c; }
  });
  casar(app.pagos, 'pago', l => l.data_pagamento || l.vencimento, 0);
  casar(app.pagos, 'pago', l => l.data_pagamento || l.vencimento, 5);
  casar(app.abertos, 'aberto', l => l.vencimento, 20);
  return r;
}

export default function Conciliacao() {
  const { contas, grupos, subgrupos, centros, beneficiarios } = useCadastros();
  const [conta, setConta] = usePersistente('conc:conta', '');
  const [arquivo, setArquivo] = usePersistente<{ nome: string; ext: ExtratoOFX; origem?: 'ofx' | 'api'; buscadoEm?: string; conta?: string } | null>('conc:extrato', null);
  const [periodo, setPeriodo] = usePersistente('conc:periodo', { inicio: somaDias(hojeISO(), -30), fim: hojeISO() });
  const [buscando, setBuscando] = useState(false);
  const autoRef = useRef(false);
  const [dec, setDec] = usePersistente<Record<string, Dec>>('conc:decisoes', {});
  const [app, setApp] = useState<{ pagos: Lancamento[]; abertos: Lancamento[] }>({ pagos: [], abertos: [] });
  const [dic, setDic] = useState<Awaited<ReturnType<typeof carregarDicionario>>>([]);
  const [saldoApp, setSaldoApp] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<Situacao | ''>('');
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [proc, setProc] = useState(false);
  const [versao, setVersao] = useState(0);
  const [todasSobras, setTodasSobras] = useState(false);
  const ext = arquivo && (!arquivo.conta || arquivo.conta === conta) ? arquivo.ext : undefined;

  useEffect(() => { carregarDicionario().then(setDic); }, [versao]);

  useEffect(() => {
    if (!ext || !conta) return;
    const c = Number(conta), ini = somaDias(ext.inicio, -7), fim = somaDias(ext.fim, 7);
    Promise.all([
      buscarTodos(() => supabase.from('lancamentos').select('*').eq('conta_id', c).eq('status', 'pago').gte('data_pagamento', ini).lte('data_pagamento', fim).order('id')),
      buscarTodos(() => supabase.from('lancamentos').select('*').neq('status', 'pago').or(`conta_id.eq.${c},conta_id.is.null`).gte('vencimento', somaDias(ext.inicio, -20)).lte('vencimento', somaDias(ext.fim, 20)).order('id')),
      ext.dataSaldo ? supabase.rpc('saldo_conta_em', { p_conta: c, p_data: ext.dataSaldo }) : Promise.resolve({ data: null }),
    ]).then(async ([pagos, abertos, s]) => {
      const dados = { pagos, abertos };
      if (autoRef.current) { autoRef.current = false; if (await conciliarExatos(casarExtrato(ext, dados))) return; }
      setApp(dados); setSaldoApp(s.data == null ? null : Number(s.data));
    }).catch(e => setErro((e as Error).message));
  }, [ext, conta, versao]);

  /** Itens com mesmo valor e mesma data de um lançamento já pago: conciliados sem pedir confirmação */
  async function conciliarExatos(lista: Par[]) {
    const exatos = lista.filter(p => p.sit === 'pago' && p.l!.data_pagamento === p.t.data);
    let n = 0;
    for (const p of exatos) {
      const r = await supabase.from('lancamentos').update({ ofx_fitid: p.t.fitid, atualizado_em: new Date().toISOString() }).eq('id', p.l!.id);
      if (!r.error) n++;
    }
    if (n) { setMsg(`${n} item(ns) com mesmo valor e data conciliado(s) automaticamente.`); setVersao(v => v + 1); return true; }
    return false;
  }

  const contaSel = contas.find(c => String(c.id) === conta);
  const integ = contaSel?.integracao || null;

  async function buscarBanco(ini = periodo.inicio, fim = periodo.fim) {
    if (!integ) return;
    setErro(''); setMsg(''); setBuscando(true);
    try {
      const { data } = await supabase.auth.getSession();
      const e = await buscarExtratoBanco(integ, ini, fim, data.session?.access_token || '');
      autoRef.current = true;
      setDec({}); setArquivo({ nome: `${integ === 'inter' ? 'API Inter' : 'API Efí'} · buscado em ${dataBR(hojeISO())}`, ext: e, origem: 'api', buscadoEm: hojeISO(), conta });
    } catch (err) { setErro((err as Error).message); }
    setBuscando(false);
  }

  // Ao abrir a tela com uma conta integrada, busca o extrato do dia automaticamente
  useEffect(() => {
    if (!integ || buscando) return;
    if (arquivo?.origem === 'api' && arquivo.conta === conta && arquivo.buscadoEm === hojeISO()) return;
    if (arquivo && arquivo.origem !== 'api' && arquivo.conta === conta) return;
    buscarBanco(somaDias(hojeISO(), -30), hojeISO());
  }, [conta, integ]);

  const pares = useMemo<Par[]>(() => (ext && conta ? casarExtrato(ext, app) : []), [ext, conta, app]);

  const sobras = useMemo(() => {
    if (!ext) return [];
    const usados = new Set(pares.filter(p => p.l).map(p => p.l!.id));
    return app.pagos.filter(l => !usados.has(l.id) && (l.data_pagamento || '') >= ext.inicio && (l.data_pagamento || '') <= ext.fim);
  }, [pares, app, ext]);

  const sugestoes = useMemo(() => {
    const m = new Map<string, Sugestao>();
    if (dic.length) pares.filter(p => p.sit === 'novo').forEach(p => m.set(p.t.fitid, sugerir(dic, { tipo: p.t.tipo, texto: descricaoOFX(p.t) })));
    return m;
  }, [pares, dic]);

  /** Decisão de cada linha: a gravada no rascunho ou a sugerida */
  const decisao = (p: Par): Dec => {
    const d = dec[p.t.fitid]; if (d) return d;
    if (p.sit !== 'novo') return { marcado: p.sit !== 'conciliado', grupo: '', sub: '', centro: '', benef: '', fav: '', ajustarData: true };
    const s = sugestoes.get(p.t.fitid), o = s?.opcoes.find(x => !ESPECIAIS.includes(grupos.find(g => g.id === x.grupo_id)?.nome || ''));
    const b = s?.beneficiario_id ? beneficiarios.find(x => x.id === s.beneficiario_id) : undefined;
    return { marcado: false, grupo: o ? String(o.grupo_id) : '', sub: o?.subgrupo_id ? String(o.subgrupo_id) : '', centro: o?.centro_custo_id ? String(o.centro_custo_id) : '', benef: b ? String(b.id) : '', fav: b?.nome || p.t.nome || p.t.memo, ajustarData: true };
  };
  const mudar = (p: Par, k: keyof Dec, v: string | boolean) => {
    const atual = decisao(p), n = { ...atual, [k]: v } as Dec;
    if (k === 'grupo') n.sub = '';
    if (k !== 'marcado' && p.sit === 'novo' && n.grupo) n.marcado = true;
    setDec({ ...dec, [p.t.fitid]: n });
  };
  const exigeBenef = (p: Par, d: Dec) => p.t.tipo === 'saida' && p.t.data >= '2027-01-01' && !ESPECIAIS.includes(grupos.find(g => g.id === Number(d.grupo))?.nome || '');
  const pronta = (p: Par, d: Dec) => p.sit !== 'novo' || (!!d.grupo && (!exigeBenef(p, d) || !!d.benef) && !!(d.fav || p.t.nome || p.t.memo));

  async function abrirArquivo(f: File) {
    setErro(''); setMsg('');
    try {
      const e = lerOFX(decodificar(await f.arrayBuffer()));
      if (!e.transacoes.length) throw new Error('Nenhuma transação encontrada no arquivo.');
      setDec({}); setArquivo({ nome: f.name, ext: e, origem: 'ofx', conta });
    } catch (err) { setErro((err as Error).message); }
  }

  async function aplicar() {
    setErro(''); setMsg(''); setProc(true);
    let nB = 0, nC = 0, nN = 0;
    const falhas: string[] = [];
    for (const p of pares) {
      const d = decisao(p);
      if (!d.marcado || p.sit === 'conciliado' || !pronta(p, d)) continue;
      let r;
      if (p.sit === 'pago') {
        const muda = d.ajustarData && p.l!.data_pagamento !== p.t.data;
        r = await supabase.from('lancamentos').update({ ofx_fitid: p.t.fitid, ...(muda ? { data_pagamento: p.t.data } : {}), atualizado_em: new Date().toISOString() }).eq('id', p.l!.id);
        if (!r.error) nC++;
      } else if (p.sit === 'aberto') {
        r = await supabase.from('lancamentos').update({ status: 'pago', data_pagamento: p.t.data, conta_id: Number(conta), ofx_fitid: p.t.fitid, atualizado_em: new Date().toISOString() }).eq('id', p.l!.id);
        if (!r.error) nB++;
      } else {
        const b = beneficiarios.find(x => x.id === Number(d.benef));
        r = await supabase.from('lancamentos').insert({
          tipo: p.t.tipo, conta_id: Number(conta), vencimento: p.t.data, data_pagamento: p.t.data, grupo_id: Number(d.grupo), subgrupo_id: d.sub ? Number(d.sub) : null,
          centro_custo_id: d.centro ? Number(d.centro) : null, beneficiario_id: b?.id ?? null, favorecido: b?.nome || d.fav || p.t.nome || p.t.memo,
          documento: p.t.documento || null, valor: p.t.valor, status: 'pago', forma_pagamento: /pix/i.test(descricaoOFX(p.t)) ? 'PIX' : null,
          observacao: 'extrato OFX: ' + descricaoOFX(p.t).slice(0, 180), ofx_fitid: p.t.fitid,
        });
        if (!r.error) nN++;
      }
      if (r.error) falhas.push(`${dataBR(p.t.data)} ${brl(p.t.valor)}: ${r.error.message}`);
    }
    setProc(false);
    const n = { ...dec }; pares.forEach(p => delete n[p.t.fitid]); setDec(n);
    if (nN) invalidarDicionario();
    setMsg(`${nC} conciliado(s), ${nB} baixado(s) e ${nN} lançamento(s) criado(s).`);
    if (falhas.length) setErro('Não foram gravados: ' + falhas.join(' · '));
    setVersao(v => v + 1);
  }

  const novaImportacao = () => { setArquivo(null); setDec({}); limparRascunhos('conc:decisoes'); setMsg(''); setErro(''); };
  const cont = (s: Situacao) => pares.filter(p => p.sit === s).length;
  const aAplicar = pares.filter(p => { const d = decisao(p); return d.marcado && p.sit !== 'conciliado' && pronta(p, d); }).length;
  const nomeG = (id: number | null | undefined) => grupos.find(g => g.id === id)?.nome || '';
  const nomeS = (id: number | null | undefined) => subgrupos.find(s => s.id === id)?.nome || '';
  const visiveis = pares.filter(p => !filtro || p.sit === filtro);
  const totE = ext?.transacoes.filter(t => t.tipo === 'entrada').reduce((a, t) => a + t.valor, 0) || 0, totS = ext?.transacoes.filter(t => t.tipo === 'saida').reduce((a, t) => a + t.valor, 0) || 0;

  return (
    <>
      <Cabecalho titulo="Conciliação bancária" sub="Extrato buscado no banco (Inter e Efí) ou importado em OFX, para conferir saldos e lançamentos">
        {arquivo && <button className="btn ghost" onClick={novaImportacao}>Nova importação</button>}
      </Cabecalho>
      <div className="card">
        <div className="filters" style={{ margin: 0 }}>
          <label style={{ fontSize: 13 }}>Conta <select value={conta} onChange={e => { setConta(e.target.value); setDec({}); }}><option value="">Selecione</option>{contas.filter(c => c.ativa && c.tipo !== 'especie').map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
          <label className="btn ghost" style={{ cursor: conta ? 'pointer' : 'default', opacity: conta ? 1 : 0.4 }}>
            {integ ? 'Usar arquivo OFX' : arquivo ? 'Trocar arquivo OFX' : 'Escolher arquivo OFX'}
            <input type="file" accept=".ofx,.OFX" disabled={!conta} style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) abrirArquivo(f); e.target.value = ''; }} />
          </label>
          {integ && <>
            <span style={{ fontSize: 13 }}>Período</span><DataBR value={periodo.inicio} onChange={e => setPeriodo({ ...periodo, inicio: e.target.value })} style={{ width: 132 }} />
            <span style={{ fontSize: 13 }}>a</span><DataBR value={periodo.fim} onChange={e => setPeriodo({ ...periodo, fim: e.target.value })} style={{ width: 132 }} />
            <button className="btn" disabled={buscando || !periodo.inicio || !periodo.fim} onClick={() => buscarBanco()}>{buscando ? 'Buscando no banco…' : `Buscar no ${integ === 'inter' ? 'Inter' : 'Efí'}`}</button>
          </>}
          {arquivo && ext && <span style={{ fontSize: 13, color: "var(--muted)" }}>{arquivo.nome} · {dataBR(ext!.inicio)} a {dataBR(ext!.fim)} · {ext!.transacoes.length} transações · entradas {brl(totE)} · saídas {brl(totS)}</span>}
        </div>
        {!conta && <p style={{ fontSize: 13, color: 'var(--muted)', margin: '12px 0 0' }}>Escolha a conta. Nas contas integradas (Inter e Efí), o extrato é buscado no banco ao abrir a tela; nas demais, envie o arquivo OFX baixado do internet banking.</p>}
        {ext?.avisos?.map((a, i) => <div key={i} className="proto mt">{a}</div>)}
        {erro && <div className="err mt">{erro}</div>}
        {msg && <div className="ok mt">{msg}</div>}
      </div>

      {ext && conta && (
        <>
          <div className="grid g4 mt">
            <div className="card kpi"><div className="lbl">Saldo no extrato{ext.dataSaldo ? ` em ${dataBR(ext.dataSaldo)}` : ''}</div><div className="val">{ext.saldo != null ? brl(ext.saldo) : '·'}</div></div>
            <div className="card kpi"><div className="lbl">Saldo no app na mesma data</div><div className="val">{saldoApp != null ? brl(saldoApp) : '·'}</div><div className="sub">Lançamentos pagos desta conta</div></div>
            <div className="card kpi"><div className="lbl">Diferença</div><div className={'val ' + (ext.saldo != null && saldoApp != null && Math.abs(ext.saldo - saldoApp) >= 0.01 ? 'neg' : 'pos')}>{ext.saldo != null && saldoApp != null ? brl(ext.saldo - saldoApp) : '·'}</div>
              <div className="sub">{ext.saldo != null && saldoApp != null && Math.abs(ext.saldo - saldoApp) < 0.01 ? 'Saldos conferem' : 'Confira os itens abaixo'}</div></div>
            <div className="card kpi"><div className="lbl">Transações</div><div className="val" style={{ fontSize: 15, lineHeight: 1.6 }}>{cont('conciliado') + cont('pago')} encontradas · {cont('aberto')} em aberto · {cont('novo')} novas</div><div className="sub">{sobras.length} lançamento(s) do app fora do extrato</div></div>
          </div>

          <div className="card mt" style={{ overflowX: 'auto' }}>
            <div className="filters">
              <div className="tabs" style={{ margin: 0, border: 0 }}>
                {([['', `Todas (${pares.length})`], ['novo', `Não estão no app (${cont('novo')})`], ['aberto', `Em aberto (${cont('aberto')})`], ['pago', `Encontradas (${cont('pago')})`], ['conciliado', `Já conciliadas (${cont('conciliado')})`]] as [Situacao | '', string][]).map(([k, t]) =>
                  <button key={k} className={filtro === k ? 'on' : ''} onClick={() => setFiltro(k)}>{t}</button>)}
              </div>
              <span style={{ flex: 1 }} />
              <button className="btn" disabled={!aAplicar || proc} onClick={aplicar}>{proc ? 'Gravando…' : `Aplicar selecionados (${aAplicar})`}</button>
            </div>
            <table className="compacta conc">
              <thead><tr><th className="c" /><th>Data</th><th>Extrato</th><th className="r">Valor</th><th>Situação</th><th style={{ minWidth: 420 }}>No app / classificação</th></tr></thead>
              <tbody>{visiveis.map(p => {
                const d = decisao(p), s = sugestoes.get(p.t.fitid), ok = pronta(p, d);
                const subsG = subgrupos.filter(x => x.grupo_id === Number(d.grupo));
                return (
                  <tr key={p.t.fitid} className={p.sit === 'conciliado' ? 'ok-row' : p.sit === 'novo' ? 'warn-row' : ''}>
                    <td className="c">{p.sit !== 'conciliado' && <input type="checkbox" checked={d.marcado} disabled={!ok} onChange={e => mudar(p, 'marcado', e.target.checked)} />}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{dataBR(p.t.data)}</td>
                    <td style={{ maxWidth: 300 }}>{p.t.provisorio && <span className="tag" title="Pix recebido hoje; o extrato definitivo do Efí chega no dia seguinte">Pix do dia</span>} {p.t.nome || p.t.memo}{p.t.memo && p.t.nome && p.t.memo !== p.t.nome && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.t.memo}</div>}</td>
                    <td className={'r ' + (p.t.tipo === 'entrada' ? 'pos' : '')} style={{ whiteSpace: 'nowrap' }}>{p.t.tipo === 'saida' ? '−' : ''}{brl(p.t.valor)}</td>
                    <td><span className={'st ' + (p.sit === 'conciliado' || p.sit === 'pago' ? 'pago' : p.sit === 'aberto' ? 'agen' : 'venc')}>{SIT[p.sit]}</span></td>
                    <td>
                      {p.l && <div>{p.l.favorecido} · {nomeG(p.l.grupo_id)}{p.l.subgrupo_id ? ' · ' + nomeS(p.l.subgrupo_id) : ''}
                        <span style={{ color: 'var(--muted)' }}> · {p.sit === 'aberto' ? `vence ${dataBR(p.l.vencimento)}; será baixado em ${dataBR(p.t.data)}` : `pago em ${dataBR(p.l.data_pagamento)}`}</span>
                        {p.sit === 'pago' && p.l.data_pagamento !== p.t.data && <label style={{ display: 'block', fontSize: 12, color: '#8A6A12' }}><input type="checkbox" checked={d.ajustarData} onChange={e => mudar(p, 'ajustarData', e.target.checked)} /> Ajustar a data de pagamento para {dataBR(p.t.data)}</label>}</div>}
                      {p.sit === 'novo' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                          <select value={d.grupo} onChange={e => mudar(p, 'grupo', e.target.value)}><option value="">Grupo…</option>{grupos.filter(g => !ESPECIAIS.includes(g.nome)).map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select>
                          <select value={d.sub} onChange={e => mudar(p, 'sub', e.target.value)}><option value="">Subgrupo</option>{subsG.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>
                          <select value={d.centro} onChange={e => mudar(p, 'centro', e.target.value)}><option value="">{'Centro: ' + (nomeCentro(centros, centroPadrao(grupos, subgrupos, Number(d.grupo), Number(d.sub))) || 'Geral')}</option><OpcoesCentro centros={centros} /></select>
                          <select value={d.benef} onChange={e => { const b = beneficiarios.find(x => x.id === Number(e.target.value)); setDec({ ...dec, [p.t.fitid]: { ...d, benef: e.target.value, fav: b?.nome || d.fav, marcado: !!d.grupo } }); }} style={{ gridColumn: 'span 2', borderColor: exigeBenef(p, d) && !d.benef ? 'var(--neg)' : undefined }}>
                            <option value="">{exigeBenef(p, d) ? 'Beneficiário (obrigatório)…' : 'Beneficiário (opcional)'}</option>{beneficiarios.filter(b => b.ativo).map(b => <option key={b.id} value={b.id}>{b.nome} · {formatarDocumento(b.documento)}</option>)}</select>
                          {!d.benef && <input placeholder="Favorecido / pagador" value={d.fav} onChange={e => mudar(p, 'fav', e.target.value)} />}
                          {s && s.opcoes.length > 0 && <div style={{ gridColumn: 'span 3', fontSize: 11.5, color: divergente(s) ? '#8A6A12' : 'var(--muted)' }}>
                            {divergente(s) ? 'Lançamentos parecidos com classificações diferentes: ' : 'Sugestão pelo histórico: '}
                            {s.opcoes.slice(0, 3).map((o, i) => <span key={i}>{i > 0 && ' · '}<a href="#" onClick={e => { e.preventDefault(); setDec(x => ({ ...x, [p.t.fitid]: { ...decisao(p), grupo: String(o.grupo_id), sub: o.subgrupo_id ? String(o.subgrupo_id) : '', centro: o.centro_custo_id ? String(o.centro_custo_id) : decisao(p).centro, marcado: true } })); }}>{nomeG(o.grupo_id)}{o.subgrupo_id ? ' · ' + nomeS(o.subgrupo_id) : ''}</a> ({o.n})</span>)}
                          </div>}
                        </div>
                      )}
                    </td>
                  </tr>);
              })}</tbody>
            </table>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>
              Encontradas: mesmo valor e data até 5 dias de diferença; ao aplicar, ficam marcadas como conciliadas. Em aberto: previsões do app com o mesmo valor; ao aplicar, são baixadas nesta conta na data do extrato.
              Não estão no app: escolha a classificação (a sugestão vem de lançamentos parecidos) e marque para criar como pagas. Transferências entre contas da RMS e pagamentos de fatura devem ser lançados pelas telas próprias.
            </p>
          </div>

          {sobras.length > 0 && (
            <div className="card mt">
              <h3>Lançamentos pagos no app nesta conta que não aparecem no extrato <small>{dataBR(ext.inicio)} a {dataBR(ext.fim)}</small></h3>
              <table className="compacta"><thead><tr><th>Pagamento</th><th>Favorecido / pagador</th><th>Grupo</th><th className="r">Valor</th></tr></thead>
                <tbody>{(todasSobras ? sobras : sobras.slice(0, 15)).map(l => <tr key={l.id}><td>{dataBR(l.data_pagamento)}</td><td>{l.favorecido}</td><td>{nomeG(l.grupo_id)}{l.subgrupo_id ? ' · ' + nomeS(l.subgrupo_id) : ''}</td>
                  <td className={'r ' + (l.tipo === 'entrada' ? 'pos' : '')}>{l.tipo === 'saida' ? '−' : ''}{brl(l.valor)}</td></tr>)}</tbody></table>
              {sobras.length > 15 && !todasSobras && <button className="btn ghost mini mt" onClick={() => setTodasSobras(true)}>Ver todos ({sobras.length})</button>}
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>Podem ser lançamentos na conta errada, com valor diferente ou duplicados. Corrija pela tela de Lançamentos.</p>
            </div>
          )}
        </>
      )}
    </>
  );
}
