import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { brl, dataBR } from '../lib/format';
import type { Modo } from '../lib/analises';

interface Item { origem: 'lancamento' | 'cartao'; id: number; data: string; descricao: string; grupo: string; subgrupo: string | null; conta: string | null; valor: number; pago: boolean }

/** Lançamentos e compras de cartão que formam um valor do DRE */
export function ModalDetalheDRE({ ano, mes, linha, grupo, conta, centro, modo, titulo, aoFechar }: {
  ano: number; mes: number; linha: number; grupo: number | null; conta: number | null; centro: number | null; modo: Modo; titulo: string; aoFechar: () => void;
}) {
  const nav = useNavigate();
  const [itens, setItens] = useState<Item[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    supabase.rpc('dre_detalhe', { p_ano: ano, p_mes: mes, p_linha: linha, p_grupo: grupo, p_conta: conta, p_centro: centro })
      .then(({ data, error }) => { if (error) setErro(/dre_detalhe/.test(error.message) ? 'Rode o arquivo 016_caixa_detalhe_dre.sql no Supabase.' : error.message); setItens(((data as Item[]) || []).filter(i => modo === 'comb' || (modo === 'real' ? i.pago : !i.pago))); });
  }, [ano, mes, linha, grupo, conta, centro, modo]);
  const total = (itens || []).reduce((a, i) => a + Number(i.valor), 0);
  return (
    <div className="modal-bg open">
      <div className="modal" style={{ width: 'min(980px, 96vw)' }}><h2>{titulo}</h2>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -6 }}>{modo === 'real' ? 'Realizado' : modo === 'prev' ? 'Previsto' : 'Realizado + previsto'} · {String(mes).padStart(2, '0')}/{ano}. Clique numa linha para abrir o lançamento ou a fatura.</p>
        {erro && <div className="err">{erro}</div>}
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {!itens ? <div className="empty">Carregando…</div> : !itens.length ? <div className="empty">Nenhum lançamento.</div> : (
            <table className="compacta">
              <thead><tr><th>Data</th><th>Descrição</th><th>Grupo · subgrupo</th><th>Conta / cartão</th><th className="r">Valor</th><th /></tr></thead>
              <tbody>{itens.map(i => (
                <tr key={i.origem + i.id} className="clicavel" onClick={() => i.origem === 'lancamento' ? nav(`/lancamentos?abrir=${i.id}`) : supabase.from('compras_cartao').select('fatura_id').eq('id', i.id).single().then(({ data }) => data && nav(`/cartoes?fatura=${(data as { fatura_id: number }).fatura_id}`))}>
                  <td>{dataBR(i.data)}</td><td>{i.descricao}</td><td>{i.grupo}{i.subgrupo ? ' · ' + i.subgrupo : ''}</td><td>{i.conta || '·'}</td>
                  <td className={'r ' + (Number(i.valor) < 0 ? 'neg' : 'pos')}>{brl(i.valor)}</td><td>{!i.pago && <span className="tag">previsto</span>}{i.origem === 'cartao' && <span className="tag">cartão</span>}</td></tr>))}
                <tr style={{ fontWeight: 700, background: '#FBF9F3' }}><td colSpan={4}>Total ({itens.length})</td><td className="r">{brl(total)}</td><td /></tr></tbody>
            </table>
          )}
        </div>
        <div className="actions"><button className="btn" onClick={aoFechar}>Fechar</button></div>
      </div>
    </div>
  );
}
