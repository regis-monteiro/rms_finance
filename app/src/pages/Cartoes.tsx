import { useEffect, useMemo, useState } from 'react';
import CampoValor from '../components/CampoValor';
import DataBR from '../components/DataBR';
import { useSearchParams } from 'react-router-dom';
import { supabase, type Lancamento, type Status } from '../lib/supabase';
import { brl, dataBR, diaMes, hojeISO, STATUS_LABEL, classeStatus } from '../lib/format';
import { useCadastros, nomeCentro, OpcoesCentro } from '../lib/useCadastros';
import { usePersistente } from '../lib/rascunho';
import { datasFatura, obterFatura, sincronizarFatura, situacaoFatura } from '../lib/faturas';
import { Cabecalho } from '../components/Layout';
import { anterior, desfazerBaixa } from '../lib/titulos';
import { BarraSelecao } from '../components/AcoesSelecao';

interface Fatura { id: number; cartao_id: number; cartao: string; competencia: string; data_fechamento: string; data_vencimento: string; total: number; pago: number }
interface Compra { id: number; fatura_id: number; data_compra: string; descricao: string; grupo_id: number; subgrupo_id: number | null; centro_custo_id: number | null; beneficiario_id?: number | null; observacao?: string | null; parcela: string | null; valor: number }
interface Estab { descricao: string; grupo_id: number; subgrupo_id: number | null; beneficiario_id: number | null }
const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const comp = (c: string) => MES[Number(c.slice(5, 7)) - 1] + '/' + c.slice(0, 4);

