import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ModalMovimentacao } from '../components/MovimentacaoConta';
import { supabase, type Lancamento } from '../lib/supabase';
import { useAuth, podeEditar } from '../lib/auth';
import { brl, diaMes, hojeISO, somaDias, statusEfetivo, classeStatus, STATUS_LABEL } from '../lib/format';
import { useCadastros } from '../lib/useCadastros';
import { Cabecalho } from '../components/Layout';
import { ModalEmissao } from '../components/Emissao';
import { gerarExcel, gerarPDF, type Linha, type Secao } from '../lib/relatorios';
import type { Signatario } from '../components/Signatarios';
import { carregarDRE, resultadoMensal, useLinhasDRE, linhaMensal, type PontoDRE, MESES_LONGOS } from '../lib/analises';

interface Saldo { id: number; nome: string; tipo: string; saldo: number }
interface Fatura { id: number; cartao: string; data_vencimento: string; total: number; pago: number }
const TIPO = { corrente: 'Conta corrente', aplicacao: 'Aplicação', especie: 'Espécie' } as Record<string, string>;

export default function Dashboard() {
  const { usuario } = useAuth();
  const { contas, todosGrupos: grupos } = useCadastros();
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [abertos, setAbertos] = useState<Lancamento[]>([]);
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [dre, setDre] = useState<PontoDRE[]>([]);
  const [receb, setReceb] = useState({ previsto: 0, recebido: 0, aberto: 0 });
  const linhasDre = useLinhasDRE();
  const [emitir, setEmitir] = useState(false);
  const [mov, setMov] = useState<{ id: number | null } | null>(null);
  const nav = useNavigate();
  const opera = podeEditar(usuario?.perfil);
  const ir = (url: string, rasc?: Record<string, unknown>) => { try { Object.entries(rasc || {}).forEach(([k, v]) => localStorage.setItem('rms-rascunho:' + k, JSON.stringify(v))); } catch { /* ignora */ } nav(url); };
  const [proj, setProj] = useState<{ conta_id: number; rendimento_pendente: number; irrf_pendente: number }[]>([]);
  const hoje = hojeISO(), [anoH, mesH] = hoje.split('-').map(Number), fimMes = `${hoje.slice(0, 8)}${new Date(anoH, mesH, 0).getDate()}`;

  useEffect(() => {
    supabase.from('saldos_contas').select('*').order('ordem').then(({ data }) => setSaldos((data as Saldo[]) || []));
    carregarDRE(anoH, null).then(setDre).catch(() => setDre([]));
    Promise.all([supabase.rpc('receitas_mensais', { p_ano: anoH }), supabase.from('previsoes_receita').select('valor').eq('ano', anoH).eq('mes', mesH)]).then(([a, b]) => {
      const r = ((a.data as { mes: number; recebido: number; a_receber: number }[]) || []).filter(x => x.mes === mesH);
      setReceb({ previsto: ((b.data as { valor: number }[]) || []).reduce((s, x) => s + Number(x.valor), 0), recebido: r.reduce((s, x) => s + Number(x.recebido), 0), aberto: r.reduce((s, x) => s + Number(x.a_receber), 0) });
    });
    if (podeEditar(usuario?.perfil)) {
      supabase.from('aplicacoes_projecao').select('*').then(({ data }) => setProj((data as typeof proj) || []));
      supabase.from('lancamentos').select('*').eq('tipo', 'saida').neq('status', 'pago').lte('vencimento', fimMes).order('vencimento')
        .then(({ data }) => setAbertos((data as Lancamento[]) || []));
      supabase.from('faturas_resumo').select('*').gte('data_vencimento', somaDias(hoje, -40)).order('data_vencimento')
        .then(({ data }) => setFaturas(((data as Fatura[]) || []).filter(f => f.total - f.pago > 0.004)));
    }
  }, [usuario]);

  const total = saldos.reduce((a, s) => a + Number(s.saldo), 0);
  const soma = (l: Lancamento[]) => l.reduce((a, x) => a + Number(x.valor), 0);
  const vencidos = abertos.filter(l => l.vencimento < hoje);
  const em7 = abertos.filter(l => l.vencimento >= hoje && l.vencimento <= somaDias(hoje, 7));
  const resto = abertos.filter(l => l.vencimento > somaDias(hoje, 7));
  const nomeConta = (id: number | null) => contas.find(c => c.id === id)?.nome || 'A definir';
  const nomeGrupo = (id: number) => grupos.find(g => g.id === id)?.nome || '';
  const aReceber = receb.previsto ? Math.max(0, receb.previsto - receb.recebido) : receb.aberto;

  async function emitirRelatorio(f: 'pdf' | 'xlsx', assinaturas: Signatario[]) {
    const res = resultadoMensal(dre, linhasDre, 'real'), rec = linhaMensal(dre, linhasDre.find(l => l.ordem === 10)?.id, 'real'), prev = resultadoMensal(dre, linhasDre, 'prev');
    const m = mesH - 1, acum = res.reduce((a, b) => a + b, 0);
    const posicao = hoje.split('-').reverse().join('/');
    const secoes: Secao[] = [
      { titulo: 'Saldos das contas', colunas: [{ titulo: 'Conta', chave: 'c' }, { titulo: 'Tipo', chave: 't' }, { titulo: 'Saldo', chave: 'v', tipo: 'moeda' as const }],
        linhas: [...saldos.map(x => ({ c: x.nome, t: TIPO[x.tipo], v: Number(x.saldo) })), { c: 'Saldo total', v: total, _estilo: 'total' as const }] as Linha[] },
      { titulo: `Resultado ${anoH} (realizado)`, colunas: [{ titulo: 'Mês', chave: 'm' }, { titulo: 'Receita de serviços', chave: 'r', tipo: 'moeda' as const }, { titulo: 'Resultado líquido', chave: 'l', tipo: 'moeda' as const }],
        linhas: [...MESES_LONGOS.slice(0, m + 1).map((n, i) => ({ m: n, r: rec[i], l: res[i] })), { m: 'Acumulado', r: rec.reduce((a, b) => a + b, 0), l: acum, _estilo: 'total' as const }] as Linha[] },
    ];
    if (podeEditar(usuario?.perfil)) {
      secoes.push({ titulo: 'Contas a pagar até o fim do mês', colunas: [{ titulo: 'Vencimento', chave: 'd', tipo: 'data' as const }, { titulo: 'Fornecedor / Beneficiário', chave: 'f' }, { titulo: 'Grupo', chave: 'g' }, { titulo: 'Conta', chave: 'c' }, { titulo: 'Status', chave: 's' }, { titulo: 'Valor', chave: 'v', tipo: 'moeda' as const }],
        linhas: [...abertos.map(l => ({ d: l.vencimento, f: l.favorecido, g: nomeGrupo(l.grupo_id), c: nomeConta(l.conta_id), s: STATUS_LABEL[statusEfetivo(l.status, l.vencimento)], v: Number(l.valor) })),
          { f: 'Vencidas', v: soma(vencidos), _estilo: 'sub' as const }, { f: 'Próximos 7 dias', v: soma(em7), _estilo: 'sub' as const }, { f: 'Restante do mês', v: soma(resto), _estilo: 'sub' as const }, { f: 'Total', v: soma(abertos), _estilo: 'total' as const }] as Linha[] });
      if (faturas.length) secoes.push({ titulo: 'Faturas de cartão em aberto', colunas: [{ titulo: 'Cartão', chave: 'c' }, { titulo: 'Vencimento', chave: 'd', tipo: 'data' as const }, { titulo: 'Em aberto', chave: 'v', tipo: 'moeda' as const }],
        linhas: [...faturas.map(x => ({ c: x.cartao, d: x.data_vencimento, v: x.total - x.pago })), { c: 'Total', v: faturas.reduce((a, x) => a + x.total - x.pago, 0), _estilo: 'total' as const }] as Linha[] });
    }
    const r = { titulo: 'Dashboard financeiro', arquivo: 'dashboard', usuario: usuario?.nome || usuario?.email || '', periodo: `Posição em ${posicao}`, assinaturas,
      resumo: [{ rotulo: 'Saldo total', valor: brl(total) }, { rotulo: `A receber em ${MESES_LONGOS[m].toLowerCase()}`, valor: brl(aReceber) }, { rotulo: `Resultado de ${m ? MESES_LONGOS[m - 1].toLowerCase() : '·'}`, valor: m ? brl(res[m - 1]) : '·' }, { rotulo: `Acumulado ${anoH}`, valor: brl(acum) }, { rotulo: 'Previsto até dezembro', valor: brl(prev.reduce((a, b) => a + b, 0)) }],
      secoes, observacao: 'Resultados em regime de caixa (realizado pela data de pagamento). Saldos conforme lançamentos pagos até a data de emissão.' };
    f === 'pdf' ? await gerarPDF(r) : await gerarExcel(r);
  }

  return (
    <>
      <Cabecalho titulo="Dashboard" sub={'Posição em ' + hoje.split('-').reverse().join('/')}><button className="btn" onClick={() => setEmitir(true)}>Emitir PDF / Excel</button></Cabecalho>
      {mov && <ModalMovimentacao conta={contas.find(c => c.id === mov.id) || null} contas={contas} saldoAtual={mov.id == null ? total : Number(saldos.find(x => x.id === mov.id)?.saldo || 0)} aoFechar={() => setMov(null)} />}
      {emitir && <ModalEmissao titulo="Dashboard" assinatura aoFechar={() => setEmitir(false)} aoGerar={emitirRelatorio} />}
      <div className="grid g4">
        <div className="card kpi total clicavel" title="Ver a movimentação de todas as contas" onClick={() => opera && setMov({ id: null })}><div className="lbl">Saldo total</div><div className="val">{brl(total)}</div><div className="sub">{saldos.length} contas</div></div>
        {saldos.map(s => (
          <div className="card kpi clicavel" key={s.id} title="Ver as últimas transações e o saldo dia a dia" onClick={() => opera && setMov({ id: s.id })}><div className="lbl">{s.nome}<span className="tag">{TIPO[s.tipo]}</span></div><div className="val">{brl(s.saldo)}</div>{(() => { const p = proj.find(x => x.conta_id === s.id); if (!p || (!Number(p.rendimento_pendente) && !Number(p.irrf_pendente))) return null;
            return <div className="sub" title="Saldo lançado + rendimentos ainda não lançados − IRRF projetado (retido só no resgate ou vencimento)">Líquido projetado: {brl(Number(s.saldo) + Number(p.rendimento_pendente) - Number(p.irrf_pendente))}</div>; })()}</div>
        ))}
      </div>

      {linhasDre.length > 0 && (() => {
        const res = resultadoMensal(dre, linhasDre, 'real'), rec = linhaMensal(dre, linhasDre.find(l => l.ordem === 10)?.id, 'real');
        const m = mesH - 1, ant = m === 0 ? null : m - 1;
        const resPrev = resultadoMensal(dre, linhasDre, 'prev');
        return (
          <div className="grid g5 mt">
            <div className="card kpi clicavel" title="Abrir as contas a receber em aberto" onClick={() => ir('/receber', opera ? { 'rec:aba': 'aberto' } : { 'rec:aba': 'resumo' })}><div className="lbl">A receber em {MESES_LONGOS[m].toLowerCase()}</div><div className="val">{brl(aReceber)}</div>
              <div className="sub">{receb.previsto ? `previsto ${brl(receb.previsto)} · recebido ${brl(receb.recebido)}` : 'entradas lançadas em aberto'}</div></div>
            <div className="card kpi clicavel" title="Abrir os recebimentos do mês" onClick={() => opera ? nav(`/lancamentos?mes=${hoje.slice(0, 7)}&tipo=entrada&status=pago`) : nav('/receber')}><div className="lbl">Receita recebida em {MESES_LONGOS[m].toLowerCase()}</div><div className="val">{brl(rec[m])}</div><div className="sub">até hoje</div></div>
            <div className="card kpi clicavel" title="Abrir o DRE (realizado)" onClick={() => nav('/dre?modo=real')}><div className="lbl">Resultado de {ant != null ? MESES_LONGOS[ant].toLowerCase() : '·'}</div><div className={'val ' + (ant != null && res[ant] < 0 ? 'neg' : 'pos')}>{ant != null ? brl(res[ant]) : '·'}</div><div className="sub">último mês fechado, realizado</div></div>
            <div className="card kpi clicavel" title="Abrir o DRE (realizado)" onClick={() => nav('/dre?modo=real')}><div className="lbl">Resultado acumulado {anoH}</div><div className={'val ' + (res.reduce((a, b) => a + b, 0) < 0 ? 'neg' : 'pos')}>{brl(res.reduce((a, b) => a + b, 0))}</div><div className="sub">realizado até hoje</div></div>
            <div className="card kpi clicavel" title="Abrir o fluxo de caixa projetado" onClick={() => ir('/dre', { 'dre:aba': 'fluxo' })}><div className="lbl">Resultado previsto até dezembro</div><div className="val">{brl(resPrev.reduce((a, b) => a + b, 0))}</div><div className="sub">lançamentos ainda não pagos</div></div>
          </div>);
      })()}

      {podeEditar(usuario?.perfil) && (
        <div className="grid g21 mt">
          <div className="card">
            <h3>Contas a pagar <small>Até o fim do mês</small></h3>
            <div className="grid g3" style={{ marginBottom: 14 }}>
              <div className="kpi"><div className="lbl">Vencidas</div><div className="val neg" style={{ fontSize: 18 }}>{brl(soma(vencidos))}</div><div className="sub">{vencidos.length} lançamentos</div></div>
              <div className="kpi"><div className="lbl">Próximos 7 dias</div><div className="val" style={{ fontSize: 18 }}>{brl(soma(em7))}</div><div className="sub">{em7.length} lançamentos</div></div>
              <div className="kpi"><div className="lbl">Restante do mês</div><div className="val" style={{ fontSize: 18 }}>{brl(soma(resto))}</div><div className="sub">{resto.length} lançamentos</div></div>
            </div>
            {abertos.length === 0 ? <div className="empty" style={{ padding: 24 }}>Nenhuma conta em aberto até o fim do mês.</div> : (
              <table>
                <thead><tr><th>Vencimento</th><th>Fornecedor / Beneficiário</th><th>Grupo</th><th>Conta</th><th className="r">Valor</th><th>Status</th></tr></thead>
                <tbody>{abertos.slice(0, 10).map(l => { const s = statusEfetivo(l.status, l.vencimento); return (
                  <tr key={l.id} className="clicavel" title="Abrir para baixar ou alterar" onClick={() => nav(`/lancamentos?abrir=${l.id}`)}><td>{diaMes(l.vencimento)}</td><td>{l.favorecido}</td><td>{nomeGrupo(l.grupo_id)}</td><td>{nomeConta(l.conta_id)}</td><td className="r">{brl(l.valor)}</td><td><span className={'st ' + classeStatus(s)}>{STATUS_LABEL[s]}</span></td></tr>
                ); })}</tbody>
              </table>
            )}
            <div style={{ textAlign: 'right', marginTop: 10 }}><Link to="/lancamentos" className="btn ghost" style={{ textDecoration: 'none' }}>Ver lançamentos</Link></div>
          </div>
          <div className="card">
            <h3>Cartões <small>Faturas em aberto</small></h3>
            {faturas.length === 0 ? <div className="empty" style={{ padding: 24 }}>Nenhuma fatura em aberto.</div> : (
              <table><thead><tr><th>Cartão</th><th>Venc.</th><th className="r">Em aberto</th></tr></thead>
                <tbody>{faturas.map(f => <tr key={f.id} className="clicavel" title="Abrir a fatura" onClick={() => nav(`/cartoes?fatura=${f.id}`)}><td>{f.cartao}</td><td>{diaMes(f.data_vencimento)}</td><td className="r">{brl(f.total - f.pago)}</td></tr>)}</tbody></table>
            )}
          </div>
        </div>
      )}
          </>
  );
}
