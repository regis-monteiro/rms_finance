import { useEffect, useMemo, useState } from 'react';
import CampoValor from './CampoValor';
import DataBR from './DataBR';
import { supabase } from '../lib/supabase';
import { brl, dataBR, hojeISO } from '../lib/format';
import { useCadastros } from '../lib/useCadastros';
import { somaMeses } from './LoteLancamentos';
import { gravarRascunho, lerRascunho } from '../lib/rascunho';

interface Aplic { id: number; conta_id: number; nome: string; ativo: boolean; vencimento: string | null }
interface Pos {
  id?: number; aplicacao_id: number; competencia: string; saldo_bruto: number; saldo_liquido: number; aporte: number; resgate: number;
  rendimento: number | null; irrf: number | null; data_confirmacao: string | null; lanc_rendimento_id: number | null; lanc_irrf_id: number | null;
  irrf_retido: number | null; data_irrf: string | null;
}
interface Proj { conta_id: number; rendimento_pendente: number; irrf_pendente: number }
type Edit = { bruto: string; liquido: string; aporte: string; resgate: string; antBruto: string; antLiquido: string; irrf: string; dataIrrf: string; verIrrf?: boolean };
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const r2 = (v: number) => Math.round(v * 100) / 100;
const mini = { padding: '3px 9px', fontSize: 12 };

