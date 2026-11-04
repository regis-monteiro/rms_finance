import { Fragment, useEffect, useMemo, useState } from 'react';
import { useCadastros, nomeCentro, OpcoesCentro } from '../lib/useCadastros';
import { carregarDRE, useAnos, useLinhasDRE, valorModo, SUBTOTAIS, type Modo, type PontoDRE } from '../lib/analises';
import { MESES_CURTOS } from '../lib/graficos';
import { Cabecalho } from '../components/Layout';
import { ModalEmissao } from '../components/Emissao';
import { gerarExcel, gerarPDF, type Linha } from '../lib/relatorios';
import { useAuth } from '../lib/auth';

const n = (v: number) => Math.round(v).toLocaleString('pt-BR');

export default function DRE() {
  const { contas, grupos, centros } = useCadastros();
  const [centro, setCentro] = useState<number | null>(null);
  const linhas = useLinhasDRE();
  const anos = useAnos();
  const [ano, setAno] = useState(new Date().getFullYear());
  const [conta, setConta] = useState<number | null>(null);
  const [modo, setModo] = useState<Modo>('comb');
  const [abertas, setAbertas] = useState<Set<number>>(new Set());
  const [pontos, setPontos] = useState<PontoDRE[]>([]);
  const [erro, setErro] = useState('');
  const [emitir, setEmitir] = useState(false);
  const [comGrupos, setComGrupos] = useState(true);
  const { usuario } = useAuth();

  useEffect(() => { setErro(''); carregarDRE(ano, conta, centro).then(setPontos).catch(e => setErro(e.message)); }, [ano, conta, centro]);

  const tabela = useMemo(() => {
    const porLinha = new Map<number, Map<number | null, number[]>>();
    pontos.forEach(p => {
      const v = valorModo(p, modo); if (!v) return;
      const m = porLinha.get(p.linha_dre_id) || new Map(); porLinha.set(p.linha_dre_id, m);
      const a = m.get(p.grupo_id) || Array(12).fill(0); m.set(p.grupo_id, a); a[p.mes - 1] += v;
    });
    return porLinha;
  }, [pontos, modo]);

  const soma = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const totLinha = (id: number) => { const t = Array(12).fill(0); tabela.get(id)?.forEach(a => a.forEach((v, i) => (t[i] += v))); return t as number[]; };
  const nomeG = (id: number | null) => (id == null ? 'Grupos restritos (total)' : grupos.find(g => g.id === id)?.nome || '·');
  const cel = (a: number[], forte = false) => <>{a.map((v, i) => <td key={i} className={'r ' + (v < -0.5 ? 'neg' : '')}>{Math.abs(v) < 0.5 ? '·' : n(v)}</td>)}<td className="r" style={{ fontWeight: 700 }}>{n(soma(a))}</td></>;

  const resultado = linhas.filter(l => l.no_resultado), fora = linhas.filter(l => !l.no_resultado);
  let acum = Array(12).fill(0) as number[];
  const linhasCsv: string[][] = [['Linha', ...MESES_CURTOS, 'Total']];

  const blocoLinha = (l: typeof linhas[number]) => {
    const t = totLinha(l.id); acum = acum.map((v, i) => v + t[i]);
    linhasCsv.push([l.nome, ...t.map(v => v.toFixed(2)), soma(t).toFixed(2)]);
    const aberta = abertas.has(l.id), gs = [...(tabela.get(l.id)?.entries() || [])].sort((a, b) => Math.abs(soma(b[1])) - Math.abs(soma(a[1])));
    const sub = SUBTOTAIS.find(s => s[0] === l.ordem);
    const subTot = sub ? [...acum] : null;
    if (sub) linhasCsv.push([sub[1], ...subTot!.map(v => v.toFixed(2)), soma(subTot!).toFixed(2)]);
    return (
      <Fragment key={l.id}>
        <tr style={{ cursor: gs.length ? 'pointer' : 'default', fontWeight: 600 }} onClick={() => { const s = new Set(abertas); aberta ? s.delete(l.id) : s.add(l.id); setAbertas(s); }}>
          <td>{gs.length ? (aberta ? '▾ ' : '▸ ') : '   '}{l.nome}</td>{cel(t)}</tr>
        {aberta && gs.map(([g, a]) => <tr key={String(g)} style={{ fontSize: 12.5, color: 'var(--muted)' }}><td style={{ paddingLeft: 28 }}>{nomeG(g)}</td>{cel(a)}</tr>)}
        {sub && <tr style={{ fontWeight: 700, background: '#F7F3E8' }}><td>{sub[1]}</td>{cel(subTot!)}</tr>}
      </Fragment>
    );
  };

  /** Linhas do relatório (mesma estrutura da tela) */
  function linhasRelatorio(): Linha[] {
    const out: Linha[] = []; let ac = Array(12).fill(0) as number[];
    const lin = (nome: string, a: number[], estilo?: Linha['_estilo']) => { const o: Linha = { l: nome, t: soma(a), _estilo: estilo }; a.forEach((v, i) => (o['m' + i] = v)); out.push(o); };
    const bloco = (l: typeof linhas[number], conta: boolean) => {
      const t = totLinha(l.id); if (conta) ac = ac.map((v, i) => v + t[i]);
      lin(l.nome, t);
      if (comGrupos) [...(tabela.get(l.id)?.entries() || [])].sort((a, b) => Math.abs(soma(b[1])) - Math.abs(soma(a[1]))).forEach(([g, a]) => lin(nomeG(g), a, 'grupo'));
      const sub = SUBTOTAIS.find(x => x[0] === l.ordem); if (sub && conta) lin(sub[1], [...ac], 'sub');
    };
    resultado.forEach(l => bloco(l, true));
    const res = [...ac];
    out.push({ l: 'Movimentações de caixa fora do resultado', _estilo: 'sub' });
    fora.forEach(l => bloco(l, false));
    lin('Variação do caixa no mês', res.map((v, i) => v + fora.reduce((x, l) => x + totLinha(l.id)[i], 0)), 'total');
    return out;
  }
  async function emitirRelatorio(f: 'pdf' | 'xlsx', assinaturas: import('../components/Signatarios').Signatario[]) {
    const nomeConta = conta ? contas.find(c => c.id === conta)?.nome : null;
    const r = { titulo: 'DRE · Análise do fluxo de caixa' + (centro ? ' · ' + nomeCentro(centros, centro) : ''), arquivo: `DRE_${ano}`, paisagem: true, usuario: usuario?.nome || usuario?.email || '',
      periodo: `01/01/${ano} a 31/12/${ano}`, assinaturas,
      filtros: [nomeConta ? 'Conta: ' + nomeConta : 'Todas as contas', centro ? 'Centro de custo: ' + nomeCentro(centros, centro) : 'Todos os centros de custo', modo === 'real' ? 'Realizado' : modo === 'prev' ? 'Previsto' : 'Realizado + previsto'].join(' · '),
      observacao: 'Regime de caixa: realizado pela data de pagamento e previsto pelo vencimento. Compras de cartão entram no mês de vencimento da fatura. Valores em R$.',
      secoes: [{ colunas: [{ titulo: 'Linha / grupo', chave: 'l', largura: 46 }, ...MESES_CURTOS.map((m, i) => ({ titulo: m, chave: 'm' + i, tipo: 'numero' as const })), { titulo: 'Total', chave: 't', tipo: 'numero' as const }], linhas: linhasRelatorio() }] };
    f === 'pdf' ? await gerarPDF(r) : await gerarExcel(r);
  }

  function exportar() {
    const csv = linhasCsv.map(r => r.map(c => `"${/^-?\d+\.\d+$/.test(c) ? c.replace('.', ',') : c}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `DRE_${ano}${centro ? '_' + nomeCentro(centros, centro) : ''}${conta ? '_' + contas.find(c => c.id === conta)?.nome : ''}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  const corpo = <>{resultado.map(blocoLinha)}</>;
  const resultadoFinal = [...acum];
  const corpoFora = <>{fora.map(l => blocoLinha({ ...l, ordem: -1 }))}</>;
  const variacao = resultadoFinal.map((v, i) => v + fora.reduce((s, l) => s + totLinha(l.id)[i], 0));
  linhasCsv.push(['Variação do caixa no mês', ...variacao.map(v => v.toFixed(2)), soma(variacao).toFixed(2)]);

  return (
    <>
      <Cabecalho titulo="DRE / Análise do fluxo" sub="Resultado por mês, regime de caixa, com filtro por conta">
        <button className="btn ghost" onClick={exportar}>CSV</button>
        <button className="btn" onClick={() => setEmitir(true)}>Emitir PDF / Excel</button>
      </Cabecalho>
      <div className="filters">
        <select value={ano} onChange={e => setAno(Number(e.target.value))}>{anos.map(a => <option key={a}>{a}</option>)}</select>
        <select value={conta ?? ''} onChange={e => setConta(e.target.value ? Number(e.target.value) : null)}><option value="">Todas as contas</option>{contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
        <select value={centro ?? ''} onChange={e => setCentro(e.target.value ? Number(e.target.value) : null)} title="Centro de custo"><option value="">Todos os centros de custo</option><OpcoesCentro centros={centros} /></select>
        <div className="tabs" style={{ margin: 0, border: 0 }}>{([['real', 'Realizado'], ['prev', 'Previsto'], ['comb', 'Realizado + previsto']] as [Modo, string][]).map(([k, t]) => <button key={k} className={modo === k ? 'on' : ''} onClick={() => setModo(k)}>{t}</button>)}</div>
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => setAbertas(new Set(linhas.map(l => l.id)))}>Expandir tudo</button>
        <button className="btn ghost" onClick={() => setAbertas(new Set())}>Recolher</button>
      </div>
      {erro && <div className="err">{erro}</div>}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="compacta">
          <thead><tr><th style={{ minWidth: 170 }}>Linha / grupo</th>{MESES_CURTOS.map(m => <th key={m} className="r">{m}</th>)}<th className="r">Total</th></tr></thead>
          <tbody>
            {corpo}
            <tr><td colSpan={14} style={{ paddingTop: 18, fontWeight: 700, color: 'var(--navy)' }}>Movimentações de caixa fora do resultado</td></tr>
            {corpoFora}
            <tr style={{ fontWeight: 700, background: 'var(--navy)', color: 'var(--ivory)' }}><td>Variação do caixa no mês</td>{variacao.map((v, i) => <td key={i} className="r">{Math.abs(v) < 0.5 ? '·' : n(v)}</td>)}<td className="r">{n(soma(variacao))}</td></tr>
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>Valores em R$. Realizado pela data de pagamento; previsto pelo vencimento. Compras de cartão entram no mês de vencimento da fatura{conta ? ', na proporção paga por esta conta' : ''}. Clique numa linha para ver os grupos.{centro ? ` Centro de custo: ${nomeCentro(centros, centro)}${centros.find(c => c.id === centro)?.nome === 'Geral' ? ' (inclui os subcentros e o que está sem centro)' : ''}.` : ''}</p>
      </div>
      {emitir && <ModalEmissao titulo={`DRE ${ano}`} assinatura semAssinaturaPadrao={modo !== 'real'} avisoSemAssinatura={modo !== 'real' ? 'Este DRE inclui valores previstos, por isso a emissão sem assinatura vem selecionada.' : undefined} aoFechar={() => setEmitir(false)} aoGerar={emitirRelatorio}
        extras={<label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 8 }}><input type="checkbox" checked={comGrupos} onChange={e => setComGrupos(e.target.checked)} /> Incluir o detalhamento por grupo</label>} />}
    </>
  );
}
