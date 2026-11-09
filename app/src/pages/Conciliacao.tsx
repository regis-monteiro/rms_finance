import { useEffect, useMemo, useRef, useState } from 'react';
import { casaBusca } from '../lib/documento';
import DataBR from '../components/DataBR';
import { Cabecalho } from '../components/Layout';
import { supabase, type Lancamento } from '../lib/supabase';
import { brl, dataBR, hojeISO, somaDias, rotuloParte, ROTULO_PARTE } from '../lib/format';
import { useCadastros, OpcoesCentro, nomeCentro, centroPadrao } from '../lib/useCadastros';
import { usePersistente, limparRascunhos } from '../lib/rascunho';
import { buscarExtratoBanco, decodificar, descricaoOFX, lerOFX, type ExtratoOFX, type TransacaoOFX } from '../lib/ofx';
import { carregarDicionario, divergente, invalidarDicionario, palavras, sugerir, type Sugestao } from '../lib/sugestao';
import { formatarDocumento } from '../lib/documento';

type Situacao = 'conciliado' | 'associado' | 'pago' | 'aberto' | 'novo';
interface Assoc { grupo: string; fitids: string[]; lancs: Lancamento[] }
type DadosApp = { pagos: Lancamento[]; abertos: Lancamento[]; assoc: Assoc[] };
interface Par { t: TransacaoOFX; sit: Situacao; l?: Lancamento; a?: Assoc }
interface Dec { marcado: boolean; grupo: string; sub: string; centro: string; benef: string; fav: string; ajustarData: boolean }
const ESPECIAIS = ['Transferências', 'Pagamento de fatura'];
const SIT = { conciliado: 'Já conciliado', associado: 'Associado', pago: 'Encontrado (pago)', aberto: 'Em aberto no app', novo: 'Não está no app' } as Record<Situacao, string>;
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
function casarExtrato(ext: ExtratoOFX, app: DadosApp): Par[] {
  const usados = new Set<number>(app.assoc.flatMap(a => a.lancs.map(l => l.id)));
  const porGrupo = new Map(app.assoc.flatMap(a => a.fitids.map(f => [f, a] as [string, Assoc])));
  const fits = new Set(ext.transacoes.map(t => t.fitid));
  const porFit = new Map(app.pagos.filter(l => l.ofx_fitid).map(l => [l.ofx_fitid!, l]));
  const r: Par[] = ext.transacoes.map(t => {
    const a = porGrupo.get(t.fitid); if (a) return { t, sit: 'associado' as Situacao, a };
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
  const { contas, grupos, subgrupos, centros, beneficiarios , todosGrupos } = useCadastros();
  const [conta, setConta] = usePersistente('conc:conta', '');
  const [arquivo, setArquivo] = usePersistente<{ nome: string; ext: ExtratoOFX; origem?: 'ofx' | 'api'; buscadoEm?: string; conta?: string } | null>('conc:extrato', null);
  const [periodo, setPeriodo] = usePersistente('conc:periodo', { inicio: somaDias(hojeISO(), -30), fim: hojeISO() });
  const [buscando, setBuscando] = useState(false);
  const autoRef = useRef(false);
  const [dec, setDec] = usePersistente<Record<string, Dec>>('conc:decisoes', {});
  const [app, setApp] = useState<DadosApp>({ pagos: [], abertos: [], assoc: [] });
  const [assocAberta, setAssocAberta] = usePersistente<{ ext: string[]; app: number[]; busca: string } | null>('conc:associar', null);
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
      carregarAssociacoes(ext.transacoes.map(t => t.fitid)),
    ]).then(async ([pagos, abertos, s, assoc]) => {
      const dados = { pagos, abertos, assoc };
      if (autoRef.current) { autoRef.current = false; if (await conciliarExatos(casarExtrato(ext, dados))) return; }
      setApp(dados); setSaldoApp(s.data == null ? null : Number(s.data));
    }).catch(e => setErro((e as Error).message));
  }, [ext, conta, versao]);

  /** Grupos de associação que envolvem linhas deste extrato */
  async function carregarAssociacoes(fitids: string[]): Promise<Assoc[]> {
    const ids = new Set<string>();
    for (let i = 0; i < fitids.length; i += 80) {
      const { data, error } = await supabase.from('conciliacao_itens').select('grupo_id').in('fitid', fitids.slice(i, i + 80));
      if (error) { if (/conciliacao_itens/.test(error.message)) return []; throw new Error(error.message); }
      (data || []).forEach((x: { grupo_id: string }) => ids.add(x.grupo_id));
    }
    if (!ids.size) return [];
    const { data: itens, error } = await supabase.from('conciliacao_itens').select('*').in('grupo_id', [...ids]);
    if (error) throw new Error(error.message);
    const lids = (itens || []).filter((x: { lancamento_id: number | null }) => x.lancamento_id).map((x: { lancamento_id: number }) => x.lancamento_id);
    const { data: lancs } = lids.length ? await supabase.from('lancamentos').select('*').in('id', lids) : { data: [] };
    return [...ids].map(g => ({ grupo: g, fitids: (itens || []).filter((x: { grupo_id: string; fitid: string | null }) => x.grupo_id === g && x.fitid).map((x: { fitid: string }) => x.fitid),
      lancs: ((lancs as Lancamento[]) || []).filter(l => (itens || []).some((x: { grupo_id: string; lancamento_id: number | null }) => x.grupo_id === g && x.lancamento_id === l.id)) }));
  }

  /** Associa linhas do extrato a lançamentos do app quando as somas são iguais; previsões são baixadas na data do extrato */
  async function associar(linhas: TransacaoOFX[], lancs: Lancamento[]) {
    setErro(''); setMsg(''); setProc(true);
    try {
      const data = linhas.map(t => t.data).sort().pop()!;
      for (const l of lancs.filter(x => x.status !== 'pago')) {
        const r = await supabase.from('lancamentos').update({ status: 'pago', data_pagamento: data, conta_id: Number(conta), atualizado_em: new Date().toISOString() }).eq('id', l.id);
        if (r.error) throw new Error(`${l.favorecido}: ${r.error.message}`);
      }
      const g = await supabase.from('conciliacao_grupos').insert({ conta_id: Number(conta) }).select('id').single();
      if (g.error) throw new Error(g.error.message);
      const itens = [...linhas.map(t => ({ grupo_id: g.data.id, fitid: t.fitid, data: t.data, valor: t.tipo === 'saida' ? -t.valor : t.valor, descricao: descricaoOFX(t).slice(0, 200) })),
        ...lancs.map(l => ({ grupo_id: g.data.id, lancamento_id: l.id }))];
      const r = await supabase.from('conciliacao_itens').insert(itens);
      if (r.error) { await supabase.from('conciliacao_grupos').delete().eq('id', g.data.id); throw new Error(r.error.message); }
      setMsg(`Associadas ${linhas.length} linha(s) do extrato a ${lancs.length} lançamento(s) do app.`);
      // a tela continua aberta para a próxima associação, com a seleção limpa
      setAssocAberta(a => a && { ...a, ext: [], app: [] }); setVersao(v => v + 1);
    } catch (e) { setErro((e as Error).message); }
    setProc(false);
  }
  async function desassociar(a: Assoc) {
    const { error } = await supabase.from('conciliacao_grupos').delete().eq('id', a.grupo);
    if (error) { setErro(error.message); return; }
    setMsg('Associação desfeita. Os lançamentos baixados pela associação continuam pagos.'); setVersao(v => v + 1);
  }

  /** O nome no extrato confere com o fornecedor / cliente do lançamento (ao menos uma palavra significativa em comum) */
  function nomeConfere(t: TransacaoOFX, l: Lancamento) {
    const b = beneficiarios.find(x => x.id === l.beneficiario_id);
    const app = new Set(palavras([l.favorecido, b?.nome, b?.nome_fantasia].filter(Boolean).join(' ')));
    return palavras(descricaoOFX(t)).some(w => app.has(w));
  }

  const rejeitado = (p: Par) => !!p.l && (((p.l.ofx_anterior as { rejeitados?: string[] } | null)?.rejeitados) || []).includes(p.t.fitid);

  /** Desfaz a conciliação: tira o vínculo e devolve o lançamento ao estado anterior (ou exclui o que foi criado do extrato) */
  async function desfazerConciliacao(l: Lancamento) {
    setErro(''); setMsg('');
    const ant = (l.ofx_anterior || {}) as { modo?: string; status?: string; data_pagamento?: string | null; conta_id?: number | null };
    let r;
    // A linha do extrato desfeita fica registrada, para não ser associada de novo automaticamente
    const rejeitados = [...new Set([...(((l.ofx_anterior as { rejeitados?: string[] } | null)?.rejeitados) || []), l.ofx_fitid].filter(Boolean))];
    if (ant.modo === 'criado') r = await supabase.from('lancamentos').delete().eq('id', l.id);
    else r = await supabase.from('lancamentos').update({
      ofx_fitid: null, ofx_anterior: { rejeitados }, atualizado_em: new Date().toISOString(),
      ...(ant.modo === 'manual' && ant.data_pagamento ? { data_pagamento: ant.data_pagamento } : {}),
      ...(ant.modo === 'baixa' ? { status: ant.status || 'confirmado', data_pagamento: ant.data_pagamento ?? null, conta_id: ant.conta_id ?? null } : {}),
    }).eq('id', l.id);
    if (r.error) { setErro(r.error.message); return; }
    setMsg(ant.modo === 'criado' ? 'Conciliação desfeita: o lançamento criado a partir do extrato foi excluído.' : ant.modo === 'baixa' ? 'Conciliação desfeita: a previsão voltou a ficar em aberto.' : 'Conciliação desfeita.');
    setVersao(v => v + 1);
  }
  const textoDesfazer = (l: Lancamento) => { const m = (l.ofx_anterior as { modo?: string } | null)?.modo; return m === 'criado' ? 'Desfazer (exclui o lançamento criado)' : m === 'baixa' ? 'Desfazer (volta a previsão)' : 'Desfazer conciliação'; };
  const rotuloModo = (l: Lancamento) => ({ auto: 'automática', manual: 'manual', baixa: 'com baixa da previsão', criado: 'lançamento criado do extrato' } as Record<string, string>)[(l.ofx_anterior as { modo?: string } | null)?.modo || ''] || '';

  /** Itens com mesmo valor, mesma data e mesmo nome de um lançamento já pago: conciliados sem pedir confirmação */
  async function conciliarExatos(lista: Par[]) {
    const exatos = lista.filter(p => p.sit === 'pago' && p.l!.data_pagamento === p.t.data && nomeConfere(p.t, p.l!) && !rejeitado(p));
    let n = 0;
    for (const p of exatos) {
      const r = await supabase.from('lancamentos').update({ ofx_fitid: p.t.fitid, ofx_anterior: { modo: 'auto' }, atualizado_em: new Date().toISOString() }).eq('id', p.l!.id);
      if (!r.error) n++;
    }
    if (n) { setMsg(`${n} item(ns) com mesmo valor, data e nome conciliado(s) automaticamente. Os demais aguardam sua confirmação.`); setVersao(v => v + 1); return true; }
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
      setDec({}); setArquivo({ nome: `API Inter · buscado em ${dataBR(hojeISO())}`, ext: e, origem: 'api', buscadoEm: hojeISO(), conta });
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
    const usados = new Set([...pares.filter(p => p.l).map(p => p.l!.id), ...app.assoc.flatMap(a => a.lancs.map(l => l.id))]);
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
    if (p.sit !== 'novo') return { marcado: (p.sit === 'pago' || p.sit === 'aberto') && !!p.l && nomeConfere(p.t, p.l) && !rejeitado(p), grupo: '', sub: '', centro: '', benef: '', fav: '', ajustarData: true };
    const s = sugestoes.get(p.t.fitid), o = s?.opcoes.find(x => !ESPECIAIS.includes(todosGrupos.find(g => g.id === x.grupo_id)?.nome || ''));
    const b = s?.beneficiario_id ? beneficiarios.find(x => x.id === s.beneficiario_id) : undefined;
    return { marcado: false, grupo: o ? String(o.grupo_id) : '', sub: o?.subgrupo_id ? String(o.subgrupo_id) : '', centro: o?.centro_custo_id ? String(o.centro_custo_id) : '', benef: b ? String(b.id) : '', fav: b?.nome || p.t.nome || p.t.memo, ajustarData: true };
  };
  const mudar = (p: Par, k: keyof Dec, v: string | boolean) => {
    const atual = decisao(p), n = { ...atual, [k]: v } as Dec;
    if (k === 'grupo') n.sub = '';
    if (k !== 'marcado' && p.sit === 'novo' && n.grupo) n.marcado = true;
    setDec({ ...dec, [p.t.fitid]: n });
  };
  const exigeBenef = (p: Par, d: Dec) => p.t.tipo === 'saida' && p.t.data >= '2027-01-01' && !ESPECIAIS.includes(todosGrupos.find(g => g.id === Number(d.grupo))?.nome || '');
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
      if (!d.marcado || p.sit === 'conciliado' || p.sit === 'associado' || !pronta(p, d)) continue;
      let r;
      if (p.sit === 'pago') {
        const muda = d.ajustarData && p.l!.data_pagamento !== p.t.data;
        r = await supabase.from('lancamentos').update({ ofx_fitid: p.t.fitid, ofx_anterior: { modo: 'manual', data_pagamento: p.l!.data_pagamento }, ...(muda ? { data_pagamento: p.t.data } : {}), atualizado_em: new Date().toISOString() }).eq('id', p.l!.id);
        if (!r.error) nC++;
      } else if (p.sit === 'aberto') {
        r = await supabase.from('lancamentos').update({ status: 'pago', data_pagamento: p.t.data, conta_id: Number(conta), ofx_fitid: p.t.fitid, ofx_anterior: { modo: 'baixa', status: p.l!.status, data_pagamento: p.l!.data_pagamento, conta_id: p.l!.conta_id }, atualizado_em: new Date().toISOString() }).eq('id', p.l!.id);
        if (!r.error) nB++;
      } else {
        const b = beneficiarios.find(x => x.id === Number(d.benef));
        r = await supabase.from('lancamentos').insert({
          tipo: p.t.tipo, conta_id: Number(conta), vencimento: p.t.data, data_pagamento: p.t.data, grupo_id: Number(d.grupo), subgrupo_id: d.sub ? Number(d.sub) : null,
          centro_custo_id: d.centro ? Number(d.centro) : null, beneficiario_id: b?.id ?? null, favorecido: b?.nome || d.fav || p.t.nome || p.t.memo,
          documento: p.t.documento || null, valor: p.t.valor, status: 'pago', forma_pagamento: /pix/i.test(descricaoOFX(p.t)) ? 'PIX' : null,
          observacao: 'extrato OFX: ' + descricaoOFX(p.t).slice(0, 180), ofx_fitid: p.t.fitid, ofx_anterior: { modo: 'criado' },
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
  const aAplicar = pares.filter(p => { const d = decisao(p); return d.marcado && p.sit !== 'conciliado' && p.sit !== 'associado' && pronta(p, d); }).length;
  const nomeG = (id: number | null | undefined) => todosGrupos.find(g => g.id === id)?.nome || '';
  const nomeS = (id: number | null | undefined) => subgrupos.find(s => s.id === id)?.nome || '';
  const visiveis = pares.filter(p => !filtro || p.sit === filtro);
  const totE = ext?.transacoes.filter(t => t.tipo === 'entrada').reduce((a, t) => a + t.valor, 0) || 0, totS = ext?.transacoes.filter(t => t.tipo === 'saida').reduce((a, t) => a + t.valor, 0) || 0;

  return (
    <>
      <Cabecalho titulo="Conciliação bancária" sub="Extrato buscado no banco (Inter) ou importado em OFX, para conferir saldos e lançamentos">
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
            <button className="btn" disabled={buscando || !periodo.inicio || !periodo.fim} onClick={() => buscarBanco()}>{buscando ? 'Buscando no banco…' : 'Buscar no Inter'}</button>
          </>}
          {arquivo && ext && <span style={{ fontSize: 13, color: "var(--muted)" }}>{arquivo.nome} · {dataBR(ext!.inicio)} a {dataBR(ext!.fim)} · {ext!.transacoes.length} transações · entradas {brl(totE)} · saídas {brl(totS)}</span>}
        </div>
        {!conta && <p style={{ fontSize: 13, color: 'var(--muted)', margin: '12px 0 0' }}>Escolha a conta. Na conta integrada (Inter), o extrato é buscado no banco ao abrir a tela; nas demais, envie o arquivo OFX baixado do internet banking.</p>}
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
            <div className="card kpi"><div className="lbl">Transações</div><div className="val" style={{ fontSize: 15, lineHeight: 1.6 }}>{cont('conciliado') + cont('pago') + cont('associado')} encontradas · {cont('aberto')} em aberto · {cont('novo')} novas</div><div className="sub">{sobras.length} lançamento(s) do app fora do extrato</div></div>
          </div>

          <div className="card mt" style={{ overflowX: 'auto' }}>
            <div className="filters">
              <div className="tabs" style={{ margin: 0, border: 0 }}>
                {([['', `Todas (${pares.length})`], ['novo', `Não estão no app (${cont('novo')})`], ['aberto', `Em aberto (${cont('aberto')})`], ['pago', `Encontradas (${cont('pago')})`], ['conciliado', `Já conciliadas (${cont('conciliado')})`], ['associado', `Associadas (${cont('associado')})`]] as [Situacao | '', string][]).map(([k, t]) =>
                  <button key={k} className={filtro === k ? 'on' : ''} onClick={() => setFiltro(k)}>{t}</button>)}
              </div>
              <span style={{ flex: 1 }} />
              <button className="btn ghost" onClick={() => { setMsg(''); setAssocAberta({ ext: [], app: [], busca: '' }); }} title="Junte várias linhas do extrato a um lançamento do app, ou o contrário">Associar lançamentos</button>
              <button className="btn" disabled={!aAplicar || proc} onClick={aplicar}>{proc ? 'Gravando…' : `Aplicar selecionados (${aAplicar})`}</button>
            </div>
            <table className="compacta conc">
              <thead><tr><th className="c" /><th>Data</th><th>Extrato</th><th className="r">Valor</th><th>Situação</th><th style={{ minWidth: 420 }}>No app / classificação</th></tr></thead>
              <tbody>{visiveis.map(p => {
                const d = decisao(p), s = sugestoes.get(p.t.fitid), ok = pronta(p, d);
                const subsG = subgrupos.filter(x => x.grupo_id === Number(d.grupo));
                return (
                  <tr key={p.t.fitid} className={p.sit === 'conciliado' || p.sit === 'associado' ? 'ok-row' : p.sit === 'novo' ? 'warn-row' : ''}>
                    <td className="c">{p.sit !== 'conciliado' && p.sit !== 'associado' && <input type="checkbox" checked={d.marcado} disabled={!ok} onChange={e => mudar(p, 'marcado', e.target.checked)} />}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{dataBR(p.t.data)}</td>
                    <td style={{ maxWidth: 300 }}>{p.t.nome || p.t.memo}{p.t.memo && p.t.nome && p.t.memo !== p.t.nome && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.t.memo}</div>}</td>
                    <td className={'r ' + (p.t.tipo === 'entrada' ? 'pos' : '')} style={{ whiteSpace: 'nowrap' }}>{p.t.tipo === 'saida' ? '−' : ''}{brl(p.t.valor)}</td>
                    <td><span className={'st ' + (p.sit === 'conciliado' || p.sit === 'pago' || p.sit === 'associado' ? 'pago' : p.sit === 'aberto' ? 'agen' : 'venc')}>{SIT[p.sit]}</span></td>
                    <td>
                      {p.a && <div>{p.a.fitids.length > 1 && <span style={{ color: 'var(--muted)' }}>Grupo de {p.a.fitids.length} linhas do extrato · </span>}
                        {p.a.lancs.map(l => <div key={l.id}>{l.favorecido} · {nomeG(l.grupo_id)}{l.subgrupo_id ? ' · ' + nomeS(l.subgrupo_id) : ''} · <span className={l.tipo === 'entrada' ? 'pos' : ''}>{l.tipo === 'saida' ? '−' : ''}{brl(l.valor)}</span></div>)}
                        <button className="btn ghost mini" style={{ marginTop: 3 }} onClick={() => desassociar(p.a!)}>Desfazer associação</button></div>}
                      {(p.sit === 'pago' || p.sit === 'aberto') && rejeitado(p) && <div style={{ fontSize: 12, color: '#8A6A12', fontWeight: 600 }}>Esta associação foi desfeita antes: confirme só se estiver correta</div>}
                      {p.l && (p.sit === 'pago' || p.sit === 'aberto') && !nomeConfere(p.t, p.l) && <div style={{ fontSize: 12, color: '#8A6A12', fontWeight: 600 }}>Nome diferente do extrato: confira antes de marcar</div>}
                      {p.l && <div>{p.l.favorecido} · {nomeG(p.l.grupo_id)}{p.l.subgrupo_id ? ' · ' + nomeS(p.l.subgrupo_id) : ''}
                        <span style={{ color: 'var(--muted)' }}> · {p.sit === 'aberto' ? `vence ${dataBR(p.l.vencimento)}; será baixado em ${dataBR(p.t.data)}` : `pago em ${dataBR(p.l.data_pagamento)}`}</span>
                        {p.sit === 'conciliado' && <div style={{ marginTop: 3 }}>{rotuloModo(p.l) && <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 6 }}>Conciliação {rotuloModo(p.l)}</span>}
                          <button className="btn ghost mini" onClick={() => desfazerConciliacao(p.l!)}>{textoDesfazer(p.l)}</button></div>}
                        {p.sit === 'pago' && p.l.data_pagamento !== p.t.data && <label style={{ display: 'block', fontSize: 12, color: '#8A6A12' }}><input type="checkbox" checked={d.ajustarData} onChange={e => mudar(p, 'ajustarData', e.target.checked)} /> Ajustar a data de pagamento para {dataBR(p.t.data)}</label>}</div>}
                      {p.sit === 'novo' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                          <select value={d.grupo} onChange={e => mudar(p, 'grupo', e.target.value)}><option value="">Grupo…</option>{grupos.filter(g => !ESPECIAIS.includes(g.nome)).map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select>
                          <select value={d.sub} onChange={e => mudar(p, 'sub', e.target.value)}><option value="">Subgrupo</option>{subsG.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>
                          <select value={d.centro} onChange={e => mudar(p, 'centro', e.target.value)}><option value="">{'Centro: ' + (nomeCentro(centros, centroPadrao(grupos, subgrupos, Number(d.grupo), Number(d.sub))) || 'Geral')}</option><OpcoesCentro centros={centros} /></select>
                          <select value={d.benef} onChange={e => { const b = beneficiarios.find(x => x.id === Number(e.target.value)); setDec({ ...dec, [p.t.fitid]: { ...d, benef: e.target.value, fav: b?.nome || d.fav, marcado: !!d.grupo } }); }} style={{ gridColumn: 'span 2', borderColor: exigeBenef(p, d) && !d.benef ? 'var(--neg)' : undefined }}>
                            <option value="">{rotuloParte(p.t.tipo) + (exigeBenef(p, d) ? ' (obrigatório)…' : ' (opcional)')}</option>{beneficiarios.filter(b => b.ativo).map(b => <option key={b.id} value={b.id}>{b.nome} · {formatarDocumento(b.documento)}</option>)}</select>
                          {!d.benef && <input placeholder={rotuloParte(p.t.tipo)} value={d.fav} onChange={e => mudar(p, 'fav', e.target.value)} />}
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
              <table className="compacta"><thead><tr><th>Pagamento</th><th>{ROTULO_PARTE}</th><th>Grupo</th><th className="r">Valor</th></tr></thead>
                <tbody>{(todasSobras ? sobras : sobras.slice(0, 15)).map(l => <tr key={l.id}><td>{dataBR(l.data_pagamento)}</td><td>{l.favorecido}</td><td>{nomeG(l.grupo_id)}{l.subgrupo_id ? ' · ' + nomeS(l.subgrupo_id) : ''}</td>
                  <td className={'r ' + (l.tipo === 'entrada' ? 'pos' : '')}>{l.tipo === 'saida' ? '−' : ''}{brl(l.valor)}</td></tr>)}</tbody></table>
              {sobras.length > 15 && !todasSobras && <button className="btn ghost mini mt" onClick={() => setTodasSobras(true)}>Ver todos ({sobras.length})</button>}
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>Podem ser lançamentos na conta errada, com valor diferente ou duplicados. Corrija pela tela de Lançamentos.</p>
            </div>
          )}
        </>
      )}
      {assocAberta && ext && (() => {
        const livresExt = pares.filter(p => p.sit !== 'conciliado' && p.sit !== 'associado');
        const assocIds = new Set(app.assoc.flatMap(a => a.lancs.map(l => l.id)));
        const conc = new Set(pares.filter(p => p.sit === 'conciliado').map(p => p.l!.id));
        const q = assocAberta.busca.trim().toLowerCase();
        const candidatos = [...app.pagos.filter(l => !l.ofx_fitid || l.ofx_fitid.startsWith('efipix:')), ...app.abertos]
          .filter(l => !assocIds.has(l.id) && !conc.has(l.id) && (!q || casaBusca(assocAberta.busca, [l.favorecido, nomeG(l.grupo_id), brl(l.valor)], beneficiarios.find(b => b.id === l.beneficiario_id)?.documento)))
          .sort((a, b) => (a.data_pagamento || a.vencimento).localeCompare(b.data_pagamento || b.vencimento));
        const selE = livresExt.filter(p => assocAberta.ext.includes(p.t.fitid)).map(p => p.t);
        const selA = [...app.pagos, ...app.abertos].filter(l => assocAberta.app.includes(l.id));
        const totE = selE.reduce((a, t) => a + (t.tipo === 'entrada' ? t.valor : -t.valor), 0);
        const totA = selA.reduce((a, l) => a + (l.tipo === 'entrada' ? Number(l.valor) : -Number(l.valor)), 0);
        const dif = Math.round((totE - totA) * 100) / 100, ok = selE.length > 0 && selA.length > 0 && Math.abs(dif) < 0.005;
        const alt = (k: 'ext' | 'app', v: string | number) => setAssocAberta({ ...assocAberta, [k]: (assocAberta[k] as (string | number)[]).includes(v) ? (assocAberta[k] as (string | number)[]).filter(x => x !== v) : [...assocAberta[k], v] } as typeof assocAberta);
        return (
          <div className="modal-bg open">
            <div className="modal" style={{ width: 'min(1180px, 96vw)' }}><h2>Associar lançamentos</h2>
              <p className="proto" style={{ marginTop: -6 }}>Marque uma ou mais linhas do extrato e um ou mais lançamentos do app. A associação só é permitida quando os totais forem iguais. Previsões em aberto são baixadas nesta conta na data do extrato{selE.length > 1 ? ' (a mais recente das linhas marcadas)' : ''}.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
                  <h3 style={{ margin: '0 0 6px' }}>Extrato do banco</h3>
                  <table className="compacta conc"><tbody>{livresExt.map(p => (
                    <tr key={p.t.fitid} className={assocAberta.ext.includes(p.t.fitid) ? 'ok-row' : ''} style={{ cursor: 'pointer' }} onClick={() => alt('ext', p.t.fitid)}>
                      <td className="c"><input type="checkbox" readOnly checked={assocAberta.ext.includes(p.t.fitid)} /></td><td style={{ whiteSpace: 'nowrap' }}>{dataBR(p.t.data)}</td>
                      <td>{p.t.nome || p.t.memo}{p.t.memo && p.t.nome && p.t.memo !== p.t.nome && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.t.memo}</div>}</td>
                      <td className={'r ' + (p.t.tipo === 'entrada' ? 'pos' : '')} style={{ whiteSpace: 'nowrap' }}>{p.t.tipo === 'saida' ? '−' : ''}{brl(p.t.valor)}</td></tr>))}</tbody></table>
                </div>
                <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}><h3 style={{ margin: 0 }}>Lançamentos do app</h3><span style={{ flex: 1 }} />
                    <input placeholder="Buscar fornecedor, cliente, grupo ou valor" value={assocAberta.busca} onChange={e => setAssocAberta({ ...assocAberta, busca: e.target.value })} style={{ width: 260 }} /></div>
                  <table className="compacta conc"><tbody>{candidatos.map(l => (
                    <tr key={l.id} className={assocAberta.app.includes(l.id) ? 'ok-row' : ''} style={{ cursor: 'pointer' }} onClick={() => alt('app', l.id)}>
                      <td className="c"><input type="checkbox" readOnly checked={assocAberta.app.includes(l.id)} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{dataBR(l.data_pagamento || l.vencimento)}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.status === 'pago' ? 'pago' : 'em aberto'}</div></td>
                      <td>{l.favorecido}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{nomeG(l.grupo_id)}{l.subgrupo_id ? ' · ' + nomeS(l.subgrupo_id) : ''}</div></td>
                      <td className={'r ' + (l.tipo === 'entrada' ? 'pos' : '')} style={{ whiteSpace: 'nowrap' }}>{l.tipo === 'saida' ? '−' : ''}{brl(l.valor)}</td></tr>))}</tbody></table>
                  {!candidatos.length && <div className="empty" style={{ padding: 20 }}>Nenhum lançamento disponível.</div>}
                </div>
              </div>
              <div className="filters" style={{ justifyContent: 'flex-end', gap: 18, margin: '12px 0 0' }}>
                <span>Extrato ({selE.length}): <b>{brl(totE)}</b></span><span>App ({selA.length}): <b>{brl(totA)}</b></span>
                <span>Diferença: <b className={Math.abs(dif) < 0.005 ? 'pos' : 'neg'}>{brl(dif)}</b></span>
              </div>
              {erro && <div className="err">{erro}</div>}
              {msg && !erro && <div className="ok">{msg} Selecione as próximas linhas ou feche.</div>}
              <div className="actions"><button type="button" className="btn ghost" onClick={() => { setAssocAberta(null); }}>Fechar</button>
                <button className="btn" disabled={!ok || proc} title={ok ? '' : 'Os totais precisam ser iguais'} onClick={() => associar(selE, selA)}>{proc ? 'Gravando…' : 'Associar'}</button></div>
            </div>
          </div>);
      })()}
    </>
  );
}
