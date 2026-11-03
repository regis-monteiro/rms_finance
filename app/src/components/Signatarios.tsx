import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface Signatario { id: number; nome: string; cargo: string; tipo: 'contabilista' | 'socio'; registro: string | null; ativo: boolean }

export function useSignatarios(versao = 0) {
  const [lista, setLista] = useState<Signatario[]>([]);
  useEffect(() => { supabase.from('signatarios').select('*').order('tipo').order('nome').then(({ data }) => setLista((data as Signatario[]) || [])); }, [versao]);
  return lista;
}

export function AbaSignatarios() {
  const [versao, setVersao] = useState(0);
  const lista = useSignatarios(versao);
  const [ed, setEd] = useState<Partial<Signatario> | null>(null);
  const [erro, setErro] = useState('');
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); if (!ed) return; setErro('');
    const d = { nome: ed.nome?.trim(), cargo: ed.cargo?.trim(), tipo: ed.tipo, registro: ed.registro?.trim() || null, ativo: ed.ativo ?? true };
    const r = ed.id ? await supabase.from('signatarios').update(d).eq('id', ed.id) : await supabase.from('signatarios').insert(d);
    if (r.error) { setErro(r.error.message); return; }
    setEd(null); setVersao(v => v + 1);
  }
  return (
    <>
      <div className="filters"><span style={{ fontSize: 13, color: 'var(--muted)' }}>Quem pode assinar o DRE e o Dashboard emitidos em PDF.</span><span style={{ flex: 1 }} />
        <button className="btn gold" onClick={() => setEd({ tipo: 'contabilista', cargo: 'Contador responsável', ativo: true })}>+ Novo signatário</button></div>
      {lista.length === 0 ? <div className="empty" style={{ padding: 30 }}>Nenhum signatário cadastrado.</div> : (
        <table><thead><tr><th>Nome</th><th>Cargo</th><th>Tipo</th><th>CRC / CPF</th><th>Situação</th></tr></thead>
          <tbody>{lista.map(s => <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setEd(s)}><td><b>{s.nome}</b></td><td>{s.cargo}</td><td>{s.tipo === 'contabilista' ? 'Contabilista' : 'Sócio'}</td><td>{s.registro || '·'}</td>
            <td><span className={'st ' + (s.ativo ? 'pago' : 'venc')}>{s.ativo ? 'Ativo' : 'Inativo'}</span></td></tr>)}</tbody></table>
      )}
      {ed && (
        <div className="modal-bg open" onClick={e => e.target === e.currentTarget && setEd(null)}>
          <div className="modal"><h2>{ed.id ? 'Editar signatário' : 'Novo signatário'}</h2>
            <form className="form" onSubmit={salvar}>
              <label className="full">Nome completo<input required value={ed.nome || ''} onChange={e => setEd({ ...ed, nome: e.target.value })} /></label>
              <label>Tipo<select value={ed.tipo} onChange={e => setEd({ ...ed, tipo: e.target.value as Signatario['tipo'], cargo: e.target.value === 'socio' ? 'Sócio-diretor' : 'Contador responsável' })}><option value="contabilista">Contabilista</option><option value="socio">Sócio</option></select></label>
              <label>Cargo<input required value={ed.cargo || ''} onChange={e => setEd({ ...ed, cargo: e.target.value })} /></label>
              <label className="full">{ed.tipo === 'contabilista' ? 'CRC (ex.: CRC 1SP 000000/O-0)' : 'CPF'}<input value={ed.registro || ''} onChange={e => setEd({ ...ed, registro: e.target.value })} /></label>
              {ed.id && <label className="full" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={ed.ativo ?? true} onChange={e => setEd({ ...ed, ativo: e.target.checked })} /> Ativo</label>}
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setEd(null)}>Cancelar</button><button className="btn">Salvar</button></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
