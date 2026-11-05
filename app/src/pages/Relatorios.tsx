import { useEffect, useRef, useState } from 'react';
import { supabase, type Lancamento } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useCadastros } from '../lib/useCadastros';
import { brl, dataBR, hojeISO, STATUS_LABEL, statusEfetivo } from '../lib/format';
import { gerarExcel, gerarPDF, type Relatorio, type Linha, type Coluna } from '../lib/relatorios';
import { MESES_LONGOS } from '../lib/analises';
import DataBR from '../components/DataBR';
import { Cabecalho } from '../components/Layout';

type Tipo = 'pagar' | 'receber' | 'lancamentos' | 'cartoes';
const TIPOS: [Tipo, string, string][] = [
  ['pagar', 'Contas a pagar', 'Saídas em aberto no período, uma a uma, com vencidas e total por conta.'],
  ['receber', 'Contas a receber', 'Previsto x recebido por grupo de receita e mês, mais as entradas lançadas em aberto.'],
  ['lancamentos', 'Lançamentos', 'Todas as entradas e saídas do período, com totais e saldo.'],
  ['cartoes', 'Cartões', 'Faturas do período (total, pago e saldo) e compras de cada cartão.'],
];

/** Busca sem o limite de 1.000 linhas por consulta */
async function todos<T>(montar: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []; const passo = 1000;
  for (let i = 0; ; i += passo) {
    const { data, error } = await montar(i, i + passo - 1);
    if (error) throw new Error(error.message);
    const d = (data as T[]) || []; out.push(...d);
    if (d.length < passo) return out;
  }
}

