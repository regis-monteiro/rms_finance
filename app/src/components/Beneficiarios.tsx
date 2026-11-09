import { useMemo, useState } from 'react';
import { formatarTelefone, lerTelefones, telefonePrincipal, telefoneValido, type Telefone } from '../lib/telefone';
import { supabase, type Beneficiario, type Grupo, type Subgrupo } from '../lib/supabase';
import { usePersistente, limparRascunhos } from '../lib/rascunho';
import { ImportarCadastro } from './ImportarCadastro';
import { BarraSelecao } from './AcoesSelecao';
import { documentoValido, formatarCep, formatarDocumento, soDigitos, tipoPessoa } from '../lib/documento';

/** Exclui cadastros sem lançamentos; os que têm lançamentos ou lotes vinculados são mantidos */
export async function excluirBeneficiarios(ids: number[]) {
  const excluidos: number[] = [], emUso: number[] = [], falhas: string[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    await Promise.all(ids.slice(i, i + 10).map(async id => {
      const { error } = await supabase.from('beneficiarios').delete().eq('id', id);
      if (!error) excluidos.push(id); else if (error.code === '23503') emUso.push(id); else falhas.push(error.message);
    }));
  }
  return { excluidos, emUso, falhas };
}

const PIX = { cpf_cnpj: 'CPF/CNPJ', email: 'E-mail', telefone: 'Telefone', aleatoria: 'Chave aleatória' } as Record<string, string>;
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
type Form = Partial<Beneficiario>;

