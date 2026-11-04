import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { brl } from '../lib/format';
import { MESES_LONGOS } from '../lib/analises';
import { Cabecalho } from '../components/Layout';

interface Lote { id: number; ano: number; arquivo: string | null; lancamentos: number; compras: number; saldo_inicial: number; saldo_final: number; totais_planilha: { mes: number; entradas: number; saidas: number }[]; observacoes: string | null; importado_em: string }
interface Conf { mes: number; entradas: number; saidas: number }

export default function Importacao() {
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [sel, setSel] = useState<Lote | null>(null);
  const [conf, setConf] = useState<Conf[]>([]);
  const [desfazer, setDesfazer] = useState<Lote | null>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    supabase.from('lotes_importacao').select('*').order('ano', { ascending: false }).then(({ data }) => {
      const ls = (data as Lote[]) || []; setLotes(ls);
      setSel(s => ls.find(l => l.id === s?.id) || ls[0] || null);
    });
  }, [versao]);
  useEffect(() => {
    if (!sel) { setConf([]); return; }
    supabase.rpc('conferencia_lote', { p_lote: sel.id }).then(({ data }) => setConf((data as Conf[]) || []));
  }, [sel]);

  async function confirmarDesfazer() {
    if (!desfazer) return;
    const { error } = await supabase.rpc('desfazer_lote', { p_lote: desfazer.id });
    setMsg(error ? { t: 'err', m: error.message } : { t: 'ok', m: `Importação de ${desfazer.ano} desfeita` });
    setDesfazer(null); setSel(null); setVersao(v => v + 1);
  }

  const linhas = sel ? Array.from({ length: 12 }, (_, i) => {
    const p = sel.totais_planilha?.find(t => t.mes === i + 1), a = conf.find(c => c.mes === i + 1);
    return { mes: i + 1, pe: Number(p?.entradas || 0), ps: Number(p?.saidas || 0), ae: Number(a?.entradas || 0), as: Number(a?.saidas || 0) };
  }) : [];
  const ok = linhas.every(l => Math.abs(l.pe - l.ae) < 0.01 && Math.abs(l.ps - l.as) < 0.01);
  const total = (k: 'pe' | 'ps' | 'ae' | 'as') => linhas.reduce((a, l) => a + l[k], 0);

  return (
    <>
      <Cabecalho titulo="Importação" sub="Anos carregados das planilhas, com conferência e opção de desfazer">{msg && <span className={msg.t}>{msg.m}</span>}</Cabecalho>

      <div className="grid g21">
        <div className="card">
          <h3>Anos importados <small>{lotes.length} ano(s)</small></h3>
          {lotes.length === 0 ? <div className="empty" style={{ padding: 30 }}>Nenhum ano histórico importado ainda.</div> : (
            <table><thead><tr><th>Ano</th><th className="r">Lançamentos</th><th className="r">Compras de cartão</th><th className="r">Saldo inicial</th><th className="r">Saldo final</th><th>Importado em</th><th /></tr></thead>
              <tbody>{lotes.map(l => (
                <tr key={l.id} style={{ cursor: 'pointer', background: sel?.id === l.id ? 'var(--gold-soft)' : undefined }} onClick={() => setSel(l)}>
                  <td><b>{l.ano}</b></td><td className="r">{l.lancamentos.toLocaleString('pt-BR')}</td><td className="r">{l.compras.toLocaleString('pt-BR')}</td>
                  <td className="r">{brl(l.saldo_inicial)}</td><td className="r">{brl(l.saldo_final)}</td>
                  <td>{new Date(l.importado_em).toLocaleDateString('pt-BR')}</td>
                  <td className="r"><button className="btn ghost" style={{ padding: '4px 10px', color: 'var(--neg)' }} onClick={e => { e.stopPropagation(); setDesfazer(l); }}>Desfazer</button></td>
                </tr>))}</tbody></table>
          )}
        </div>
        <div className="card">
          <h3>Como importar</h3>
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, fontSize: 13.5 }}>
            <li>Os arquivos de carga de cada ano são preparados a partir das planilhas, com as regras registradas no projeto.</li>
            <li>No Supabase, abra <b>SQL Editor → New query</b>, cole o arquivo do ano e clique em <b>Run</b>.</li>
            <li>Volte aqui e confira o ano: os totais do app devem bater com os da planilha, mês a mês.</li>
          </ol>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '12px 0 0' }}>Rodar o arquivo de novo substitui o ano, sem duplicar. Os anos anteriores não alteram os saldos atuais das contas, que partem de 01/01/2026.</p>
        </div>
      </div>

      {sel && (
        <div className="card mt">
          <h3>Conferência {sel.ano} <span className={'st ' + (ok ? 'pago' : 'venc')}>{ok ? 'Confere com a planilha' : 'Há diferenças'}</span></h3>
          <table><thead><tr><th>Mês</th><th className="r">Entradas planilha</th><th className="r">Entradas app</th><th className="r">Saídas planilha</th><th className="r">Saídas app</th><th>Situação</th></tr></thead>
            <tbody>{linhas.map(l => { const bate = Math.abs(l.pe - l.ae) < 0.01 && Math.abs(l.ps - l.as) < 0.01; return (
              <tr key={l.mes}><td>{MESES_LONGOS[l.mes - 1]}</td><td className="r">{brl(l.pe)}</td><td className="r">{brl(l.ae)}</td><td className="r">{brl(l.ps)}</td><td className="r">{brl(l.as)}</td>
                <td><span className={'st ' + (bate ? 'pago' : 'venc')}>{bate ? 'Confere' : 'Diferença'}</span></td></tr>); })}
              <tr style={{ fontWeight: 700, background: '#FBF9F3' }}><td>Ano</td><td className="r">{brl(total('pe'))}</td><td className="r">{brl(total('ae'))}</td><td className="r">{brl(total('ps'))}</td><td className="r">{brl(total('as'))}</td><td /></tr>
            </tbody></table>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>
            Arquivo: {sel.arquivo || '·'}. Compras de cartão entram no mês de vencimento da fatura, como na planilha.
            {sel.observacoes && <> Não importados por regra: {sel.observacoes}.</>}
          </p>
        </div>
      )}

      {desfazer && (
        <div className="modal-bg open">
          <div className="modal"><h2>Desfazer importação de {desfazer.ano}?</h2>
            <p style={{ color: 'var(--muted)' }}>Serão apagados {desfazer.lancamentos.toLocaleString('pt-BR')} lançamentos e {desfazer.compras.toLocaleString('pt-BR')} compras de cartão desse ano. Para recuperar, basta rodar o arquivo de carga de novo no Supabase.</p>
            <div className="actions"><button className="btn ghost" onClick={() => setDesfazer(null)}>Cancelar</button><button className="btn" style={{ background: 'var(--neg)', borderColor: 'var(--neg)' }} onClick={confirmarDesfazer}>Desfazer {desfazer.ano}</button></div>
          </div>
        </div>
      )}
    </>
  );
}
