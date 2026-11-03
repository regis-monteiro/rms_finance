import { brl } from './format';

export const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const k = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v / 1000).toLocaleString('pt-BR') + 'k' : Math.round(v).toLocaleString('pt-BR'));

function escala(valores: number[]) {
  const max = Math.max(0, ...valores), min = Math.min(0, ...valores);
  const passo = Math.max(1000, Math.ceil(((max - min) || 1) / 4 / 5000) * 5000);
  const topo = Math.ceil(max / passo) * passo, base = Math.floor(min / passo) * passo;
  const ticks: number[] = []; for (let v = base; v <= topo + 0.1; v += passo) ticks.push(v);
  return { topo: topo || passo, base, ticks };
}

export interface Serie { nome: string; dados: (number | null)[]; cor: string; tracejado?: boolean }

export function GraficoLinhas({ series, rotulos = MESES_CURTOS, altura = 240 }: { series: Serie[]; rotulos?: string[]; altura?: number }) {
  const w = 760, pad = { l: 52, r: 14, t: 14, b: 26 };
  const vals = series.flatMap(s => s.dados.filter((v): v is number => v != null));
  if (!vals.length) return <div className="empty" style={{ padding: 30 }}>Sem dados para o período.</div>;
  const { topo, base, ticks } = escala(vals);
  const x = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / (rotulos.length - 1);
  const y = (v: number) => pad.t + (altura - pad.t - pad.b) * (1 - (v - base) / (topo - base));
  return (
    <>
      <svg viewBox={`0 0 ${w} ${altura}`} width="100%">
        {ticks.map(v => <g key={v}><line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#D8D2C2' : '#EEE9DC'} /><text x={pad.l - 8} y={y(v) + 4} textAnchor="end">{k(v)}</text></g>)}
        {rotulos.map((m, i) => <text key={m} x={x(i)} y={altura - 6} textAnchor="middle">{m}</text>)}
        {series.map(s => {
          const pts = s.dados.map((v, i) => (v == null ? null : [x(i), y(v), v] as const)).filter(Boolean) as (readonly [number, number, number])[];
          return <g key={s.nome}>
            <polyline fill="none" stroke={s.cor} strokeWidth={2.5} strokeDasharray={s.tracejado ? '5 4' : undefined} points={pts.map(p => p[0] + ',' + p[1]).join(' ')} />
            {!s.tracejado && pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3} fill={s.cor}><title>{s.nome}: {brl(p[2])}</title></circle>)}
          </g>;
        })}
      </svg>
      <div className="legend">{series.map(s => <span key={s.nome}><i style={{ background: s.cor }} />{s.nome}</span>)}</div>
    </>
  );
}

export function GraficoBarras({ itens, nomes = ['Anterior', 'Atual'], altura = 240, largura = 760 }: { itens: { rotulo: string; a: number | null; b: number | null }[]; nomes?: [string, string] | string[]; altura?: number; largura?: number }) {
  const w = largura, pad = { l: 52, r: 10, t: 10, b: 26 };
  const vals = itens.flatMap(i => [i.a, i.b]).filter((v): v is number => v != null);
  if (!vals.length) return <div className="empty" style={{ padding: 30 }}>Sem dados para o período.</div>;
  const { topo, base, ticks } = escala(vals);
  const bw = (w - pad.l - pad.r) / itens.length;
  const y = (v: number) => pad.t + (altura - pad.t - pad.b) * (1 - (v - base) / (topo - base));
  const barra = (v: number | null, x0: number, cor: string, t: string) => v == null ? null :
    <rect x={x0} y={Math.min(y(v), y(0))} width={bw * 0.3} height={Math.abs(y(0) - y(v))} rx={2} fill={cor}><title>{t}: {brl(v)}</title></rect>;
  return (
    <>
      <svg viewBox={`0 0 ${w} ${altura}`} width="100%">
        {ticks.map(v => <g key={v}><line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#D8D2C2' : '#EEE9DC'} /><text x={pad.l - 8} y={y(v) + 4} textAnchor="end">{k(v)}</text></g>)}
        {itens.map((it, i) => { const x0 = pad.l + i * bw + bw * 0.18; return <g key={it.rotulo}>
          {barra(it.a, x0, '#C9CEDA', `${it.rotulo} ${nomes[0]}`)}{barra(it.b, x0 + bw * 0.3 + 2, '#0B162C', `${it.rotulo} ${nomes[1]}`)}
          <text x={pad.l + i * bw + bw / 2} y={altura - 6} textAnchor="middle">{it.rotulo}</text></g>; })}
      </svg>
      <div className="legend"><span><i style={{ background: '#C9CEDA' }} />{nomes[0]}</span><span><i style={{ background: '#0B162C' }} />{nomes[1]}</span></div>
    </>
  );
}
