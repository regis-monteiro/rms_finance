import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useCadastros } from '../lib/useCadastros';
import { brl } from '../lib/format';
import { carregarDRE, pct, useLinhasDRE, valorModo, SUBTOTAIS, MESES_LONGOS, type PontoDRE } from '../lib/analises';
import { MESES_CURTOS } from '../lib/graficos';
import { Cabecalho } from '../components/Layout';

interface Orc { ano: number; mes: number; grupo_id: number; valor: number }
const IGNORAR = ['Transferências', 'Pagamento de fatura'];
/** Arredonda para cima, na casa das dezenas, em valor absoluto (despesas ficam mais negativas) */
export const arredondaDezena = (v: number) => Math.sign(v) * Math.ceil(Math.abs(v) / 10) * 10;
const n0 = (v: number) => Math.round(v).toLocaleString('pt-BR');

export default function Orcamento() {
  const { usuario } = useAuth();
  const diretor = usuario?.perfil === 'diretor';
  const { grupos } = useCadastros();
  const linhas = useLinhasDRE();
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear() + 1);
  const [orc, setOrc] = useState<Orc[]>([]);
  const [real, setReal] = useState<PontoDRE[]>([]);
  const [aba, setAba] = useState<'orcado' | 'comparar'>('orcado');
  const [mesComp, setMesComp] = useState(hoje.getMonth() + 1);
  const [acum, setAcum] = useState(true);
  const [gerar, setGerar] = useState<{ previa: Orc[]; info: Map<number, number> } | null>(null);
  const [gerando, setGerando] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [versao, setVersao] = useState(0);
  const avisar = (t: 'ok' | 'err', m: string) => { setMsg({ t, m }); setTimeout(() => setMsg(null), 4000); };

  useEffect(() => {
    supabase.from('orcamento').select('ano,mes,grupo_id,valor').eq('ano', ano).then(({ data }) => setOrc((data as Orc[]) || []));
    carregarDRE(ano, null).then(setReal).catch(() => setReal([]));
  }, [ano, versao]);

  const grupoLinha = useMemo(() => new Map(grupos.map(g => [g.id, g.linha_dre_id])), [grupos]);
  const gruposOrc = grupos.filter(g => !IGNORAR.includes(g.nome));

  /** Gera a prévia: mesmo mês do ano anterior × (1 + crescimento médio anual dos últimos 3 anos), por grupo */
  async function preparar() {
    setGerando(true);
    try {
      const anos = [ano - 1, ano - 2, ano - 3, ano - 4];
      const dados = await Promise.all(anos.map(a => carregarDRE(a, null)));
      const serie = (pts: PontoDRE[]) => { const m = new Map<number, number[]>(); pts.forEach(p => { if (p.grupo_id == null) return; const a = m.get(p.grupo_id) || Array(12).fill(0); a[p.mes - 1] += valorModo(p, 'comb'); m.set(p.grupo_id, a); }); return m; };
      const [s1, s2, s3, s4] = dados.map(serie);
      const total = (s: Map<number, number[]>, g: number) => (s.get(g) || []).reduce((a, b) => a + b, 0);
      const previa: Orc[] = [], info = new Map<number, number>();
      gruposOrc.forEach(g => {
        const pares = [[s1, s2], [s2, s3], [s3, s4]].map(([a, b]) => [total(a, g.id), total(b, g.id)]).filter(([a, b]) => a !== 0 && b !== 0 && Math.sign(a) === Math.sign(b));
        let cresc = pares.length ? pares.reduce((acc, [a, b]) => acc + (a / b - 1), 0) / pares.length : 0;
        cresc = Math.max(-0.5, Math.min(1, cresc));
        info.set(g.id, cresc);
        const base = s1.get(g.id) || Array(12).fill(0);
        base.forEach((v, i) => { const val = arredondaDezena(v * (1 + cresc)); if (val !== 0) previa.push({ ano, mes: i + 1, grupo_id: g.id, valor: val }); });
      });
      setGerar({ previa, info });
    } catch (err) { avisar('err', (err as Error).message); }
    setGerando(false);
  }

  async function aplicarGeracao() {
    if (!gerar) return;
    const del = await supabase.from('orcamento').delete().eq('ano', ano);
    if (del.error) { avisar('err', del.error.message); return; }
    const { error } = await supabase.from('orcamento').insert(gerar.previa);
    if (error) { avisar('err', error.message); return; }
    setGerar(null); avisar('ok', `Orçamento de ${ano} gerado`); setVersao(v => v + 1);
  }

  async function editarCelula(g: number, mes: number, valor: number) {
    const { error } = await supabase.from('orcamento').upsert({ ano, mes, grupo_id: g, valor: arredondaDezena(valor) }, { onConflict: 'ano,mes,grupo_id' });
    if (error) avisar('err', error.message); else setVersao(v => v + 1);
  }

  // Estrutura: linha DRE -> grupo -> 12 meses
  const orcPorGrupo = useMemo(() => { const m = new Map<number, number[]>(); orc.forEach(o => { const a = m.get(o.grupo_id) || Array(12).fill(0); a[o.mes - 1] += Number(o.valor); m.set(o.grupo_id, a); }); return m; }, [orc]);
  const realPorLinha = useMemo(() => { const m = new Map<number, number[]>(); real.forEach(p => { const a = m.get(p.linha_dre_id) || Array(12).fill(0); a[p.mes - 1] += valorModo(p, 'real'); m.set(p.linha_dre_id, a); }); return m; }, [real]);
  const orcPorLinha = useMemo(() => { const m = new Map<number, number[]>(); orcPorGrupo.forEach((a, g) => { const l = grupoLinha.get(g); if (l == null) return; const t = m.get(l) || Array(12).fill(0); a.forEach((v, i) => (t[i] += v)); m.set(l, t); }); return m; }, [orcPorGrupo, grupoLinha]);
  const soma = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const zeros = Array(12).fill(0) as number[];

  const grade = () => {
    let acc = [...zeros]; const out: JSX.Element[] = [];
    linhas.forEach(l => {
      const gs = gruposOrc.filter(g => g.linha_dre_id === l.id);
      const t = orcPorLinha.get(l.id) || zeros; if (l.no_resultado) acc = acc.map((v, i) => v + t[i]);
      out.push(<tr key={'l' + l.id} style={{ fontWeight: 600 }}><td>{l.nome}</td>{t.map((v, i) => <td key={i} className={'r ' + (v < 0 ? 'neg' : '')}>{v ? n0(v) : '·'}</td>)}<td className="r" style={{ fontWeight: 700 }}>{n0(soma(t))}</td></tr>);
      gs.filter(g => orcPorGrupo.has(g.id) || diretor).forEach(g => {
        const a = orcPorGrupo.get(g.id) || zeros;
        if (!diretor && (g.restrito || !soma(a.map(Math.abs)))) return;
        out.push(<tr key={'g' + g.id} style={{ fontSize: 12.5, color: 'var(--muted)' }}><td style={{ paddingLeft: 26 }}>{g.nome}</td>
          {a.map((v, i) => <td key={i} className="r">{diretor ? <input key={`${g.id}-${i}-${v}`} type="number" step="10" defaultValue={v || ''} placeholder="·" style={{ width: 78, textAlign: 'right', padding: '3px 5px', fontSize: 12 }} onBlur={e => Number(e.target.value || 0) !== v && editarCelula(g.id, i + 1, Number(e.target.value || 0))} /> : (v ? n0(v) : '·')}</td>)}
          <td className="r">{n0(soma(a))}</td></tr>);
      });
      const sub = SUBTOTAIS.find(s => s[0] === l.ordem);
      if (sub) out.push(<tr key={'s' + l.id} style={{ fontWeight: 700, background: '#F7F3E8' }}><td>{sub[1]}</td>{acc.map((v, i) => <td key={i} className="r">{n0(v)}</td>)}<td className="r">{n0(soma(acc))}</td></tr>);
      if (l.ordem === 80) out.push(<tr key="fora"><td colSpan={14} style={{ paddingTop: 16, fontWeight: 700, color: 'var(--navy)' }}>Movimentações fora do resultado</td></tr>);
    });
    return out;
  };

  const comparativo = () => {
    const corte = (a: number[]) => (acum ? soma(a.slice(0, mesComp)) : a[mesComp - 1]);
    let accO = 0, accR = 0; const out: JSX.Element[] = [];
    linhas.filter(l => l.no_resultado).forEach(l => {
      const o = corte(orcPorLinha.get(l.id) || zeros), r = corte(realPorLinha.get(l.id) || zeros); accO += o; accR += r;
      const linha = (nome: string, o: number, r: number, forte = false) => { const d = r - o; return (
        <tr key={nome} style={forte ? { fontWeight: 700, background: '#FBF9F3' } : undefined}><td>{nome}</td><td className="r">{brl(o)}</td><td className="r">{brl(r)}</td>
          <td className={'r ' + (d >= 0 ? 'pos' : 'neg')}>{d >= 0 ? '+' : '−'}{brl(Math.abs(d))}</td><td className="r">{o ? pct(r / o - 1) : '·'}</td>
          <td style={{ width: '16%' }}><div className="bar"><i style={{ width: o ? Math.min(100, Math.abs(r / o) * 100) + '%' : 0 }} /></div></td></tr>); };
      out.push(linha(l.nome, o, r));
      const sub = SUBTOTAIS.find(s => s[0] === l.ordem); if (sub) out.push(linha(sub[1], accO, accR, true));
    });
    return out;
  };

  const temOrc = orc.length > 0;
  return (
    <>
      <Cabecalho titulo="Orçamento financeiro" sub="Projeção anual por grupo e mês, com acompanhamento do orçado x realizado">{msg && <span className={msg.t}>{msg.m}</span>}</Cabecalho>
      <div className="filters">
        <select value={ano} onChange={e => setAno(Number(e.target.value))}>{[hoje.getFullYear() - 1, hoje.getFullYear(), hoje.getFullYear() + 1, hoje.getFullYear() + 2].map(a => <option key={a}>{a}</option>)}</select>
        <div className="tabs" style={{ margin: 0, border: 0 }}>
          <button className={aba === 'orcado' ? 'on' : ''} onClick={() => setAba('orcado')}>Orçado por grupo</button>
          <button className={aba === 'comparar' ? 'on' : ''} onClick={() => setAba('comparar')}>Orçado x realizado</button>
        </div>
        <span style={{ flex: 1 }} />
        {diretor && <button className="btn gold" disabled={gerando} onClick={preparar}>{gerando ? 'Calculando…' : temOrc ? `Gerar novamente ${ano}` : `Gerar orçamento ${ano}`}</button>}
      </div>

      {!temOrc ? <div className="card empty">Ainda não há orçamento para {ano}.{diretor ? ' Use "Gerar orçamento" para criar a projeção automática.' : ''}</div> : aba === 'orcado' ? (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 1250 }}><thead><tr><th style={{ minWidth: 200 }}>Linha / grupo</th>{MESES_CURTOS.map(m => <th key={m} className="r">{m}</th>)}<th className="r">Total</th></tr></thead>
            <tbody>{grade()}</tbody></table>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>Valores em R$, arredondados para cima na casa das dezenas. {diretor ? 'Clique num valor para ajustar.' : ''}</p>
        </div>
      ) : (
        <div className="card">
          <div className="filters">
            <select value={mesComp} onChange={e => setMesComp(Number(e.target.value))}>{MESES_LONGOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={acum} onChange={e => setAcum(e.target.checked)} /> Acumulado de janeiro até o mês</label>
          </div>
          <table><thead><tr><th>Linha</th><th className="r">Orçado</th><th className="r">Realizado</th><th className="r">Diferença</th><th className="r">Variação</th><th>Execução</th></tr></thead><tbody>{comparativo()}</tbody></table>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>Realizado em regime de caixa (data de pagamento). Verde = melhor que o orçado para o caixa.</p>
        </div>
      )}

      {gerar && (
        <div className="modal-bg open" onClick={e => e.target === e.currentTarget && setGerar(null)}>
          <div className="modal" style={{ width: 'min(720px,100%)' }}><h2>Orçamento automático {ano}</h2>
            <p style={{ margin: '-4px 0 12px', fontSize: 13, color: 'var(--muted)' }}>Para cada grupo: valor do mesmo mês de {ano - 1} (realizado + previsto) × (1 + crescimento médio anual de {ano - 4} a {ano - 1}), arredondado para cima nas dezenas. Crescimento limitado entre −50% e +100%.</p>
            <div style={{ maxHeight: 360, overflow: 'auto' }}>
              <table><thead><tr><th>Grupo</th><th className="r">Crescimento usado</th><th className="r">Total {ano}</th></tr></thead>
                <tbody>{gruposOrc.map(g => { const t = gerar.previa.filter(p => p.grupo_id === g.id).reduce((a, p) => a + p.valor, 0); if (!t) return <Fragment key={g.id} />;
                  const c = gerar.info.get(g.id) || 0; return <tr key={g.id}><td>{g.nome}</td><td className="r">{pct(c)}</td><td className={'r ' + (t < 0 ? 'neg' : 'pos')}>{brl(t)}</td></tr>; })}</tbody></table>
            </div>
            <p style={{ fontSize: 13, margin: '12px 0 0' }}>Resultado projetado: <b>{brl(gerar.previa.filter(p => linhas.find(l => l.id === grupoLinha.get(p.grupo_id))?.no_resultado).reduce((a, p) => a + p.valor, 0))}</b>.{temOrc && ` Substitui o orçamento atual de ${ano}, inclusive ajustes manuais.`}</p>
            <div className="actions"><button className="btn ghost" onClick={() => setGerar(null)}>Cancelar</button><button className="btn" onClick={aplicarGeracao}>Gravar orçamento</button></div>
          </div>
        </div>
      )}
    </>
  );
}
