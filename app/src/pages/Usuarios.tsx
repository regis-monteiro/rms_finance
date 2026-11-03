import { useEffect, useState } from 'react';
import { supabase, type Perfil } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Cabecalho } from '../components/Layout';

interface U { id: string; nome: string; email: string; perfil: Perfil; ativo: boolean; criado_em: string }
const PERFIS: [Perfil, string][] = [['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['consulta', 'Consulta']];
const MATRIZ: [string, string, string, string][] = [
  ['Dashboard', 'Completo', 'Completo', 'Sem saldos de aplicação'],
  ['Lançamentos e contas a pagar', 'Edita', 'Edita', 'Não acessa'],
  ['Cartões', 'Edita', 'Edita', 'Não acessa'],
  ['Fornecedores / beneficiários', 'Edita', 'Edita', 'Não acessa'],
  ['Pessoal, pró-labore e sócios', 'Vê detalhe', 'Não vê', 'Não vê'],
  ['Contas, cartões e plano de contas', 'Edita', 'Não acessa', 'Não acessa'],
  ['Usuários e importação', 'Edita', 'Não acessa', 'Não acessa'],
];
const cor = (v: string) => (/^Não/.test(v) ? 'venc' : /Edita|Completo|detalhe/.test(v) ? 'pago' : 'conf');

export default function Usuarios() {
  const { usuario } = useAuth();
  const [lista, setLista] = useState<U[]>([]);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [versao, setVersao] = useState(0);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    supabase.from('usuarios').select('*').order('ativo').order('nome').then(({ data }) => setLista((data as U[]) || []));
  }, [versao]);

  async function alterar(u: U, campos: Partial<U>) {
    const { error } = await supabase.from('usuarios').update(campos).eq('id', u.id);
    setMsg(error ? { t: 'err', m: error.message.includes('Diretor ativo') ? 'É preciso manter pelo menos um Diretor ativo.' : error.message } : { t: 'ok', m: 'Alteração salva' });
    setTimeout(() => setMsg(null), 3000);
    setVersao(v => v + 1);
  }

  const convite = `Olá! Você foi convidado(a) para o RMS Finance.\n\n1. Acesse ${window.location.origin}\n2. Clique em "Primeiro acesso" e cadastre seu nome, e-mail e senha\n3. Confirme pelo link enviado ao seu e-mail\n\nDepois disso, aguarde a liberação do seu acesso pela diretoria.`;
  const pendentes = lista.filter(u => !u.ativo);
  const ativos = lista.filter(u => u.ativo);
  const dataBR = (s: string) => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);

  const linha = (u: U) => (
    <tr key={u.id}>
      <td><b>{u.nome}</b>{u.id === usuario?.id && <span className="tag" style={{ marginLeft: 6 }}>você</span>}</td>
      <td>{u.email}</td>
      <td><select value={u.perfil} onChange={e => alterar(u, { perfil: e.target.value as Perfil })}>{PERFIS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>
      <td>{dataBR(u.criado_em)}</td>
      <td><span className={'st ' + (u.ativo ? 'pago' : 'conf')}>{u.ativo ? 'Ativo' : 'Aguardando liberação'}</span></td>
      <td className="r">{u.ativo
        ? <button className="btn ghost" style={{ padding: '4px 10px' }} disabled={u.id === usuario?.id} onClick={() => alterar(u, { ativo: false })}>Bloquear</button>
        : <button className="btn" style={{ padding: '4px 10px' }} onClick={() => alterar(u, { ativo: true })}>Liberar acesso</button>}</td>
    </tr>
  );
  const cab = <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Cadastro</th><th>Situação</th><th /></tr></thead>;

  return (
    <>
      <Cabecalho titulo="Usuários e permissões" sub="Quem acessa o app e o que cada perfil pode ver">{msg && <span className={msg.t}>{msg.m}</span>}</Cabecalho>

      <div className="card">
        <h3>Convidar usuário <small>a pessoa se cadastra e você libera o acesso aqui</small></h3>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <pre style={{ flex: 1, minWidth: 280, margin: 0, background: 'var(--ivory)', borderRadius: 8, padding: '12px 14px', fontFamily: 'Inter', fontSize: 13, whiteSpace: 'pre-wrap' }}>{convite}</pre>
          <button className="btn gold" onClick={() => navigator.clipboard?.writeText(convite).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000); }).catch(() => {})}>{copiado ? 'Mensagem copiada' : 'Copiar mensagem'}</button>
        </div>
      </div>

      {pendentes.length > 0 && (
        <div className="card mt" style={{ borderColor: 'var(--gold)' }}>
          <h3>Aguardando liberação <small>{pendentes.length} pessoa(s)</small></h3>
          <p style={{ margin: '-4px 0 10px', fontSize: 12.5, color: 'var(--muted)' }}>Escolha o perfil antes de liberar. Só libere quem você reconhece pelo nome e e-mail.</p>
          <table>{cab}<tbody>{pendentes.map(linha)}</tbody></table>
        </div>
      )}

      <div className="card mt"><h3>Usuários ativos <small>{ativos.length}</small></h3><table>{cab}<tbody>{ativos.map(linha)}</tbody></table></div>

      <div className="card mt"><h3>Matriz de permissões <small>aplicada no banco de dados</small></h3>
        <table><thead><tr><th>Recurso</th><th>Diretor</th><th>Financeiro</th><th>Consulta</th></tr></thead>
          <tbody>{MATRIZ.map(r => <tr key={r[0]}><td>{r[0]}</td>{r.slice(1).map((v, i) => <td key={i}><span className={'st ' + cor(v)}>{v}</span></td>)}</tr>)}</tbody></table>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>Contas a receber, DRE e comparativos serão liberados por perfil quando essas telas ficarem prontas.</p>
      </div>
    </>
  );
}