export default function Relatorios() {
  const { usuario } = useAuth();
  const { contas, grupos, subgrupos, cartoes, beneficiarios } = useCadastros();
  const hoje = hojeISO();
  const [tipo, setTipo] = useState<Tipo>('pagar');
  const [de, setDe] = useState(hoje.slice(0, 8) + '01');
  const [ate, setAte] = useState(() => { const [a, m] = hoje.split('-').map(Number); return `${hoje.slice(0, 8)}${new Date(a, m, 0).getDate()}`; });
  const [selContas, setSelContas] = useState<Set<string>>(new Set());
  const [selCartoes, setSelCartoes] = useState<Set<number>>(new Set());
  const [opt, setOpt] = useState({ vencidas: true, tipoL: '', statusL: '', base: 'caixa', cliente: '' });
  const [gerando, setGerando] = useState<'' | 'pdf' | 'xlsx'>('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [previa, setPrevia] = useState<{ r: Relatorio | null; carregando: boolean; erro: string }>({ r: null, carregando: true, erro: '' });
  const [todasLinhas, setTodasLinhas] = useState<Set<number>>(new Set());
  const rodada = useRef(0);

  const nome = (arr: { id: number; nome: string }[], id: number | null) => arr.find(x => x.id === id)?.nome || '';
  const periodo = `${dataBR(de)} a ${dataBR(ate)}`;
  const contasFiltro = () => (selContas.size ? 'Contas: ' + [...selContas].map(c => (c === 'sem' ? 'A definir' : nome(contas, Number(c)))).join(', ') : 'Todas as contas');
  const passaConta = (l: Lancamento) => !selContas.size || (l.conta_id ? selContas.has(String(l.conta_id)) : selContas.has('sem'));
  const linhaLanc = (l: Lancamento): Linha => ({ venc: l.vencimento, pag: l.data_pagamento, tipo: l.tipo === 'entrada' ? 'Entrada' : 'Saída', conta: nome(contas, l.conta_id) || 'A definir',
    grupo: nome(grupos, l.grupo_id), sub: nome(subgrupos, l.subgrupo_id), fav: l.favorecido, ref: l.referencia || '', status: STATUS_LABEL[statusEfetivo(l.status, l.vencimento)],
    valor: l.tipo === 'saida' ? -Number(l.valor) : Number(l.valor) });

  async function montar(): Promise<Relatorio> {
    const base = { usuario: usuario?.nome || usuario?.email || '', periodo };
    if (tipo === 'pagar') {
      const ls = (await todos<Lancamento>((i, f) => {
        let q = supabase.from('lancamentos').select('*').eq('tipo', 'saida').neq('status', 'pago').lte('vencimento', ate).order('vencimento').order('id').range(i, f);
        if (!opt.vencidas) q = q.gte('vencimento', de);
        return q;
      })).filter(passaConta);
      const vencidas = ls.filter(l => l.vencimento < hoje), soma = (a: Lancamento[]) => a.reduce((s, l) => s + Number(l.valor), 0);
      const porConta = new Map<string, number>(); ls.forEach(l => { const k = nome(contas, l.conta_id) || 'A definir'; porConta.set(k, (porConta.get(k) || 0) + Number(l.valor)); });
      return { ...base, titulo: 'Contas a pagar', arquivo: 'contas_a_pagar', paisagem: true,
        filtros: contasFiltro() + (opt.vencidas ? ' · inclui vencidas anteriores ao período' : ''),
        resumo: [{ rotulo: 'Total em aberto', valor: brl(soma(ls)) }, { rotulo: 'Vencidas', valor: brl(soma(vencidas)) }, { rotulo: 'Itens', valor: String(ls.length) }],
        secoes: [
          { titulo: 'Contas em aberto', colunas: [{ titulo: 'Vencimento', chave: 'venc', tipo: 'data' }, { titulo: 'Fornecedor / Beneficiário', chave: 'fav' }, { titulo: 'Grupo', chave: 'grupo' }, { titulo: 'Subgrupo', chave: 'sub' }, { titulo: 'Conta', chave: 'conta' }, { titulo: 'Ref.', chave: 'ref' }, { titulo: 'Status', chave: 'status' }, { titulo: 'Valor', chave: 'v', tipo: 'moeda' }],
            linhas: [...ls.map(l => ({ ...linhaLanc(l), v: Number(l.valor) })), { venc: '', fav: 'Total', v: soma(ls), _estilo: 'total' as const }] },
          { titulo: 'Total por conta', colunas: [{ titulo: 'Conta', chave: 'c' }, { titulo: 'Valor', chave: 'v', tipo: 'moeda' }], linhas: [...[...porConta].map(([c, v]) => ({ c, v })), { c: 'Total', v: soma(ls), _estilo: 'total' as const }] },
        ] };
    }
    if (tipo === 'lancamentos') {
      const campo = opt.base === 'pagamento' ? 'data_pagamento' : 'vencimento';
      const ls = (await todos<Lancamento>((i, f) => {
        let q = (opt.base === 'caixa' ? supabase.from('lancamentos').select('*').or(`and(status.eq.pago,data_pagamento.gte.${de},data_pagamento.lte.${ate}),and(status.neq.pago,vencimento.gte.${de},vencimento.lte.${ate})`) : supabase.from('lancamentos').select('*').gte(campo, de).lte(campo, ate)).order(campo).order('id').range(i, f);
        if (opt.tipoL) q = q.eq('tipo', opt.tipoL);
        if (opt.statusL === 'pago') q = q.eq('status', 'pago'); else if (opt.statusL === 'aberto') q = q.neq('status', 'pago');
        return q;
      })).filter(passaConta);
      const efetiva = (l: Lancamento) => (l.status === 'pago' && l.data_pagamento ? l.data_pagamento : l.vencimento);
      if (opt.base !== 'vencimento') ls.sort((a, b) => efetiva(a).localeCompare(efetiva(b)) || a.id - b.id);
      const ent = ls.filter(l => l.tipo === 'entrada').reduce((a, l) => a + Number(l.valor), 0), sai = ls.filter(l => l.tipo === 'saida').reduce((a, l) => a + Number(l.valor), 0);
      return { ...base, titulo: 'Lançamentos', arquivo: 'lancamentos', paisagem: true,
        filtros: [contasFiltro(), opt.base === 'pagamento' ? 'por data de pagamento' : opt.base === 'caixa' ? 'por pagamento (pagos) e vencimento (em aberto)' : 'por vencimento', opt.tipoL ? (opt.tipoL === 'entrada' ? 'só entradas' : 'só saídas') : '', opt.statusL === 'pago' ? 'só pagos' : opt.statusL === 'aberto' ? 'só em aberto' : ''].filter(Boolean).join(' · '),
        resumo: [{ rotulo: 'Saldo do período', valor: brl(ent - sai) }, { rotulo: 'Entradas', valor: brl(ent) }, { rotulo: 'Saídas', valor: brl(sai) }, { rotulo: 'Lançamentos', valor: ls.length.toLocaleString('pt-BR') }],
        secoes: [{ colunas: [{ titulo: 'Pagamento', chave: 'pag', tipo: 'data' }, { titulo: 'Vencimento', chave: 'venc', tipo: 'data' }, { titulo: 'Tipo', chave: 'tipo' }, { titulo: 'Conta', chave: 'conta' }, { titulo: 'Grupo', chave: 'grupo' }, { titulo: 'Subgrupo', chave: 'sub' }, { titulo: 'Fornecedor / Cliente', chave: 'fav' }, { titulo: 'Ref.', chave: 'ref' }, { titulo: 'Status', chave: 'status' }, { titulo: 'Valor', chave: 'valor', tipo: 'moeda' }],
          linhas: [...ls.map(linhaLanc), { fav: 'Entradas', valor: ent, _estilo: 'sub' as const }, { fav: 'Saídas', valor: -sai, _estilo: 'sub' as const }, { fav: 'Saldo do período', valor: ent - sai, _estilo: 'total' as const }] }] };
    }
    if (tipo === 'receber') {
      const a0 = Number(de.slice(0, 4)), a1 = Number(ate.slice(0, 4)), m0 = Number(de.slice(5, 7)), m1 = Number(ate.slice(5, 7));
      const meses: [number, number][] = []; for (let a = a0; a <= a1; a++) for (let m = a === a0 ? m0 : 1; m <= (a === a1 ? m1 : 12); m++) meses.push([a, m]);
      const gr = grupos.filter(g => g.natureza === 'receita');
      const secoes: Relatorio['secoes'] = []; let tp = 0, tr = 0;
      const linhasAno: Linha[] = [];
      for (const ano of [...new Set(meses.map(x => x[0]))]) {
        const [{ data: rec }, { data: prev }] = await Promise.all([supabase.rpc('receitas_mensais', { p_ano: ano }), supabase.from('previsoes_receita').select('grupo_id,mes,valor').eq('ano', ano)]);
        meses.filter(x => x[0] === ano).forEach(([, m]) => {
          const ls = gr.map(g => {
            const p = ((prev as { grupo_id: number; mes: number; valor: number }[]) || []).filter(x => x.grupo_id === g.id && x.mes === m).reduce((s, x) => s + Number(x.valor), 0);
            const rr = ((rec as { grupo_id: number; mes: number; recebido: number; a_receber: number }[]) || []).filter(x => x.grupo_id === g.id && x.mes === m);
            const r = rr.reduce((s, x) => s + Number(x.recebido), 0), ab = rr.reduce((s, x) => s + Number(x.a_receber), 0);
            return { g: g.nome, p, r, ab, d: r - p, pc: p ? r / p : null };
          }).filter(x => x.p || x.r || x.ab);
          const sp = ls.reduce((s, x) => s + x.p, 0), sr = ls.reduce((s, x) => s + x.r, 0), sa = ls.reduce((s, x) => s + x.ab, 0);
          tp += sp; tr += sr;
          linhasAno.push({ g: `${MESES_LONGOS[m - 1]}/${ano}`, p: sp, r: sr, ab: sa, d: sr - sp, pc: sp ? sr / sp : null, _estilo: 'sub' }, ...ls.map(x => ({ ...x, _estilo: 'grupo' as const })));
        });
      }
      secoes.push({ titulo: 'Previsto x recebido por grupo de receita', colunas: [{ titulo: 'Mês / grupo', chave: 'g' }, { titulo: 'Previsto', chave: 'p', tipo: 'moeda' }, { titulo: 'Recebido', chave: 'r', tipo: 'moeda' }, { titulo: 'Lançado a receber', chave: 'ab', tipo: 'moeda' }, { titulo: 'Diferença', chave: 'd', tipo: 'moeda' }, { titulo: 'Realizado', chave: 'pc', tipo: 'pct' }],
        linhas: [...linhasAno, { g: 'Total do período', p: tp, r: tr, d: tr - tp, pc: tp ? tr / tp : null, _estilo: 'total' }] });
      const abertas = (await todos<Lancamento>((i, f) => supabase.from('lancamentos').select('*').eq('tipo', 'entrada').neq('status', 'pago').gte('vencimento', de).lte('vencimento', ate).order('vencimento').range(i, f))).filter(passaConta);
      if (abertas.length) secoes.push({ titulo: 'Entradas lançadas em aberto', colunas: [{ titulo: 'Vencimento', chave: 'venc', tipo: 'data' }, { titulo: 'Cliente / Origem', chave: 'fav' }, { titulo: 'Grupo', chave: 'grupo' }, { titulo: 'Conta', chave: 'conta' }, { titulo: 'Status', chave: 'status' }, { titulo: 'Valor', chave: 'valor', tipo: 'moeda' }],
        linhas: [...abertas.map(linhaLanc), { fav: 'Total', valor: abertas.reduce((s, l) => s + Number(l.valor), 0), _estilo: 'total' }] });
      return { ...base, titulo: 'Contas a receber', arquivo: 'contas_a_receber', filtros: contasFiltro() + ' (contas valem para as entradas em aberto)',
        resumo: [{ rotulo: 'Previsto', valor: brl(tp) }, { rotulo: 'Recebido', valor: brl(tr) }, { rotulo: 'Realizado', valor: tp ? (tr / tp * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '·' }], secoes };
    }
    // cartões
    const ids = selCartoes.size ? [...selCartoes] : cartoes.map(c => c.id);
    const fat = await todos<{ id: number; cartao_id: number; cartao: string; competencia: string; data_fechamento: string; data_vencimento: string; total: number; pago: number }>((i, f) =>
      supabase.from('faturas_resumo').select('*').in('cartao_id', ids).gte('data_vencimento', de).lte('data_vencimento', ate).order('data_vencimento').range(i, f));
    const comp = (fat.length ? await todos<{ fatura_id: number; data_compra: string; descricao: string; grupo_id: number; subgrupo_id: number | null; cliente_id: number | null; parcela: string | null; valor: number }>((i, f) =>
      supabase.from('compras_cartao').select('fatura_id,data_compra,descricao,grupo_id,subgrupo_id,cliente_id,parcela,valor').in('fatura_id', fat.map(x => x.id)).order('data_compra').range(i, f)) : [])
      .filter(c => !opt.cliente || (opt.cliente === 'com' ? c.cliente_id != null : String(c.cliente_id) === opt.cliente));
    const porCliente = new Map<string, number>(); comp.forEach(c => { if (c.cliente_id) { const k = nome(beneficiarios, c.cliente_id); porCliente.set(k, (porCliente.get(k) || 0) + Number(c.valor)); } });
    const tt = fat.reduce((s, x) => s + Number(x.total), 0), tpg = fat.reduce((s, x) => s + Number(x.pago), 0);
    const porGrupo = new Map<string, number>(); comp.forEach(c => { const g = nome(grupos, c.grupo_id); porGrupo.set(g, (porGrupo.get(g) || 0) + Number(c.valor)); });
    return { ...base, titulo: 'Cartões de crédito', arquivo: 'cartoes', paisagem: true,
      filtros: (selCartoes.size ? 'Cartões: ' + ids.map(id => nome(cartoes, id)).join(', ') : 'Todos os cartões') + (opt.cliente === 'com' ? ' · só compras com cliente relacionado (filtro vale para as compras)' : opt.cliente ? ' · cliente: ' + nome(beneficiarios, Number(opt.cliente)) + ' (filtro vale para as compras)' : ''),
      resumo: [{ rotulo: 'Total das faturas', valor: brl(tt) }, { rotulo: 'Pago', valor: brl(tpg) }, { rotulo: 'Saldo em aberto', valor: brl(tt - tpg) }, { rotulo: 'Compras', valor: String(comp.length) }],
      secoes: [
        { titulo: 'Faturas', colunas: [{ titulo: 'Cartão', chave: 'c' }, { titulo: 'Fechamento', chave: 'fe', tipo: 'data' }, { titulo: 'Vencimento', chave: 've', tipo: 'data' }, { titulo: 'Total', chave: 't', tipo: 'moeda' }, { titulo: 'Pago', chave: 'p', tipo: 'moeda' }, { titulo: 'Saldo', chave: 's', tipo: 'moeda' }],
          linhas: [...fat.map(x => ({ c: x.cartao, fe: x.data_fechamento, ve: x.data_vencimento, t: Number(x.total), p: Number(x.pago), s: Number(x.total) - Number(x.pago) })), { c: 'Total', t: tt, p: tpg, s: tt - tpg, _estilo: 'total' as const }] },
        { titulo: 'Gastos por grupo', colunas: [{ titulo: 'Grupo', chave: 'g' }, { titulo: 'Valor', chave: 'v', tipo: 'moeda' }], linhas: [...[...porGrupo].sort((a, b) => b[1] - a[1]).map(([g, v]) => ({ g, v })), { g: 'Total', v: comp.reduce((s, c) => s + Number(c.valor), 0), _estilo: 'total' as const }] },
        ...(porCliente.size ? [{ titulo: 'Compras por cliente relacionado', colunas: [{ titulo: 'Cliente', chave: 'g' }, { titulo: 'Valor', chave: 'v', tipo: 'moeda' as const }], linhas: [...[...porCliente].sort((a, b) => b[1] - a[1]).map(([g, v]) => ({ g, v })), { g: 'Total', v: [...porCliente.values()].reduce((a, v) => a + v, 0), _estilo: 'total' as const }] }] : []),
        { titulo: 'Compras', colunas: [{ titulo: 'Data', chave: 'd', tipo: 'data' }, { titulo: 'Cartão', chave: 'c' }, { titulo: 'Fatura', chave: 'f', tipo: 'data' }, { titulo: 'Estabelecimento', chave: 'e' }, { titulo: 'Grupo', chave: 'g' }, { titulo: 'Subgrupo', chave: 's' }, { titulo: 'Cliente relacionado', chave: 'cl' }, { titulo: 'Parcela', chave: 'pa' }, { titulo: 'Valor', chave: 'v', tipo: 'moeda' }],
          linhas: comp.map(c => { const fx = fat.find(x => x.id === c.fatura_id)!; return { d: c.data_compra, c: fx.cartao, f: fx.data_vencimento, e: c.descricao, g: nome(grupos, c.grupo_id), s: nome(subgrupos, c.subgrupo_id), cl: nome(beneficiarios, c.cliente_id), pa: c.parcela || '', v: Number(c.valor) }; }) },
      ] };
  }

  async function gerar(f: 'pdf' | 'xlsx') {
    if (de > ate) { setMsg({ t: 'err', m: 'A data inicial é maior que a final.' }); return; }
    setGerando(f); setMsg(null);
    try { const r = await montar(); f === 'pdf' ? await gerarPDF(r) : await gerarExcel(r); setMsg({ t: 'ok', m: 'Relatório gerado' }); }
    catch (e) { setMsg({ t: 'err', m: (e as Error).message }); }
    setGerando('');
  }

  // Visualização simplificada: atualiza sozinha quando muda o relatório ou algum filtro
  useEffect(() => {
    if (!contas.length || !grupos.length) return;
    const n = ++rodada.current;
    setPrevia(p => ({ ...p, carregando: true, erro: '' }));
    const t = setTimeout(async () => {
      if (de > ate) { setPrevia({ r: null, carregando: false, erro: 'A data inicial é maior que a final.' }); return; }
      try { const r = await montar(); if (n === rodada.current) { setPrevia({ r, carregando: false, erro: '' }); setTodasLinhas(new Set()); } }
      catch (e) { if (n === rodada.current) setPrevia({ r: null, carregando: false, erro: (e as Error).message }); }
    }, 450);
    return () => clearTimeout(t);
  }, [tipo, de, ate, selContas, selCartoes, opt, contas, grupos, subgrupos, cartoes, beneficiarios]);

  const marcar = <T,>(s: Set<T>, v: T, on: boolean, set: (n: Set<T>) => void) => { const n = new Set(s); on ? n.add(v) : n.delete(v); set(n); };
  return (
    <>
      <Cabecalho titulo="Relatórios" sub="Exportação em PDF e Excel, no padrão visual da RMS">{msg && <span className={msg.t}>{msg.m}</span>}</Cabecalho>
      <div className="grid g4">
        {TIPOS.map(([k, t, d]) => (
          <div key={k} className={'card'} onClick={() => setTipo(k)} style={{ cursor: 'pointer', borderColor: tipo === k ? 'var(--gold)' : undefined, boxShadow: tipo === k ? 'inset 0 0 0 1px var(--gold)' : undefined }}>
            <h3 style={{ marginBottom: 6 }}>{t}</h3><div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{d}</div>
          </div>))}
      </div>
      <div className="card mt">
        <h3>Filtros · {TIPOS.find(x => x[0] === tipo)![1]}</h3>
        <div className="form" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <label>De<DataBR required value={de} onChange={e => setDe(e.target.value)} /></label>
          <label>Até<DataBR required value={ate} onChange={e => setAte(e.target.value)} /></label>
          {tipo === 'pagar' && <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, gridColumn: 'span 2' }}><input type="checkbox" checked={opt.vencidas} onChange={e => setOpt({ ...opt, vencidas: e.target.checked })} /> Incluir vencidas antes do período</label>}
          {tipo === 'lancamentos' && <>
            <label>Período por<select value={opt.base} onChange={e => setOpt({ ...opt, base: e.target.value })}><option value="caixa">Pagamento (pagos) ou vencimento (em aberto)</option><option value="vencimento">Vencimento</option><option value="pagamento">Só data de pagamento</option></select></label>
            <label>Tipo e status<select value={opt.tipoL + '|' + opt.statusL} onChange={e => { const [t, s] = e.target.value.split('|'); setOpt({ ...opt, tipoL: t, statusL: s }); }}>
              <option value="|">Todos</option><option value="entrada|">Só entradas</option><option value="saida|">Só saídas</option><option value="|pago">Só pagos</option><option value="|aberto">Só em aberto</option></select></label></>}
          {tipo === 'cartoes' && <label className="span2">Cliente relacionado<select value={opt.cliente} onChange={e => setOpt({ ...opt, cliente: e.target.value })}>
            <option value="">Todas as compras</option><option value="com">Só compras com cliente relacionado</option>{beneficiarios.filter(b => b.ativo).map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}</select></label>}
        </div>
        {tipo !== 'cartoes' ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginBottom: 6 }}>Contas (nenhuma marcada = todas)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[...contas.filter(c => c.ativa).map(c => [String(c.id), c.nome]), ['sem', 'A definir']].map(([id, n]) => (
                <label key={id} className="chip" style={{ cursor: 'pointer', background: selContas.has(id) ? 'var(--gold-soft)' : undefined }}>
                  <input type="checkbox" checked={selContas.has(id)} onChange={e => marcar(selContas, id, e.target.checked, setSelContas)} /> {n}</label>))}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginBottom: 6 }}>Cartões (nenhum marcado = todos). O período vale para o vencimento das faturas.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {cartoes.map(c => (
                <label key={c.id} className="chip" style={{ cursor: 'pointer', background: selCartoes.has(c.id) ? 'var(--gold-soft)' : undefined }}>
                  <input type="checkbox" checked={selCartoes.has(c.id)} onChange={e => marcar(selCartoes, c.id, e.target.checked, setSelCartoes)} /> {c.nome}{!c.ativo && ' (inativo)'}</label>))}
            </div>
          </div>
        )}
        <div className="actions">
          <button className="btn ghost" disabled={!!gerando} onClick={() => gerar('xlsx')}>{gerando === 'xlsx' ? 'Gerando…' : 'Exportar Excel'}</button>
          <button className="btn" disabled={!!gerando} onClick={() => gerar('pdf')}>{gerando === 'pdf' ? 'Gerando…' : 'Exportar PDF'}</button>
        </div>
      </div>
      <Previa estado={previa} todas={todasLinhas} mostrarTodas={i => setTodasLinhas(new Set([...todasLinhas, i]))} />
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>Todo relatório sai com o logotipo da RMS, o nome do relatório, o período, a data e hora da emissão e o usuário que solicitou. O DRE e o Dashboard têm exportação própria, com opção de assinatura.</p>
    </>
  );
}

