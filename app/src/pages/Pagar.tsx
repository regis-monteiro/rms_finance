import { useEffect, useMemo, useState } from 'react';
import CampoValor from '../components/CampoValor';
import DataBR from '../components/DataBR';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, type Lancamento } from '../lib/supabase';
import { brl, dataBR, diaMes, hojeISO, somaDias, statusEfetivo, classeStatus, STATUS_LABEL } from '../lib/format';
import { useCadastros } from '../lib/useCadastros';
import { sincronizarFatura } from '../lib/faturas';
import { Cabecalho } from '../components/Layout';
import { formatarDocumento } from '../lib/documento';
import { usePersistente } from '../lib/rascunho';
import { registrarPagamento } from '../lib/titulos';
import { sincronizarDesconto } from '../lib/descontos';
import { pendenciasDeLote, temOQueReunir, type Candidato } from '../lib/lotes';
import ConfirmarLotes from '../components/ConfirmarLotes';
import PrevistasVencidas from '../components/PrevistasVencidas';
import { ModalLancarContas } from '../components/LancarContas';
import { ModalAlterarLote } from '../components/LoteLancamentos';
import { BarraSelecao, ModalBaixarVarias, ModalExcluirContas } from '../components/AcoesSelecao';

const SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export default function Pagar() {
  const { contas, grupos, subgrupos, beneficiarios, centros , todosGrupos } = useCadastros();
  const [lote, setLote] = usePersistente('pagar:lote', false);
  const [aviso, setAviso] = useState('');
  const [copiado, setCopiado] = useState(false);
  const hoje = hojeISO();
  const [lista, setLista] = useState<Lancamento[]>([]);
  const [f, setF] = useState({ per: 'mes', conta: '', grupo: '', status: '' });
  const [baixa, setBaixa] = usePersistente<{ l: Lancamento; data: string; conta: string; valor: string; juros: string; desconto?: string } | null>('pagar:baixa', null);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0);
  const [lotesDia, setLotesDia] = useState<Candidato[] | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [erroLista, setErroLista] = useState('');
  const [acao, setAcao] = useState<'' | 'alterar' | 'baixar' | 'excluir'>('');
  const nav = useNavigate();

  useEffect(() => {
    supabase.from('lancamentos').select('*').eq('tipo', 'saida').neq('status', 'pago').order('vencimento').order('id')
      .then(({ data }) => setLista((data as Lancamento[]) || []));
  }, [versao]);

  const fimMes = (() => { const [a, m] = hoje.split('-').map(Number); return `${hoje.slice(0, 7)}-${new Date(a, m, 0).getDate()}`; })();
  const limite = f.per === '7' ? somaDias(hoje, 7) : f.per === 'mes' ? fimMes : '9999-12-31';
  const nome = (arr: { id: number; nome: string }[], id: number | null) => arr.find(x => x.id === id)?.nome || '';
  const linhas = useMemo(() => lista.filter(l => l.vencimento <= limite &&
    (!f.conta || (f.conta === 'sem' ? !l.conta_id : String(l.conta_id) === f.conta)) &&
    (!f.grupo || String(l.grupo_id) === f.grupo) && (!f.status || statusEfetivo(l.status, l.vencimento) === f.status)), [lista, f, limite]);

  const marcados = lista.filter(l => sel.has(l.id));
  const alternar = (id: number, on: boolean) => { const n = new Set(sel); on ? n.add(id) : n.delete(id); setSel(n); };
  const avisar = (m: string) => { setAviso(m); setTimeout(() => setAviso(''), 6000); };
  /** Alterar uma conta: a edição completa abre em Lançamentos e volta para esta tela ao fechar */
  const editar = (l: Lancamento) => nav(l.fatura_id ? '/cartoes?fatura=' + l.fatura_id : `/lancamentos?abrir=${l.id}&voltar=/pagar`);
  const abrirBaixa = (l: Lancamento) => { setErro(''); setBaixa({ l, data: hoje, conta: l.conta_id ? String(l.conta_id) : '', valor: String(l.valor), juros: '' }); };
  function executar(a: 'alterar' | 'baixar' | 'excluir') {
    if (a === 'alterar' && marcados.length === 1) return editar(marcados[0]);
    if (a === 'baixar' && marcados.length === 1) return abrirBaixa(marcados[0]);
    setAcao(a);
  }
  const soma = (a: Lancamento[]) => a.reduce((s, l) => s + Number(l.valor), 0);
  const vencidas = lista.filter(l => l.vencimento < hoje);
  const hojeL = lista.filter(l => l.vencimento === hoje);
  const sete = lista.filter(l => l.vencimento > hoje && l.vencimento <= somaDias(hoje, 7));
  const dias: [string, Lancamento[]][] = [];
  linhas.forEach(l => { const u = dias[dias.length - 1]; u && u[0] === l.vencimento ? u[1].push(l) : dias.push([l.vencimento, [l]]); });

  async function confirmar(e: React.FormEvent) {
    e.preventDefault(); if (!baixa) return; setErro('');
    const { l } = baixa, valor = Number(baixa.valor), juros = Number(baixa.juros || 0), desconto = l.fatura_id ? 0 : Number(baixa.desconto || 0);
    if (!baixa.conta) { setErro('Informe a conta do pagamento.'); return; }
    if (desconto < 0) { setErro('O desconto não pode ser negativo.'); return; }
    if (desconto > 0 && Math.abs(valor + desconto - Number(l.valor)) >= 0.005) { setErro(`Com desconto, a conta é quitada: valor pago + desconto deve somar ${brl(l.valor)}.`); return; }
    if (valor <= 0 || valor > Number(l.valor) + 0.004) { setErro('O valor pago deve ser maior que zero e até ' + brl(l.valor) + '.'); return; }
    const conta_id = Number(baixa.conta);
    const parcial = valor < Number(l.valor) - 0.004;
    let idPago: number | null = null;
    if (!l.fatura_id) {
      // conta única: pagamento parcial fica no histórico e o saldo continua em aberto
      const r = await registrarPagamento(l, Math.round((valor + desconto) * 100) / 100, baixa.data, conta_id);
      if (r.erro) { setErro(r.erro); return; }
      if (r.id) idPago = r.id;
      if (desconto > 0 && r.id) {
        const { data: pago } = await supabase.from('lancamentos').select('*').eq('id', r.id).single();
        const ed = pago ? await sincronizarDesconto(pago as Lancamento, desconto) : 'conta não encontrada';
        if (ed) { setErro('Baixa registrada, mas o desconto não foi lançado: ' + ed); setVersao(v => v + 1); return; }
      }
    } else if (l.fatura_id) {
      const { data: g } = await supabase.from('grupos').select('id').eq('nome', 'Pagamento de fatura').single();
      const r = await supabase.from('lancamentos').insert({ tipo: 'saida', conta_id, vencimento: l.vencimento, data_pagamento: baixa.data, grupo_id: g!.id, favorecido: l.favorecido, referencia: l.referencia, valor, status: 'pago', fatura_id: l.fatura_id });
      if (r.error) { setErro(r.error.message); return; }
      await sincronizarFatura(l.fatura_id);
    }
    if (juros > 0) {
      const g = todosGrupos.find(x => x.nome === 'Despesas financeiras') || todosGrupos.find(x => x.nome === 'Juros Bancários');
      const sg = subgrupos.find(x => x.grupo_id === g!.id && x.nome === 'Multa/juros por atraso');
      const r = await supabase.from('lancamentos').insert({ tipo: 'saida', conta_id, vencimento: baixa.data, data_pagamento: baixa.data, grupo_id: g!.id, subgrupo_id: sg?.id ?? null, favorecido: l.favorecido, beneficiario_id: l.beneficiario_id, referencia: 'Multa/juros: ' + (l.referencia || dataBR(l.vencimento)), valor: juros, status: 'pago', observacao: 'multa/juros por atraso' }).select('id').single();
      if (!r.error && !parcial && !l.fatura_id) await supabase.from('lancamentos').update({ juros_multa: juros, juros_lanc_id: r.data.id }).eq('id', l.id);
    }
    setBaixa(null); setVersao(v => v + 1);
    if (idPago) { const p = (await pendenciasDeLote([idPago])).filter(temOQueReunir); if (p.length) setLotesDia(p); }
  }

  return (
    <>
      <Cabecalho titulo="Contas a pagar" sub="Saídas em aberto, uma a uma, incluindo saldos de faturas de cartão">{aviso && <span className="ok">{aviso}</span>}<button className="btn gold" onClick={() => setLote(true)}>+ Novas contas a pagar</button></Cabecalho>
      <PrevistasVencidas tipo="saida" recarga={versao} aoMudar={() => setVersao(v => v + 1)} />
      {acao === 'alterar' && <ModalAlterarLote itens={marcados} cad={{ contas, grupos, subgrupos, beneficiarios }} hoje={hoje} aoFechar={() => setAcao('')} aoSalvar={n => { setAcao(''); setSel(new Set()); avisar(n + ' conta(s) alterada(s).'); setVersao(v => v + 1); }} />}
      {acao === 'excluir' && <ModalExcluirContas itens={marcados} aoFechar={() => setAcao('')} aoConcluir={(m, f) => { setAcao(''); setSel(new Set()); avisar(m); if (f.length) setErroLista('Não excluídas: ' + f.join(' · ')); setVersao(v => v + 1); }} />}
      {acao === 'baixar' && <ModalBaixarVarias itens={marcados} contas={contas} hoje={hoje} aoFechar={() => setAcao('')} aoConcluir={async (ids, m) => { setAcao(''); setSel(new Set()); avisar(m); setVersao(v => v + 1); const p = (await pendenciasDeLote(ids)).filter(temOQueReunir); if (p.length) setLotesDia(p); }} />}
      {lotesDia && <ConfirmarLotes pendentes={lotesDia} cad={{ contas, grupos, subgrupos }} aoConcluir={m => { setLotesDia(null); if (m) { setAviso(m); setTimeout(() => setAviso(''), 6000); } }} />}
      {lote && <ModalLancarContas tipo="saida" cad={{ contas, grupos, subgrupos, centros, beneficiarios }} aoFechar={() => setLote(false)} aoSalvar={m => { setLote(false); setAviso(m); setTimeout(() => setAviso(''), 6000); setVersao(v => v + 1); }} aoGravar={() => setVersao(v => v + 1)} />}
      <div className="grid g4">
        <div className="card kpi"><div className="lbl">Vencidas</div><div className="val neg">{brl(soma(vencidas))}</div><div className="sub">{vencidas.length} itens</div></div>
        <div className="card kpi"><div className="lbl">Vencem hoje</div><div className="val">{brl(soma(hojeL))}</div><div className="sub">{hojeL.length} itens</div></div>
        <div className="card kpi"><div className="lbl">Próximos 7 dias</div><div className="val">{brl(soma(sete))}</div><div className="sub">{sete.length} itens</div></div>
        <div className="card kpi total"><div className="lbl">Total no filtro</div><div className="val">{brl(soma(linhas))}</div><div className="sub">{linhas.length} itens</div></div>
      </div>
      <div className="card mt">
        <div className="filters">
          <select value={f.per} onChange={e => setF({ ...f, per: e.target.value })}><option value="7">Até 7 dias</option><option value="mes">Até o fim do mês</option><option value="tudo">Tudo em aberto</option></select>
          <select value={f.conta} onChange={e => setF({ ...f, conta: e.target.value })}><option value="">Todas as contas</option>{contas.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}<option value="sem">Conta a definir</option></select>
          <select value={f.grupo} onChange={e => setF({ ...f, grupo: e.target.value })}><option value="">Todos os grupos</option>{grupos.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select>
          <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">Todos os status</option>{(['vencido', 'previsto', 'confirmado', 'agendado'] as const).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
        </div>
        {erroLista && <div className="err" style={{ marginBottom: 10 }} onClick={() => setErroLista('')}>{erroLista}</div>}
        <BarraSelecao n={marcados.length} total={soma(marcados)} aoLimpar={() => setSel(new Set())}>
          <button className="btn ghost mini" onClick={() => executar('alterar')}>{marcados.length > 1 ? 'Alterar em lote' : 'Alterar'}</button>
          <button className="btn mini" onClick={() => executar('baixar')}>Baixar</button>
          <button className="btn ghost mini" style={{ color: 'var(--neg)' }} onClick={() => executar('excluir')}>Excluir</button>
        </BarraSelecao>
        {dias.length === 0 ? <div className="empty">Nada em aberto neste filtro.</div> : (
          <table>
            <thead><tr><th className="c"><input type="checkbox" checked={linhas.length > 0 && linhas.every(l => sel.has(l.id))} onChange={e => setSel(e.target.checked ? new Set(linhas.map(l => l.id)) : new Set())} /></th><th>Vencimento</th><th>Fornecedor / Beneficiário</th><th>Grupo</th><th>Subgrupo</th><th>Conta</th><th>Ref.</th><th className="r">Valor</th><th>Status</th><th className="r">Ação</th></tr></thead>
            <tbody>{dias.map(([d, ls]) => [
              <tr key={d}><td colSpan={10} style={{ background: '#FBF9F3', fontWeight: 600, fontSize: 12.5, color: 'var(--navy)' }}>
                {dataBR(d)} · {SEMANA[new Date(d + 'T12:00:00').getDay()]}<span style={{ float: 'right' }}>{brl(soma(ls))}</span></td></tr>,
              ...ls.map(l => { const s = statusEfetivo(l.status, l.vencimento); return (
                <tr key={l.id} className="clicavel" title={l.fatura_id ? 'Abrir a fatura' : 'Alterar a conta'} onClick={() => editar(l)} style={sel.has(l.id) ? { background: 'var(--gold-soft)' } : undefined}>
                  <td className="c" onClick={e => e.stopPropagation()}><input type="checkbox" checked={sel.has(l.id)} onChange={e => alternar(l.id, e.target.checked)} /></td>
                  <td>{diaMes(l.vencimento)}</td><td>{l.favorecido}{l.observacao && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{l.observacao}</div>}{l.cliente_id ? <div><span className="tag">Cliente: {beneficiarios.find(b => b.id === l.cliente_id)?.nome}</span></div> : null}</td>
                  <td>{nome(todosGrupos, l.grupo_id)}</td><td>{nome(subgrupos, l.subgrupo_id) || '·'}</td>
                  <td>{nome(contas, l.conta_id) || <span className="tag">A definir</span>}</td><td>{l.referencia || '·'}</td>
                  <td className="r">{brl(l.valor)}{l.valor_original != null && <div style={{ fontSize: 11, color: 'var(--muted)' }}>saldo de {brl(l.valor_original)}</div>}</td><td><span className={'st ' + classeStatus(s)}>{STATUS_LABEL[s]}</span></td>
                  <td className="r" style={{ whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                    {l.fatura_id && <Link to={'/cartoes?fatura=' + l.fatura_id} className="btn ghost" style={{ padding: '4px 10px', textDecoration: 'none', marginRight: 6 }}>Fatura</Link>}
                    <button className="btn ghost" style={{ padding: '4px 10px' }} onClick={() => abrirBaixa(l)}>Baixar</button>
                  </td>
                </tr>); })])}</tbody>
          </table>
        )}
      </div>

      {baixa && (
        <div className="modal-bg open">
          <div className="modal"><h2>Baixar pagamento</h2>
            <p style={{ margin: '-6px 0 14px', color: 'var(--muted)' }}>{baixa.l.favorecido} · vencimento {dataBR(baixa.l.vencimento)} · {brl(baixa.l.valor)}</p>
            {(() => { const b = beneficiarios.find(x => x.id === baixa.l.beneficiario_id); return b && (
              <div style={{ background: 'var(--ivory)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13 }}>
                <b>{b.nome}</b> · {formatarDocumento(b.documento)}
                {b.pix_chave && <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>PIX: <code>{b.pix_chave}</code>
                  <button type="button" className="btn ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => { navigator.clipboard?.writeText(b.pix_chave!).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); }).catch(() => {}); }}>{copiado ? 'Copiado' : 'Copiar'}</button></div>}
                {(b.banco || b.agencia || b.conta) && <div style={{ marginTop: 4, color: 'var(--muted)' }}>Banco {b.banco || '·'} · Ag. {b.agencia || '·'} · Conta {b.conta || '·'}</div>}
              </div>); })()}
            <form className="form" onSubmit={confirmar}>
              <label>Data do pagamento<DataBR required value={baixa.data} onChange={e => setBaixa({ ...baixa, data: e.target.value })} /></label>
              <label>Conta<select required value={baixa.conta} onChange={e => setBaixa({ ...baixa, conta: e.target.value })}><option value="" disabled>Selecione</option>{contas.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
              <label>Valor pago (R$)<CampoValor min="0.01" required value={baixa.valor} onChange={e => setBaixa({ ...baixa, valor: e.target.value })} /></label>
              <label>Juros / multa (R$)<CampoValor min="0" value={baixa.juros} onChange={e => setBaixa({ ...baixa, juros: e.target.value })} /></label>
              {!baixa.l.fatura_id && <label>Desconto obtido (R$)<CampoValor min="0" value={baixa.desconto || ''} onChange={e => { const d = Number(e.target.value || 0); setBaixa({ ...baixa, desconto: e.target.value, valor: d > 0 ? String(Math.round((Number(baixa.l.valor) - d) * 100) / 100) : String(baixa.l.valor) }); }} /></label>}
              <p className="full" style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Valor menor que o total registra pagamento parcial; a diferença continua em aberto. Multa e juros entram como lançamento separado em Despesas financeiras · Multa/juros por atraso.{!baixa.l.fatura_id && ' Com desconto, a conta é quitada e o desconto entra em Receitas financeiras · Descontos obtidos.'}</p>
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setBaixa(null)}>Cancelar</button><button className="btn">Confirmar baixa</button></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
