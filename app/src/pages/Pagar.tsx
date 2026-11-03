import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, type Lancamento } from '../lib/supabase';
import { brl, dataBR, diaMes, hojeISO, somaDias, statusEfetivo, classeStatus, STATUS_LABEL } from '../lib/format';
import { useCadastros } from '../lib/useCadastros';
import { sincronizarFatura } from '../lib/faturas';
import { Cabecalho } from '../components/Layout';

const SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export default function Pagar() {
  const { contas, grupos, subgrupos } = useCadastros();
  const hoje = hojeISO();
  const [lista, setLista] = useState<Lancamento[]>([]);
  const [f, setF] = useState({ per: 'mes', conta: '', grupo: '', status: '' });
  const [baixa, setBaixa] = useState<{ l: Lancamento; data: string; conta: string; valor: string; juros: string } | null>(null);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    supabase.from('lancamentos').select('*').eq('tipo', 'saida').neq('status', 'pago').order('vencimento').order('id')
      .then(({ data }) => setLista((data as Lancamento[]) || []));
  }, [versao]);

  const fimMes = (() => { const [a, m] = hoje.split('-').map(Number); return `${hoje.slice(0, 7)}-${new Date(a, m, 0).getDate()}`; })();
  const limite = f.per === '7' ? somaDias(hoje, 7) : f.per === 'mes' ? fimMes : '9999-12-31';
  const nome = (arr: { id: number; nome: string }[], id: number | null) => arr.find(x => x.id === id)?.nome || '';
  const linhas = useMemo(() => lista.filter(l => l.vencimento <= limite &&
    (!f.conta || (f.conta === 'sem' ? !l.conta_id : String(l.conta_id) === f.conta)) &&
    (!f.grupo || String(l.grupo_id) === f.grupo) && (!f.status || statusEfetivo(l.status, l.vencimento) === f.status)), [lista, f, limite]);

  const soma = (a: Lancamento[]) => a.reduce((s, l) => s + Number(l.valor), 0);
  const vencidas = lista.filter(l => l.vencimento < hoje);
  const hojeL = lista.filter(l => l.vencimento === hoje);
  const sete = lista.filter(l => l.vencimento > hoje && l.vencimento <= somaDias(hoje, 7));
  const dias: [string, Lancamento[]][] = [];
  linhas.forEach(l => { const u = dias[dias.length - 1]; u && u[0] === l.vencimento ? u[1].push(l) : dias.push([l.vencimento, [l]]); });

  async function confirmar(e: React.FormEvent) {
    e.preventDefault(); if (!baixa) return; setErro('');
    const { l } = baixa, valor = Number(baixa.valor), juros = Number(baixa.juros || 0);
    if (!baixa.conta) { setErro('Informe a conta do pagamento.'); return; }
    if (valor <= 0 || valor > Number(l.valor) + 0.004) { setErro('O valor pago deve ser maior que zero e até ' + brl(l.valor) + '.'); return; }
    const agora = new Date().toISOString(), conta_id = Number(baixa.conta);
    const parcial = valor < Number(l.valor) - 0.004;
    if (parcial && !l.fatura_id) {
      // pagamento parcial: baixa o valor pago e deixa o restante em aberto
      const { id, ...resto } = l;
      const r1 = await supabase.from('lancamentos').insert({ ...resto, valor, status: 'pago', conta_id, data_pagamento: baixa.data, observacao: [l.observacao, 'pagamento parcial'].filter(Boolean).join('; '), atualizado_em: agora });
      if (r1.error) { setErro(r1.error.message); return; }
      await supabase.from('lancamentos').update({ valor: Math.round((Number(l.valor) - valor) * 100) / 100, atualizado_em: agora }).eq('id', id);
    } else if (l.fatura_id) {
      const { data: g } = await supabase.from('grupos').select('id').eq('nome', 'Pagamento de fatura').single();
      const r = await supabase.from('lancamentos').insert({ tipo: 'saida', conta_id, vencimento: l.vencimento, data_pagamento: baixa.data, grupo_id: g!.id, favorecido: l.favorecido, referencia: l.referencia, valor, status: 'pago', fatura_id: l.fatura_id });
      if (r.error) { setErro(r.error.message); return; }
      await sincronizarFatura(l.fatura_id);
    } else {
      const r = await supabase.from('lancamentos').update({ status: 'pago', conta_id, data_pagamento: baixa.data, atualizado_em: agora }).eq('id', l.id);
      if (r.error) { setErro(r.error.message); return; }
    }
    if (juros > 0) {
      const g = grupos.find(x => x.nome === 'Juros Bancários');
      await supabase.from('lancamentos').insert({ tipo: 'saida', conta_id, vencimento: baixa.data, data_pagamento: baixa.data, grupo_id: g!.id, favorecido: l.favorecido, referencia: 'Juros/multa: ' + (l.referencia || dataBR(l.vencimento)), valor: juros, status: 'pago' });
    }
    setBaixa(null); setVersao(v => v + 1);
  }

  return (
    <>
      <Cabecalho titulo="Contas a pagar" sub="Saídas em aberto, uma a uma, incluindo saldos de faturas de cartão" />
      <div className="grid g4">
        <div className="card kpi"><div className="lbl">Vencidas</div><div className="val neg">{brl(soma(vencidas))}</div><div className="sub">{vencidas.length} itens</div></div>
        <div className="card kpi"><div className="lbl">Vencem hoje</div><div className="val">{brl(soma(hojeL))}</div><div className="sub">{hojeL.length} itens</div></div>
        <div className="card kpi"><div className="lbl">Próximos 7 dias</div><div className="val">{brl(soma(sete))}</div><div className="sub">{sete.length} itens</div></div>
        <div className="card kpi total"><div className="lbl">Total no filtro</div><div className="val">{brl(soma(linhas))}</div><div className="sub">{linhas.length} itens</div></div>
      </div>
      <div className="card mt">
        <div className="filters">
          <select value={f.per} onChange={e => setF({ ...f, per: e.target.value })}><option value="7">Até 7 dias</option><option value="mes">Até o fim do mês</option><option value="tudo">Tudo em aberto</option></select>
          <select value={f.conta} onChange={e => setF({ ...f, conta: e.target.value })}><option value="">Todas as contas</option>{contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}<option value="sem">Conta a definir</option></select>
          <select value={f.grupo} onChange={e => setF({ ...f, grupo: e.target.value })}><option value="">Todos os grupos</option>{grupos.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select>
          <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">Todos os status</option>{(['vencido', 'previsto', 'confirmado', 'agendado'] as const).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
        </div>
        {dias.length === 0 ? <div className="empty">Nada em aberto neste filtro.</div> : (
          <table>
            <thead><tr><th>Vencimento</th><th>Favorecido</th><th>Grupo</th><th>Subgrupo</th><th>Conta</th><th>Ref.</th><th className="r">Valor</th><th>Status</th><th className="r">Ação</th></tr></thead>
            <tbody>{dias.map(([d, ls]) => [
              <tr key={d}><td colSpan={9} style={{ background: '#FBF9F3', fontWeight: 600, fontSize: 12.5, color: 'var(--navy)' }}>
                {dataBR(d)} · {SEMANA[new Date(d + 'T12:00:00').getDay()]}<span style={{ float: 'right' }}>{brl(soma(ls))}</span></td></tr>,
              ...ls.map(l => { const s = statusEfetivo(l.status, l.vencimento); return (
                <tr key={l.id}>
                  <td>{diaMes(l.vencimento)}</td><td>{l.favorecido}{l.observacao && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{l.observacao}</div>}</td>
                  <td>{nome(grupos, l.grupo_id)}</td><td>{nome(subgrupos, l.subgrupo_id) || '·'}</td>
                  <td>{nome(contas, l.conta_id) || <span className="tag">A definir</span>}</td><td>{l.referencia || '·'}</td>
                  <td className="r">{brl(l.valor)}</td><td><span className={'st ' + classeStatus(s)}>{STATUS_LABEL[s]}</span></td>
                  <td className="r" style={{ whiteSpace: 'nowrap' }}>
                    {l.fatura_id && <Link to={'/cartoes?fatura=' + l.fatura_id} className="btn ghost" style={{ padding: '4px 10px', textDecoration: 'none', marginRight: 6 }}>Fatura</Link>}
                    <button className="btn ghost" style={{ padding: '4px 10px' }} onClick={() => { setErro(''); setBaixa({ l, data: hoje, conta: l.conta_id ? String(l.conta_id) : '', valor: String(l.valor), juros: '' }); }}>Baixar</button>
                  </td>
                </tr>); })])}</tbody>
          </table>
        )}
      </div>

      {baixa && (
        <div className="modal-bg open" onClick={e => e.target === e.currentTarget && setBaixa(null)}>
          <div className="modal"><h2>Baixar pagamento</h2>
            <p style={{ margin: '-6px 0 14px', color: 'var(--muted)' }}>{baixa.l.favorecido} · vencimento {dataBR(baixa.l.vencimento)} · {brl(baixa.l.valor)}</p>
            <form className="form" onSubmit={confirmar}>
              <label>Data do pagamento<input type="date" required value={baixa.data} onChange={e => setBaixa({ ...baixa, data: e.target.value })} /></label>
              <label>Conta<select required value={baixa.conta} onChange={e => setBaixa({ ...baixa, conta: e.target.value })}><option value="" disabled>Selecione</option>{contas.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
              <label>Valor pago (R$)<input type="number" step="0.01" min="0.01" required value={baixa.valor} onChange={e => setBaixa({ ...baixa, valor: e.target.value })} /></label>
              <label>Juros / multa (R$)<input type="number" step="0.01" min="0" value={baixa.juros} onChange={e => setBaixa({ ...baixa, juros: e.target.value })} /></label>
              <p className="full" style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Valor menor que o total registra pagamento parcial; a diferença continua em aberto. Juros e multa entram como lançamento separado em Juros Bancários.</p>
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setBaixa(null)}>Cancelar</button><button className="btn">Confirmar baixa</button></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
