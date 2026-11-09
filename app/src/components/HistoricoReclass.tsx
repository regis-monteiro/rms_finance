import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { invalidarDicionario } from '../lib/sugestao';

interface Reclass {
  id: number; criado_em: string; origem: 'plano' | 'semelhantes' | 'lote'; descricao: string; de_texto: string | null; para_texto: string | null; filtros: string | null;
  qtd_lancamentos: number; qtd_compras: number; qtd_cadastros: number; desfeita_em: string | null; restaurados: number | null; ignorados: number | null;
  usuario: { nome: string } | null;
}
const ORIGEM = { plano: 'Plano de contas', semelhantes: 'Semelhantes', lote: 'Alteração em lote' };
const quando = (s: string) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Histórico das reclassificações (plano de contas, semelhantes e alteração em lote), com opção de desfazer */
export default function HistoricoReclass({ versao, aoDesfazer }: { versao: number; aoDesfazer: (m: string) => void }) {
  const [lista, setLista] = useState<Reclass[]>([]);
  const [conf, setConf] = useState<number | null>(null);
  const [proc, setProc] = useState(false);
  const [erro, setErro] = useState('');
  const [rec, setRec] = useState(0);
  const [todas, setTodas] = useState(false);

  useEffect(() => {
    supabase.from('reclassificacoes').select('*, usuario:usuarios!reclassificacoes_usuario_id_fkey(nome)').order('criado_em', { ascending: false }).range(0, todas ? 499 : 19)
      .then(({ data, error }) => { if (error) setErro(/reclassificacoes/.test(error.message) ? 'Rode o arquivo 024_historico_reclass_telefones.sql no Supabase para ativar o histórico.' : error.message); setLista((data as Reclass[]) || []); });
  }, [versao, rec, todas]);

  async function desfazer(id: number) {
    setProc(true); setErro('');
    const { data, error } = await supabase.rpc('desfazer_reclassificacao', { p_id: id });
    setProc(false); setConf(null);
    if (error) { setErro(error.message); return; }
    const r = ((data as { restaurados: number; ignorados: number }[]) || [])[0];
    invalidarDicionario(); setRec(v => v + 1);
    aoDesfazer(`Reclassificação desfeita: ${r?.restaurados ?? 0} registro(s) voltaram à classificação anterior` + (r?.ignorados ? `; ${r.ignorados} já tinham sido alterados depois e foram mantidos.` : '.'));
  }

  const qtd = (r: Reclass) => [r.qtd_lancamentos && `${r.qtd_lancamentos} lançamento(s)`, r.qtd_compras && `${r.qtd_compras} compra(s)`, r.qtd_cadastros && `${r.qtd_cadastros} cadastro(s)`].filter(Boolean).join(', ') || '·';
  return (
    <div className="card mt">
      <h3>Histórico de reclassificações <small>plano de contas, semelhantes e alterações em lote</small></h3>
      {erro && <div className="err" style={{ marginBottom: 10 }}>{erro}</div>}
      {!lista.length ? <div className="empty">Nenhuma reclassificação registrada.</div> : (
        <table className="compacta">
          <thead><tr><th>Quando</th><th>Origem</th><th>De</th><th>Para</th><th>Alcance</th><th>Quem</th><th /></tr></thead>
          <tbody>{lista.map(r => (
            <tr key={r.id} style={r.desfeita_em ? { opacity: 0.55 } : undefined}>
              <td style={{ whiteSpace: 'nowrap' }}>{quando(r.criado_em)}</td>
              <td>{ORIGEM[r.origem]}<div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{r.descricao}{r.filtros ? ' · ' + r.filtros : ''}</div></td>
              <td>{r.de_texto || '·'}</td><td>{r.para_texto || '·'}</td><td>{qtd(r)}</td><td>{r.usuario?.nome || '·'}</td>
              <td className="r" style={{ whiteSpace: 'nowrap' }}>
                {r.desfeita_em ? <span className="st prev" title={`${r.restaurados ?? 0} restaurado(s), ${r.ignorados ?? 0} mantido(s)`}>Desfeita em {quando(r.desfeita_em).slice(0, 10)}</span>
                  : conf === r.id ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>Voltar à classificação anterior?
                      <button className="btn mini" disabled={proc} onClick={() => desfazer(r.id)}>{proc ? 'Desfazendo…' : 'Sim'}</button><button className="btn ghost mini" onClick={() => setConf(null)}>Não</button></span>
                  : <button className="btn ghost mini" onClick={() => setConf(r.id)}>Desfazer</button>}
              </td>
            </tr>))}</tbody>
        </table>)}
      {lista.length >= 20 && !todas && <button className="btn ghost mini mt" onClick={() => setTodas(true)}>Ver mais antigas</button>}
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 0' }}>Ao desfazer, cada registro volta à classificação anterior. Os que foram alterados de novo depois da reclassificação são mantidos como estão.</p>
    </div>
  );
}
