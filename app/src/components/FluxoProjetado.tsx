import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, type Lancamento } from '../lib/supabase';
import { brl, dataBR, hojeISO } from '../lib/format';
import { useCadastros } from '../lib/useCadastros';
import { GraficoLinhas, MESES_CURTOS } from '../lib/graficos';
import { usePersistente } from '../lib/rascunho';
import { useAuth } from '../lib/auth';
import { gerarExcel, gerarPDF, type Linha } from '../lib/relatorios';

/** Cada movimento projetado */
interface Mov { data: string; valor: number; tipo: 'lancado' | 'cartao' | 'estimado'; vencido?: boolean; descricao: string; grupo: string; lancId?: number; faturaId?: number }
interface Dados { saldos: { id: number; tipo: string; saldo: number }[]; abertos: Lancamento[]; rateios: { lancamento_id: number; grupo_id: number; fracao: number }[];
  faturas: { id: number; cartao: string; data_vencimento: string; total: number; pago: number }[]; compras: { fatura_id: number; grupo_id: number; valor: number }[];
  orc: { ano: number; mes: number; grupo_id: number; valor: number }[]; prevRec: { ano: number; mes: number; grupo_id: number; valor: number }[];
  realMes: { grupo_id: number | null; realizado: number }[] }
type Visao = 'mensal' | 'semanal' | 'diaria';