export default function Cartoes() {
  const { centros, contas, grupos, subgrupos, todosSub, cartoes, beneficiarios } = useCadastros();
  const hoje = hojeISO();
  const [params, setParams] = useSearchParams();
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [cartaoId, setCartaoId] = usePersistente<number | null>('cart:cartao', null);
  const [faturaId, setFaturaId] = usePersistente<number | null>('cart:fatura', null);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [pags, setPags] = useState<Lancamento[]>([]);
  const [aba, setAba] = useState<'compras' | 'pag'>('compras');
  const [novaCompra, setNovaCompra] = usePersistente<{ data: string; descricao: string; grupo: string; sub?: string; valor: string; parcelas: string; centro?: string; obs?: string; benef?: string } | null>('cart:compra', null);
  const [pagto, setPagto] = usePersistente<{ conta: string; data: string; valor: string; status: Status } | null>('cart:pagto', null);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0);
  const recarregar = () => setVersao(v => v + 1);
  const [selC, setSelC] = useState<Set<number>>(new Set());
  const [editC, setEditC] = useState<{ ids: number[]; data: string; descricao: string; grupo: string; sub: string; centro: string; valor: string; obs: string; benef: string } | null>(null);
  const [historico, setHistorico] = useState<Estab[]>([]);
  const [confExcluir, setConfExcluir] = useState(false);

  useEffect(() => {
    supabase.from('faturas_resumo').select('*').order('competencia').then(({ data }) => {
      const fs = (data as Fatura[]) || [];
      setFaturas(fs);
      const q = Number(params.get('fatura'));
      const alvo = fs.find(x => x.id === q);
      if (alvo) { setCartaoId(alvo.cartao_id); setFaturaId(alvo.id); setParams({}, { replace: true }); return; }
      if (cartaoId == null && fs.length) setCartaoId(fs[0].cartao_id);
    });
  }, [versao]);

  const doCartao = useMemo(() => faturas.filter(f => f.cartao_id === cartaoId), [faturas, cartaoId]);
  useEffect(() => {
    if (!doCartao.length) { setFaturaId(null); return; }
    if (faturaId && doCartao.some(f => f.id === faturaId)) return;
    const atual = doCartao.find(f => f.data_vencimento >= hoje && Number(f.total) - Number(f.pago) > 0.004) || doCartao.filter(f => f.data_vencimento <= hoje).pop() || doCartao[0];
    setFaturaId(atual.id);
  }, [doCartao]);

  useEffect(() => {
    setSelC(new Set()); setConfExcluir(false);
    if (!faturaId) { setCompras([]); setPags([]); return; }
    supabase.from('compras_cartao').select('*').eq('fatura_id', faturaId).order('data_compra').then(({ data }) => setCompras((data as Compra[]) || []));
    supabase.from('lancamentos').select('*').eq('fatura_id', faturaId).order('vencimento').then(({ data }) => setPags((data as Lancamento[]) || []));
  }, [faturaId, versao]);

  // Estabelecimentos já usados (sugestão de classificação) e cadastros de fornecedores
  useEffect(() => {
    supabase.from('compras_cartao').select('descricao,grupo_id,subgrupo_id,beneficiario_id').order('id', { ascending: false }).range(0, 2999).then(({ data }) => {
      const vistos = new Set<string>(), out: Estab[] = [];
      for (const c of (data as Estab[]) || []) { const k = c.descricao.trim().toLowerCase(); if (!vistos.has(k)) { vistos.add(k); out.push(c); } }
      setHistorico(out);
    });
  }, [versao]);
  /** Ao escolher o estabelecimento: liga ao cadastro (se houver) e sugere grupo e subgrupo, sem sobrescrever o que já foi escolhido */
  function escolherEstab<T extends { descricao: string; grupo: string; sub?: string; benef?: string }>(f: T, texto: string): T {
    const q = texto.trim().toLowerCase();
    const b = beneficiarios.find(x => x.nome.toLowerCase() === q || (x.nome_fantasia || '').toLowerCase() === q);
    const h = historico.find(x => x.descricao.trim().toLowerCase() === q);
    const g = f.grupo || String(h?.grupo_id || b?.grupo_id || '');
    const sub = f.grupo ? f.sub : String((h ? h.subgrupo_id : b?.subgrupo_id) || '');
    return { ...f, descricao: texto, benef: b ? String(b.id) : h?.beneficiario_id ? String(h.beneficiario_id) : '', grupo: g, sub: sub || '' };
  }
  const opcoesEstab = useMemo(() => {
    const nomes = new Map<string, string>();
    beneficiarios.filter(b => b.ativo).forEach(b => nomes.set(b.nome.toLowerCase(), b.nome));
    historico.forEach(h => { if (!nomes.has(h.descricao.trim().toLowerCase())) nomes.set(h.descricao.trim().toLowerCase(), h.descricao.trim()); });
    return [...nomes.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [beneficiarios, historico]);
  const nomeSub = (id: number | null) => todosSub.find(x => x.id === id)?.nome || '';
  const despesas = grupos.filter(g => g.natureza !== 'receita' && g.nome !== 'Pagamento de fatura');

  const fat = faturas.find(f => f.id === faturaId);
  const cartao = cartoes.find(c => c.id === cartaoId);
  const agendado = pags.filter(p => p.status === 'agendado').reduce((a, p) => a + Number(p.valor), 0);
  const aberto = fat ? Math.max(0, Number(fat.total) - Number(fat.pago)) : 0;
  const aPagar = Math.max(0, aberto - agendado);
  const porGrupo = useMemo(() => {
    const m = new Map<number, number>(); compras.forEach(c => m.set(c.grupo_id, (m.get(c.grupo_id) || 0) + Number(c.valor)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [compras]);
  const maxG = porGrupo[0]?.[1] || 1;
  const nomeG = (id: number) => grupos.find(g => g.id === id)?.nome || '';
  const abertoCartao = (id: number) => faturas.filter(f => f.cartao_id === id).reduce((a, f) => a + Math.max(0, Number(f.total) - Number(f.pago)), 0);

  async function salvarCompra(e: React.FormEvent) {
    e.preventDefault(); if (!novaCompra || !cartao) return; setErro('');
    const n = Math.max(1, Number(novaCompra.parcelas) || 1), total = Number(novaCompra.valor);
    const base = Math.floor((total / n) * 100) / 100, ultima = Math.round((total - base * (n - 1)) * 100) / 100;
    try {
      const tocadas = new Set<number>();
      for (let i = 0; i < n; i++) {
        const fid = await obterFatura(cartao, datasFatura(cartao, novaCompra.data, i));
        const { error } = await supabase.from('compras_cartao').insert({ cartao_id: cartao.id, fatura_id: fid, data_compra: novaCompra.data, descricao: novaCompra.descricao.trim(),
          grupo_id: Number(novaCompra.grupo), subgrupo_id: novaCompra.sub ? Number(novaCompra.sub) : null, beneficiario_id: novaCompra.benef ? Number(novaCompra.benef) : null, observacao: novaCompra.obs?.trim() || null, centro_custo_id: novaCompra.centro ? Number(novaCompra.centro) : null, parcela: n > 1 ? `${String(i + 1).padStart(2, '0')} de ${String(n).padStart(2, '0')}` : null, valor: i === n - 1 ? ultima : base });
        if (error) throw error;
        tocadas.add(fid);
      }
      for (const fid of tocadas) await sincronizarFatura(fid);
    } catch (err) { setErro((err as Error).message); return; }
    setNovaCompra(null); recarregar();
  }

  async function excluirCompras(ids: number[]) {
    const { error } = await supabase.from('compras_cartao').delete().in('id', ids);
    if (error) setErro(error.message);
    if (faturaId) await sincronizarFatura(faturaId);
    setSelC(new Set()); setConfExcluir(false); recarregar();
  }
  const marcadas = compras.filter(c => selC.has(c.id));
  const abrirEdicao = (cs: Compra[]) => {
    setErro('');
    const um = cs.length === 1 ? cs[0] : null;
    setEditC({ ids: cs.map(c => c.id), data: um?.data_compra || '', descricao: um?.descricao || '', grupo: um || cs.every(c => c.grupo_id === cs[0].grupo_id) ? String(cs[0].grupo_id) : '',
      sub: um?.subgrupo_id ? String(um.subgrupo_id) : '', centro: um?.centro_custo_id ? String(um.centro_custo_id) : '', valor: um ? String(um.valor) : '',
      obs: um?.observacao || '', benef: um?.beneficiario_id ? String(um.beneficiario_id) : '' });
  };
  async function salvarEdicao(e: React.FormEvent) {
    e.preventDefault(); if (!editC) return; setErro('');
    const um = editC.ids.length === 1;
    const d: Record<string, unknown> = {};
    if (editC.grupo) { d.grupo_id = Number(editC.grupo); d.subgrupo_id = editC.sub ? Number(editC.sub) : null; }
    if (um || editC.centro) d.centro_custo_id = editC.centro ? Number(editC.centro) : null;
    if (um) { d.data_compra = editC.data; d.descricao = editC.descricao.trim(); d.valor = Number(editC.valor); d.observacao = editC.obs.trim() || null; d.beneficiario_id = editC.benef ? Number(editC.benef) : null; }
    if (!Object.keys(d).length) { setErro('Escolha o grupo ou o centro de custo a aplicar.'); return; }
    const { error } = await supabase.from('compras_cartao').update(d).in('id', editC.ids);
    if (error) { setErro(error.message); return; }
    if (faturaId) await sincronizarFatura(faturaId);
    setEditC(null); setSelC(new Set()); recarregar();
  }

  async function salvarPagto(e: React.FormEvent) {
    e.preventDefault(); if (!pagto || !fat) return; setErro('');
    const valor = Number(pagto.valor);
    if (valor <= 0 || valor > aPagar + 0.004) { setErro('O valor deve ser maior que zero e até ' + brl(aPagar) + '.'); return; }
    const g = grupos.find(x => x.nome === 'Pagamento de fatura');
    const { error } = await supabase.from('lancamentos').insert({ tipo: 'saida', conta_id: Number(pagto.conta), vencimento: fat.data_vencimento,
      data_pagamento: pagto.status === 'pago' ? pagto.data : null, grupo_id: g!.id, favorecido: 'Fatura ' + fat.cartao, referencia: comp(fat.competencia),
      valor, status: pagto.status, fatura_id: fat.id });
    if (error) { setErro(error.message); return; }
    await sincronizarFatura(fat.id);
    setPagto(null); setAba('pag'); recarregar();
  }

  async function trocarConta(p: Lancamento, conta: string) {
    const obs = (p.observacao || '').split('; ').filter(x => !x.startsWith('revisar conta') && x !== 'conta a definir').join('; ') || null;
    await supabase.from('lancamentos').update({ conta_id: conta ? Number(conta) : null, observacao: obs, atualizado_em: new Date().toISOString() }).eq('id', p.id);
    recarregar();
  }

  async function baixarPagto(p: Lancamento) {
    if (!p.conta_id) { setErro('Escolha a conta antes de marcar como pago.'); return; }
    await supabase.from('lancamentos').update({ status: 'pago', data_pagamento: hoje, baixa_anterior: anterior(p), atualizado_em: new Date().toISOString() }).eq('id', p.id);
    if (p.fatura_id) await sincronizarFatura(p.fatura_id);
    recarregar();
  }

  const sit = fat ? situacaoFatura(fat, hoje) : null;

  return (
    <>
      <Cabecalho titulo="Cartões" sub="Compras, faturas e pagamentos dos cartões empresariais">
        <button className="btn gold" disabled={!cartao} onClick={() => { setErro(''); setNovaCompra({ data: hoje, descricao: '', grupo: '', valor: '', parcelas: '1' }); }}>+ Nova compra</button>
      </Cabecalho>
      <div className="grid g4">
        {cartoes.filter(c => c.ativo).map(c => (
          <div key={c.id} className={'cc ' + (c.id === cartaoId ? 'sel' : '')} onClick={() => { setCartaoId(c.id); setFaturaId(null); }}>
            <div className="nm">{c.nome}<span style={{ fontSize: 11, color: '#B9C0D0' }}>vence dia {c.dia_vencimento}</span></div>
            <div className="vl">{brl(abertoCartao(c.id))}</div><div className="ds">Em aberto em todas as faturas</div>
          </div>
        ))}
      </div>

      {!fat ? <div className="card mt empty">Nenhuma fatura para este cartão. Use "Nova compra" para começar.</div> : (
        <div className="grid g21 mt">
          <div className="card">
            <h3>
              <span>{fat.cartao} · fatura <select value={fat.id} onChange={e => setFaturaId(Number(e.target.value))} style={{ fontFamily: 'Inter', fontWeight: 600 }}>
                {doCartao.map(f => <option key={f.id} value={f.id}>{comp(f.competencia)}</option>)}</select></span>
              {sit && <span className={'st ' + sit.cls}>{sit.txt}</span>}
            </h3>
            <div className="grid g4" style={{ marginBottom: 14 }}>
              <div className="kpi"><div className="lbl">Total da fatura</div><div className="val" style={{ fontSize: 18 }}>{brl(fat.total)}</div></div>
              <div className="kpi"><div className="lbl">Pago</div><div className="val pos" style={{ fontSize: 18 }}>{brl(fat.pago)}</div></div>
              <div className="kpi"><div className="lbl">Saldo em aberto</div><div className={'val ' + (aberto > 0 ? 'neg' : '')} style={{ fontSize: 18 }}>{brl(aberto)}</div></div>
              <div className="kpi"><div className="lbl">Fechamento · vencimento</div><div className="val" style={{ fontSize: 18 }}>{diaMes(fat.data_fechamento)} · {diaMes(fat.data_vencimento)}</div></div>
            </div>
            <div className="tabs">
              <button className={aba === 'compras' ? 'on' : ''} onClick={() => setAba('compras')}>Compras ({compras.length})</button>
              <button className={aba === 'pag' ? 'on' : ''} onClick={() => setAba('pag')}>Pagamentos ({pags.length})</button>
            </div>
            {aba === 'compras' ? (
              compras.length === 0 ? <div className="empty" style={{ padding: 24 }}>Nenhuma compra nesta fatura.</div> :
              <>
              <BarraSelecao n={marcadas.length} total={marcadas.reduce((a, c) => a + Number(c.valor), 0)} aoLimpar={() => { setSelC(new Set()); setConfExcluir(false); }}>
                {!confExcluir ? <>
                  <button className="btn ghost mini" onClick={() => abrirEdicao(marcadas)}>{marcadas.length > 1 ? 'Alterar em lote' : 'Alterar'}</button>
                  <button className="btn ghost mini" style={{ color: 'var(--neg)' }} onClick={() => setConfExcluir(true)}>Excluir</button>
                </> : <span style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>Excluir {marcadas.length} compra(s)?
                  <button className="btn mini" style={{ background: 'var(--neg)', borderColor: 'var(--neg)' }} onClick={() => excluirCompras(marcadas.map(c => c.id))}>Sim, excluir</button>
                  <button className="btn ghost mini" onClick={() => setConfExcluir(false)}>Não</button></span>}
              </BarraSelecao>
              <table><thead><tr><th className="c"><input type="checkbox" checked={compras.length > 0 && compras.every(c => selC.has(c.id))} onChange={e => setSelC(e.target.checked ? new Set(compras.map(c => c.id)) : new Set())} /></th><th>Data</th><th>Estabelecimento</th><th>Grupo</th><th>Subgrupo</th><th>Parcela</th><th className="r">Valor</th></tr></thead>
                <tbody>{compras.map(c => <tr key={c.id} className="clicavel" title="Alterar a compra" onClick={() => abrirEdicao([c])} style={selC.has(c.id) ? { background: 'var(--gold-soft)' } : undefined}>
                  <td className="c" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selC.has(c.id)} onChange={e => { const n = new Set(selC); e.target.checked ? n.add(c.id) : n.delete(c.id); setSelC(n); }} /></td><td>{dataBR(c.data_compra)}</td><td>{c.descricao}{c.observacao && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{c.observacao}</div>}</td><td>{nomeG(c.grupo_id)}</td><td>{nomeSub(c.subgrupo_id) || '·'}</td><td style={{ whiteSpace: 'nowrap' }}>{c.parcela || '·'}</td>
                  <td className={'r ' + (Number(c.valor) < 0 ? 'pos' : '')}>{brl(c.valor)}</td></tr>)}</tbody></table>
              </>
            ) : (
              pags.length === 0 ? <div className="empty" style={{ padding: 24 }}>Nenhum pagamento registrado.</div> :
              <table><thead><tr><th>Vencimento</th><th>Pago em</th><th>Conta</th><th className="r">Valor</th><th>Status</th><th /></tr></thead>
                <tbody>{pags.map(p => {
                  const alerta = (p.observacao || '').includes('revisar conta') || !p.conta_id;
                  return (
                    <tr key={p.id}><td>{diaMes(p.vencimento)}</td><td>{p.data_pagamento ? dataBR(p.data_pagamento) : '·'}</td>
                      <td><select value={p.conta_id ?? ''} onChange={e => trocarConta(p, e.target.value)} style={alerta ? { borderColor: 'var(--gold)', background: 'var(--gold-soft)' } : undefined}>
                        <option value="">A definir</option>{contas.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
                        {alerta && <div style={{ fontSize: 11, color: '#8A6A12', marginTop: 3 }}>Confirme a conta usada</div>}</td>
                      <td className="r">{brl(p.valor)}</td><td><span className={'st ' + classeStatus(p.status)}>{STATUS_LABEL[p.status]}</span></td>
                      <td className="r">{p.status !== 'pago' && p.status !== 'previsto' && <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => baixarPagto(p)}>Marcar pago</button>}
                        {p.status === 'pago' && <button className="btn ghost mini" title="Volta a ficar agendado/confirmado, sem excluir" onClick={async () => { const e = await desfazerBaixa(p); if (e) setErro(e); recarregar(); }}>Desfazer baixa</button>}</td></tr>);
                })}</tbody></table>
            )}
            {erro && !novaCompra && !pagto && !editC && <div className="err mt">{erro}</div>}
            <div style={{ textAlign: 'right', marginTop: 12 }}>
              <button className="btn gold" disabled={aPagar <= 0.004} onClick={() => { setErro(''); setPagto({ conta: '', data: hoje, valor: aPagar.toFixed(2), status: 'pago' }); }}>Registrar pagamento</button>
            </div>
          </div>
          <div className="card"><h3>Gastos por grupo <small>esta fatura</small></h3>
            {porGrupo.length === 0 ? <div className="empty" style={{ padding: 24 }}>Sem compras.</div> : porGrupo.map(([g, v]) => (
              <div key={g} className="rowline" style={{ gridTemplateColumns: '1fr 110px' }}>
                <div>{nomeG(g)}<div className="bar" style={{ marginTop: 5 }}><i style={{ width: Math.max(0, (v / maxG) * 100) + '%' }} /></div></div>
                <div className="n"><b>{brl(v)}</b></div>
              </div>))}
          </div>
        </div>
      )}

      <datalist id="estabelecimentos">{opcoesEstab.map(n => <option key={n} value={n} />)}</datalist>
      {novaCompra && cartao && (
        <div className="modal-bg open">
          <div className="modal"><h2>Nova compra · {cartao.nome}</h2>
            <form className="form" onSubmit={salvarCompra}>
              <label>Data da compra<DataBR required value={novaCompra.data} onChange={e => setNovaCompra({ ...novaCompra, data: e.target.value })} /></label>
              <label>Valor total (R$)<CampoValor required value={novaCompra.valor} onChange={e => setNovaCompra({ ...novaCompra, valor: e.target.value })} /></label>
              <label className="full">Estabelecimento<input required list="estabelecimentos" value={novaCompra.descricao} placeholder="Digite para buscar nos cadastrados ou informe um novo"
                onChange={e => setNovaCompra(escolherEstab(novaCompra, e.target.value))} />
                {novaCompra.benef && <span style={{ color: 'var(--pos)' }}>Ligado ao cadastro de fornecedores</span>}</label>
              <label>Grupo<select required value={novaCompra.grupo} onChange={e => setNovaCompra({ ...novaCompra, grupo: e.target.value, sub: '' })}><option value="" disabled>Selecione</option>
                {despesas.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select></label>
              <label>Subgrupo<select value={novaCompra.sub || ''} onChange={e => setNovaCompra({ ...novaCompra, sub: e.target.value })}><option value="">·</option>
                {subgrupos.filter(x => x.grupo_id === Number(novaCompra.grupo)).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
              <label>Centro de custo<select value={novaCompra.centro || ''} onChange={e => setNovaCompra({ ...novaCompra, centro: e.target.value })}>
                <option value="">{'Padrão do plano: ' + (nomeCentro(centros, grupos.find(g => g.id === Number(novaCompra.grupo))?.centro_custo_id) || 'Geral')}</option><OpcoesCentro centros={centros} /></select></label>
              <label>Parcelas<input type="number" min={1} max={24} value={novaCompra.parcelas} onChange={e => setNovaCompra({ ...novaCompra, parcelas: e.target.value })} /></label>
              <label className="full">Observações / detalhes<input value={novaCompra.obs || ''} onChange={e => setNovaCompra({ ...novaCompra, obs: e.target.value })} placeholder="Ex.: material de escritório para o setor fiscal" /></label>
              <p className="full" style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
                {novaCompra.data && `Entra na fatura com vencimento em ${dataBR(datasFatura(cartao, novaCompra.data).data_vencimento)}`}
                {Number(novaCompra.parcelas) > 1 && `, em ${novaCompra.parcelas} parcelas mensais`}. Valor negativo registra estorno.</p>
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setNovaCompra(null)}>Cancelar</button><button className="btn">Salvar</button></div>
            </form>
          </div>
        </div>
      )}

      {editC && (
        <div className="modal-bg open">
          <div className="modal"><h2>{editC.ids.length === 1 ? 'Alterar compra' : `Alterar ${editC.ids.length} compras`}</h2>
            <form className="form" onSubmit={salvarEdicao}>
              {editC.ids.length === 1 && <>
                <label>Data da compra<DataBR required value={editC.data} onChange={e => setEditC({ ...editC, data: e.target.value })} /></label>
                <label>Valor (R$)<CampoValor required value={editC.valor} onChange={e => setEditC({ ...editC, valor: e.target.value })} /></label>
                <label className="full">Estabelecimento<input required list="estabelecimentos" value={editC.descricao} onChange={e => setEditC(escolherEstab(editC, e.target.value))} />
                  {editC.benef && <span style={{ color: 'var(--pos)' }}>Ligado ao cadastro de fornecedores</span>}</label>
              </>}
              <label>Grupo<select required={editC.ids.length === 1} value={editC.grupo} onChange={e => setEditC({ ...editC, grupo: e.target.value, sub: '' })}><option value="">{editC.ids.length === 1 ? 'Selecione' : 'Manter o de cada compra'}</option>
                {despesas.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select></label>
              <label>Subgrupo<select value={editC.sub} disabled={!editC.grupo} onChange={e => setEditC({ ...editC, sub: e.target.value })}><option value="">·</option>
                {subgrupos.filter(x => x.grupo_id === Number(editC.grupo) || String(x.id) === editC.sub).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
              <label className="full">Centro de custo<select value={editC.centro} onChange={e => setEditC({ ...editC, centro: e.target.value })}>
                <option value="">{editC.ids.length === 1 ? 'Padrão do plano: ' + (nomeCentro(centros, grupos.find(g => g.id === Number(editC.grupo))?.centro_custo_id) || 'Geral') : 'Manter o de cada compra'}</option><OpcoesCentro centros={centros} /></select></label>
              {editC.ids.length === 1 && <label className="full">Observações / detalhes<input value={editC.obs} onChange={e => setEditC({ ...editC, obs: e.target.value })} /></label>}
              <p className="full" style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>A compra continua nesta fatura. Para mudar de fatura ou de número de parcelas, exclua e lance novamente.</p>
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setEditC(null)}>Cancelar</button><button className="btn">Salvar</button></div>
            </form>
          </div>
        </div>
      )}

      {pagto && fat && (
        <div className="modal-bg open">
          <div className="modal"><h2>Registrar pagamento · {fat.cartao} {comp(fat.competencia)}</h2>
            <form className="form" onSubmit={salvarPagto}>
              <label>Conta utilizada<select required value={pagto.conta} onChange={e => setPagto({ ...pagto, conta: e.target.value })}><option value="" disabled>Selecione</option>
                {contas.filter(c => c.ativa && c.tipo !== 'aplicacao').map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
              <label>Status<select value={pagto.status} onChange={e => setPagto({ ...pagto, status: e.target.value as Status })}><option value="pago">Pago</option><option value="agendado">Agendado</option></select></label>
              {pagto.status === 'pago' && <label>Data do pagamento<DataBR required value={pagto.data} onChange={e => setPagto({ ...pagto, data: e.target.value })} /></label>}
              <label>Valor (R$)<CampoValor min="0.01" required value={pagto.valor} onChange={e => setPagto({ ...pagto, valor: e.target.value })} /></label>
              <p className="full" style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Saldo em aberto: {brl(aberto)}{agendado > 0 && `, dos quais ${brl(agendado)} já agendados`}. Valor menor registra pagamento parcial; a diferença continua em contas a pagar.</p>
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setPagto(null)}>Cancelar</button><button className="btn">Registrar</button></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
