import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useCadastros, nomeCentro } from '../lib/useCadastros';
import { brl } from '../lib/format';
import { pct, useAnos, useLinhasDRE, MESES_LONGOS } from '../lib/analises';
import { GraficoLinhas, MESES_CURTOS } from '../lib/graficos';
import { ModalEmissao } from './Emissao';
import { gerarExcel, gerarPDF, type Relatorio } from '../lib/relatorios';
import { useAuth } from '../lib/auth';
import type { Signatario } from './Signatarios';

interface Ponto { ano: number; mes: number; linha_dre_id: number | null; grupo_id: number | null; subgrupo_id: number | null; realizado: number; previsto: number }
type Visao = 'mensal' | 'anual';
const CORES = ['#0B162C', '#D9A73B', '#2F7D5B', '#B4463C', '#5B6FA8', '#8A6A12'];
const soma = (a: number[]) => a.reduce((x, y) => x + y, 0);
const media = (a: number[]) => (a.length ? soma(a) / a.length : null);
const r2 = (v: number) => Math.round(v * 100) / 100;
/** inclinação da reta (mínimos quadrados) */
function tendencia(a: number[]) {
  const n = a.length; if (n < 2) return null;
  const mx = (n - 1) / 2, my = soma(a) / n;
  return a.reduce((s, y, i) => s + (i - mx) * (y - my), 0) / a.reduce((s, _, i) => s + (i - mx) ** 2, 0);
}

