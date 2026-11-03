import { Fragment, useEffect, useMemo, useState } from 'react';
import CampoValor from './CampoValor';
import DataBR from './DataBR';
import { supabase } from '../lib/supabase';
import { brl, dataBR, hojeISO } from '../lib/format';
import { useCadastros } from '../lib/useCadastros';
import { somaMeses } from './LoteLancamentos';

interface Aplic { id: number; conta_id: number; nome: string; ativo: boolean }
interface Pos { id?: number; aplicacao_id: number; competencia: string; saldo_bruto: number; saldo_liquido: number; aporte: number; resgate: number; rendimento: number | null; irrf: number | null; data_confirmacao: string | null; lanc_rendimento_id: number | null; lanc_irrf_id: number | null }
type Edit = { bruto: string; liquido: string; aporte: string; resgate: string; antBruto: string; antLiquido: string; data: string };
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const r2 = (v: number) => Math.round(v * 100) / 100;

export default function Rendimentos({ mes }: { mes: string }) {
  const { contas, grupos, subgrupos } = useCadastros();
  const comp = mes + '-01', compAnt = somaMeses(comp, -1);
  const hoje = hojeISO();
  const fimMes = (() => { const [a, m] = mes.split('-').map(Number); return `${mes}-${new Date(a, m, 0).getDate()}`; })();
  const [aplics, setAplics] = useState<Aplic[]>([]);
  const [atual, setAtual] = useState<Pos[]>([]);
  const [ant, setAnt] = useState<Pos[]>([]);
  const [saldosApp, setSaldosApp] = useState<{ id: number; saldo: number }[]>([]);
  const [ed, setEd] = useState<Record<number, Edit>>({});
  const [nova, setNova] = useState<{ conta: string; nome: string } | null>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [versao, setVersao] = useState(0);
  const avisar = (t: 'ok' | 'err', m: string) => { setMsg({ t, m }); setTimeout(() => setMsg(null), 4000); };

  useEffect(() => {
    Promise.all([
      supabase.from('aplicacoes').select('*').order('nome'),
      supabase.from('aplicacoes_saldos').select('*').eq('competencia', comp),
      supabase.from('aplicacoes_saldos').select('*').eq('competencia', compAnt),
      supabase.from('saldos_contas').select('id,saldo'),
    ]).then(([a, b, c, d]) => {
      const ap = (a.data as Aplic[]) || [], at = (b.data as Pos[]) || [], an = (c.data as Pos[]) || [];
      setAplics(ap); setAtual(at); setAnt(an); setSaldosApp((d.data as { id: number; saldo: number }[]) || []);
      const e: Record<number, Edit> = {};
      ap.forEach(x => {
        const p = at.find(y => y.aplicacao_id === x.id), q = an.find(y => y.aplicacao_id === x.id);
        e[x.id] = { bruto: p ? String(p.saldo_bruto) : '', liquido: p ? String(p.saldo_liquido) : '', aporte: p?.aporte ? String(p.aporte) : '', resgate: p?.resgate ? String(p.resgate) : '',
          antBruto: q ? String(q.saldo_bruto) : '', antLiquido: q ? String(q.saldo_liquido) : '', data: p?.data_confirmacao || (fimMes < hoje ? fimMes : hoje) };
      });
      setEd(e);
    });
  }, [mes, versao]);

  const contasAF = contas.filter(c => c.tipo === 'aplicacao' && c.ativa);
  const calc = (id: number) => {
    const e = ed[id]; if (!e || e.bruto === '' || e.liquido === '' || e.antBruto === '' || e.antLiquido === '') return null;
    const b = Number(e.bruto), l = Number(e.liquido), ab = Number(e.antBruto), al = Number(e.antLiquido);
    return { rend: r2(b - ab - Number(e.aporte || 0) + Number(e.resgate || 0)), irrf: r2((b - l) - (ab - al)), irrfAcum: r2(b - l) };
  };
  const set = (id: number, k: keyof Edit, v: string) => setEd(x => ({ ...x, [id]: { ...x[id], [k]: v } }));

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
    try { await gravar(a); avisar('ok', 'Saldos salvos'); setVersao(v => v + 1); } catch (err) { avisar('err', (err as Error).message); }
  }

  async function confirmar(a: Aplic, silencioso = false) {
    const c = calc(a.id), e = ed[a.id]; if (!c) return false;
    try {
      const pos = await gravar(a);
      const gR = grupos.find(g => g.nome === 'Rendimentos')!, gI = grupos.find(g => g.nome === 'Impostos')!;
      const sI = subgrupos.find(s => s.grupo_id === gI.id && s.nome === 'IRRF');
      const base = { conta_id: a.conta_id, vencimento: e.data, data_pagamento: e.data, favorecido: a.nome, referencia: `${mes.slice(5, 7)}/${mes.slice(0, 4)}`, status: 'pago', observacao: 'rendimento de aplicação' };
      let idR: number | null = null, idI: number | null = null;
      if (c.rend !== 0) {
        const r = await supabase.from('lancamentos').insert({ ...base, tipo: c.rend > 0 ? 'entrada' : 'saida', grupo_id: gR.id, valor: Math.abs(c.rend) }).select('id').single();
        if (r.error) throw r.error; idR = r.data.id;
      }
      if (c.irrf !== 0) {
        const r = await supabase.from('lancamentos').insert({ ...base, tipo: c.irrf > 0 ? 'saida' : 'entrada', grupo_id: gI.id, subgrupo_id: sI?.id ?? null, valor: Math.abs(c.irrf) }).select('id').single();
        if (r.error) throw r.error; idI = r.data.id;
      }
      const u = await supabase.from('aplicacoes_saldos').update({ rendimento: c.rend, irrf: c.irrf, data_confirmacao: e.data, lanc_rendimento_id: idR, lanc_irrf_id: idI }).eq('id', pos.id!);
      if (u.error) throw u.error;
      if (!silencioso) { avisar('ok', `${a.nome}: rendimento e IRRF lançados em ${dataBR(e.data)}`); setVersao(v => v + 1); }
      return true;
    } catch (err) { avisar('err', (err as Error).message); return false; }
  }

  async function confirmarTodos() {
    let n = 0;
    for (const a of aplics.filter(x => x.ativo)) {
      const p = atual.find(y => y.aplicacao_id === a.id);
      if (!p?.data_confirmacao && calc(a.id)) { if (await confirmar(a, true)) n++; }
    }
    avisar('ok', `${n} aplicação(ões) confirmada(s)`); setVersao(v => v + 1);
  }

  async function desfazer(p: Pos) {
    const ids = [p.lanc_rendimento_id, p.lanc_irrf_id].filter(Boolean) as number[];
    if (ids.length) await supabase.from('lancamentos').delete().in('id', ids);
    await supabase.from('aplicacoes_saldos').update({ rendimento: null, irrf: null, data_confirmacao: null, lanc_rendimento_id: null, lanc_irrf_id: null }).eq('id', p.id!);
    avisar('ok', 'Confirmação desfeita'); setVersao(v => v + 1);
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault(); if (!nova) return;
    const { error } = await supabase.from('aplicacoes').insert({ conta_id: Number(nova.conta), nome: nova.nome.trim() });
    if (error) { avisar('err', error.code === '23505' ? 'Já existe essa aplicação nesta conta.' : error.message); return; }
    setNova(null); setVersao(v => v + 1);
  }
  async function inativar(a: Aplic) { await supabase.from('aplicacoes').update({ ativo: !a.ativo }).eq('id', a.id); setVersao(v => v + 1); }

  const porConta = useMemo(() => contasAF.map(c => ({ c, itens: aplics.filter(a => a.conta_id === c.id && (a.ativo || atual.some(p => p.aplicacao_id === a.id))) })), [contasAF, aplics, atual]);
  const inp = (id: number, k: keyof Edit, travado: boolean) => <CampoValor value={ed[id]?.[k] ?? ''} disabled={travado} onChange={e => set(id, k, e.target.value)} style={{ width: 118, textAlign: 'right' }} />;
  const pendentes = aplics.filter(a => a.ativo && !atual.find(p => p.aplicacao_id === a.id)?.data_confirmacao && calc(a.id)).length;

  return (
    <>
      <div className="filters">
        <span className="chip" style={{ fontSize: 13, padding: '7px 12px' }}>Competência: {MESES[Number(mes.slice(5, 7)) - 1]}/{mes.slice(0, 4)}</span>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Informe os saldos bruto e líquido do extrato no fim do mês. Rendimento = bruto atual − bruto anterior − aplicações + resgates. IRRF = variação de (bruto − líquido).</span>
        <span style={{ flex: 1 }} />
        {msg && <span className={msg.t}>{msg.m}</span>}
        <button className="btn ghost" onClick={() => setNova({ conta: String(contasAF[0]?.id || ''), nome: '' })}>+ Nova aplicação</button>
        <button className="btn gold" disabled={!pendentes} onClick={confirmarTodos}>Confirmar todas ({pendentes})</button>
      </div>
      {porConta.map(({ c, itens }) => {
        const tot = itens.reduce((acc, a) => { const k = calc(a.id); const e = ed[a.id]; return { b: acc.b + Number(e?.bruto || 0), l: acc.l + Number(e?.liquido || 0), r: acc.r + (k?.rend || 0), i: acc.i + (k?.irrf || 0) }; }, { b: 0, l: 0, r: 0, i: 0 });
        const app = Number(saldosApp.find(s => s.id === c.id)?.saldo || 0);
        return (
          <div className="card mt" key={c.id} style={{ overflowX: 'auto' }}>
            <h3>{c.nome} <small>Saldo da conta no app: {brl(app)}{tot.l ? ` · soma dos saldos líquidos: ${brl(tot.l)} · diferença ${brl(tot.l - app)}` : ''}</small></h3>
            {itens.length === 0 ? <div className="empty" style={{ padding: 20 }}>Nenhuma aplicação nesta conta.</div> : (
              <table style={{ minWidth: 1180 }}>
                <thead><tr><th style={{ minWidth: 190 }}>Aplicação</th><th className="r">Bruto anterior</th><th className="r">Líquido anterior</th><th className="r">Aplicado no mês</th><th className="r">Resgatado no mês</th><th className="r">Bruto atual</th><th className="r">Líquido atual</th><th className="r">Rendimento</th><th className="r">IRRF projetado</th><th>Data</th><th /></tr></thead>
                <tbody>{itens.map(a => {
                  const p = atual.find(y => y.aplicacao_id === a.id), q = ant.find(y => y.aplicacao_id === a.id), k = calc(a.id), ok = !!p?.data_confirmacao;
                  return (
                    <Fragment key={a.id}>
                      <tr style={{ opacity: a.ativo ? 1 : 0.55 }}>
                        <td><b>{a.nome}</b>{!q && <div style={{ fontSize: 11, color: '#8A6A12' }}>Primeiro mês: informe o saldo anterior</div>}</td>
                        <td className="r">{q ? brl(q.saldo_bruto) : inp(a.id, 'antBruto', ok)}</td>
                        <td className="r">{q ? brl(q.saldo_liquido) : inp(a.id, 'antLiquido', ok)}</td>
                        <td className="r">{inp(a.id, 'aporte', ok)}</td><td className="r">{inp(a.id, 'resgate', ok)}</td>
                        <td className="r">{inp(a.id, 'bruto', ok)}</td><td className="r">{inp(a.id, 'liquido', ok)}</td>
                        <td className={'r ' + ((k?.rend || 0) >= 0 ? 'pos' : 'neg')}>{k ? brl(k.rend) : '·'}</td>
                        <td className="r neg">{k ? brl(k.irrf) : '·'}{k && <div style={{ fontSize: 11, color: 'var(--muted)' }}>acumulado {brl(k.irrfAcum)}</div>}</td>
                        <td><DataBR value={ed[a.id]?.data || ''} disabled={ok} onChange={e => set(a.id, 'data', e.target.value)} /></td>
                        <td className="r" style={{ whiteSpace: 'nowrap' }}>
                          {ok ? <><span className="st pago">Confirmado {dataBR(p!.data_confirmacao)}</span> <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => desfazer(p!)}>Desfazer</button></>
                            : <><button className="btn ghost" style={{ padding: '3px 9px', fontSize: 12 }} disabled={!ed[a.id]?.bruto || !ed[a.id]?.liquido} onClick={() => salvar(a)}>Salvar</button>{' '}
                              <button className="btn" style={{ padding: '3px 9px', fontSize: 12 }} disabled={!k} onClick={() => confirmar(a)}>Confirmar</button>{' '}
                              <button className="btn ghost" style={{ padding: '3px 9px', fontSize: 12 }} title={a.ativo ? 'Inativar' : 'Reativar'} onClick={() => inativar(a)}>{a.ativo ? '×' : '↺'}</button></>}
                        </td>
                      </tr>
                    </Fragment>);
                })}
                  <tr style={{ fontWeight: 700, background: '#FBF9F3' }}><td>Total</td><td colSpan={4} /><td className="r">{brl(tot.b)}</td><td className="r">{brl(tot.l)}</td><td className="r">{brl(tot.r)}</td><td className="r">{brl(tot.i)}</td><td colSpan={2} /></tr>
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>Ao confirmar, o app lança o rendimento (grupo Rendimentos) e o IRRF (Impostos · IRRF) como pagos na conta da aplicação, na data escolhida. Aplicações e resgates entre contas são registrados com "Transferência entre contas".</p>

      {nova && (
        <div className="modal-bg open" onClick={e => e.target === e.currentTarget && setNova(null)}>
          <div className="modal"><h2>Nova aplicação</h2>
            <form className="form" onSubmit={criar}>
              <label>Conta<select required value={nova.conta} onChange={e => setNova({ ...nova, conta: e.target.value })}>{contasAF.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
              <label>Nome do produto<input required value={nova.nome} onChange={e => setNova({ ...nova, nome: e.target.value })} placeholder="Ex.: CDB Banco X 110% CDI" /></label>
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setNova(null)}>Cancelar</button><button className="btn">Criar</button></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
