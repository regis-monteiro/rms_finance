import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import CampoValor from '../components/CampoValor';
import DataBR from '../components/DataBR';
import { supabase, type Lancamento, type Status } from '../lib/supabase';
import { brl, dataBR, diaMes, hojeISO, statusEfetivo, classeStatus, STATUS_LABEL, rotuloParte, ROTULO_PARTE } from '../lib/format';
import { useCadastros, centroPadrao, nomeCentro, OpcoesCentro } from '../lib/useCadastros';
import { usePersistente, limparRascunhos } from '../lib/rascunho';
import { invalidarDicionario } from '../lib/sugestao';
import SugestaoClassificacao from '../components/SugestaoClassificacao';
import { EditorRateio, HistoricoPagamentos, linhaVazia, somaRateio } from '../components/Rateio';
import { DetalheLote } from '../components/Recebimentos';
import { ModalEditarLote } from '../components/EditarLote';
import ConfirmarLotes from '../components/ConfirmarLotes';
import { pendenciasDeLote, temOQueReunir, type Candidato } from '../lib/lotes';
import { anterior, carregarRateio, desfazerBaixa, gravarRateio, type LinhaRateio } from '../lib/titulos';
import { Cabecalho } from '../components/Layout';
import { FormBeneficiario } from '../components/Beneficiarios';
import { formatarDocumento } from '../lib/documento';
import { ModalTransferencia, ModalRepeticao, ModalCopiar, ModalAlterarLote } from '../components/LoteLancamentos';
import Rendimentos from '../components/Rendimentos';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const FORMAS = ['Boleto', 'PIX', 'Débito em conta', 'Transferência (TED)', 'Espécie'];
type Form = Partial<Lancamento>;
/** Data que vale para o caixa: pagamento, se pago; senão, vencimento */
const dataEfetiva = (l: Lancamento) => (l.status === 'pago' && l.data_pagamento ? l.data_pagamento : l.vencimento);
const rotulo = (b?: { nome: string; documento: string }) => (b ? `${b.nome} · ${formatarDocumento(b.documento)}` : '');

