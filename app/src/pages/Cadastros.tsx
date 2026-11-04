import { useState } from 'react';
import { AbaSignatarios } from '../components/Signatarios';
import CampoValor from '../components/CampoValor';
import DataBR from '../components/DataBR';
import { supabase } from '../lib/supabase';
import { useCadastros } from '../lib/useCadastros';
import { Cabecalho } from '../components/Layout';
import { AbaBeneficiarios } from '../components/Beneficiarios';
import { useAuth } from '../lib/auth';
import PlanoContas from '../components/PlanoContas';
import { usePersistente } from '../lib/rascunho';

const TIPO = { corrente: 'Conta corrente', aplicacao: 'Aplicação', especie: 'Espécie' };

export default function Cadastros() {
  const { contas, cartoes, grupos, subgrupos, beneficiarios, recarregar } = useCadastros();
  const diretor = useAuth().usuario?.perfil === 'diretor';
  const [aba, setAba] = usePersistente<'beneficiarios' | 'contas' | 'cartoes' | 'grupos' | 'signatarios'>('cad:aba', 'beneficiarios');
  const [msg, setMsg] = useState('');

  async function gravar(tabela: string, id: number, campo: string, valor: unknown) {
    const { error } = await supabase.from(tabela).update({ [campo]: valor }).eq('id', id);
    setMsg(error ? 'Erro: ' + error.message : 'Alteração salva');
    setTimeout(() => setMsg(''), 2500);
    recarregar();
  }
  return (
    <>
      <Cabecalho titulo="Cadastros" sub="Fornecedores, clientes, contas, cartões e plano de contas">{msg && <span className={msg.startsWith('Erro') ? 'err' : 'ok'}>{msg}</span>}</Cabecalho>
      <div className="card">
        <div className="tabs">
          {([['beneficiarios', 'Fornecedores / Clientes'], ...(diretor ? [['contas', 'Contas'], ['cartoes', 'Cartões'], ['grupos', 'Plano de contas'], ['signatarios', 'Signatários']] : [])] as [typeof aba, string][]).map(([k, t]) => <button key={k} className={aba === k ? 'on' : ''} onClick={() => setAba(k)}>{t}</button>)}
        </div>

        {aba === 'beneficiarios' && <AbaBeneficiarios beneficiarios={beneficiarios} grupos={grupos} subgrupos={subgrupos} recarregar={recarregar} />}

        {aba === 'contas' && (
          <table><thead><tr><th>Conta</th><th>Tipo</th><th className="r">Saldo inicial</th><th>Data do saldo inicial</th><th>Integração bancária</th><th>Ativa</th></tr></thead>
            <tbody>{contas.map(c => (
              <tr key={c.id}><td>{c.nome}</td><td>{TIPO[c.tipo]}</td>
                <td className="r"><CampoValor defaultValue={c.saldo_inicial} style={{ width: 140, textAlign: 'right' }} onBlur={e => Number(e.target.value) !== Number(c.saldo_inicial) && gravar('contas', c.id, 'saldo_inicial', Number(e.target.value))} /></td>
                <td><DataBR defaultValue={c.data_saldo_inicial} onBlur={e => e.target.value !== c.data_saldo_inicial && gravar('contas', c.id, 'data_saldo_inicial', e.target.value)} /></td>
                <td>{c.tipo === 'corrente' ? <select value={c.integracao || ''} onChange={e => gravar('contas', c.id, 'integracao', e.target.value || null)}><option value="">Nenhuma (OFX)</option><option value="inter">API Inter</option><option value="efi">API Efí</option></select> : '·'}</td>
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

        {aba === 'signatarios' && <AbaSignatarios />}

        {aba === 'grupos' && <PlanoContas aoMudar={recarregar} avisar={m => { setMsg(m); setTimeout(() => setMsg(''), 4000); }} />}
      </div>
    </>
  );
}
