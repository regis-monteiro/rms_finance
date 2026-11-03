import { useEffect, useMemo, useState } from 'react';
import { useCadastros } from '../lib/useCadastros';
import { brl } from '../lib/format';
import { carregarDRE, linhaMensal, pct, resultadoMensal, useAnos, useLinhasDRE, SUBTOTAIS, MESES_LONGOS, type PontoDRE } from '../lib/analises';
import { GraficoBarras, GraficoLinhas, MESES_CURTOS } from '../lib/graficos';
import { Cabecalho } from '../components/Layout';

type Tipo = 'mes' | 'ano' | 'acum';
const soma = (a: number[]) => a.reduce((x, y) => x + y, 0);

export default function Comparativos() {
  const { contas } = useCadastros();
  const linhas = useLinhasDRE();
  const anos = useAnos();
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(Math.max(1, hoje.getMonth())); // último mês fechado
  const [conta, setConta] = useState<number | null>(null);
  const [tipo, setTipo] = useState<Tipo>('ano');
  const [atual, setAtual] = useState<PontoDRE[]>([]);
  const [anterior, setAnterior] = useState<PontoDRE[]>([]);

  useEffect(() => {
    carregarDRE(ano, conta).then(setAtual).catch(() => setAtual([]));
    carregarDRE(ano - 1, conta).then(setAnterior).catch(() => setAnterior([]));
  }, [ano, conta]);

  const resultado = linhas.filter(l => l.no_resultado);
  const receitaId = resultado.find(l => l.ordem === 10)?.id;
  // valores realizados por linha, 12 meses, para os dois anos
  const serie = (pts: PontoDRE[]) => new Map(resultado.map(l => [l.id, linhaMensal(pts, l.id, 'real')]));
  const sA = useMemo(() => serie(atual), [atual, linhas]);
  const sB = useMemo(() => serie(anterior), [anterior, linhas]);

  const zeros = Array(12).fill(0) as number[];
  const arrA = (id: number) => sA.get(id) || zeros, arrB = (id: number) => sB.get(id) || zeros;
  const valA = (id: number) => (tipo === 'acum' ? soma(arrA(id).slice(0, mes)) : arrA(id)[mes - 1]);
  const valB = (id: number) => (tipo === 'acum' ? soma(arrB(id).slice(0, mes)) : tipo === 'ano' ? arrB(id)[mes - 1] : mes === 1 ? arrB(id)[11] : arrA(id)[mes - 2]);

  const rotA = tipo === 'acum' ? `Jan a ${MESES_CURTOS[mes - 1]}/${ano}` : `${MESES_LONGOS[mes - 1]}/${ano}`;
  const rotB = tipo === 'acum' ? `Jan a ${MESES_CURTOS[mes - 1]}/${ano - 1}` : tipo === 'ano' ? `${MESES_LONGOS[mes - 1]}/${ano - 1}` : mes === 1 ? `Dezembro/${ano - 1}` : `${MESES_LONGOS[mes - 2]}/${ano}`;

  // tabela com subtotais
  const tab: { nome: string; a: number; b: number; sub: boolean }[] = [];
  let accA = 0, accB = 0;
  resultado.forEach(l => {
    const a = valA(l.id), b = valB(l.id); accA += a; accB += b;
    tab.push({ nome: l.nome, a, b, sub: false });
    const s = SUBTOTAIS.find(x => x[0] === l.ordem); if (s) tab.push({ nome: s[1], a: accA, b: accB, sub: true });
  });
  const rec = { a: receitaId ? valA(receitaId) : 0, b: receitaId ? valB(receitaId) : 0 };
  const res = { a: accA, b: accB };
  const desp = { a: rec.a - res.a, b: rec.b - res.b };

  const recA = linhaMensal(atual, receitaId, 'real'), recB = linhaMensal(anterior, receitaId, 'real');
  const resA = resultadoMensal(atual, linhas, 'real'), resB = resultadoMensal(anterior, linhas, 'real');
  const fechados = ano === hoje.getFullYear() ? hoje.getMonth() : 12;
  const recFech = recA.slice(0, fechados);
  const media3 = recA.map((_, i) => (i < 2 || i >= fechados ? null : (recA[i] + recA[i - 1] + recA[i - 2]) / 3));
  // tendência linear da receita nos meses fechados
  const nF = recFech.length, mx = (nF - 1) / 2, my = nF ? soma(recFech) / nF : 0;
  const incl = nF > 1 ? recFech.reduce((a, y, i) => a + (i - mx) * (y - my), 0) / recFech.reduce((a, _, i) => a + (i - mx) ** 2, 0) : 0;
  const proj = (k: number) => my + incl * (nF - 1 + k - mx);
  const ytd = (a: number[]) => soma(a.slice(0, fechados));
  const despA = recA.map((v, i) => v - resA[i]), despB = recB.map((v, i) => v - resB[i]);
  const semAnterior = anterior.length === 0;

  const kpi = (t: string, x: { a: number; b: number }, inverter = false) => {
    const d = x.a - x.b, p = x.b ? d / Math.abs(x.b) : 0, bom = inverter ? d <= 0 : d >= 0;
    return <div className="card kpi"><div className="lbl">{t}</div><div className="val">{brl(x.a)}</div>
      <div className="sub">{rotB}: {brl(x.b)} · <span className={bom ? 'pos' : 'neg'}>{d >= 0 ? '+' : '−'}{brl(Math.abs(d))}{x.b ? ` (${pct(p)})` : ''}</span></div></div>;
  };

  return (
    <>
      <Cabecalho titulo="Comparativos" sub="Evolução, tendências e variações em R$ e %" />
      <div className="filters">
        <div className="tabs" style={{ margin: 0, border: 0 }}>{([['mes', 'Mês anterior'], ['ano', 'Mesmo mês do ano anterior'], ['acum', 'Acumulado do ano']] as [Tipo, string][]).map(([k, t]) => <button key={k} className={tipo === k ? 'on' : ''} onClick={() => setTipo(k)}>{t}</button>)}</div>
        <span style={{ flex: 1 }} />
        <select value={conta ?? ''} onChange={e => setConta(e.target.value ? Number(e.target.value) : null)}><option value="">Todas as contas</option>{contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
        <select value={mes} onChange={e => setMes(Number(e.target.value))}>{MESES_LONGOS.map((m, i) => <option key={m} value={i + 1}>Mês base: {m}</option>)}</select>
        <select value={ano} onChange={e => setAno(Number(e.target.value))}>{anos.map(a => <option key={a}>{a}</option>)}</select>
      </div>
      {semAnterior && tipo !== 'mes' && <div className="proto" style={{ marginBottom: 14 }}>Ainda não há dados de {ano - 1}. Os comparativos com o ano anterior ficam completos depois da importação das planilhas desse ano.</div>}
      <div className="grid g3">{kpi('Receita de serviços', rec)}{kpi('Custos e despesas', desp, true)}{kpi('Resultado líquido', res)}</div>
      <div className="grid g2 mt">
        <div className="card"><h3>Receitas: {ano} x {ano - 1} <small>realizado, com média móvel de 3 meses</small></h3>
          <GraficoLinhas series={[{ nome: String(ano - 1), dados: recB.map(v => v || null), cor: '#C9CEDA' }, { nome: String(ano), dados: recA.map((v, i) => (i < fechados ? v : null)), cor: '#0B162C' }, { nome: 'Média móvel 3m', dados: media3, cor: '#D9A73B', tracejado: true }]} />
        </div>
        <div className="card"><h3>Resultado mensal <small>realizado</small></h3>
          <GraficoBarras itens={MESES_CURTOS.map((m, i) => ({ rotulo: m, a: resB[i] || null, b: i < fechados ? resA[i] : null }))} nomes={[String(ano - 1), String(ano)]} />
        </div>
      </div>
      <div className="grid g21 mt">
        <div className="card"><h3>DRE comparativo <small>{rotA} x {rotB}</small></h3>
          <table><thead><tr><th>Linha</th><th className="r">{rotA}</th><th className="r">{rotB}</th><th className="r">Variação R$</th><th className="r">Variação %</th><th className="r">% da receita</th></tr></thead>
            <tbody>{tab.map(t => { const d = t.a - t.b, p = t.b ? d / Math.abs(t.b) : 0; return (
              <tr key={t.nome} style={t.sub ? { fontWeight: 700, background: '#FBF9F3' } : undefined}><td>{t.nome}</td><td className="r">{brl(t.a)}</td><td className="r">{brl(t.b)}</td>
                <td className={'r ' + (d >= 0 ? 'pos' : 'neg')}>{d >= 0 ? '+' : '−'}{brl(Math.abs(d))}</td><td className={'r ' + (d >= 0 ? 'pos' : 'neg')}>{t.b ? pct(p) : '·'}</td>
                <td className="r">{rec.a ? (t.a / rec.a * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '·'}</td></tr>); })}</tbody></table>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>Valores realizados (regime de caixa). Verde = variação favorável ao caixa.</p>
        </div>
        <div className="card"><h3>Tendências <small>meses fechados de {ano}</small></h3>
          <table><tbody>
            <tr><td>Crescimento médio mensal da receita</td><td className={'r ' + (incl >= 0 ? 'pos' : 'neg')}>{incl >= 0 ? '+' : '−'}{brl(Math.abs(incl))}</td></tr>
            <tr><td>Receita acumulada x {ano - 1}</td><td className="r">{ytd(recB) ? pct(ytd(recA) / ytd(recB) - 1) : '·'}</td></tr>
            <tr><td>Custos e despesas acumulados x {ano - 1}</td><td className="r">{ytd(despB) ? pct(ytd(despA) / ytd(despB) - 1) : '·'}</td></tr>
            <tr><td>Margem líquida média</td><td className="r">{ytd(recA) ? (ytd(resA) / ytd(recA) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '·'}</td></tr>
            {fechados < 12 && <tr><td>Receita projetada para {MESES_LONGOS[fechados].toLowerCase()}</td><td className="r">{brl(proj(1))}</td></tr>}
            {fechados < 11 && <tr><td>Receita projetada para {MESES_LONGOS[fechados + 1].toLowerCase()}</td><td className="r">{brl(proj(2))}</td></tr>}
          </tbody></table>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>Projeção por tendência linear dos meses fechados. Não considera sazonalidade (ex.: IRPF, 13º).</p>
        </div>
      </div>
    </>
  );
}