export function FormBeneficiario({ inicial, grupos, subgrupos, aoSalvar: salvo, aoFechar: fechar, aoExcluir, rascunho = 'benef:form' }: {
  inicial: Form; grupos: Grupo[]; subgrupos: Subgrupo[]; aoSalvar: (b: Beneficiario) => void; aoFechar: () => void; aoExcluir?: () => void; rascunho?: string;
}) {
  const [f, setF] = usePersistente<Form>(rascunho, () => ({ ...inicial, documento: inicial.documento ? formatarDocumento(inicial.documento) : '', telefones: lerTelefones(inicial.telefones, inicial.telefone) }));
  const aoFechar = () => { limparRascunhos(rascunho); fechar(); };
  const aoSalvar = (b: Beneficiario) => { limparRascunhos(rascunho); salvo(b); };
  const [erro, setErro] = useState('');
  const set = (k: keyof Beneficiario, v: unknown) => setF(x => ({ ...x, [k]: v }));
  const docOk = documentoValido(f.documento || '');
  const [confExcluir, setConfExcluir] = useState(false);
  async function excluir() {
    setConfExcluir(false); setErro('');
    const r = await excluirBeneficiarios([f.id!]);
    if (r.emUso.length) { setErro('Este cadastro tem lançamentos vinculados e não pode ser excluído. Para tirá-lo das listas, desmarque "Ativo" e salve.'); return; }
    if (r.falhas.length) { setErro(r.falhas[0]); return; }
    limparRascunhos(rascunho); fechar(); aoExcluir?.();
  }

  async function buscarCep(cep: string) {
    const d = soDigitos(cep); if (d.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`); const j = await r.json();
      if (!j.erro) setF(x => ({ ...x, logradouro: j.logradouro || x.logradouro, bairro: j.bairro || x.bairro, cidade: j.localidade || x.cidade, uf: j.uf || x.uf }));
    } catch { /* consulta de CEP é opcional */ }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    if (!f.nome?.trim()) { setErro('Informe o nome.'); return; }
    if (!docOk) { setErro('CPF ou CNPJ inválido.'); return; }
    const tels = lerTelefones((f.telefones || []).map(t => ({ ...t, numero: soDigitos(t.numero), descricao: (t.descricao || '').trim() })));
    if (tels.some(t => !telefoneValido(t.numero))) { setErro('Telefone incompleto: informe DDD + número (10 dígitos para fixo, 11 para celular).'); return; }
    const vazio = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
    const dados = Object.fromEntries(Object.entries({ ...f, documento: soDigitos(f.documento || ''), cep: f.cep ? soDigitos(f.cep) : null, telefones: tels, telefone: telefonePrincipal(tels) }).map(([k, v]) => [k, vazio(v)]));
    delete (dados as Record<string, unknown>).criado_em;
    const q = f.id ? supabase.from('beneficiarios').update(dados).eq('id', f.id).select().single() : supabase.from('beneficiarios').insert(dados).select().single();
    const { data, error } = await q;
    if (error) { setErro(error.code === '23505' ? 'Já existe um cadastro com este CPF/CNPJ.' : error.message); return; }
    aoSalvar(data as Beneficiario);
  }

  const subs = subgrupos.filter(s => s.grupo_id === Number(f.grupo_id));
  return (
    <div className="modal-bg open">
      <div className="modal" style={{ width: 'min(1080px, 96vw)' }}>
        <h2>{f.id ? 'Editar fornecedor / cliente' : 'Novo fornecedor / cliente'}</h2>
        <form className="form" onSubmit={salvar} style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
          <label style={{ gridColumn: 'span 2' }}>CPF / CNPJ *<input required value={f.documento || ''} onChange={e => set('documento', formatarDocumento(e.target.value))}
            style={f.documento && soDigitos(f.documento).length >= 11 && !docOk ? { borderColor: 'var(--neg)' } : undefined} />
            {f.documento && soDigitos(f.documento).length >= 11 && <span style={{ color: docOk ? 'var(--pos)' : 'var(--neg)' }}>{docOk ? (tipoPessoa(f.documento) === 'PJ' ? 'CNPJ válido' : 'CPF válido') : 'Documento inválido'}</span>}</label>
          <label style={{ gridColumn: 'span 4' }}>Nome / Razão social *<input required value={f.nome || ''} onChange={e => set('nome', e.target.value)} /></label>
          <label style={{ gridColumn: 'span 2' }}>Nome fantasia<input value={f.nome_fantasia || ''} onChange={e => set('nome_fantasia', e.target.value)} /></label>
          <label style={{ gridColumn: 'span 2' }}>E-mail<input type="email" value={f.email || ''} onChange={e => set('email', e.target.value)} /></label>
          <label style={{ gridColumn: 'span 2' }}>Telefone principal<input readOnly value={telefonePrincipal(f.telefones || []) || ''} placeholder="Cadastre abaixo" style={{ background: 'var(--ivory)' }} /></label>
          <div className="full" style={{ gridColumn: '1 / -1' }}><CampoTelefones lista={f.telefones || []} aoMudar={l => set('telefones', l)} /></div>

          <div className="full" style={{ fontWeight: 600, color: 'var(--navy)', marginTop: 4 }}>Pagamento</div>
          <label style={{ gridColumn: 'span 2' }}>Tipo de chave PIX<select value={f.pix_tipo || ''} onChange={e => set('pix_tipo', e.target.value || null)}><option value="">·</option>{Object.entries(PIX).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
          <label style={{ gridColumn: 'span 4' }}>Chave PIX<input value={f.pix_chave || ''} onChange={e => set('pix_chave', e.target.value)} placeholder={f.pix_tipo === 'cpf_cnpj' ? 'Pode usar o próprio CPF/CNPJ' : ''} /></label>
          <label style={{ gridColumn: 'span 2' }}>Banco<input value={f.banco || ''} onChange={e => set('banco', e.target.value)} /></label>
          <label>Agência<input value={f.agencia || ''} onChange={e => set('agencia', e.target.value)} /></label>
          <label>Conta<input value={f.conta || ''} onChange={e => set('conta', e.target.value)} /></label>
          <label style={{ gridColumn: 'span 1' }}>Grupo padrão<select value={f.grupo_id ?? ''} onChange={e => setF(x => ({ ...x, grupo_id: e.target.value ? Number(e.target.value) : null, subgrupo_id: null }))}><option value="">·</option>{grupos.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select></label>
          <label style={{ gridColumn: 'span 1' }}>Subgrupo padrão<select value={f.subgrupo_id ?? ''} onChange={e => set('subgrupo_id', e.target.value ? Number(e.target.value) : null)}><option value="">·</option>{subs.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>

          <div className="full" style={{ fontWeight: 600, color: 'var(--navy)', marginTop: 4 }}>Endereço</div>
          <label>CEP<input value={f.cep ? formatarCep(f.cep) : ''} onChange={e => set('cep', e.target.value)} onBlur={e => buscarCep(e.target.value)} /></label>
          <label style={{ gridColumn: 'span 3' }}>Logradouro<input value={f.logradouro || ''} onChange={e => set('logradouro', e.target.value)} /></label>
          <label>Número<input value={f.numero || ''} onChange={e => set('numero', e.target.value)} /></label>
          <label>Complemento<input value={f.complemento || ''} onChange={e => set('complemento', e.target.value)} /></label>
          <label style={{ gridColumn: 'span 2' }}>Bairro<input value={f.bairro || ''} onChange={e => set('bairro', e.target.value)} /></label>
          <label style={{ gridColumn: 'span 3' }}>Cidade<input value={f.cidade || ''} onChange={e => set('cidade', e.target.value)} /></label>
          <label>UF<select value={f.uf || ''} onChange={e => set('uf', e.target.value || null)}><option value="">·</option>{UFS.map(u => <option key={u}>{u}</option>)}</select></label>
          <label className="full">Observações<input value={f.observacao || ''} onChange={e => set('observacao', e.target.value)} /></label>
          {f.id && <label className="full" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={f.ativo ?? true} onChange={e => set('ativo', e.target.checked)} /> Ativo</label>}
          {erro && <div className="err full">{erro}</div>}
          <div className="actions full">
            {f.id && (!confExcluir ? <button type="button" className="btn ghost" style={{ marginRight: 'auto', color: 'var(--neg)' }} onClick={() => setConfExcluir(true)}>Excluir</button>
              : <span style={{ marginRight: 'auto', display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>Excluir este cadastro?
                <button type="button" className="btn mini" style={{ background: 'var(--neg)', borderColor: 'var(--neg)' }} onClick={excluir}>Sim, excluir</button>
                <button type="button" className="btn ghost mini" onClick={() => setConfExcluir(false)}>Não</button></span>)}
            <button type="button" className="btn ghost" onClick={aoFechar}>Cancelar</button><button className="btn">Salvar</button></div>
        </form>
      </div>
    </div>
  );
}

export function AbaBeneficiarios({ beneficiarios, grupos, subgrupos, recarregar }: {
  beneficiarios: Beneficiario[]; grupos: Grupo[]; subgrupos: Subgrupo[]; recarregar: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [inativos, setInativos] = useState(false);
  const [edit, setEdit] = usePersistente<Form | null>('cad:benef-edit', null);
  const [importar, setImportar] = useState(false);
  const [aviso, setAviso] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [confExcluir, setConfExcluir] = useState(false);
  const [proc, setProc] = useState(false);
  const [mantidos, setMantidos] = useState<number[]>([]);
  const avisar = (m: string) => { setAviso(m); setTimeout(() => setAviso(''), 8000); };
  const marcados = beneficiarios.filter(b => sel.has(b.id));
  const alternar = (id: number, on: boolean) => { const n = new Set(sel); on ? n.add(id) : n.delete(id); setSel(n); };
  async function situacao(ids: number[], ativo: boolean) {
    setProc(true);
    const { error } = await supabase.from('beneficiarios').update({ ativo }).in('id', ids);
    setProc(false);
    if (error) { avisar(error.message); return; }
    setSel(new Set()); setMantidos([]); avisar(`${ids.length} cadastro(s) ${ativo ? 'ativado(s)' : 'inativado(s)'}.`); recarregar();
  }
  async function excluirSel() {
    setProc(true); setConfExcluir(false);
    const r = await excluirBeneficiarios([...sel]);
    setProc(false);
    setSel(new Set(r.emUso)); setMantidos(r.emUso);
    avisar(`${r.excluidos.length} cadastro(s) excluído(s).` + (r.falhas.length ? ' Erros: ' + r.falhas.slice(0, 2).join(' · ') : ''));
    recarregar();
  }
  const lista = useMemo(() => {
    const q = busca.toLowerCase(), qd = soDigitos(busca);
    return beneficiarios.filter(b => (inativos || b.ativo) && (!busca || b.nome.toLowerCase().includes(q) || (b.nome_fantasia || '').toLowerCase().includes(q) || (qd && b.documento.includes(qd))));
  }, [beneficiarios, busca, inativos]);
  const nomeG = (id: number | null) => grupos.find(g => g.id === id)?.nome || '·';
  return (
    <>
      <div className="filters">
        <input placeholder="Buscar por nome ou CPF/CNPJ" value={busca} onChange={e => setBusca(e.target.value)} style={{ minWidth: 280 }} />
        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={inativos} onChange={e => setInativos(e.target.checked)} /> Mostrar inativos</label>
        <span style={{ flex: 1 }} />
        {aviso && <span className="ok">{aviso}</span>}
        <button className="btn ghost" onClick={() => setImportar(true)}>Importar planilha</button>
        <button className="btn gold" onClick={() => setEdit({ ativo: true })}>+ Novo fornecedor / cliente</button>
      </div>
      {mantidos.length > 0 && <div className="proto" style={{ margin: '0 0 10px', fontSize: 13, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {mantidos.length} cadastro(s) têm lançamentos vinculados e foram mantidos (continuam selecionados).
        <button className="btn mini" disabled={proc} onClick={() => situacao(mantidos, false)}>Inativar esses {mantidos.length}</button>
        <button className="btn ghost mini" onClick={() => setMantidos([])}>Fechar</button></div>}
      <BarraSelecao n={marcados.length} aoLimpar={() => { setSel(new Set()); setConfExcluir(false); setMantidos([]); }}>
        {!confExcluir ? <>
          <button className="btn ghost mini" disabled={proc} onClick={() => situacao([...sel], true)}>Ativar</button>
          <button className="btn ghost mini" disabled={proc} onClick={() => situacao([...sel], false)}>Inativar</button>
          <button className="btn ghost mini" style={{ color: 'var(--neg)' }} disabled={proc} onClick={() => setConfExcluir(true)}>{proc ? 'Processando…' : 'Excluir'}</button>
        </> : <span style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>Excluir {marcados.length} cadastro(s)? Só saem os que não têm lançamentos.
          <button className="btn mini" style={{ background: 'var(--neg)', borderColor: 'var(--neg)' }} onClick={excluirSel}>Sim, excluir</button>
          <button className="btn ghost mini" onClick={() => setConfExcluir(false)}>Não</button></span>}
      </BarraSelecao>
      {lista.length === 0 ? <div className="empty" style={{ padding: 30 }}>{beneficiarios.length ? 'Nenhum cadastro encontrado.' : 'Nenhum fornecedor ou cliente cadastrado ainda.'}</div> : (
        <table><thead><tr><th className="c"><input type="checkbox" checked={lista.length > 0 && lista.every(b => sel.has(b.id))} onChange={e => setSel(e.target.checked ? new Set([...sel, ...lista.map(b => b.id)]) : new Set([...sel].filter(id => !lista.some(b => b.id === id))))} /></th><th>Nome</th><th>CPF / CNPJ</th><th>Chave PIX</th><th>Grupo padrão</th><th>Contato</th><th>Situação</th></tr></thead>
          <tbody>{lista.map(b => (
            <tr key={b.id} style={{ cursor: 'pointer', ...(sel.has(b.id) ? { background: 'var(--gold-soft)' } : {}) }} onClick={() => setEdit(b)}>
              <td className="c" onClick={e => e.stopPropagation()}><input type="checkbox" checked={sel.has(b.id)} onChange={e => alternar(b.id, e.target.checked)} /></td>
              <td><b>{b.nome}</b>{b.nome_fantasia && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.nome_fantasia}</div>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{formatarDocumento(b.documento)} <span className="tag">{tipoPessoa(b.documento)}</span></td>
              <td>{b.pix_chave ? <><span className="tag">{PIX[b.pix_tipo || ''] || 'PIX'}</span> {b.pix_chave}</> : '·'}</td>
              <td>{nomeG(b.grupo_id)}</td><td style={{ fontSize: 12.5 }}>{[b.email, b.telefone].filter(Boolean).join(' · ') || '·'}</td>
              <td><span className={'st ' + (b.ativo ? 'pago' : 'venc')}>{b.ativo ? 'Ativo' : 'Inativo'}</span></td>
            </tr>))}</tbody></table>
      )}
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>O mesmo cadastro serve como fornecedor / beneficiário nos pagamentos e como cliente / origem nos recebimentos. A partir de 01/01/2027, todo pagamento precisa de um fornecedor / beneficiário cadastrado (exceto faturas de cartão e transferências entre contas da RMS).</p>
      {importar && <ImportarCadastro existentes={beneficiarios} aoFechar={() => setImportar(false)} aoConcluir={m => { setImportar(false); setAviso(m); setTimeout(() => setAviso(''), 8000); recarregar(); }} />}
      {edit && <FormBeneficiario inicial={edit} grupos={grupos} subgrupos={subgrupos} aoFechar={() => setEdit(null)} aoSalvar={() => { setEdit(null); recarregar(); }} aoExcluir={() => { avisar('Cadastro excluído.'); recarregar(); }} />}
    </>
  );
}

/** Telefones do cadastro: número formatado, descrição opcional e um principal */
function CampoTelefones({ lista, aoMudar }: { lista: Telefone[]; aoMudar: (l: Telefone[]) => void }) {
  const muda = (i: number, t: Partial<Telefone>) => aoMudar(lista.map((x, j) => (j === i ? { ...x, ...t } : t.principal ? { ...x, principal: false } : x)));
  const tirar = (i: number) => { const l = lista.filter((_, j) => j !== i); aoMudar(l.length && !l.some(x => x.principal) ? l.map((x, j) => ({ ...x, principal: j === 0 })) : l); };
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: lista.length ? 6 : 0 }}>
        <b style={{ fontSize: 13, color: 'var(--navy)' }}>Telefones</b>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>marque o principal, que aparece nas listas</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn ghost mini" onClick={() => aoMudar([...lista, { numero: '', descricao: '', principal: !lista.length }])}>+ Adicionar telefone</button>
      </div>
      {lista.map((t, i) => {
        const d = t.numero.replace(/\D/g, '');
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 180px 1fr 32px', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, fontWeight: 400, fontSize: 13 }}><input type="radio" name="tel-principal" checked={t.principal} onChange={() => muda(i, { principal: true })} style={{ width: 'auto' }} /> Principal</label>
            <input value={formatarTelefone(t.numero)} placeholder="(11) 98765-4321" inputMode="tel" onChange={e => muda(i, { numero: e.target.value.replace(/\D/g, '').slice(0, 11) })}
              style={d && d.length < 10 ? { borderColor: 'var(--neg)' } : undefined} title={d && d.length < 10 ? 'Informe DDD + número' : ''} />
            <input value={t.descricao} placeholder="Descrição (ex.: Financeiro, WhatsApp, João)" onChange={e => muda(i, { descricao: e.target.value })} />
            <button type="button" className="btn ghost mini" onClick={() => tirar(i)} title="Remover">×</button>
          </div>
        );
      })}
    </div>
  );
}