export default function Lancamentos() {
  const { todosSub, centros, contas, grupos, subgrupos, beneficiarios, recarregar } = useCadastros();
  const [novoBenef, setNovoBenef] = usePersistente('lanc:novo-benef', false);
  const [buscaBenef, setBuscaBenef] = usePersistente('lanc:benef', '');
  const hoje = hojeISO();
  const [mes, setMes] = usePersistente('lanc:mes', hoje.slice(0, 7));
  const [lista, setLista] = useState<Lancamento[]>([]);
  const [f, setF] = useState({ tipo: '', conta: '', status: '', busca: '' });
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [form, setForm] = usePersistente<Form | null>('lanc:form', null);
  const [rateio, setRateio] = usePersistente<LinhaRateio[] | null>('lanc:rateio', null);
  const [comRateio, setComRateio] = useState<Set<number>>(new Set());
  const [lotes, setLotes] = useState<Map<number, number>>(new Map());   // lançamento → lote de baixa de boletos
  const [loteAberto, setLoteAberto] = useState<number | null>(null);
  const fechar = () => { setForm(null); setRateio(null); };
  const [baixa, setBaixa] = useState<{ data: string; conta: string } | null>(null);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0);
  const [aba, setAba] = usePersistente<'lanc' | 'rend'>('lanc:aba', 'lanc');
  const [modal, setModalBruto] = usePersistente<'transf' | 'repet' | 'copiar' | 'alterar' | 'desfazer' | null>('lanc:modal', null);
  const setModal = (m: typeof modal) => { if (!m) limparRascunhos('lote:'); setModalBruto(m); };
  const [aviso, setAviso] = useState('');
  const [params, setParams] = useSearchParams();
  // Atalhos vindos de outras telas: ?abrir=ID abre o lançamento; ?mes, ?tipo e ?status aplicam filtros
  useEffect(() => {
    const id = Number(params.get('abrir')), m = params.get('mes'), t = params.get('tipo'), st = params.get('status');
    if (!id && !m && !t && !st) return;
    setAba('lanc');
    if (m && /^\d{4}-\d{2}$/.test(m)) setMes(m);
    if (t || st) setF(x => ({ ...x, tipo: t || '', status: st || '' }));
    if (id) supabase.from('lancamentos').select('*').eq('id', id).single().then(({ data }) => {
      if (data) { const l = data as Lancamento; setMes(l.vencimento.slice(0, 7)); abrir({ ...l }); }
    });
    setParams({}, { replace: true });
  }, []);
  const avisar = (t: string) => { setAviso(t); setTimeout(() => setAviso(''), 3500); };

  useEffect(() => {
    const [a, m] = mes.split('-').map(Number);
    const fim = new Date(a, m, 0).getDate();
    supabase.from('lancamentos').select('*').or(`and(status.eq.pago,data_pagamento.gte.${mes}-01,data_pagamento.lte.${mes}-${fim}),and(status.neq.pago,vencimento.gte.${mes}-01,vencimento.lte.${mes}-${fim})`).order('id').range(0, 4999)
      .then(async ({ data }) => {
        // Ordem pela data de pagamento (pagos) ou de vencimento (em aberto), como no fluxo de caixa
        const ls = ((data as Lancamento[]) || []).sort((a, b) => dataEfetiva(a).localeCompare(dataEfetiva(b)) || a.id - b.id); setLista(ls); setSel(new Set());
        const ids = ls.map(l => l.id), com = new Set<number>();
        for (let i = 0; i < ids.length; i += 200) {
          const r = await supabase.from('lancamento_rateios').select('lancamento_id').in('lancamento_id', ids.slice(i, i + 200));
          ((r.data as { lancamento_id: number }[]) || []).forEach(x => com.add(x.lancamento_id));
        }
        setComRateio(com);
        // Baixas em lote de boletos aparecem numa linha só, com o total
        const itens: { lote_id: number; lancamento_id: number }[] = [];
        for (let i = 0; i < ids.length; i += 200) {
          const r = await supabase.from('lotes_recebimento_itens').select('lote_id,lancamento_id').in('lancamento_id', ids.slice(i, i + 200));
          itens.push(...((r.data as typeof itens) || []));
        }
        const loteIds = [...new Set(itens.map(x => x.lote_id))];
        const { data: tipos } = loteIds.length ? await supabase.from('lotes_recebimento').select('id,tipo').in('id', loteIds) : { data: [] };
        const deBaixa = new Set(((tipos as { id: number; tipo: string }[]) || []).filter(x => x.tipo === 'baixa').map(x => x.id));
        setLotes(new Map(itens.filter(x => deBaixa.has(x.lote_id)).map(x => [x.lancamento_id, x.lote_id])));
      });
  }, [mes, versao]);

  const nome = (arr: { id: number; nome: string }[], id: number | null) => arr.find(x => x.id === id)?.nome || '';
  const linhas = useMemo(() => lista.filter(l =>
    (!f.tipo || l.tipo === f.tipo) && (!f.conta || String(l.conta_id) === f.conta) &&
    (!f.status || statusEfetivo(l.status, l.vencimento) === f.status) &&
    (!f.busca || (l.favorecido + nome(grupos, l.grupo_id) + nome(todosSub, l.subgrupo_id)).toLowerCase().includes(f.busca.toLowerCase()))
  ), [lista, f, grupos, subgrupos]);
  const exibicao = useMemo(() => {
    const out: (Lancamento | { lote: number; tipo: 'entrada' | 'saida'; data: string; conta: number | null; valor: number; n: number; grupos: number[]; subs: (number | null)[] })[] = [];
    const pos = new Map<number, number>();
    for (const l of linhas) {
      const lt = lotes.get(l.id);
      if (lt == null) { out.push(l); continue; }
      let i = pos.get(lt);
      if (i == null) { i = out.length; pos.set(lt, i); out.push({ lote: lt, tipo: l.tipo, data: l.data_pagamento || l.vencimento, conta: l.conta_id, valor: 0, n: 0, grupos: [], subs: [] }); }
      const g = out[i] as { valor: number; n: number; grupos: number[]; subs: (number | null)[] };
      g.valor = Math.round((g.valor + Number(l.valor)) * 100) / 100; g.n++; if (!g.grupos.includes(l.grupo_id)) g.grupos.push(l.grupo_id); if (!g.subs.includes(l.subgrupo_id ?? null)) g.subs.push(l.subgrupo_id ?? null);
    }
    return out;
  }, [linhas, lotes]);
  const pagosSel = lista.filter(l => sel.has(l.id) && l.status === 'pago' && !l.fatura_id).length;
  const pendentesSel = lista.filter(l => sel.has(l.id) && l.status !== 'pago').length;
  const ent = linhas.filter(l => l.tipo === 'entrada').reduce((a, l) => a + Number(l.valor), 0);
  const sai = linhas.filter(l => l.tipo === 'saida').reduce((a, l) => a + Number(l.valor), 0);

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    if (!form) return;
    const dados = { ...form, valor: Number(form.valor), conta_id: form.conta_id ? Number(form.conta_id) : null, grupo_id: Number(form.grupo_id), subgrupo_id: form.subgrupo_id ? Number(form.subgrupo_id) : null, centro_custo_id: form.centro_custo_id ? Number(form.centro_custo_id) : null,
      data_pagamento: form.status === 'pago' ? (form.data_pagamento || form.vencimento) : null,
      ...(form.status === 'pago' && form.id && lista.find(x => x.id === form.id)?.status !== 'pago' ? { baixa_anterior: anterior(lista.find(x => x.id === form.id)!) } : {}), juros_multa: Number(form.juros_multa || 0), atualizado_em: new Date().toISOString() };
    if (form.status === 'pago' && !dados.conta_id) { setErro('Para marcar como Pago, informe a conta.'); return; }
    if (rateio) {
      const validas = rateio.filter(l => l.grupo_id && Number(l.valor) > 0);
      if (validas.length < 2) { setErro('O rateio precisa de pelo menos duas linhas com grupo e valor. Para uma classificação só, remova o rateio.'); return; }
      if (Math.abs(somaRateio(validas) - dados.valor) >= 0.005) { setErro(`O rateio soma ${brl(somaRateio(validas))}, mas o lançamento é de ${brl(dados.valor)}.`); return; }
      const maior = [...validas].sort((a, b) => Number(b.valor) - Number(a.valor))[0];
      Object.assign(dados, { grupo_id: maior.grupo_id, subgrupo_id: maior.subgrupo_id, centro_custo_id: null });
    }
    if (exigeBenef && !form.beneficiario_id) { setErro('A partir de 01/01/2027, escolha um fornecedor / beneficiário cadastrado.'); return; }
    if (form.transferencia_id) {
      const par = { valor: dados.valor, vencimento: dados.vencimento, status: dados.status, data_pagamento: dados.data_pagamento, observacao: dados.observacao ?? null, atualizado_em: dados.atualizado_em };
      const r1 = await supabase.from('lancamentos').update({ ...par, conta_id: dados.conta_id }).eq('id', form.id!);
      const r2 = await supabase.from('lancamentos').update(par).eq('transferencia_id', form.transferencia_id).neq('id', form.id!);
      if (r1.error || r2.error) { setErro((r1.error || r2.error)!.message); return; }
      fechar(); setVersao(v => v + 1); return;
    }
    const res = form.id ? await supabase.from('lancamentos').update(dados).eq('id', form.id).select().single() : await supabase.from('lancamentos').insert(dados).select().single();
    if (res.error) { setErro(res.error.message); return; }
    if (!form.transferencia_id && !form.fatura_id) {
      const er = await gravarRateio((res.data as Lancamento).id, Number(dados.valor), rateio ?? []);
      if (er) { setErro('Lançamento salvo, mas o rateio não foi gravado: ' + er); setVersao(v => v + 1); return; }
    }
    const erroJuros = await sincronizarJuros(res.data as Lancamento);
    if (erroJuros) { setErro('Lançamento salvo, mas a multa/juros não foi lançada: ' + erroJuros); setVersao(v => v + 1); return; }
    invalidarDicionario(); fechar(); setVersao(v => v + 1);
    const antes = form.id ? lista.find(x => x.id === form.id)?.status : null;
    if (dados.status === 'pago' && antes !== 'pago' && !form.fatura_id) await perguntarLotes([(res.data as Lancamento).id]);
  }

  /** Baixas do mesmo dia, conta e classificação: oferece reunir no lote do dia */
  async function perguntarLotes(ids: number[]) {
    const p = (await pendenciasDeLote(ids)).filter(temOQueReunir);
    if (p.length) setLotesDia(p);
  }

  /** Multa/juros: lançamento separado em Despesas financeiras (pagamento) ou Receitas financeiras (recebimento) */
  async function sincronizarJuros(l: Lancamento): Promise<string | null> {
    const juros = Number(l.juros_multa || 0);
    if (l.status === 'pago' && juros > 0) {
      const g = grupos.find(x => x.nome === (l.tipo === 'saida' ? 'Despesas financeiras' : 'Receitas financeiras'));
      if (!g) return 'rode o arquivo 007_multa_juros.sql no Supabase';
      const sg = subgrupos.find(x => x.grupo_id === g.id && x.nome === 'Multa/juros por atraso');
      const dados = { tipo: l.tipo, conta_id: l.conta_id, vencimento: l.data_pagamento, data_pagamento: l.data_pagamento, grupo_id: g.id, subgrupo_id: sg?.id ?? null,
        favorecido: l.favorecido, beneficiario_id: l.beneficiario_id, referencia: 'Multa/juros: ' + (l.referencia || dataBR(l.vencimento)), valor: juros, status: 'pago', observacao: 'multa/juros por atraso' };
      if (l.juros_lanc_id) { const r = await supabase.from('lancamentos').update(dados).eq('id', l.juros_lanc_id); return r.error?.message ?? null; }
      const r = await supabase.from('lancamentos').insert(dados).select('id').single();
      if (r.error) return r.error.message;
      const u = await supabase.from('lancamentos').update({ juros_lanc_id: r.data.id }).eq('id', l.id);
      return u.error?.message ?? null;
    }
    if (l.juros_lanc_id) {
      await supabase.from('lancamentos').update({ juros_lanc_id: null }).eq('id', l.id);
      const r = await supabase.from('lancamentos').delete().eq('id', l.juros_lanc_id);
      return r.error?.message ?? null;
    }
    return null;
  }

  async function confirmarBaixa(e: React.FormEvent) {
    e.preventDefault(); if (!baixa) return; setErro('');
    const itens = lista.filter(l => sel.has(l.id) && l.status !== 'pago');
    for (const l of itens) {
      const conta = l.conta_id ?? (baixa.conta ? Number(baixa.conta) : null);
      if (!conta) { setErro(`"${l.favorecido}" está sem conta. Escolha uma conta para os itens sem conta.`); return; }
      const { error } = await supabase.from('lancamentos').update({ status: 'pago', data_pagamento: baixa.data, conta_id: conta, baixa_anterior: anterior(l), atualizado_em: new Date().toISOString() }).eq('id', l.id);
      if (error) { setErro(error.message); return; }
    }
    setBaixa(null); setVersao(v => v + 1);
    await perguntarLotes(itens.map(l => l.id));
  }

  async function excluir() {
    if (!form?.id) return;
    const { error } = form.transferencia_id
      ? await supabase.from('lancamentos').delete().eq('transferencia_id', form.transferencia_id)
      : await supabase.from('lancamentos').delete().eq('id', form.id);
    if (!error && form.juros_lanc_id) await supabase.from('lancamentos').delete().eq('id', form.juros_lanc_id);
    if (error) { setErro(error.message); return; }
    fechar(); setVersao(v => v + 1);
  }

  const [confirmaDesfazer, setConfirmaDesfazer] = useState(false);
  const [lotesDia, setLotesDia] = useState<Candidato[] | null>(null);
  const baixadoForm = !!form?.id && lista.find(x => x.id === form.id)?.status === 'pago' && !form.fatura_id;
  async function desfazerForm() {
    if (!form?.id) return;
    const { data } = await supabase.from('lancamentos').select('*').eq('id', form.id).single();
    const e = data ? await desfazerBaixa(data as Lancamento) : 'Lançamento não encontrado.';
    setConfirmaDesfazer(false);
    if (e) { setErro(e); return; }
    fechar(); avisar(form.titulo_id ? 'Pagamento estornado: o valor voltou ao saldo da conta.' : 'Baixa desfeita: a conta voltou a ficar em aberto.'); setVersao(v => v + 1);
  }
  async function desfazerSelecionados() {
    setErro('');
    const itens = lista.filter(l => sel.has(l.id) && l.status === 'pago' && !l.fatura_id);
    const feitos = new Set<string>(); let n = 0; const falhas: string[] = [];
    for (const l of itens) {
      if (l.transferencia_id) { if (feitos.has(l.transferencia_id)) continue; feitos.add(l.transferencia_id); }
      const { data } = await supabase.from('lancamentos').select('*').eq('id', l.id).single();
      const e = data ? await desfazerBaixa(data as Lancamento) : 'não encontrado';
      if (e) falhas.push(`${l.favorecido || 'lançamento'}: ${e}`); else n++;
    }
    setModal(null); setVersao(v => v + 1);
    avisar(`${n} baixa(s) desfeita(s).`);
    if (falhas.length) setErro('Não desfeitas: ' + falhas.join(' · '));
  }
  const abrir = (l: Form) => {
    setConfirmaDesfazer(false);
    setErro(''); setBuscaBenef(rotulo(beneficiarios.find(b => b.id === l.beneficiario_id))); setForm(l); setRateio(null);
    if (l.id) carregarRateio(l.id).then(r => r.length && setRateio(r.map(x => ({ grupo_id: x.grupo_id, subgrupo_id: x.subgrupo_id, centro_custo_id: x.centro_custo_id,
      valor: String(Math.round(Number(x.fracao) * Number(l.valor) * 100) / 100), pct: String(Math.round(Number(x.fracao) * 10000) / 100) }))));
  };
  const recarregarForm = async () => {
    setVersao(v => v + 1);
    if (!form?.id) return;
    const { data } = await supabase.from('lancamentos').select('*').eq('id', form.id).single();
    if (data) setForm({ ...form, ...(data as Lancamento) });
  };
  const novo = () => { setErro(''); setBuscaBenef(''); setRateio(null); setForm({ tipo: 'saida', vencimento: hoje, status: 'previsto', forma_pagamento: 'Boleto', favorecido: '', valor: undefined }); };
  const subsDoGrupo = subgrupos.filter(s => s.grupo_id === Number(form?.grupo_id));
  const grupoForm = grupos.find(g => g.id === Number(form?.grupo_id));
  const exigeBenef = !!form && form.tipo === 'saida' && (form.vencimento || '') >= '2027-01-01' && !form.fatura_id && !form.transferencia_id && !['Transferências', 'Pagamento de fatura'].includes(grupoForm?.nome || '') && contas.find(c => c.id === Number(form.conta_id))?.tipo !== 'aplicacao';
  function escolherBenef(texto: string) {
    setBuscaBenef(texto);
    const b = beneficiarios.find(x => rotulo(x) === texto);
    if (!form) return;
    if (!b) { if (!texto) setForm({ ...form, beneficiario_id: null }); return; }
    setForm({ ...form, beneficiario_id: b.id, favorecido: b.nome, grupo_id: form.grupo_id || b.grupo_id || undefined, subgrupo_id: form.grupo_id ? form.subgrupo_id : b.subgrupo_id });
  }
  const [ano, m] = mes.split('-').map(Number);

  return (
    <>
      <Cabecalho titulo="Lançamentos" sub="Fluxo de caixa: pagos pela data de pagamento e em aberto pelo vencimento">
        <button className="btn ghost" onClick={() => setMes(`${m === 1 ? ano - 1 : ano}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`)}>‹</button>
        <span className="chip" style={{ fontSize: 13, padding: '7px 12px' }}>{MESES[m - 1]}/{ano}</span>
        <button className="btn ghost" onClick={() => setMes(`${m === 12 ? ano + 1 : ano}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`)}>›</button>
      </Cabecalho>
      <div className="tabs">
        <button className={aba === 'lanc' ? 'on' : ''} onClick={() => setAba('lanc')}>Lançamentos</button>
        <button className={aba === 'rend' ? 'on' : ''} onClick={() => setAba('rend')}>Rendimentos de aplicações</button>
        {aviso && <span className="ok" style={{ marginLeft: 'auto', alignSelf: 'center' }}>{aviso}</span>}
      </div>
      {aba === 'rend' ? <Rendimentos mes={mes} /> : <>
      <div className="filters">
        <button className="btn ghost" onClick={() => setModal('transf')}>⇄ Transferência entre contas</button>
        <button className="btn ghost" onClick={() => setModal('repet')}>Previsões em lote</button>
        <span style={{ flex: 1 }} />
        {sel.size > 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{sel.size} selecionado(s):</span>}
        <button className="btn ghost" disabled={!sel.size} onClick={() => setModal('alterar')}>Alterar em lote</button>
        <button className="btn ghost" disabled={!sel.size} onClick={() => setModal('copiar')}>Copiar como previsão</button>
        <button className="btn ghost" disabled={!pendentesSel} onClick={() => { setErro(''); setBaixa({ data: hoje, conta: '' }); }}>Baixar ({pendentesSel})</button>
        <button className="btn ghost" disabled={!pagosSel} onClick={() => setModal('desfazer')} title="Volta os selecionados para em aberto, sem excluir">Desfazer baixa ({pagosSel})</button>
      </div>
      <div className="card">
        <div className="filters">
          <select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}><option value="">Entradas e saídas</option><option value="entrada">Entradas</option><option value="saida">Saídas</option></select>
          <select value={f.conta} onChange={e => setF({ ...f, conta: e.target.value })}><option value="">Todas as contas</option>{contas.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
          <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">Todos os status</option>{Object.entries(STATUS_LABEL).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
          <input placeholder="Buscar fornecedor, cliente ou grupo" value={f.busca} onChange={e => setF({ ...f, busca: e.target.value })} />
          <span style={{ flex: 1 }} />
          <button className="btn gold" onClick={novo}>+ Novo lançamento</button>
        </div>
        {linhas.length === 0 ? <div className="empty">Nenhum lançamento neste mês.</div> : (
          <table className="compacta">
            <thead><tr><th className="c"><input type="checkbox" checked={linhas.length > 0 && linhas.filter(l => !lotes.has(l.id)).every(l => sel.has(l.id))} onChange={e => setSel(e.target.checked ? new Set(linhas.filter(l => !lotes.has(l.id)).map(l => l.id)) : new Set())} /></th>
              <th>Pagamento</th><th>Vencimento</th><th>Tipo</th><th>Conta</th><th>Grupo</th><th>Subgrupo</th><th>{ROTULO_PARTE}</th><th>Ref.</th><th className="r">Valor</th><th>Status</th></tr></thead>
            <tbody>{exibicao.map(x => { if ('lote' in x) return (
              <tr key={'lote' + x.lote} className="clicavel" title="Ver e editar o lote" onClick={() => setLoteAberto(x.lote)}>
                <td className="c" />
                <td>{diaMes(x.data)}</td><td style={{ color: 'var(--muted)' }}>·</td><td>{x.tipo === 'entrada' ? <span className="pos">Entrada</span> : 'Saída'}<div><span className="tag">Lote</span></div></td>
                <td>{nome(contas, x.conta)}</td><td>{x.grupos.length === 1 ? nome(grupos, x.grupos[0]) : 'Vários'}</td><td>{x.subs.length === 1 ? nome(todosSub, x.subs[0]) || '·' : 'Vários'}</td>
                <td>{x.tipo === 'entrada' ? `Recebimento em lote (${x.n} ${x.n > 1 ? 'itens' : 'item'})` : `Pagamento em lote (${x.n} ${x.n > 1 ? 'itens' : 'item'})`}</td><td>·</td>
                <td className={'r ' + (x.tipo === 'entrada' ? 'pos' : '')}>{x.tipo === 'saida' ? '−' : ''}{brl(x.valor)}</td><td><span className="st pago">Pago</span></td>
              </tr>);
              const l = x; const s = statusEfetivo(l.status, l.vencimento); return (
              <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => abrir({ ...l })}>
                <td className="c" onClick={e => e.stopPropagation()}><input type="checkbox" checked={sel.has(l.id)} onChange={e => { const n = new Set(sel); e.target.checked ? n.add(l.id) : n.delete(l.id); setSel(n); }} /></td>
                <td>{l.status === 'pago' && l.data_pagamento ? diaMes(l.data_pagamento) : <span style={{ color: 'var(--muted)' }}>·</span>}</td><td style={l.status === 'pago' ? { color: 'var(--muted)' } : undefined}>{diaMes(l.vencimento)}</td><td>{l.tipo === 'entrada' ? <span className="pos">Entrada</span> : 'Saída'}{l.transferencia_id && <div><span className="tag">Transferência</span></div>}</td>
                <td>{nome(contas, l.conta_id) || <span className="tag">A definir</span>}</td><td>{nome(grupos, l.grupo_id)}{comRateio.has(l.id) && <div><span className="tag">Rateio</span></div>}</td><td>{nome(todosSub, l.subgrupo_id) || '·'}</td>
                <td>{l.favorecido}</td><td>{l.referencia || '·'}</td>
                <td className={'r ' + (l.tipo === 'entrada' ? 'pos' : '')}>{l.tipo === 'saida' ? '−' : ''}{brl(l.valor)}{l.titulo_id ? <div><span className="tag">Parcial</span></div> : l.valor_original != null ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.status === 'pago' ? 'última parcela de ' : 'saldo de '}{brl(l.valor_original)}</div> : null}</td>
                <td><span className={'st ' + classeStatus(s)}>{STATUS_LABEL[s]}</span></td>
              </tr>); })}</tbody>
          </table>
        )}
        <div className="filters" style={{ justifyContent: 'flex-end', margin: '14px 0 0', gap: 22 }}>
          <span>Entradas: <b className="pos">{brl(ent)}</b></span><span>Saídas: <b className="neg">{brl(sai)}</b></span><span>Saldo do filtro: <b>{brl(ent - sai)}</b></span>
        </div>
      </div>

      </>}

      {form && (
        <div className="modal-bg open">
          <div className="modal" style={{ width: 'min(920px, 96vw)' }}><h2>{form.id ? 'Editar lançamento' : 'Novo lançamento'}</h2>
            {form.transferencia_id && <p className="proto" style={{ marginTop: -6 }}>Este lançamento faz parte de uma transferência entre contas. Valor, data e status são atualizados nas duas pontas; excluir remove as duas.</p>}
            <form className="form form4" onSubmit={salvar}>
              <label>Tipo<select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value as 'entrada' | 'saida' })}><option value="saida">Saída</option><option value="entrada">Entrada</option></select></label>
              <label>Conta<select value={form.conta_id ?? ''} onChange={e => setForm({ ...form, conta_id: e.target.value ? Number(e.target.value) : null })}><option value="">A definir</option>{contas.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
              <label>Vencimento<DataBR required value={form.vencimento} onChange={e => setForm({ ...form, vencimento: e.target.value })} /></label>
              <label>Valor (R$)<CampoValor min="0.01" required value={form.valor ?? ''} onChange={e => setForm({ ...form, valor: e.target.value as unknown as number })} /></label>
              {rateio ? <>
                <div className="full" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><b style={{ color: 'var(--navy)', fontSize: 13 }}>Rateio da classificação</b>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>A soma das linhas precisa fechar o valor do lançamento.</span><span style={{ flex: 1 }} />
                  <button type="button" className="btn ghost mini" onClick={() => setRateio(null)}>Remover rateio</button></div>
                <EditorRateio total={Number(form.valor || 0)} linhas={rateio} aoMudar={setRateio} grupos={grupos} subgrupos={subgrupos} centros={centros} tipo={form.tipo || 'saida'} />
              </> : <>
              <label>Grupo<select required value={form.grupo_id ?? ''} onChange={e => setForm({ ...form, grupo_id: Number(e.target.value), subgrupo_id: null })}><option value="" disabled>Selecione</option>{grupos.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select></label>
              <label>Subgrupo<select value={form.subgrupo_id ?? ''} onChange={e => setForm({ ...form, subgrupo_id: e.target.value ? Number(e.target.value) : null })}><option value="">·</option>{subsDoGrupo.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
              <label className="span2">Centro de custo<select value={form.centro_custo_id ?? ''} onChange={e => setForm({ ...form, centro_custo_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{'Padrão do plano: ' + (nomeCentro(centros, centroPadrao(grupos, subgrupos, Number(form.grupo_id), Number(form.subgrupo_id))) || 'Geral (sem centro)')}</option><OpcoesCentro centros={centros} /></select></label>
              {!form.transferencia_id && !form.fatura_id && <SugestaoClassificacao tipo={form.tipo || 'saida'} beneficiario_id={form.beneficiario_id} texto={form.favorecido} grupo_id={form.grupo_id} subgrupo_id={form.subgrupo_id}
                grupos={grupos} subgrupos={subgrupos} aoUsar={o => setForm({ ...form, grupo_id: o.grupo_id, subgrupo_id: o.subgrupo_id, centro_custo_id: o.centro_custo_id ?? form.centro_custo_id ?? null })} />}
              {!form.transferencia_id && !form.fatura_id && <div className="full" style={{ marginTop: -4 }}><button type="button" className="btn ghost mini" onClick={() => setRateio([
                { grupo_id: form.grupo_id ? Number(form.grupo_id) : null, subgrupo_id: form.subgrupo_id ? Number(form.subgrupo_id) : null, centro_custo_id: form.centro_custo_id ?? null, valor: form.valor ? String(form.valor) : '', pct: form.valor ? '100' : '' }, linhaVazia()])}>Ratear entre classificações</button></div>}
              </>}
              <label className="span2">{rotuloParte(form.tipo)} cadastrado{exigeBenef ? ' *' : form.tipo === 'saida' ? ' (opcional até 31/12/2026)' : ' (opcional)'}
                <span style={{ display: 'flex', gap: 6 }}>
                  <input list="lista-benef" style={{ flex: 1 }} placeholder="Digite o nome ou CPF/CNPJ" value={buscaBenef} onChange={e => escolherBenef(e.target.value)} required={exigeBenef} />
                  <button type="button" className="btn ghost" onClick={() => setNovoBenef(true)}>+ Novo</button>
                </span>
                <datalist id="lista-benef">{beneficiarios.filter(b => b.ativo).map(b => <option key={b.id} value={rotulo(b)} />)}</datalist>
              </label>
              {!form.beneficiario_id && <label className="span2">{rotuloParte(form.tipo)}<input required value={form.favorecido} onChange={e => setForm({ ...form, favorecido: e.target.value })} /></label>}
              <label>Referência<input placeholder="Parcela ou competência" value={form.referencia ?? ''} onChange={e => setForm({ ...form, referencia: e.target.value })} /></label>
              <label>Documento<input value={form.documento ?? ''} onChange={e => setForm({ ...form, documento: e.target.value })} /></label>
              <label>Status<select value={form.status} onChange={e => { const st = e.target.value as Status; setForm({ ...form, status: st, data_pagamento: st === 'pago' ? (form.data_pagamento || hoje) : null }); }}>{(['previsto', 'confirmado', 'agendado', 'pago'] as Status[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
              <label>Forma de pagamento<select value={form.forma_pagamento ?? ''} onChange={e => setForm({ ...form, forma_pagamento: e.target.value })}>{FORMAS.map(x => <option key={x}>{x}</option>)}</select></label>
              <label>Data do {form.tipo === 'entrada' ? 'recebimento' : 'pagamento'}<DataBR required={form.status === 'pago'} value={form.data_pagamento ?? ''}
                onChange={e => setForm({ ...form, data_pagamento: e.target.value || null, status: e.target.value ? 'pago' : form.status === 'pago' ? 'confirmado' : form.status })} /></label>
              <label>Multa / juros por atraso (R$)<CampoValor min="0" disabled={!!form.transferencia_id || !!form.fatura_id} value={form.juros_multa || ''} placeholder="0,00"
                onChange={e => setForm({ ...form, juros_multa: e.target.value as unknown as number })} /></label>
              {Number(form.juros_multa || 0) > 0 && <p className="full" style={{ margin: '-4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
                {brl(Number(form.juros_multa))} serão lançados em <b>{form.tipo === 'saida' ? 'Despesas financeiras' : 'Receitas financeiras'} · Multa/juros por atraso</b>, na data do {form.tipo === 'entrada' ? 'recebimento' : 'pagamento'}{form.status !== 'pago' ? ', quando o status for Pago' : ''}. Total {form.tipo === 'entrada' ? 'recebido' : 'pago'}: {brl(Number(form.valor || 0) + Number(form.juros_multa))}.</p>}
              {form.id && !form.transferencia_id && !form.fatura_id && !form.titulo_id && (form.valor_original != null || form.status !== 'pago') &&
                <HistoricoPagamentos titulo={form as Lancamento} contas={contas} aoMudar={recarregarForm} />}
              {form.id && <DetalheLote lancamentoId={form.id} aoEditar={id => { fechar(); setLoteAberto(id); }} />}
              {form.titulo_id && <p className="full proto" style={{ margin: 0 }}>Este é um {form.tipo === 'entrada' ? 'recebimento' : 'pagamento'} parcial. <a href="#" onClick={async e => { e.preventDefault(); const { data } = await supabase.from('lancamentos').select('*').eq('id', form.titulo_id!).single(); if (data) abrir(data as Lancamento); }}>Abrir a conta original</a> para ver o histórico e o saldo.</p>}
              <label className="full">Observação<input value={form.observacao ?? ''} onChange={e => setForm({ ...form, observacao: e.target.value })} /></label>
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full">
                {form.id && <button type="button" className="btn ghost" style={{ marginRight: baixadoForm ? 0 : 'auto', color: 'var(--neg)' }} onClick={excluir}>Excluir</button>}
                {baixadoForm && (!confirmaDesfazer
                  ? <button type="button" className="btn ghost" style={{ marginRight: 'auto' }} title="Volta a ficar em aberto, sem excluir a conta" onClick={() => setConfirmaDesfazer(true)}>{form.titulo_id ? 'Estornar este pagamento' : 'Desfazer baixa'}</button>
                  : <span style={{ marginRight: 'auto', display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>{form.titulo_id ? 'O valor volta ao saldo da conta.' : 'A conta volta a ficar em aberto.'}{form.ofx_fitid ? ' A conciliação com o extrato também é desfeita.' : ''}
                    <button type="button" className="btn mini" onClick={desfazerForm}>Confirmar</button><button type="button" className="btn ghost mini" onClick={() => setConfirmaDesfazer(false)}>Não</button></span>)}
                <button type="button" className="btn ghost" onClick={() => fechar()}>Cancelar</button><button className="btn">Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal === 'desfazer' && (
        <div className="modal-bg open"><div className="modal"><h2>Desfazer baixa de {pagosSel} lançamento(s)</h2>
          <p style={{ fontSize: 13 }}>Os lançamentos voltam a ficar em aberto, com o status e a conta que tinham antes da baixa. Nada é excluído. Pagamentos parciais voltam ao saldo da conta original; transferências voltam nas duas pontas; multa/juros lançados na baixa são removidos; itens de lote de boletos saem do lote (com a tarifa recalculada); conciliações com o extrato são desfeitas.</p>
          {erro && <div className="err">{erro}</div>}
          <div className="actions"><button className="btn ghost" onClick={() => setModal(null)}>Cancelar</button><button className="btn" onClick={desfazerSelecionados}>Desfazer baixa</button></div>
        </div></div>
      )}
      {lotesDia && <ConfirmarLotes pendentes={lotesDia} cad={{ contas, grupos, subgrupos: todosSub }} aoConcluir={() => { setLotesDia(null); setVersao(v => v + 1); }} />}
      {loteAberto != null && <ModalEditarLote loteId={loteAberto} cad={{ contas, grupos, subgrupos, centros, beneficiarios }} aoFechar={() => setLoteAberto(null)}
        aoSalvar={m => { setLoteAberto(null); avisar(m); setVersao(v => v + 1); }} />}
      {novoBenef && form && (
        <FormBeneficiario rascunho="lanc:benef-form" inicial={{ ativo: true, nome: form.favorecido, grupo_id: form.grupo_id ?? null }} grupos={grupos} subgrupos={subgrupos}
          aoFechar={() => setNovoBenef(false)}
          aoSalvar={b => { setNovoBenef(false); recarregar(); setBuscaBenef(rotulo(b)); setForm({ ...form, beneficiario_id: b.id, favorecido: b.nome }); }} />
      )}

      {baixa && (
        <div className="modal-bg open">
          <div className="modal"><h2>Baixar {sel.size} lançamento(s)</h2>
            <form className="form" onSubmit={confirmarBaixa}>
              <label>Data do pagamento<DataBR required value={baixa.data} onChange={e => setBaixa({ ...baixa, data: e.target.value })} /></label>
              <label>Conta (para itens sem conta)<select value={baixa.conta} onChange={e => setBaixa({ ...baixa, conta: e.target.value })}><option value="">Manter a do lançamento</option>{contas.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setBaixa(null)}>Cancelar</button><button className="btn">Confirmar baixa</button></div>
            </form>
          </div>
        </div>
      )}
      {modal === 'transf' && <ModalTransferencia cad={{ contas, grupos, subgrupos, beneficiarios }} hoje={hoje} aoFechar={() => setModal(null)} aoSalvar={() => { setModal(null); avisar('Transferência registrada'); setVersao(v => v + 1); }} />}
      {modal === 'repet' && <ModalRepeticao cad={{ contas, grupos, subgrupos, beneficiarios }} hoje={hoje} aoFechar={() => setModal(null)} aoSalvar={n => { setModal(null); avisar(n + ' previsões criadas'); setVersao(v => v + 1); }} />}
      {modal === 'copiar' && <ModalCopiar itens={lista.filter(l => sel.has(l.id))} cad={{ contas, grupos, subgrupos, beneficiarios }} aoFechar={() => setModal(null)} aoSalvar={n => { setModal(null); avisar(n + ' previsões criadas nos meses seguintes'); setVersao(v => v + 1); }} />}
      {modal === 'alterar' && <ModalAlterarLote itens={lista.filter(l => sel.has(l.id))} cad={{ contas, grupos, subgrupos, beneficiarios }} hoje={hoje} aoFechar={() => setModal(null)} aoSalvar={n => { setModal(null); avisar(n + ' lançamento(s) alterado(s)'); setVersao(v => v + 1); }} />}
    </>
  );
}