export default function Rendimentos({ mes }: { mes: string }) {
  const { contas, todosGrupos: grupos, subgrupos } = useCadastros();
  const comp = mes + '-01', compAnt = somaMeses(comp, -1);
  const hoje = hojeISO();
  const fimMes = (() => { const [a, m] = mes.split('-').map(Number); return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`; })();
  const chaveRasc = 'rend:' + mes;
  const [aplics, setAplics] = useState<Aplic[]>([]);
  const [atual, setAtual] = useState<Pos[]>([]);
  const [ant, setAnt] = useState<Pos[]>([]);
  const [saldosApp, setSaldosApp] = useState<{ id: number; saldo: number }[]>([]);
  const [proj, setProj] = useState<Proj[]>([]);
  const [ed, setEd] = useState<Record<number, Edit>>({});
  const [sujos, setSujos] = useState<Set<number>>(new Set());
  const [cad, setCad] = useState<{ id?: number; conta: string; nome: string; vencimento: string } | null>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [versao, setVersao] = useState(0);
  const avisar = (t: 'ok' | 'err', m: string) => { setMsg({ t, m }); setTimeout(() => setMsg(null), 5000); };

  useEffect(() => {
    Promise.all([
      supabase.from('aplicacoes').select('*').order('nome'),
      supabase.from('aplicacoes_saldos').select('*').eq('competencia', comp),
      supabase.from('aplicacoes_saldos').select('*').eq('competencia', compAnt),
      supabase.from('saldos_contas').select('id,saldo'),
      supabase.from('aplicacoes_projecao').select('*'),
    ]).then(([a, b, c, d, p]) => {
      const ap = (a.data as Aplic[]) || [], at = (b.data as Pos[]) || [], an = (c.data as Pos[]) || [];
      setAplics(ap); setAtual(at); setAnt(an); setSaldosApp((d.data as { id: number; saldo: number }[]) || []); setProj((p.data as Proj[]) || []);
      const rasc = lerRascunho<Record<number, Edit>>(chaveRasc) || {};
      const e: Record<number, Edit> = {};
      ap.forEach(x => {
        const pp = at.find(y => y.aplicacao_id === x.id), q = an.find(y => y.aplicacao_id === x.id);
        e[x.id] = rasc[x.id] || {
          bruto: pp ? String(pp.saldo_bruto) : '', liquido: pp ? String(pp.saldo_liquido) : '', aporte: pp?.aporte ? String(pp.aporte) : '', resgate: pp?.resgate ? String(pp.resgate) : '',
          antBruto: q ? String(q.saldo_bruto) : '', antLiquido: q ? String(q.saldo_liquido) : '',
          irrf: pp?.irrf_retido != null ? String(pp.irrf_retido) : '', dataIrrf: pp?.data_irrf || (fimMes < hoje ? fimMes : hoje),
        };
      });
      setEd(e); setSujos(new Set(Object.keys(rasc).map(Number)));
    });
  }, [mes, versao]);

  /** Rascunho: o que foi digitado e ainda não salvo continua aqui ao voltar para a tela */
  const set = (id: number, k: keyof Edit, v: string | boolean) => setEd(x => {
    const n = { ...x, [id]: { ...x[id], [k]: v } };
    const r = lerRascunho<Record<number, Edit>>(chaveRasc) || {}; r[id] = n[id]; gravarRascunho(chaveRasc, r);
    setSujos(s => new Set(s).add(id));
    return n;
  });
  const limparRasc = (id: number) => {
    const r = lerRascunho<Record<number, Edit>>(chaveRasc) || {}; delete r[id]; gravarRascunho(chaveRasc, r);
    setSujos(s => { const n = new Set(s); n.delete(id); return n; });
  };

  const contasAF = contas.filter(c => c.tipo === 'aplicacao' && c.ativa);
  const calc = (id: number) => {
    const e = ed[id]; if (!e || e.bruto === '' || e.liquido === '') return null;
    const b = Number(e.bruto), l = Number(e.liquido);
    const irrfAcum = r2(b - l);
    if (e.antBruto === '' || e.antLiquido === '') return { rend: null as number | null, irrfAcum };
    return { rend: r2(b - Number(e.antBruto) - Number(e.aporte || 0) + Number(e.resgate || 0)), irrfAcum };
  };

  async function gravar(a: Aplic) {
    const e = ed[a.id]; const q = ant.find(y => y.aplicacao_id === a.id);
    if (!q && e.antBruto !== '' && e.antLiquido !== '') {
      const r = await supabase.from('aplicacoes_saldos').upsert({ aplicacao_id: a.id, competencia: compAnt, saldo_bruto: Number(e.antBruto), saldo_liquido: Number(e.antLiquido) }, { onConflict: 'aplicacao_id,competencia' });
      if (r.error) throw r.error;
    }
    const r = await supabase.from('aplicacoes_saldos').upsert({ aplicacao_id: a.id, competencia: comp, saldo_bruto: Number(e.bruto), saldo_liquido: Number(e.liquido), aporte: Number(e.aporte || 0), resgate: Number(e.resgate || 0) }, { onConflict: 'aplicacao_id,competencia' }).select().single();
    if (r.error) throw r.error;
    return r.data as Pos;
  }

  async function salvar(a: Aplic) {
    try { await gravar(a); limparRasc(a.id); avisar('ok', 'Saldos salvos'); setVersao(v => v + 1); } catch (err) { avisar('err', (err as Error).message); }
  }

  /** Rendimento bruto: sempre gravado no último dia do mês */
  async function confirmarRendimento(a: Aplic, silencioso = false) {
    const c = calc(a.id); if (!c || c.rend == null) return false;
    try {
      const pos = await gravar(a);
      const gR = grupos.find(g => g.nome === 'Rendimentos')!;
      let idR: number | null = null;
      if (c.rend !== 0) {
        const r = await supabase.from('lancamentos').insert({ conta_id: a.conta_id, vencimento: fimMes, data_pagamento: fimMes, favorecido: a.nome, referencia: `${mes.slice(5, 7)}/${mes.slice(0, 4)}`,
          status: 'pago', observacao: 'rendimento de aplicação', tipo: c.rend > 0 ? 'entrada' : 'saida', grupo_id: gR.id, valor: Math.abs(c.rend) }).select('id').single();
        if (r.error) throw r.error; idR = r.data.id;
      }
      const u = await supabase.from('aplicacoes_saldos').update({ rendimento: c.rend, data_confirmacao: fimMes, lanc_rendimento_id: idR }).eq('id', pos.id!);
      if (u.error) throw u.error;
      limparRasc(a.id);
      if (!silencioso) { avisar('ok', `${a.nome}: rendimento de ${brl(c.rend)} lançado em ${dataBR(fimMes)}`); setVersao(v => v + 1); }
      return true;
    } catch (err) { avisar('err', (err as Error).message); return false; }
  }

  /** IRRF: lançado só no resgate ou vencimento, pelo valor retido informado no extrato */
  async function lancarIrrf(a: Aplic) {
    const e = ed[a.id], c = calc(a.id), valor = r2(Number(e.irrf || 0));
    if (!(valor > 0)) { avisar('err', 'Informe o IRRF retido mostrado no extrato.'); return; }
    if (!e.dataIrrf) { avisar('err', 'Informe a data do resgate ou do vencimento.'); return; }
    try {
      const pos = await gravar(a);
      const gI = grupos.find(g => g.nome === 'Impostos')!, sI = subgrupos.find(s => s.grupo_id === gI.id && s.nome === 'IRRF');
      const r = await supabase.from('lancamentos').insert({ conta_id: a.conta_id, vencimento: e.dataIrrf, data_pagamento: e.dataIrrf, favorecido: a.nome, referencia: `IRRF ${mes.slice(5, 7)}/${mes.slice(0, 4)}`,
        status: 'pago', observacao: 'IRRF retido no resgate/vencimento', tipo: 'saida', grupo_id: gI.id, subgrupo_id: sI?.id ?? null, valor }).select('id').single();
      if (r.error) throw r.error;
      const u = await supabase.from('aplicacoes_saldos').update({ irrf_retido: valor, data_irrf: e.dataIrrf, irrf: c?.irrfAcum ?? null, lanc_irrf_id: r.data.id }).eq('id', pos.id!);
      if (u.error) throw u.error;
      limparRasc(a.id); avisar('ok', `${a.nome}: IRRF de ${brl(valor)} lançado em ${dataBR(e.dataIrrf)}`); setVersao(v => v + 1);
    } catch (err) { avisar('err', (err as Error).message); }
  }

  async function confirmarTodos() {
    let n = 0;
    for (const a of aplics.filter(x => x.ativo)) {
      const p = atual.find(y => y.aplicacao_id === a.id);
      if (!p?.data_confirmacao && calc(a.id)?.rend != null) { if (await confirmarRendimento(a, true)) n++; }
    }
    avisar('ok', `${n} rendimento(s) lançado(s) em ${dataBR(fimMes)}`); setVersao(v => v + 1);
  }

  async function desfazerRend(p: Pos) {
    if (p.lanc_rendimento_id) await supabase.from('lancamentos').delete().eq('id', p.lanc_rendimento_id);
    await supabase.from('aplicacoes_saldos').update({ rendimento: null, data_confirmacao: null, lanc_rendimento_id: null }).eq('id', p.id!);
    avisar('ok', 'Lançamento do rendimento desfeito'); setVersao(v => v + 1);
  }
  async function desfazerIrrf(p: Pos) {
    if (p.lanc_irrf_id) await supabase.from('lancamentos').delete().eq('id', p.lanc_irrf_id);
    await supabase.from('aplicacoes_saldos').update({ irrf: null, irrf_retido: null, data_irrf: null, lanc_irrf_id: null }).eq('id', p.id!);
    avisar('ok', 'Lançamento do IRRF desfeito'); setVersao(v => v + 1);
  }

  async function gravarCadastro(e: React.FormEvent) {
    e.preventDefault(); if (!cad) return;
    const dados = { conta_id: Number(cad.conta), nome: cad.nome.trim(), vencimento: cad.vencimento || null };
    const { error } = cad.id ? await supabase.from('aplicacoes').update(dados).eq('id', cad.id) : await supabase.from('aplicacoes').insert(dados);
    if (error) { avisar('err', error.code === '23505' ? 'Já existe essa aplicação nesta conta.' : error.message); return; }
    setCad(null); setVersao(v => v + 1);
  }
  async function inativar(a: Aplic) { await supabase.from('aplicacoes').update({ ativo: !a.ativo }).eq('id', a.id); setVersao(v => v + 1); }

  const porConta = useMemo(() => contasAF.map(c => ({ c, itens: aplics.filter(a => a.conta_id === c.id && (a.ativo || atual.some(p => p.aplicacao_id === a.id))) })), [contasAF, aplics, atual]);
  const inp = (id: number, k: keyof Edit, travado: boolean, w = 96) => <CampoValor value={(ed[id]?.[k] as string) ?? ''} disabled={travado} onChange={e => set(id, k, e.target.value)} style={{ width: w, textAlign: 'right' }} />;
  const pendentes = aplics.filter(a => a.ativo && !atual.find(p => p.aplicacao_id === a.id)?.data_confirmacao && calc(a.id)?.rend != null).length;
  const venceNoMes = (a: Aplic) => !!a.vencimento && a.vencimento.slice(0, 7) === mes;

  return (
    <>
      <div className="filters">
        <span className="chip" style={{ fontSize: 13, padding: '7px 12px' }}>Competência: {MESES[Number(mes.slice(5, 7)) - 1]}/{mes.slice(0, 4)}</span>
        <span style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 640 }}>Informe os saldos bruto e líquido do extrato. O rendimento (bruto) é lançado em {dataBR(fimMes)}. O IRRF fica projetado e só é lançado no resgate ou no vencimento, pelo valor retido no extrato.</span>
        <span style={{ flex: 1 }} />
        {msg && <span className={msg.t}>{msg.m}</span>}
        <button className="btn ghost" onClick={() => setCad({ conta: String(contasAF[0]?.id || ''), nome: '', vencimento: '' })}>+ Nova aplicação</button>
        <button className="btn gold" disabled={!pendentes} onClick={confirmarTodos}>Lançar rendimentos ({pendentes})</button>
      </div>
      {porConta.map(({ c, itens }) => {
        const tot = itens.reduce((acc, a) => { const k = calc(a.id); const e = ed[a.id]; return { b: acc.b + Number(e?.bruto || 0), l: acc.l + Number(e?.liquido || 0), r: acc.r + (k?.rend || 0), i: acc.i + (k?.irrfAcum || 0) }; }, { b: 0, l: 0, r: 0, i: 0 });
        const app = Number(saldosApp.find(s => s.id === c.id)?.saldo || 0);
        const pj = proj.find(p => p.conta_id === c.id), rp = Number(pj?.rendimento_pendente || 0), ip = Number(pj?.irrf_pendente || 0);
        return (
          <div className="card mt" key={c.id} style={{ overflowX: 'auto' }}>
            <h3>{c.nome} <small>Saldo lançado: {brl(app)} · rendimentos a lançar: {brl(rp)} · IRRF projetado: −{brl(ip)} · <b>saldo líquido projetado: {brl(app + rp - ip)}</b>
              {tot.b ? ` · extrato (bruto): ${brl(tot.b)}, diferença ${brl(tot.b - app - rp)}` : ''}</small></h3>
            {itens.length === 0 ? <div className="empty" style={{ padding: 20 }}>Nenhuma aplicação nesta conta.</div> : (
              <table className="compacta">
                <thead><tr><th>Aplicação</th><th className="r">Mês anterior<div style={{ fontWeight: 400 }}>bruto / líquido</div></th><th className="r">Aplicado / resgatado</th><th className="r">Mês atual<div style={{ fontWeight: 400 }}>bruto / líquido</div></th><th className="r">Rendimento bruto</th><th className="r">IRRF projetado</th><th>IRRF retido no resgate ou vencimento</th><th /></tr></thead>
                <tbody>{itens.map(a => {
                  const p = atual.find(y => y.aplicacao_id === a.id), q = ant.find(y => y.aplicacao_id === a.id), k = calc(a.id);
                  const rendOk = !!p?.data_confirmacao, irrfOk = !!p?.lanc_irrf_id, legado = irrfOk && p?.irrf_retido == null;
                  const e = ed[a.id];
                  const mostraIrrf = !irrfOk && (Number(e?.resgate || 0) > 0 || venceNoMes(a) || e?.verIrrf);
                  return (
                    <tr key={a.id} style={{ opacity: a.ativo ? 1 : 0.55 }}>
                      <td style={{ minWidth: 150 }}><b>{a.nome}</b>
                        {a.vencimento && <div style={{ fontSize: 11, color: venceNoMes(a) ? '#8A6A12' : 'var(--muted)' }}>{venceNoMes(a) ? 'Vence neste mês: ' : 'Vencimento: '}{dataBR(a.vencimento)}</div>}
                        {!q && <div style={{ fontSize: 11, color: '#8A6A12' }}>Primeiro mês: informe o saldo anterior</div>}
                        {sujos.has(a.id) && <div style={{ fontSize: 11, color: '#8A6A12' }}>Digitação não salva</div>}</td>
                      <td className="r"><div className="pilha">{q ? <><span>{brl(q.saldo_bruto)}</span><span>{brl(q.saldo_liquido)}</span></> : <>{inp(a.id, 'antBruto', rendOk)}{inp(a.id, 'antLiquido', rendOk)}</>}</div></td>
                      <td className="r"><div className="pilha"><span title="Aplicado no mês">+ {inp(a.id, 'aporte', rendOk, 84)}</span><span title="Resgatado no mês">− {inp(a.id, 'resgate', rendOk && irrfOk, 84)}</span></div></td>
                      <td className="r"><div className="pilha">{inp(a.id, 'bruto', rendOk)}{inp(a.id, 'liquido', rendOk && irrfOk)}</div></td>
                      <td className={'r ' + ((k?.rend || 0) >= 0 ? 'pos' : 'neg')}>{k?.rend != null ? brl(k.rend) : '·'}
                        <div style={{ fontSize: 11, marginTop: 3 }}>{rendOk
                          ? <><span className="st pago">Lançado {dataBR(p!.data_confirmacao)}</span> <button className="btn ghost mini" onClick={() => desfazerRend(p!)}>Desfazer</button></>
                          : k?.rend != null && <button className="btn mini" onClick={() => confirmarRendimento(a)} title={'Lança o rendimento em ' + dataBR(fimMes)}>Lançar</button>}</div></td>
                      <td className="r neg">{k ? brl(k.irrfAcum) : '·'}<div style={{ fontSize: 11, color: 'var(--muted)' }}>bruto − líquido</div></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {irrfOk ? <><span className="st pago">{legado ? `IRRF mensal (modelo anterior) ${brl(Number(p!.irrf))}` : `${brl(Number(p!.irrf_retido))} em ${dataBR(p!.data_irrf)}`}</span> <button className="btn ghost mini" onClick={() => desfazerIrrf(p!)}>Desfazer</button>
                          {!legado && k && Math.abs(Number(p!.irrf_retido) - Number(p!.irrf ?? 0)) >= 0.01 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Projetado na data: {brl(Number(p!.irrf ?? 0))}</div>}</>
                          : mostraIrrf ? <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              {inp(a.id, 'irrf', false, 84)}<DataBR value={e?.dataIrrf || ''} onChange={x => set(a.id, 'dataIrrf', x.target.value)} style={{ width: 128 }} />
                              <button className="btn mini" disabled={!(Number(e?.irrf || 0) > 0)} onClick={() => lancarIrrf(a)}>Lançar IRRF</button></div>
                            : <button className="btn ghost mini" onClick={() => set(a.id, 'verIrrf', true)}>Informar</button>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn ghost mini" disabled={!e?.bruto || !e?.liquido} onClick={() => salvar(a)}>Salvar</button>{' '}
                        <button className="btn ghost mini" title="Editar aplicação" onClick={() => setCad({ id: a.id, conta: String(a.conta_id), nome: a.nome, vencimento: a.vencimento || '' })}>✎</button>{' '}
                        <button className="btn ghost mini" title={a.ativo ? 'Inativar' : 'Reativar'} onClick={() => inativar(a)}>{a.ativo ? '×' : '↺'}</button>
                      </td>
                    </tr>);
                })}
                  <tr style={{ fontWeight: 700, background: '#FBF9F3' }}><td>Total</td><td colSpan={2} /><td className="r"><div className="pilha"><span>{brl(tot.b)}</span><span>{brl(tot.l)}</span></div></td><td className="r">{brl(tot.r)}</td><td className="r">{brl(tot.i)}</td><td colSpan={2} /></tr>
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>O rendimento bruto é lançado em Rendimentos, como pago, no último dia do mês. O IRRF (Impostos · IRRF) só é lançado quando houver resgate ou vencimento, pelo valor retido informado no extrato. Até lá, os saldos mostram o IRRF projetado. Aplicações e resgates entre contas são registrados com "Transferência entre contas".</p>

      {cad && (
        <div className="modal-bg open">
          <div className="modal"><h2>{cad.id ? 'Editar aplicação' : 'Nova aplicação'}</h2>
            <form className="form" onSubmit={gravarCadastro}>
              <label>Conta<select required value={cad.conta} onChange={e => setCad({ ...cad, conta: e.target.value })}>{contasAF.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
              <label>Nome do produto<input required value={cad.nome} onChange={e => setCad({ ...cad, nome: e.target.value })} placeholder="Ex.: CDB Banco X 110% CDI" /></label>
              <label>Vencimento (opcional)<DataBR value={cad.vencimento} onChange={e => setCad({ ...cad, vencimento: e.target.value })} /></label>
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setCad(null)}>Cancelar</button><button className="btn">{cad.id ? 'Salvar' : 'Criar'}</button></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
