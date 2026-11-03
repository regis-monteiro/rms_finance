import { useEffect, useMemo, useState } from 'react';
import { supabase, type Lancamento, type Status } from '../lib/supabase';
import { brl, diaMes, hojeISO, statusEfetivo, classeStatus, STATUS_LABEL } from '../lib/format';
import { useCadastros } from '../lib/useCadastros';
import { Cabecalho } from '../components/Layout';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const FORMAS = ['Boleto', 'PIX', 'Débito em conta', 'Transferência (TED)', 'Espécie'];
type Form = Partial<Lancamento>;

export default function Lancamentos() {
  const { contas, grupos, subgrupos } = useCadastros();
  const hoje = hojeISO();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [lista, setLista] = useState<Lancamento[]>([]);
  const [f, setF] = useState({ tipo: '', conta: '', status: '', busca: '' });
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<Form | null>(null);
  const [baixa, setBaixa] = useState<{ data: string; conta: string } | null>(null);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    const [a, m] = mes.split('-').map(Number);
    const fim = new Date(a, m, 0).getDate();
    supabase.from('lancamentos').select('*').gte('vencimento', mes + '-01').lte('vencimento', `${mes}-${fim}`).order('vencimento').order('id')
      .then(({ data }) => { setLista((data as Lancamento[]) || []); setSel(new Set()); });
  }, [mes, versao]);

  const nome = (arr: { id: number; nome: string }[], id: number | null) => arr.find(x => x.id === id)?.nome || '';
  const linhas = useMemo(() => lista.filter(l =>
    (!f.tipo || l.tipo === f.tipo) && (!f.conta || String(l.conta_id) === f.conta) &&
    (!f.status || statusEfetivo(l.status, l.vencimento) === f.status) &&
    (!f.busca || (l.favorecido + nome(grupos, l.grupo_id) + nome(subgrupos, l.subgrupo_id)).toLowerCase().includes(f.busca.toLowerCase()))
  ), [lista, f, grupos, subgrupos]);
  const ent = linhas.filter(l => l.tipo === 'entrada').reduce((a, l) => a + Number(l.valor), 0);
  const sai = linhas.filter(l => l.tipo === 'saida').reduce((a, l) => a + Number(l.valor), 0);

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    if (!form) return;
    const dados = { ...form, valor: Number(form.valor), conta_id: form.conta_id ? Number(form.conta_id) : null, grupo_id: Number(form.grupo_id), subgrupo_id: form.subgrupo_id ? Number(form.subgrupo_id) : null,
      data_pagamento: form.status === 'pago' ? (form.data_pagamento || form.vencimento) : null, atualizado_em: new Date().toISOString() };
    if (form.status === 'pago' && !dados.conta_id) { setErro('Para marcar como Pago, informe a conta.'); return; }
    const { error } = form.id ? await supabase.from('lancamentos').update(dados).eq('id', form.id) : await supabase.from('lancamentos').insert(dados);
    if (error) { setErro(error.message); return; }
    setForm(null); setVersao(v => v + 1);
  }

  async function confirmarBaixa(e: React.FormEvent) {
    e.preventDefault(); if (!baixa) return; setErro('');
    const itens = lista.filter(l => sel.has(l.id));
    for (const l of itens) {
      const conta = l.conta_id ?? (baixa.conta ? Number(baixa.conta) : null);
      if (!conta) { setErro(`"${l.favorecido}" está sem conta. Escolha uma conta para os itens sem conta.`); return; }
      const { error } = await supabase.from('lancamentos').update({ status: 'pago', data_pagamento: baixa.data, conta_id: conta, atualizado_em: new Date().toISOString() }).eq('id', l.id);
      if (error) { setErro(error.message); return; }
    }
    setBaixa(null); setVersao(v => v + 1);
  }

  async function excluir() {
    if (!form?.id) return;
    const { error } = await supabase.from('lancamentos').delete().eq('id', form.id);
    if (error) { setErro(error.message); return; }
    setForm(null); setVersao(v => v + 1);
  }

  const novo = () => { setErro(''); setForm({ tipo: 'saida', vencimento: hoje, status: 'previsto', forma_pagamento: 'Boleto', favorecido: '', valor: undefined }); };
  const subsDoGrupo = subgrupos.filter(s => s.grupo_id === Number(form?.grupo_id));
  const [ano, m] = mes.split('-').map(Number);

  return (
    <>
      <Cabecalho titulo="Lançamentos" sub="Fluxo de caixa: todas as entradas e saídas">
        <button className="btn ghost" onClick={() => setMes(`${m === 1 ? ano - 1 : ano}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`)}>‹</button>
        <span className="chip" style={{ fontSize: 13, padding: '7px 12px' }}>{MESES[m - 1]}/{ano}</span>
        <button className="btn ghost" onClick={() => setMes(`${m === 12 ? ano + 1 : ano}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`)}>›</button>
      </Cabecalho>
      <div className="card">
        <div className="filters">
          <select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}><option value="">Entradas e saídas</option><option value="entrada">Entradas</option><option value="saida">Saídas</option></select>
          <select value={f.conta} onChange={e => setF({ ...f, conta: e.target.value })}><option value="">Todas as contas</option>{contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
          <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">Todos os status</option>{Object.entries(STATUS_LABEL).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
          <input placeholder="Buscar favorecido ou grupo" value={f.busca} onChange={e => setF({ ...f, busca: e.target.value })} />
          <span style={{ flex: 1 }} />
          <button className="btn ghost" disabled={!sel.size} onClick={() => { setErro(''); setBaixa({ data: hoje, conta: '' }); }}>Baixar selecionados ({sel.size})</button>
          <button className="btn gold" onClick={novo}>+ Novo lançamento</button>
        </div>
        {linhas.length === 0 ? <div className="empty">Nenhum lançamento neste mês.</div> : (
          <table>
            <thead><tr><th className="c"><input type="checkbox" onChange={e => setSel(e.target.checked ? new Set(linhas.filter(l => l.status !== 'pago').map(l => l.id)) : new Set())} /></th>
              <th>Vencimento</th><th>Tipo</th><th>Conta</th><th>Grupo</th><th>Subgrupo</th><th>Favorecido / Pagador</th><th>Ref.</th><th className="r">Valor</th><th>Status</th></tr></thead>
            <tbody>{linhas.map(l => { const s = statusEfetivo(l.status, l.vencimento); return (
              <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => { setErro(''); setForm({ ...l }); }}>
                <td className="c" onClick={e => e.stopPropagation()}><input type="checkbox" disabled={l.status === 'pago'} checked={sel.has(l.id)} onChange={e => { const n = new Set(sel); e.target.checked ? n.add(l.id) : n.delete(l.id); setSel(n); }} /></td>
                <td>{diaMes(l.vencimento)}</td><td>{l.tipo === 'entrada' ? <span className="pos">Entrada</span> : 'Saída'}</td>
                <td>{nome(contas, l.conta_id) || <span className="tag">A definir</span>}</td><td>{nome(grupos, l.grupo_id)}</td><td>{nome(subgrupos, l.subgrupo_id) || '·'}</td>
                <td>{l.favorecido}</td><td>{l.referencia || '·'}</td>
                <td className={'r ' + (l.tipo === 'entrada' ? 'pos' : '')}>{l.tipo === 'saida' ? '−' : ''}{brl(l.valor)}</td>
                <td><span className={'st ' + classeStatus(s)}>{STATUS_LABEL[s]}</span></td>
              </tr>); })}</tbody>
          </table>
        )}
        <div className="filters" style={{ justifyContent: 'flex-end', margin: '14px 0 0', gap: 22 }}>
          <span>Entradas: <b className="pos">{brl(ent)}</b></span><span>Saídas: <b className="neg">{brl(sai)}</b></span><span>Saldo do filtro: <b>{brl(ent - sai)}</b></span>
        </div>
      </div>

      {form && (
        <div className="modal-bg open" onClick={e => e.target === e.currentTarget && setForm(null)}>
          <div className="modal"><h2>{form.id ? 'Editar lançamento' : 'Novo lançamento'}</h2>
            <form className="form" onSubmit={salvar}>
              <label>Tipo<select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value as 'entrada' | 'saida' })}><option value="saida">Saída</option><option value="entrada">Entrada</option></select></label>
              <label>Conta<select value={form.conta_id ?? ''} onChange={e => setForm({ ...form, conta_id: e.target.value ? Number(e.target.value) : null })}><option value="">A definir</option>{contas.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
              <label>Vencimento<input type="date" required value={form.vencimento} onChange={e => setForm({ ...form, vencimento: e.target.value })} /></label>
              <label>Valor (R$)<input type="number" step="0.01" min="0.01" required value={form.valor ?? ''} onChange={e => setForm({ ...form, valor: e.target.value as unknown as number })} /></label>
              <label>Grupo<select required value={form.grupo_id ?? ''} onChange={e => setForm({ ...form, grupo_id: Number(e.target.value), subgrupo_id: null })}><option value="" disabled>Selecione</option>{grupos.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select></label>
              <label>Subgrupo<select value={form.subgrupo_id ?? ''} onChange={e => setForm({ ...form, subgrupo_id: e.target.value ? Number(e.target.value) : null })}><option value="">·</option>{subsDoGrupo.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
              <label className="full">Favorecido / Pagador<input required value={form.favorecido} onChange={e => setForm({ ...form, favorecido: e.target.value })} /></label>
              <label>Referência<input placeholder="Parcela ou competência" value={form.referencia ?? ''} onChange={e => setForm({ ...form, referencia: e.target.value })} /></label>
              <label>Documento<input value={form.documento ?? ''} onChange={e => setForm({ ...form, documento: e.target.value })} /></label>
              <label>Status<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Status })}>{(['previsto', 'confirmado', 'agendado', 'pago'] as Status[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
              {form.status === 'pago'
                ? <label>Data do pagamento<input type="date" required value={form.data_pagamento ?? form.vencimento} onChange={e => setForm({ ...form, data_pagamento: e.target.value })} /></label>
                : <label>Forma de pagamento<select value={form.forma_pagamento ?? ''} onChange={e => setForm({ ...form, forma_pagamento: e.target.value })}>{FORMAS.map(x => <option key={x}>{x}</option>)}</select></label>}
              <label className="full">Observação<input value={form.observacao ?? ''} onChange={e => setForm({ ...form, observacao: e.target.value })} /></label>
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full">
                {form.id && <button type="button" className="btn ghost" style={{ marginRight: 'auto', color: 'var(--neg)' }} onClick={excluir}>Excluir</button>}
                <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancelar</button><button className="btn">Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {baixa && (
        <div className="modal-bg open" onClick={e => e.target === e.currentTarget && setBaixa(null)}>
          <div className="modal"><h2>Baixar {sel.size} lançamento(s)</h2>
            <form className="form" onSubmit={confirmarBaixa}>
              <label>Data do pagamento<input type="date" required value={baixa.data} onChange={e => setBaixa({ ...baixa, data: e.target.value })} /></label>
              <label>Conta (para itens sem conta)<select value={baixa.conta} onChange={e => setBaixa({ ...baixa, conta: e.target.value })}><option value="">Manter a do lançamento</option>{contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setBaixa(null)}>Cancelar</button><button className="btn">Confirmar baixa</button></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