const LIMITE = 100;
function celula(c: Coluna, v: unknown) {
  if (v == null || v === '') return '';
  if (c.tipo === 'moeda') return brl(Number(v));
  if (c.tipo === 'data') return dataBR(String(v));
  if (c.tipo === 'pct') return (Number(v) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  if (c.tipo === 'numero') return Number(v).toLocaleString('pt-BR');
  return String(v);
}

/** Prévia em tela do relatório, sem cabeçalho de emissão */
function Previa({ estado, todas, mostrarTodas }: { estado: { r: Relatorio | null; carregando: boolean; erro: string }; todas: Set<number>; mostrarTodas: (i: number) => void }) {
  const { r, carregando, erro } = estado;
  return (
    <div className="card mt" style={{ opacity: carregando && r ? 0.55 : 1, transition: 'opacity .2s' }}>
      <h3>Visualização{r ? ` · ${r.titulo}` : ''}{carregando && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>atualizando…</span>}</h3>
      {erro ? <div className="err">{erro}</div> : !r ? <div className="empty">Carregando…</div> : <>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>{r.periodo}{r.filtros ? ` · ${r.filtros}` : ''}</div>
        {r.resumo && <div className="grid g4" style={{ marginBottom: 12 }}>{r.resumo.map(x => (
          <div key={x.rotulo} className="card kpi" style={{ padding: '10px 14px' }}><div className="lbl">{x.rotulo}</div><div className="val" style={{ fontSize: 18 }}>{x.valor}</div></div>))}</div>}
        {r.secoes.map((s, i) => {
          const corpo = s.linhas.filter(l => !l._estilo || l._estilo === 'grupo'), rodape = s.linhas.filter(l => l._estilo && l._estilo !== 'grupo');
          const cheio = todas.has(i) || corpo.length <= LIMITE;
          const visiveis = cheio ? s.linhas : [...s.linhas.filter(l => !l._estilo || l._estilo === 'grupo').slice(0, LIMITE), ...rodape];
          return (
            <div key={i} style={{ marginTop: i ? 16 : 0 }}>
              {s.titulo && <div style={{ fontWeight: 600, color: 'var(--navy)', margin: '4px 0 6px' }}>{s.titulo}</div>}
              {corpo.length === 0 && rodape.length <= 1 ? <div className="empty">Nada a mostrar neste filtro.</div> : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="compacta">
                    <thead><tr>{s.colunas.map(c => <th key={c.chave} className={c.tipo === 'moeda' || c.tipo === 'pct' || c.tipo === 'numero' ? 'r' : ''}>{c.titulo}</th>)}</tr></thead>
                    <tbody>{visiveis.map((l, j) => (
                      <tr key={j} style={l._estilo === 'total' ? { fontWeight: 700, background: '#FBF9F3' } : l._estilo === 'sub' ? { fontWeight: 600, background: '#FBF9F3' } : undefined}>
                        {s.colunas.map((c, k) => { const v = l[c.chave], num = c.tipo === 'moeda' || c.tipo === 'pct' || c.tipo === 'numero';
                          return <td key={c.chave} className={num ? 'r' + (c.tipo === 'moeda' && Number(v) < 0 ? ' neg' : '') : ''} style={l._estilo === 'grupo' && k === 0 ? { paddingLeft: 22 } : undefined}>{celula(c, v)}</td>; })}
                      </tr>))}</tbody>
                  </table>
                  {!cheio && <button className="btn ghost mini mt" onClick={() => mostrarTodas(i)}>Mostrar todas as {corpo.length.toLocaleString('pt-BR')} linhas (exibindo {LIMITE})</button>}
                </div>)}
            </div>);
        })}
      </>}
    </div>
  );
}