export default function Evolucao({ conta, centro }: { conta: number | null; centro: number | null }) {
  const { grupos, todosSub, contas, centros } = useCadastros();
  const linhas = useLinhasDRE();
  const anos = useAnos();
  const { usuario } = useAuth();
  const hoje = new Date(), anoAtual = hoje.getFullYear(), mesAtual = hoje.getMonth() + 1;
  const receitaId = linhas.find(l => l.no_resultado && l.ordem === 10)?.id;
  const [itens, setItens] = useState<string[]>([]);
  const [visao, setVisao] = useState<Visao>('mensal');
  const [de, setDe] = useState(anoAtual - 1);
  const [ate, setAte] = useState(anoAtual);
  const [mm, setMm] = useState(true);
  const [prev, setPrev] = useState(false);
  const [pts, setPts] = useState<Ponto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [emitir, setEmitir] = useState(false);

  useEffect(() => { if (!itens.length && receitaId) setItens(['L:' + receitaId, 'R']); }, [receitaId]);
  useEffect(() => { if (visao === 'anual' && anos.length) { setDe(Math.min(...anos)); setAte(Math.max(...anos)); } }, [visao, anos]);
  useEffect(() => {
    setCarregando(true); setErro('');
    // o ano anterior ao início entra para comparar o acumulado e a média de 12 meses
    let vivo = true;
    (async () => {
      // o servidor devolve no máximo 1.000 linhas por consulta: busca em páginas até acabar
      const todos: Ponto[] = [];
      for (let i = 0; ; i += 1000) {
        const { data, error } = await supabase.rpc('evolucao_mensal', { p_de: de - 1, p_ate: ate, p_conta: conta, p_centro: centro }).order('ano').order('mes').order('linha_dre_id').order('grupo_id').order('subgrupo_id').range(i, i + 999);
        if (error) { if (vivo) setErro(/evolucao_mensal/.test(error.message) ? 'Rode o arquivo 023_evolucao.sql no Supabase para habilitar a Evolução.' : error.message); break; }
        todos.push(...((data as Ponto[]) || []));
        if (!data || data.length < 1000) break;
      }
      if (vivo) { setPts(todos); setCarregando(false); }
    })();
    return () => { vivo = false; };
  }, [de, ate, conta, centro]);

  const resultadoIds = useMemo(() => new Set(linhas.filter(l => l.no_resultado).map(l => l.id)), [linhas]);
  const nomeItem = (k: string) => {
    const [t, id] = k.split(':'); const n = Number(id);
    if (t === 'R') return 'Resultado líquido';
    if (t === 'L') return linhas.find(l => l.id === n)?.nome || 'Linha';
    if (t === 'G') return grupos.find(g => g.id === n)?.nome || 'Grupo';
    const s = todosSub.find(x => x.id === n); return s ? `${grupos.find(g => g.id === s.grupo_id)?.nome || ''} · ${s.nome}` : 'Subgrupo';
  };
  const casa = (k: string, p: Ponto) => {
    const [t, id] = k.split(':'); const n = Number(id);
    return t === 'R' ? p.linha_dre_id != null && resultadoIds.has(p.linha_dre_id) : t === 'L' ? p.linha_dre_id === n : t === 'G' ? p.grupo_id === n : p.subgrupo_id === n;
  };

  // série mensal contínua de (de-1)/jan até ate/dez
  const meses = useMemo(() => { const out: [number, number][] = []; for (let a = de - 1; a <= ate; a++) for (let m = 1; m <= 12; m++) out.push([a, m]); return out; }, [de, ate]);
  const fechado = (a: number, m: number) => a < anoAtual || (a === anoAtual && m < mesAtual);
  const series = useMemo(() => itens.map(k => {
    const real = meses.map(() => 0), pr = meses.map(() => 0);
    for (const p of pts) if (casa(k, p)) { const i = (p.ano - (de - 1)) * 12 + p.mes - 1; if (i >= 0 && i < meses.length) { real[i] += Number(p.realizado); pr[i] += Number(p.previsto); } }
    // despesas aparecem positivas para facilitar a leitura; o resultado mantém o sinal
    const inv = k !== 'R' && soma(real) + soma(pr) < 0 ? -1 : 1;
    return { k, nome: nomeItem(k), inv, real: real.map(v => r2(v * inv)), prev: pr.map(v => r2(v * inv)) };
  }), [itens, pts, meses, linhas, grupos, todosSub]);
  const receita = useMemo(() => { const r = meses.map(() => 0); pts.forEach(p => { if (p.linha_dre_id === receitaId) { const i = (p.ano - (de - 1)) * 12 + p.mes - 1; if (i >= 0 && i < r.length) r[i] += Number(p.realizado); } }); return r; }, [pts, meses, receitaId]);

  const vis = meses.map((x, i) => [x, i] as const).filter(([[a]]) => a >= de);
  // mês corrente e futuros só aparecem com os previstos (o mês em andamento sozinho distorce o gráfico)
  const valorMes = (s: typeof series[number], i: number) => { const [a, m] = meses[i]; return fechado(a, m) ? s.real[i] : prev ? r2(s.real[i] + s.prev[i]) : null; };

  // indicadores
  const idxFech = meses.map(([a, m], i) => (fechado(a, m) ? i : -1)).filter(i => i >= 0);
  const ultimo = idxFech[idxFech.length - 1];
  function indicadores(s: typeof series[number]) {
    const fech = idxFech.filter(i => meses[i][0] >= de).map(i => s.real[i]);
    const ult12 = idxFech.slice(-12).map(i => s.real[i]), ult3 = idxFech.slice(-3).map(i => s.real[i]);
    const m12 = media(ult12), m3 = media(ult3);
    const idxAno = meses.map(([a], i) => (a === anoAtual ? i : -1)).filter(i => i >= 0);
    const realAno = soma(idxAno.filter(i => fechado(...meses[i])).map(i => s.real[i]));
    const mesesFechAno = idxAno.filter(i => fechado(...meses[i])).length, restantes = 12 - mesesFechAno;
    const idxAnt = meses.map(([a, m], i) => (a === anoAtual - 1 && m <= mesesFechAno ? i : -1)).filter(i => i >= 0);
    const acumAnt = soma(idxAnt.map(i => s.real[i]));
    const prevRest = soma(idxAno.filter(i => !fechado(...meses[i])).map(i => s.prev[i] + (meses[i][1] === mesAtual ? s.real[i] : 0)));
    const totPer = soma(vis.map(([, i]) => s.real[i]));
    const recPer = soma(vis.map(([, i]) => receita[i]));
    const anuais = [...new Set(meses.map(x => x[0]))].filter(a => a >= de && a < anoAtual).map(a => soma(meses.map(([y], i) => (y === a ? s.real[i] : 0))));
    const cagr = anuais.length >= 2 && anuais[0] > 0 && anuais[anuais.length - 1] > 0 ? (anuais[anuais.length - 1] / anuais[0]) ** (1 / (anuais.length - 1)) - 1 : null;
    return {
      total: totPer, mediaMensal: media(fech), m3, m12, tend: tendencia(ult12),
      ultimoVsM12: ultimo != null && m12 ? s.real[ultimo] / m12 - 1 : null,
      acumVsAnt: anoAtual <= ate && acumAnt ? realAno / acumAnt - 1 : null,
      projMedia3: anoAtual <= ate && m3 != null ? realAno + m3 * restantes : null,
      projPrev: anoAtual <= ate ? realAno + prevRest : null,
      partReceita: recPer && s.k !== 'L:' + receitaId ? totPer / recPer : null,
      cagr,
    };
  }
  const ind = series.map(s => ({ s, x: indicadores(s) }));

  // visão anual
  const anosVis = [...new Set(vis.map(([[a]]) => a))];
  const anual = (s: typeof series[number], a: number) => soma(meses.map(([y, m], i) => (y === a && (fechado(y, m) || (y === anoAtual && m === mesAtual)) ? s.real[i] : 0)));

  const rotMes = vis.map(([[a, m]]) => `${MESES_CURTOS[m - 1]}/${String(a).slice(2)}`);
  const opcoes = [
    { g: 'Linhas do DRE', o: [['R', 'Resultado líquido'], ...linhas.filter(l => l.no_resultado).map(l => ['L:' + l.id, l.nome])] },
    { g: 'Grupos', o: grupos.filter(g => g.natureza !== 'movimentacao' && g.ativo).map(g => ['G:' + g.id, g.nome]) },
    // custos e despesas só por grupo; subgrupos apenas nas receitas
    { g: 'Subgrupos de receita', o: todosSub.filter(s => s.ativo !== false && grupos.find(g => g.id === s.grupo_id)?.natureza === 'receita').map(s => ['S:' + s.id, `${grupos.find(g => g.id === s.grupo_id)?.nome || ''} · ${s.nome}`]).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')) },
  ];
  const fmtPct = (v: number | null) => (v == null || !isFinite(v) ? '·' : pct(v));
  const fmtBrl = (v: number | null) => (v == null ? '·' : brl(v));

  async function emitirRelatorio(f: 'pdf' | 'xlsx', assinaturas: Signatario[]) {
    const per = visao === 'mensal' ? rotMes : anosVis.map(String);
    const r: Relatorio = { titulo: 'Evolução', arquivo: `evolucao_${de}_${ate}`, paisagem: true, usuario: usuario?.nome || usuario?.email || '', assinaturas,
      periodo: de === ate ? String(de) : `${de} a ${ate}`,
      filtros: [visao === 'mensal' ? 'Mensal' : 'Anual', conta ? 'Conta: ' + contas.find(c => c.id === conta)?.nome : 'Todas as contas', ...(centro ? ['Centro de custo: ' + nomeCentro(centros, centro)] : []), prev ? 'com previstos lançados nos meses futuros' : 'valores realizados'].join(' · '),
      secoes: [
        { titulo: visao === 'mensal' ? 'Valores mensais' : 'Valores anuais', colunas: [{ titulo: 'Item', chave: 'n' }, ...per.map((p, i) => ({ titulo: p, chave: 'c' + i, tipo: 'moeda' as const }))],
          linhas: series.map(s => Object.fromEntries([['n', s.nome], ...(visao === 'mensal' ? vis.map(([, i], j) => ['c' + j, valorMes(s, i)]) : anosVis.map((a, j) => ['c' + j, anual(s, a)]))])) },
        { titulo: 'Indicadores', colunas: [{ titulo: 'Item', chave: 'n' }, { titulo: 'Total do período', chave: 't', tipo: 'moeda' }, { titulo: 'Média mensal', chave: 'mm', tipo: 'moeda' }, { titulo: 'Média 3 meses', chave: 'm3', tipo: 'moeda' }, { titulo: 'Média 12 meses', chave: 'm12', tipo: 'moeda' }, { titulo: 'Tendência mensal', chave: 'td', tipo: 'moeda' }, { titulo: 'Acum. ano x ano anterior', chave: 'aa', tipo: 'pct' }, { titulo: `Projeção ${anoAtual} (média 3m)`, chave: 'p3', tipo: 'moeda' }, { titulo: `Projeção ${anoAtual} (previstos)`, chave: 'pp', tipo: 'moeda' }],
          linhas: ind.map(({ s, x }) => ({ n: s.nome, t: x.total, mm: x.mediaMensal, m3: x.m3, m12: x.m12, td: x.tend, aa: x.acumVsAnt, p3: x.projMedia3, pp: x.projPrev })) },
      ],
      observacao: 'Regime de caixa (realizado pela data de pagamento). Despesas exibidas em valores positivos. Médias e tendência usam só meses fechados. Projeção do ano = realizado até o último mês fechado + média dos últimos 3 meses (ou + previstos lançados) para os meses restantes.' };
    f === 'pdf' ? await gerarPDF(r) : await gerarExcel(r);
  }

  return (
    <>
      {emitir && <ModalEmissao titulo={`Evolução ${de}${de !== ate ? ' a ' + ate : ''}`} aoFechar={() => setEmitir(false)} aoGerar={emitirRelatorio} />}
      <div className="card">
        <div className="filters" style={{ margin: 0 }}>
          <div className="tabs" style={{ margin: 0, border: 0 }}>{([['mensal', 'Mensal'], ['anual', 'Anual']] as [Visao, string][]).map(([k, t]) => <button key={k} className={visao === k ? 'on' : ''} onClick={() => setVisao(k)}>{t}</button>)}</div>
          <select value={de} onChange={e => { const v = Number(e.target.value); setDe(v); if (v > ate) setAte(v); }}>{anos.map(a => <option key={a} value={a}>De {a}</option>)}</select>
          <select value={ate} onChange={e => { const v = Number(e.target.value); setAte(v); if (v < de) setDe(v); }}>{anos.map(a => <option key={a} value={a}>Até {a}</option>)}</select>
          {visao === 'mensal' && <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, fontWeight: 400 }}><input type="checkbox" checked={mm} onChange={e => setMm(e.target.checked)} style={{ width: 'auto' }} /> Média móvel 3m</label>}
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, fontWeight: 400 }} title="Nos meses futuros, mostra os lançamentos previstos, confirmados e agendados"><input type="checkbox" checked={prev} onChange={e => setPrev(e.target.checked)} style={{ width: 'auto' }} /> Incluir previstos futuros</label>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setEmitir(true)} disabled={!series.length}>Emitir PDF / Excel</button>
        </div>
        <div className="filters" style={{ margin: '12px 0 0', alignItems: 'center' }}>
          <b style={{ fontSize: 13, color: 'var(--navy)' }}>Contas analisadas:</b>
          {itens.map((k, i) => <span key={k} className="tag" style={{ background: CORES[i % CORES.length], color: '#fff', padding: '4px 8px', display: 'inline-flex', gap: 6, alignItems: 'center' }}>{nomeItem(k)}
            <button onClick={() => setItens(itens.filter(x => x !== k))} style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer', padding: 0, fontSize: 14 }} title="Remover">×</button></span>)}
          {itens.length < CORES.length ? <select value="" onChange={e => e.target.value && !itens.includes(e.target.value) && setItens([...itens, e.target.value])} style={{ maxWidth: 320 }}>
            <option value="">+ Adicionar linha do DRE, grupo ou subgrupo</option>
            {opcoes.map(o => <optgroup key={o.g} label={o.g}>{o.o.filter(([k]) => !itens.includes(k)).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</optgroup>)}
          </select> : <span style={{ fontSize: 12, color: 'var(--muted)' }}>Máximo de {CORES.length} itens</span>}
        </div>
      </div>
      {erro && <div className="err mt">{erro}</div>}
      <div className="card mt" style={{ opacity: carregando ? 0.55 : 1 }}>
        <h3>{visao === 'mensal' ? 'Evolução mensal' : 'Evolução anual'} <small>{visao === 'anual' && anosVis.includes(anoAtual) ? `${anoAtual} até ${MESES_LONGOS[mesAtual - 1].toLowerCase()}` : 'realizado'}{prev ? ', com previstos nos meses futuros' : ''}</small></h3>
        {!series.length ? <div className="empty">Adicione ao menos um item para analisar.</div> : visao === 'mensal'
          ? <GraficoLinhas rotulos={rotMes.map((r, j) => (vis.length > 36 ? (r.startsWith('Jan') ? r : '') : vis.length > 12 ? (j % 3 === 0 ? r : '') : r))} series={series.flatMap((s, i) => [
              { nome: s.nome, dados: vis.map(([, idx]) => valorMes(s, idx)), cor: CORES[i % CORES.length] },
              ...(mm ? [{ nome: s.nome + ' (média 3m)', dados: vis.map(([, idx]) => { const ok = [idx, idx - 1, idx - 2].every(j => j >= 0 && fechado(...meses[j])); return ok ? r2((s.real[idx] + s.real[idx - 1] + s.real[idx - 2]) / 3) : null; }), cor: CORES[i % CORES.length], tracejado: true }] : []),
            ])} />
          : <GraficoLinhas rotulos={anosVis.map(String)} series={series.map((s, i) => ({ nome: s.nome, dados: anosVis.map(a => anual(s, a)), cor: CORES[i % CORES.length] }))} />}
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 0' }}>Despesas aparecem em valores positivos para facilitar a comparação. O resultado mantém o sinal.{visao === 'anual' && anosVis.includes(anoAtual) ? ` O ano de ${anoAtual} está parcial.` : ''}</p>
      </div>
      {series.length > 0 && <div className="card mt">
        <h3>Indicadores <small>médias e tendência pelos meses fechados</small></h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="compacta">
            <thead><tr><th>Item</th><th className="r">Total do período</th><th className="r">Média mensal</th><th className="r">Média 3 meses</th><th className="r">Média 12 meses</th>
              <th className="r" title="Último mês fechado comparado à média dos 12 meses">Último mês x média 12m</th><th className="r" title="Inclinação da reta dos últimos 12 meses fechados">Tendência mensal</th>
              <th className="r">Acum. {anoAtual} x {anoAtual - 1}</th>{visao === 'anual' && <th className="r" title="Crescimento médio anual entre o primeiro e o último ano completo">Cresc. médio anual</th>}
              <th className="r" title="Realizado até o último mês fechado + média dos últimos 3 meses nos meses restantes">Projeção {anoAtual} (média 3m)</th>
              <th className="r" title="Realizado até o último mês fechado + previstos, confirmados e agendados já lançados">Projeção {anoAtual} (lançados)</th>
              <th className="r">% da receita</th></tr></thead>
            <tbody>{ind.map(({ s, x }, i) => (
              <tr key={s.k}><td><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: CORES[i % CORES.length], marginRight: 6 }} />{s.nome}</td>
                <td className="r">{fmtBrl(x.total)}</td><td className="r">{fmtBrl(x.mediaMensal)}</td><td className="r">{fmtBrl(x.m3)}</td><td className="r">{fmtBrl(x.m12)}</td>
                <td className="r">{fmtPct(x.ultimoVsM12)}</td><td className="r">{x.tend == null ? '·' : (x.tend >= 0 ? '+' : '−') + brl(Math.abs(x.tend))}</td>
                <td className="r">{fmtPct(x.acumVsAnt)}</td>{visao === 'anual' && <td className="r">{fmtPct(x.cagr)}</td>}
                <td className="r">{fmtBrl(x.projMedia3)}</td><td className="r">{fmtBrl(x.projPrev)}</td>
                <td className="r">{x.partReceita == null ? '·' : (x.partReceita * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'}</td></tr>))}</tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 0' }}>Para despesas, variação positiva significa gasto maior. As projeções não consideram sazonalidade (ex.: 13º, IRPF); compare as duas para ter uma faixa.</p>
      </div>}
      {series.length > 0 && <div className="card mt">
        <h3>Valores {visao === 'mensal' ? 'mensais' : 'anuais'}</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="compacta">
            <thead><tr><th>Item</th>{(visao === 'mensal' ? rotMes : anosVis.map(String)).map(r => <th key={r} className="r">{r}</th>)}</tr></thead>
            <tbody>{series.map(s => (
              <tr key={s.k}><td style={{ whiteSpace: 'nowrap' }}>{s.nome}</td>{visao === 'mensal'
                ? vis.map(([[a, m], idx]) => { const v = valorMes(s, idx); return <td key={idx} className="r" style={{ whiteSpace: 'nowrap', color: !fechado(a, m) ? 'var(--muted)' : undefined }}>{v == null ? '·' : brl(v)}</td>; })
                : anosVis.map(a => <td key={a} className="r" style={{ whiteSpace: 'nowrap' }}>{brl(anual(s, a))}</td>)}</tr>))}</tbody>
          </table>
        </div>
      </div>}
    </>
  );
}
