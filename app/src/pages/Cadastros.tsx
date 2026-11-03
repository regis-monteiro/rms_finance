import { useState } from 'react';
import DataBR from '../components/DataBR';
import { supabase } from '../lib/supabase';
import { useCadastros } from '../lib/useCadastros';
import { Cabecalho } from '../components/Layout';
import { AbaBeneficiarios } from '../components/Beneficiarios';
import { useAuth } from '../lib/auth';

const TIPO = { corrente: 'Conta corrente', aplicacao: 'Aplicação', especie: 'Espécie' };

export default function Cadastros() {
  const { contas, cartoes, grupos, subgrupos, beneficiarios, recarregar } = useCadastros();
  const diretor = useAuth().usuario?.perfil === 'diretor';
  const [aba, setAba] = useState<'beneficiarios' | 'contas' | 'cartoes' | 'grupos'>('beneficiarios');
  const [msg, setMsg] = useState('');
  const [novoSub, setNovoSub] = useState<{ grupo: string; nome: string }>({ grupo: '', nome: '' });

  async function gravar(tabela: string, id: number, campo: string, valor: unknown) {
    const { error } = await supabase.from(tabela).update({ [campo]: valor }).eq('id', id);
    setMsg(error ? 'Erro: ' + error.message : 'Alteração salva');
    setTimeout(() => setMsg(''), 2500);
    recarregar();
  }
  async function incluirSub(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('subgrupos').insert({ grupo_id: Number(novoSub.grupo), nome: novoSub.nome.trim() });
    setMsg(error ? 'Erro: ' + error.message : 'Subgrupo incluído');
    setNovoSub({ ...novoSub, nome: '' }); recarregar();
  }

  return (
    <>
      <Cabecalho titulo="Cadastros" sub="Beneficiários, contas, cartões e plano de contas">{msg && <span className={msg.startsWith('Erro') ? 'err' : 'ok'}>{msg}</span>}</Cabecalho>
      <div className="card">
        <div className="tabs">
          {([['beneficiarios', 'Fornecedores / beneficiários'], ...(diretor ? [['contas', 'Contas'], ['cartoes', 'Cartões'], ['grupos', 'Plano de contas']] : [])] as [typeof aba, string][]).map(([k, t]) => <button key={k} className={aba === k ? 'on' : ''} onClick={() => setAba(k)}>{t}</button>)}
        </div>

        {aba === 'beneficiarios' && <AbaBeneficiarios beneficiarios={beneficiarios} grupos={grupos} subgrupos={subgrupos} recarregar={recarregar} />}

        {aba === 'contas' && (
          <table><thead><tr><th>Conta</th><th>Tipo</th><th className="r">Saldo inicial</th><th>Data do saldo inicial</th><th>Ativa</th></tr></thead>
            <tbody>{contas.map(c => (
              <tr key={c.id}><td>{c.nome}</td><td>{TIPO[c.tipo]}</td>
                <td className="r"><input type="number" step="0.01" defaultValue={c.saldo_inicial} style={{ width: 140, textAlign: 'right' }} onBlur={e => Number(e.target.value) !== Number(c.saldo_inicial) && gravar('contas', c.id, 'saldo_inicial', Number(e.target.value))} /></td>
                <td><DataBR defaultValue={c.data_saldo_inicial} onBlur={e => e.target.value !== c.data_saldo_inicial && gravar('contas', c.id, 'data_saldo_inicial', e.target.value)} /></td>
                <td><input type="checkbox" checked={c.ativa} onChange={e => gravar('contas', c.id, 'ativa', e.target.checked)} /></td></tr>
            ))}</tbody></table>
        )}

        {aba === 'cartoes' && (
          <>
            <table><thead><tr><th>Cartão</th><th className="c">Dia de fechamento</th><th className="c">Dia de vencimento</th><th>Ativo</th></tr></thead>
              <tbody>{cartoes.map(c => (
                <tr key={c.id}><td>{c.nome}</td>
                  <td className="c"><input type="number" min={1} max={31} defaultValue={c.dia_fechamento} style={{ width: 70, textAlign: 'center' }} onBlur={e => Number(e.target.value) !== c.dia_fechamento && gravar('cartoes', c.id, 'dia_fechamento', Number(e.target.value))} /></td>
                  <td className="c"><input type="number" min={1} max={31} defaultValue={c.dia_vencimento} style={{ width: 70, textAlign: 'center' }} onBlur={e => Number(e.target.value) !== c.dia_vencimento && gravar('cartoes', c.id, 'dia_vencimento', Number(e.target.value))} /></td>
                  <td><input type="checkbox" checked={c.ativo} onChange={e => gravar('cartoes', c.id, 'ativo', e.target.checked)} /></td></tr>
              ))}</tbody></table>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>Fechamento provisório: 7 dias antes do vencimento. Ajuste conforme cada cartão.</p>
          </>
        )}

        {aba === 'grupos' && (
          <>
            <form className="filters" onSubmit={incluirSub}>
              <select required value={novoSub.grupo} onChange={e => setNovoSub({ ...novoSub, grupo: e.target.value })}><option value="" disabled>Grupo</option>{grupos.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select>
              <input required placeholder="Novo subgrupo" value={novoSub.nome} onChange={e => setNovoSub({ ...novoSub, nome: e.target.value })} />
              <button className="btn gold">+ Incluir subgrupo</button>
            </form>
            <table><thead><tr><th>Grupo</th><th>Natureza</th><th>Restrito</th><th>Subgrupos</th></tr></thead>
              <tbody>{grupos.map(g => (
                <tr key={g.id}><td><b>{g.nome}</b></td><td>{{ receita: 'Receita', despesa: 'Despesa', movimentacao: 'Movimentação' }[g.natureza]}</td>
                  <td><input type="checkbox" checked={g.restrito} onChange={e => gravar('grupos', g.id, 'restrito', e.target.checked)} /></td>
                  <td style={{ color: 'var(--muted)' }}>{subgrupos.filter(s => s.grupo_id === g.id).map(s => s.nome).join(', ') || '·'}</td></tr>
              ))}</tbody></table>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>Grupos restritos (pessoal, pró-labore e sócios) não aparecem em detalhe para o perfil Financeiro.</p>
          </>
        )}
      </div>
    </>
  );
}