const r2 = (v: number) => Math.round(v * 100) / 100;
const mesDe = (iso: string) => iso.slice(0, 7);
const fimDoMes = (ym: string) => { const [a, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`; };
const somaMeses = (ym: string, k: number) => { const [a, m] = ym.split('-').map(Number); const d = new Date(a, m - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const segunda = (iso: string) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

async function todos<T>(q: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown }> }) {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) { const { data } = await q().range(i, i + 999); out.push(...((data as T[]) || [])); if (!Array.isArray(data) || data.length < 1000) return out; }
}

export default function FluxoProjetado() {
  const nav = useNavigate();
  const { usuario } = useAuth();
  const { grupos } = useCadastros();
  const hoje = hojeISO(), mes0 = mesDe(hoje), mesFim = somaMeses(mes0, 11), fim = fimDoMes(mesFim);
  const [op, setOp] = usePersistente('fluxo:opcoes', { orcamento: true, aplicacoes: false, vencidos: true, visao: 'mensal' as Visao });
  const [d, setD] = useState<Dados | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    (async () => {
      const anos = [...new Set([Number(mes0.slice(0, 4)), Number(mesFim.slice(0, 4))])];
      const [saldos, abertos, faturas, orc, prevRec, dre] = await Promise.all([
        supabase.from('saldos_contas').select('id,tipo,saldo').then(r => (r.data as Dados['saldos']) || []),
        todos<Lancamento>(() => supabase.from('lancamentos').select('*').neq('status', 'pago').is('transferencia_id', null).is('fatura_id', null).lte('vencimento', fim).order('vencimento')),
        supabase.from('faturas_resumo').select('id,cartao,data_vencimento,total,pago').lte('data_vencimento', fim).then(r => ((r.data as Dados['faturas']) || []).filter(f => Number(f.total) - Number(f.pago) > 0.004)),
        supabase.from('orcamento').select('ano,mes,grupo_id,valor').in('ano', anos).then(r => (r.data as Dados['orc']) || []),
        supabase.from('previsoes_receita').select('ano,mes,grupo_id,valor').in('ano', anos).then(r => (r.data as Dados['prevRec']) || []),
        supabase.rpc('dre_mensal', { p_ano: Number(mes0.slice(0, 4)) }).then(r => ((r.data as { grupo_id: number | null; mes: number; realizado: number }[]) || []).filter(x => x.mes === Number(mes0.slice(5, 7)))),
      ]);
      const ids = abertos.map(l => l.id), rateios: Dados['rateios'] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const r = await supabase.from('lancamento_rateios').select('lancamento_id,grupo_id,fracao').in('lancamento_id', ids.slice(i, i + 200));
        rateios.push(...((r.data as Dados['rateios']) || []));
      }
      const fids = faturas.map(f => f.id), compras: Dados['compras'] = [];
      for (let i = 0; i < fids.length; i += 100) compras.push(...(await todos<Dados['compras'][number]>(() => supabase.from('compras_cartao').select('fatura_id,grupo_id,valor').in('fatura_id', fids.slice(i, i + 100)))));
      setD({ saldos, abertos, rateios, faturas, compras, orc, prevRec, realMes: dre.map(x => ({ grupo_id: x.grupo_id, realizado: Number(x.realizado) })) });
    })().catch(e => setErro((e as Error).message));
  }, []);

  const nomeG = (id: number | null) => grupos.find(g => g.id === id)?.nome || 'Grupos restritos';

  const calc = useMemo(() => {
    if (!d) return null;
    const saldoIni = r2(d.saldos.filter(s => op.aplicacoes || s.tipo !== 'aplicacao').reduce((a, s) => a + Number(s.saldo), 0));
    const movs: Mov[] = [];
    // valor já lançado por grupo e mês, para não duplicar com o orçamento
    const lancGM = new Map<string, number>(), k = (g: number, m: string) => `${g}|${m}`;
    const somaGM = (g: number, m: string, v: number) => lancGM.set(k(g, m), r2((lancGM.get(k(g, m)) || 0) + v));
    const rat = new Map<number, Dados['rateios']>(); d.rateios.forEach(r => rat.set(r.lancamento_id, [...(rat.get(r.lancamento_id) || []), r]));
    for (const l of d.abertos) {
      const vencido = l.vencimento < hoje;
      if (vencido && !op.vencidos) continue;
      if (!op.aplicacoes && l.conta_id && d.saldos.find(s => s.id === l.conta_id)?.tipo === 'aplicacao') continue;
      const data = vencido ? hoje : l.vencimento, v = (l.tipo === 'entrada' ? 1 : -1) * Number(l.valor);
      movs.push({ data, valor: v, tipo: 'lancado', vencido, descricao: l.favorecido + (l.referencia ? ' · ' + l.referencia : ''), grupo: nomeG(l.grupo_id), lancId: l.id });
      (rat.get(l.id) || [{ grupo_id: l.grupo_id, fracao: 1 }]).forEach(r => somaGM(r.grupo_id, mesDe(data), v * Number(r.fracao)));
    }
    for (const f of d.faturas) {
      const vencido = f.data_vencimento < hoje;
      if (vencido && !op.vencidos) continue;
      const data = vencido ? hoje : f.data_vencimento, aberto = r2(Number(f.total) - Number(f.pago)), w = Number(f.total) ? aberto / Number(f.total) : 0;
      movs.push({ data, valor: -aberto, tipo: 'cartao', vencido, descricao: 'Fatura ' + f.cartao, grupo: 'Cartões', faturaId: f.id });
      d.compras.filter(c => c.fatura_id === f.id).forEach(c => somaGM(c.grupo_id, mesDe(data), -Number(c.valor) * w));
    }
    // Complemento pelo orçamento (ou previsão de receita): entra só a parte que ainda não está lançada; vale o maior
    if (op.orcamento) {
      const meses = Array.from({ length: 12 }, (_, i) => somaMeses(mes0, i));
      for (const m of meses) {
        const [a, mm] = m.split('-').map(Number);
        const gs = new Set([...d.orc.filter(o => o.ano === a && o.mes === mm).map(o => o.grupo_id), ...d.prevRec.filter(o => o.ano === a && o.mes === mm).map(o => o.grupo_id)]);
        for (const g of gs) {
          const orc = Number(d.orc.find(o => o.ano === a && o.mes === mm && o.grupo_id === g)?.valor || 0);
          const prev = Number(d.prevRec.find(o => o.ano === a && o.mes === mm && o.grupo_id === g)?.valor || 0);
          const alvo = Math.abs(prev) > Math.abs(orc) ? prev : orc;
          if (Math.abs(alvo) < 0.005 || ['Transferências', 'Pagamento de fatura'].includes(grupos.find(x => x.id === g)?.nome || '')) continue;
          const real = m === mes0 ? Number(d.realMes.find(x => x.grupo_id === g)?.realizado || 0) : 0;
          const lanc = lancGM.get(k(g, m)) || 0, sinal = alvo > 0 ? 1 : -1;
          const falta = r2(Math.max(0, Math.abs(alvo) - Math.max(0, sinal * real) - Math.max(0, sinal * lanc)));
          if (falta < 0.005) continue;
          const dia = m === mes0 ? (hoje > `${m}-15` ? hoje : `${m}-15`) : `${m}-15`;
          movs.push({ data: dia, valor: sinal * falta, tipo: 'estimado', descricao: `${Math.abs(prev) > Math.abs(orc) ? 'Previsão de receita' : 'Orçamento'}: ${nomeG(g)} (ainda não lançado)`, grupo: nomeG(g) });
        }
      }
    }
    movs.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : b.valor - a.valor));
    // Saldo dia a dia
    let saldo = saldoIni, menor = { v: saldoIni, data: hoje };
    const diario = new Map<string, number>();
    for (const m of movs) { saldo = r2(saldo + m.valor); diario.set(m.data, saldo); if (saldo < menor.v) menor = { v: saldo, data: m.data }; }
    // Agrupamento conforme a visão
    const chave = (iso: string) => (op.visao === 'mensal' ? mesDe(iso) : op.visao === 'semanal' ? segunda(iso) : iso);
    const periodos: { k: string; itens: Mov[]; entL: number; entE: number; saiL: number; saiC: number; saiE: number; saldo: number; menor: number }[] = [];
    let corrente = saldoIni;
    const todosPer = op.visao === 'mensal' ? Array.from({ length: 12 }, (_, i) => somaMeses(mes0, i)) : [...new Set(movs.map(m => chave(m.data)))];
    for (const p of todosPer) {
      const itens = movs.filter(m => chave(m.data) === p);
      let menorP = corrente;
      itens.forEach(m => { corrente = r2(corrente + m.valor); if (corrente < menorP) menorP = corrente; });
      const s = (f: (m: Mov) => boolean) => r2(itens.filter(f).reduce((a, m) => a + m.valor, 0));
      periodos.push({ k: p, itens, entL: s(m => m.tipo === 'lancado' && m.valor > 0), entE: s(m => m.tipo === 'estimado' && m.valor > 0), saiL: s(m => m.tipo === 'lancado' && m.valor < 0),
        saiC: s(m => m.tipo === 'cartao'), saiE: s(m => m.tipo === 'estimado' && m.valor < 0), saldo: corrente, menor: menorP });
    }
    // Gráfico semanal do saldo
    const semanas: string[] = []; for (let x = segunda(hoje); x <= fim; x = new Date(new Date(x + 'T12:00:00').getTime() + 7 * 86400000).toISOString().slice(0, 10)) semanas.push(x);
    let ult = saldoIni; const dias = [...diario.keys()].sort();
    const serie = semanas.map(w => { const fimSem = new Date(new Date(w + 'T12:00:00').getTime() + 6 * 86400000).toISOString().slice(0, 10); dias.filter(x => x <= fimSem).forEach(x => (ult = diario.get(x)!)); return ult; });
    const rotulos = semanas.map((w, i) => (i === 0 || w.slice(5, 7) !== semanas[i - 1].slice(5, 7) ? MESES_CURTOS[Number(w.slice(5, 7)) - 1] : ''));
    const vencidos = movs.filter(m => m.vencido);
    return { saldoIni, movs, menor, periodos, serie, rotulos, saldoFim: saldo, vencidos };
  }, [d, op, grupos]);

  const rotuloPer = (p: string) => (op.visao === 'mensal' ? `${MESES_CURTOS[Number(p.slice(5, 7)) - 1]}/${p.slice(0, 4)}` : op.visao === 'semanal' ? 'Semana de ' + dataBR(p) : dataBR(p));
  async function exportar(f: 'pdf' | 'xlsx') {
    if (!calc) return;
    const linhas: Linha[] = calc.periodos.map(p => ({ p: rotuloPer(p.k), el: p.entL, ee: p.entE, sl: p.saiL, sc: p.saiC, se: p.saiE, s: p.saldo, m: p.menor }));
    const r = { titulo: 'Fluxo de caixa projetado', arquivo: `fluxo_projetado_${hoje}`, paisagem: true, usuario: usuario?.nome || usuario?.email || '', periodo: `${dataBR(hoje)} a ${dataBR(fim)}`,
      filtros: [op.orcamento ? 'com orçamento e previsões' : 'só lançamentos', op.aplicacoes ? 'com aplicações' : 'sem aplicações', op.vencidos ? 'vencidos considerados hoje' : 'sem vencidos'].join(' · '),
      resumo: [{ rotulo: 'Saldo inicial', valor: brl(calc.saldoIni) }, { rotulo: 'Menor saldo', valor: `${brl(calc.menor.v)} em ${dataBR(calc.menor.data)}` }, { rotulo: 'Saldo final', valor: brl(calc.saldoFim) }],
      observacao: 'Projeção: lançamentos em aberto, faturas de cartão e, quando maior, o orçamento ou a previsão de receita ainda não lançados (estimados no dia 15 do mês). Transferências entre contas não entram.',
      secoes: [{ colunas: [{ titulo: 'Período', chave: 'p', largura: 34 }, { titulo: 'Entradas lançadas', chave: 'el', tipo: 'moeda' as const }, { titulo: 'Entradas estimadas', chave: 'ee', tipo: 'moeda' as const },
        { titulo: 'Saídas lançadas', chave: 'sl', tipo: 'moeda' as const }, { titulo: 'Cartões', chave: 'sc', tipo: 'moeda' as const }, { titulo: 'Saídas estimadas', chave: 'se', tipo: 'moeda' as const },
        { titulo: 'Saldo final', chave: 's', tipo: 'moeda' as const }, { titulo: 'Menor saldo', chave: 'm', tipo: 'moeda' as const }], linhas }] };
    f === 'pdf' ? await gerarPDF(r) : await gerarExcel(r);
  }

  if (erro) return <div className="err">{erro}</div>;
  if (!calc) return <div className="card"><div className="empty">Calculando a projeção…</div></div>;
  const opcao = (k: 'orcamento' | 'aplicacoes' | 'vencidos', t: string) => <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={op[k]} onChange={e => setOp({ ...op, [k]: e.target.checked })} /> {t}</label>;
  return (
    <>
      <div className="filters">
        <div className="tabs" style={{ margin: 0, border: 0 }}>{([['mensal', 'Mensal'], ['semanal', 'Semanal'], ['diaria', 'Diária']] as [Visao, string][]).map(([v, t]) => <button key={v} className={op.visao === v ? 'on' : ''} onClick={() => { setOp({ ...op, visao: v }); setAberto(null); }}>{t}</button>)}</div>
        {opcao('orcamento', 'Orçamento e previsões de receita')}{opcao('vencidos', 'Vencidos em aberto (como se fossem hoje)')}{opcao('aplicacoes', 'Incluir aplicações')}
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => exportar('xlsx')}>Excel</button><button className="btn" onClick={() => exportar('pdf')}>PDF</button>
      </div>
      <div className="grid g4">
        <div className="card kpi total"><div className="lbl">Saldo hoje</div><div className="val">{brl(calc.saldoIni)}</div><div className="sub">{op.aplicacoes ? 'todas as contas' : 'sem as aplicações'}</div></div>
        <div className="card kpi"><div className="lbl">Menor saldo projetado</div><div className={'val ' + (calc.menor.v < 0 ? 'neg' : '')}>{brl(calc.menor.v)}</div><div className="sub">em {dataBR(calc.menor.data)}</div></div>
        <div className="card kpi"><div className="lbl">Saldo em {dataBR(fim)}</div><div className={'val ' + (calc.saldoFim < 0 ? 'neg' : 'pos')}>{brl(calc.saldoFim)}</div></div>
        <div className="card kpi"><div className="lbl">Vencidos em aberto</div><div className="val">{brl(calc.vencidos.reduce((a, m) => a + m.valor, 0))}</div><div className="sub">{calc.vencidos.length} item(ns){op.vencidos ? ', considerados hoje' : ', fora da projeção'}</div></div>
      </div>
      <div className="card mt"><h3>Saldo projetado <small>fim de cada semana</small></h3>
        <GraficoLinhas series={[{ nome: 'Saldo projetado', dados: calc.serie, cor: '#0B162C' }]} rotulos={calc.rotulos} altura={220} />
      </div>
      <div className="card mt" style={{ overflowX: 'auto' }}>
        <table className="compacta">
          <thead><tr><th>Período</th><th className="r">Entradas lançadas</th><th className="r">Entradas estimadas</th><th className="r">Saídas lançadas</th><th className="r">Cartões</th><th className="r">Saídas estimadas</th><th className="r">Saldo final</th><th className="r">Menor saldo</th></tr></thead>
          <tbody>{calc.periodos.map(p => (
            <Fragment key={p.k}>
              <tr className="clicavel" onClick={() => setAberto(aberto === p.k ? null : p.k)}>
                <td>{aberto === p.k ? '▾ ' : '▸ '}{rotuloPer(p.k)}</td><td className="r pos">{p.entL ? brl(p.entL) : '·'}</td><td className="r pos">{p.entE ? brl(p.entE) : '·'}</td>
                <td className="r neg">{p.saiL ? brl(p.saiL) : '·'}</td><td className="r neg">{p.saiC ? brl(p.saiC) : '·'}</td><td className="r neg">{p.saiE ? brl(p.saiE) : '·'}</td>
                <td className={'r ' + (p.saldo < 0 ? 'neg' : '')} style={{ fontWeight: 700 }}>{brl(p.saldo)}</td><td className={'r ' + (p.menor < 0 ? 'neg' : '')}>{brl(p.menor)}</td></tr>
              {aberto === p.k && p.itens.map((m, i) => (
                <tr key={i} className={m.lancId || m.faturaId ? 'clicavel' : ''} style={{ fontSize: 12.5, color: 'var(--muted)' }}
                  onClick={() => (m.lancId ? nav(`/lancamentos?abrir=${m.lancId}`) : m.faturaId ? nav(`/cartoes?fatura=${m.faturaId}`) : undefined)}>
                  <td style={{ paddingLeft: 26 }}>{dataBR(m.data)}{m.vencido && <span className="tag" style={{ marginLeft: 6 }}>vencido</span>}</td>
                  <td colSpan={5}>{m.descricao}{m.tipo === 'estimado' && <span className="tag" style={{ marginLeft: 6 }}>estimado</span>}<span style={{ marginLeft: 8 }}>{m.grupo}</span></td>
                  <td className={'r ' + (m.valor < 0 ? 'neg' : 'pos')}>{brl(m.valor)}</td><td /></tr>))}
            </Fragment>))}</tbody>
        </table>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>
          Parte do saldo de hoje e soma os lançamentos em aberto (previstos, confirmados e agendados) e as faturas de cartão. Com orçamento, cada grupo recebe, no mês, a diferença entre o orçado (ou a previsão de receita, o que for maior) e o que já está lançado ou realizado, sem duplicar; esse complemento é estimado no dia 15. Transferências entre contas não entram. Clique num período para ver os itens e num item para abri-lo.
        </p>
      </div>
    </>
  );
}
