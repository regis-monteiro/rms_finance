import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, type Lancamento } from '../lib/supabase';
import { useAuth, podeEditar } from '../lib/auth';
import { brl, diaMes, hojeISO, somaDias, statusEfetivo, classeStatus, STATUS_LABEL } from '../lib/format';
import { useCadastros } from '../lib/useCadastros';
import { Cabecalho } from '../components/Layout';

interface Saldo { id: number; nome: string; tipo: string; saldo: number }
interface Fatura { id: number; cartao: string; data_vencimento: string; total: number; pago: number }
const TIPO = { corrente: 'Conta corrente', aplicacao: 'Aplicação', especie: 'Espécie' } as Record<string, string>;

export default function Dashboard() {
  const { usuario } = useAuth();
  const { contas, grupos } = useCadastros();
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [abertos, setAbertos] = useState<Lancamento[]>([]);
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const hoje = hojeISO(), fimMes = hoje.slice(0, 8) + '31';

  useEffect(() => {
    supabase.from('saldos_contas').select('*').order('ordem').then(({ data }) => setSaldos((data as Saldo[]) || []));
    if (podeEditar(usuario?.perfil)) {
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

  return (
    <>
      <Cabecalho titulo="Dashboard" sub={'Posição em ' + hoje.split('-').reverse().join('/')} />
      <div className="grid g4">
        <div className="card kpi total"><div className="lbl">Saldo total</div><div className="val">{brl(total)}</div><div className="sub">{saldos.length} contas</div></div>
        {saldos.map(s => (
          <div className="card kpi" key={s.id}><div className="lbl">{s.nome}<span className="tag">{TIPO[s.tipo]}</span></div><div className="val">{brl(s.saldo)}</div></div>
        ))}
      </div>

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
                <thead><tr><th>Vencimento</th><th>Favorecido</th><th>Grupo</th><th>Conta</th><th className="r">Valor</th><th>Status</th></tr></thead>
                <tbody>{abertos.slice(0, 10).map(l => { const s = statusEfetivo(l.status, l.vencimento); return (
                  <tr key={l.id}><td>{diaMes(l.vencimento)}</td><td>{l.favorecido}</td><td>{nomeGrupo(l.grupo_id)}</td><td>{nomeConta(l.conta_id)}</td><td className="r">{brl(l.valor)}</td><td><span className={'st ' + classeStatus(s)}>{STATUS_LABEL[s]}</span></td></tr>
                ); })}</tbody>
              </table>
            )}
            <div style={{ textAlign: 'right', marginTop: 10 }}><Link to="/lancamentos" className="btn ghost" style={{ textDecoration: 'none' }}>Ver lançamentos</Link></div>
          </div>
          <div className="card">
            <h3>Cartões <small>Faturas em aberto</small></h3>
            {faturas.length === 0 ? <div className="empty" style={{ padding: 24 }}>Nenhuma fatura em aberto.</div> : (
              <table><thead><tr><th>Cartão</th><th>Venc.</th><th className="r">Em aberto</th></tr></thead>
                <tbody>{faturas.map(f => <tr key={f.id}><td>{f.cartao}</td><td>{diaMes(f.data_vencimento)}</td><td className="r">{brl(f.total - f.pago)}</td></tr>)}</tbody></table>
            )}
          </div>
        </div>
      )}
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 16 }}>Projeção de saldo, contas a receber e resultado entram nas próximas etapas, junto com essas telas.</p>
    </>
  );
}
