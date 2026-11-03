import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth, podeEditar } from '../lib/auth';
import { useCadastros } from '../lib/useCadastros';
import { brl } from '../lib/format';
import { useAnos, MESES_LONGOS } from '../lib/analises';
import { GraficoBarras, MESES_CURTOS } from '../lib/graficos';
import { Cabecalho } from '../components/Layout';

interface Rec { grupo_id: number; mes: number; recebido: number; a_receber: number }
interface Prev { grupo_id: number; mes: number; valor: number }

export default function Receber() {
  const { usuario } = useAuth();
  const edita = podeEditar(usuario?.perfil);
  const { grupos } = useCadastros();
  const anos = useAnos();
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [rec, setRec] = useState<Rec[]>([]);
  const [prev, setPrev] = useState<Prev[]>([]);
  const [recAnt, setRecAnt] = useState<Rec[]>([]);
  const [gerar, setGerar] = useState<{ base: 'anterior' | 'media'; reajuste: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    supabase.rpc('receitas_mensais', { p_ano: ano }).then(({ data }) => setRec((data as Rec[]) || []));
    supabase.rpc('receitas_mensais', { p_ano: ano - 1 }).then(({ data }) => setRecAnt((data as Rec[]) || []));
    supabase.from('previsoes_receita').select('grupo_id,mes,valor').eq('ano', ano).then(({ data }) => setPrev((data as Prev[]) || []));
  }, [ano, versao]);

  const gruposRec = useMemo(() => grupos.filter(g => g.natureza === 'receita'), [grupos]);
  const val = (arr: { grupo_id: number; mes: number }[], g: number, m: number, campo: string) =>
    arr.filter(x => x.grupo_id === g && x.mes === m).reduce((a, x) => a + Number((x as unknown as Record<string, number>)[campo]), 0);
  const linhas = gruposRec.map(g => ({ g, previsto: val(prev, g.id, mes, 'valor'), recebido: val(rec, g.id, mes, 'recebido'), aberto: val(rec, g.id, mes, 'a_receber') }));
  const tp = linhas.reduce((a, l) => a + l.previsto, 0), tr = linhas.reduce((a, l) => a + l.recebido, 0), ta = linhas.reduce((a, l) => a + l.aberto, 0);
  const anual = MESES_CURTOS.map((r, i) => ({ rotulo: r, a: prev.filter(p => p.mes === i + 1).reduce((s, p) => s + Number(p.valor), 0) || null, b: rec.filter(x => x.mes === i + 1).reduce((s, x) => s + Number(x.recebido), 0) || null }));
  const p100 = (a: number, b: number) => (b ? (a / b * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '·');

  async function salvarPrev(grupo_id: number, valor: number) {
    const { error } = await supabase.from('previsoes_receita').upsert({ ano, mes, grupo_id, valor }, { onConflict: 'ano,mes,grupo_id' });
    setMsg(error ? 'Erro: ' + error.message : 'Previsão salva'); setTimeout(() => setMsg(''), 2000); setVersao(v => v + 1);
  }

  async function gerarAno(e: React.FormEvent) {
    e.preventDefault(); if (!gerar) return;
    const fator = 1 + Number(gerar.reajuste || 0) / 100;
    const ultimoMes = ano === hoje.getFullYear() ? hoje.getMonth() : 12; // meses fechados do ano
    const registros = gruposRec.flatMap(g => MESES_CURTOS.map((_, i) => {
      let base = 0;
      if (gerar.base === 'anterior') base = val(recAnt, g.id, i + 1, 'recebido');
      else { const meses = Array.from({ length: ultimoMes }, (_, k) => val(rec, g.id, k + 1, 'recebido')); base = meses.length ? meses.reduce((a, b) => a + b, 0) / meses.length : 0; }
      return { ano, mes: i + 1, grupo_id: g.id, valor: Math.round(base * fator * 100) / 100 };
    }));
    const { error } = await supabase.from('previsoes_receita').upsert(registros, { onConflict: 'ano,mes,grupo_id' });
    setMsg(error ? 'Erro: ' + error.message : 'Previsão do ano gerada'); setTimeout(() => setMsg(''), 2500);
    setGerar(null); setVersao(v => v + 1);
  }

  return (
    <>
      <Cabecalho titulo="Contas a receber" sub="Controle sintético por grupo de receita: previsto x recebido">{msg && <span className={msg.startsWith('Erro') ? 'err' : 'ok'}>{msg}</span>}</Cabecalho>
      <div className="filters">
        <select value={mes} onChange={e => setMes(Number(e.target.value))}>{MESES_LONGOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        <select value={ano} onChange={e => setAno(Number(e.target.value))}>{anos.map(a => <option key={a}>{a}</option>)}</select>
        <span style={{ flex: 1 }} />
        {edita && <button className="btn ghost" onClick={() => setGerar({ base: recAnt.length ? 'anterior' : 'media', reajuste: '0' })}>Gerar previsão do ano</button>}
      </div>
      <div className="grid g4">
        <div className="card kpi"><div className="lbl">Previsto no mês</div><div className="val">{brl(tp)}</div></div>
        <div className="card kpi"><div className="lbl">Recebido</div><div className="val pos">{brl(tr)}</div></div>
        <div className="card kpi"><div className="lbl">Lançado a receber</div><div className="val">{brl(ta)}</div><div className="sub">entradas ainda não baixadas</div></div>
        <div className="card kpi total"><div className="lbl">Realizado</div><div className="val">{p100(tr, tp)}</div><div className="sub">do previsto</div></div>
      </div>
      <div className="grid g21 mt">
        <div className="card"><h3>Por grupo de receita <small>{MESES_LONGOS[mes - 1]}/{ano}{edita ? ' · previsão editável' : ''}</small></h3>
          <table><thead><tr><th>Grupo</th><th className="r">Previsto</th><th className="r">Recebido</th><th className="r">Diferença R$</th><th className="r">Realizado</th><th style={{ width: '24%' }} /></tr></thead>
            <tbody>{linhas.map(({ g, previsto, recebido }) => { const d = recebido - previsto, p = previsto ? recebido / previsto : 0; return (
              <tr key={g.id}><td>{g.nome}</td>
                <td className="r">{edita ? <input type="number" step="0.01" key={`${g.id}-${mes}-${ano}-${previsto}`} defaultValue={previsto || ''} placeholder="0" style={{ width: 120, textAlign: 'right' }}
                  onBlur={e => Number(e.target.value || 0) !== previsto && salvarPrev(g.id, Number(e.target.value || 0))} /> : brl(previsto)}</td>
                <td className="r">{brl(recebido)}</td><td className={'r ' + (d >= 0 ? 'pos' : 'neg')}>{d >= 0 ? '+' : '−'}{brl(Math.abs(d))}</td>
                <td className="r">{p100(recebido, previsto)}</td><td><div className="bar"><i style={{ width: Math.min(100, p * 100) + '%' }} /></div></td></tr>); })}
              <tr style={{ fontWeight: 700, background: '#FBF9F3' }}><td>Total</td><td className="r">{brl(tp)}</td><td className="r">{brl(tr)}</td><td className={'r ' + (tr - tp >= 0 ? 'pos' : 'neg')}>{tr - tp >= 0 ? '+' : '−'}{brl(Math.abs(tr - tp))}</td><td className="r">{p100(tr, tp)}</td><td /></tr>
            </tbody></table>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>O recebido vem dos lançamentos de entrada com status Pago, pela data de pagamento.</p>
        </div>
        <div className="card"><h3>Ano {ano} <small>previsto x recebido</small></h3><GraficoBarras itens={anual} nomes={['Previsto', 'Recebido']} altura={300} largura={440} /></div>
      </div>

      {gerar && (
        <div className="modal-bg open" onClick={e => e.target === e.currentTarget && setGerar(null)}>
          <div className="modal"><h2>Gerar previsão de {ano}</h2>
            <form className="form" onSubmit={gerarAno}>
              <label className="full">Base<select value={gerar.base} onChange={e => setGerar({ ...gerar, base: e.target.value as 'anterior' | 'media' })}>
                <option value="anterior">Recebido no mesmo mês de {ano - 1}{recAnt.length ? '' : ' (sem dados)'}</option>
                <option value="media">Média mensal recebida em {ano} até o mês anterior</option></select></label>
              <label>Reajuste (%)<input type="number" step="0.1" value={gerar.reajuste} onChange={e => setGerar({ ...gerar, reajuste: e.target.value })} /></label>
              <p className="full" style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Substitui a previsão dos 12 meses de {ano} para todos os grupos de receita. Depois, cada valor pode ser ajustado na tabela.</p>
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setGerar(null)}>Cancelar</button><button className="btn">Gerar</button></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
