import { useMemo, useState } from 'react';
import { supabase, type Beneficiario, type Grupo, type Subgrupo } from '../lib/supabase';
import { documentoValido, formatarCep, formatarDocumento, soDigitos, tipoPessoa } from '../lib/documento';

const PIX = { cpf_cnpj: 'CPF/CNPJ', email: 'E-mail', telefone: 'Telefone', aleatoria: 'Chave aleatória' } as Record<string, string>;
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
type Form = Partial<Beneficiario>;

export function FormBeneficiario({ inicial, grupos, subgrupos, aoSalvar, aoFechar }: {
  inicial: Form; grupos: Grupo[]; subgrupos: Subgrupo[]; aoSalvar: (b: Beneficiario) => void; aoFechar: () => void;
}) {
  const [f, setF] = useState<Form>({ ...inicial, documento: inicial.documento ? formatarDocumento(inicial.documento) : '' });
  const [erro, setErro] = useState('');
  const set = (k: keyof Beneficiario, v: unknown) => setF(x => ({ ...x, [k]: v }));
  const docOk = documentoValido(f.documento || '');

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
    const vazio = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
    const dados = Object.fromEntries(Object.entries({ ...f, documento: soDigitos(f.documento || ''), cep: f.cep ? soDigitos(f.cep) : null }).map(([k, v]) => [k, vazio(v)]));
    delete (dados as Record<string, unknown>).criado_em;
    const q = f.id ? supabase.from('beneficiarios').update(dados).eq('id', f.id).select().single() : supabase.from('beneficiarios').insert(dados).select().single();
    const { data, error } = await q;
    if (error) { setErro(error.code === '23505' ? 'Já existe um beneficiário com este CPF/CNPJ.' : error.message); return; }
    aoSalvar(data as Beneficiario);
  }

  const subs = subgrupos.filter(s => s.grupo_id === Number(f.grupo_id));
  return (
    <div className="modal-bg open" onClick={e => e.target === e.currentTarget && aoFechar()}>
      <div className="modal" style={{ width: 'min(1080px, 96vw)' }}>
        <h2>{f.id ? 'Editar beneficiário' : 'Novo beneficiário'}</h2>
        <form className="form" onSubmit={salvar} style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
          <label style={{ gridColumn: 'span 2' }}>CPF / CNPJ *<input required value={f.documento || ''} onChange={e => set('documento', formatarDocumento(e.target.value))}
            style={f.documento && soDigitos(f.documento).length >= 11 && !docOk ? { borderColor: 'var(--neg)' } : undefined} />
            {f.documento && soDigitos(f.documento).length >= 11 && <span style={{ color: docOk ? 'var(--pos)' : 'var(--neg)' }}>{docOk ? (tipoPessoa(f.documento) === 'PJ' ? 'CNPJ válido' : 'CPF válido') : 'Documento inválido'}</span>}</label>
          <label style={{ gridColumn: 'span 4' }}>Nome / Razão social *<input required value={f.nome || ''} onChange={e => set('nome', e.target.value)} /></label>
          <label style={{ gridColumn: 'span 2' }}>Nome fantasia<input value={f.nome_fantasia || ''} onChange={e => set('nome_fantasia', e.target.value)} /></label>
          <label style={{ gridColumn: 'span 2' }}>E-mail<input type="email" value={f.email || ''} onChange={e => set('email', e.target.value)} /></label>
          <label style={{ gridColumn: 'span 2' }}>Telefone<input value={f.telefone || ''} onChange={e => set('telefone', e.target.value)} /></label>

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
          <div className="actions full"><button type="button" className="btn ghost" onClick={aoFechar}>Cancelar</button><button className="btn">Salvar</button></div>
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
  const [edit, setEdit] = useState<Form | null>(null);
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
        <button className="btn gold" onClick={() => setEdit({ ativo: true })}>+ Novo beneficiário</button>
      </div>
      {lista.length === 0 ? <div className="empty" style={{ padding: 30 }}>{beneficiarios.length ? 'Nenhum beneficiário encontrado.' : 'Nenhum beneficiário cadastrado ainda.'}</div> : (
        <table><thead><tr><th>Nome</th><th>CPF / CNPJ</th><th>Chave PIX</th><th>Grupo padrão</th><th>Contato</th><th>Situação</th></tr></thead>
          <tbody>{lista.map(b => (
            <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => setEdit(b)}>
              <td><b>{b.nome}</b>{b.nome_fantasia && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.nome_fantasia}</div>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{formatarDocumento(b.documento)} <span className="tag">{tipoPessoa(b.documento)}</span></td>
              <td>{b.pix_chave ? <><span className="tag">{PIX[b.pix_tipo || ''] || 'PIX'}</span> {b.pix_chave}</> : '·'}</td>
              <td>{nomeG(b.grupo_id)}</td><td style={{ fontSize: 12.5 }}>{[b.email, b.telefone].filter(Boolean).join(' · ') || '·'}</td>
              <td><span className={'st ' + (b.ativo ? 'pago' : 'venc')}>{b.ativo ? 'Ativo' : 'Inativo'}</span></td>
            </tr>))}</tbody></table>
      )}
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>A partir de 01/01/2027, todo pagamento precisa de um beneficiário cadastrado (exceto faturas de cartão e transferências entre contas da RMS).</p>
      {edit && <FormBeneficiario inicial={edit} grupos={grupos} subgrupos={subgrupos} aoFechar={() => setEdit(null)} aoSalvar={() => { setEdit(null); recarregar(); }} />}
    </>
  );
}
