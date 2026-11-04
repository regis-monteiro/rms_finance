import { useState } from 'react';
import DataBR from './DataBR';
import type { Conta, Lancamento } from '../lib/supabase';
import { brl } from '../lib/format';
import { bloqueioExclusao, excluirContas, registrarPagamento } from '../lib/titulos';

/** Barra que aparece quando há itens marcados, com as ações disponíveis */
export function BarraSelecao({ n, total, aoLimpar, children }: { n: number; total?: number; aoLimpar: () => void; children: React.ReactNode }) {
  if (!n) return null;
  return (
    <div className="barra-sel" style={{ position: 'sticky', top: 8, zIndex: 5, boxShadow: '0 4px 14px rgba(11,22,44,.12)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: 'var(--gold-soft)', border: '1px solid var(--gold)', borderRadius: 8, padding: '8px 12px', margin: '0 0 12px' }}>
      <b style={{ fontSize: 13, color: 'var(--navy)' }}>{n} selecionada(s){total != null && ` · ${brl(total)}`}</b>
      <span style={{ flex: 1 }} />
      {children}
      <button className="btn ghost mini" onClick={aoLimpar}>Limpar seleção</button>
    </div>
  );
}

/** Confirmação de exclusão de contas em aberto */
export function ModalExcluirContas({ itens, aoFechar, aoConcluir }: { itens: Lancamento[]; aoFechar: () => void; aoConcluir: (msg: string, falhas: string[]) => void }) {
  const [proc, setProc] = useState(false);
  const bloqueados = itens.filter(l => bloqueioExclusao(l));
  const livres = itens.length - bloqueados.length;
  async function excluir() {
    setProc(true);
    const r = await excluirContas(itens);
    setProc(false);
    aoConcluir(`${r.n} conta(s) excluída(s).`, r.falhas);
  }
  return (
    <div className="modal-bg open">
      <div className="modal" style={{ maxWidth: 560 }}><h2>Excluir {itens.length} conta(s)?</h2>
        <p style={{ fontSize: 13 }}>Total: <b>{brl(itens.reduce((a, l) => a + Number(l.valor), 0))}</b>. A exclusão não pode ser desfeita.</p>
        {bloqueados.length > 0 && <div className="err" style={{ fontSize: 12.5 }}>Não serão excluídas:<ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {bloqueados.slice(0, 8).map(l => <li key={l.id}>{l.favorecido}: {bloqueioExclusao(l)}</li>)}{bloqueados.length > 8 && <li>e mais {bloqueados.length - 8}</li>}</ul></div>}
        <div className="actions">
          <button className="btn ghost" onClick={aoFechar}>Cancelar</button>
          <button className="btn" style={{ background: 'var(--neg)', borderColor: 'var(--neg)' }} disabled={proc || !livres} onClick={excluir}>{proc ? 'Excluindo…' : `Excluir ${livres}`}</button>
        </div>
      </div>
    </div>
  );
}

/** Baixa de várias contas pelo valor integral, numa data e conta */
export function ModalBaixarVarias({ itens, contas, hoje, entrada, aoFechar, aoConcluir }: { itens: Lancamento[]; contas: Conta[]; hoje: string; entrada?: boolean; aoFechar: () => void; aoConcluir: (ids: number[], msg: string) => void }) {
  const [data, setData] = useState(hoje);
  const [conta, setConta] = useState('');
  const [erro, setErro] = useState('');
  const [proc, setProc] = useState(false);
  const validos = itens.filter(l => !l.fatura_id && !l.transferencia_id);
  async function confirmar(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    const semConta = validos.filter(l => !l.conta_id);
    if (semConta.length && !conta) { setErro(`${semConta.length} conta(s) sem conta bancária definida. Escolha a conta para elas.`); return; }
    setProc(true);
    const ids: number[] = []; const falhas: string[] = [];
    for (const l of validos) {
      const r = await registrarPagamento(l, Number(l.valor), data, conta ? Number(conta) : l.conta_id!);
      if (r.erro) falhas.push(`${l.favorecido}: ${r.erro}`); else if (r.id) ids.push(r.id);
    }
    setProc(false);
    aoConcluir(ids, `${ids.length} conta(s) baixada(s).` + (falhas.length ? ' Não baixadas: ' + falhas.join(' · ') : ''));
  }
  return (
    <div className="modal-bg open">
      <div className="modal"><h2>Baixar {validos.length} conta(s)</h2>
        <form className="form" onSubmit={confirmar}>
          <label>{entrada ? 'Data do recebimento' : 'Data do pagamento'}<DataBR required value={data} onChange={e => setData(e.target.value)} /></label>
          <label>Conta<select value={conta} onChange={e => setConta(e.target.value)}><option value="">Manter a de cada lançamento</option>{contas.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
          <p className="full" style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
            Total: {brl(validos.reduce((a, l) => a + Number(l.valor), 0))}, pelo valor integral de cada conta. Para pagamento parcial ou multa/juros, baixe uma conta por vez.
            {itens.length > validos.length && ` ${itens.length - validos.length} item(ns) de fatura de cartão ou transferência ficam de fora.`}</p>
          {erro && <div className="err full">{erro}</div>}
          <div className="actions full"><button type="button" className="btn ghost" onClick={aoFechar}>Cancelar</button><button className="btn" disabled={proc || !validos.length}>{proc ? 'Baixando…' : 'Confirmar baixa'}</button></div>
        </form>
      </div>
    </div>
  );
}
