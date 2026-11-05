import { useMemo, useState } from 'react';
import CampoValor from './CampoValor';
import DataBR from './DataBR';
import { supabase, type Lancamento, type Status, type Conta, type Grupo, type Subgrupo, type Beneficiario } from '../lib/supabase';
import { brl, dataBR, STATUS_LABEL, rotuloParte, ROTULO_PARTE } from '../lib/format';
import { formatarDocumento } from '../lib/documento';
import { usePersistente } from '../lib/rascunho';

export const somaMeses = (iso: string, k: number) => {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(a, m - 1 + k, 1), ult = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(Math.min(d, ult)).padStart(2, '0')}`;
};
const somaDiasISO = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const rotuloB = (b?: Beneficiario) => (b ? `${b.nome} · ${formatarDocumento(b.documento)}` : '');
const ESPECIAIS = ['Transferências', 'Pagamento de fatura'];

interface Cad { contas: Conta[]; grupos: Grupo[]; subgrupos: Subgrupo[]; beneficiarios: Beneficiario[] }

function Modal({ titulo, largura = 600, aoFechar, children }: { titulo: string; largura?: number; aoFechar: () => void; children: React.ReactNode }) {
  return <div className="modal-bg open"><div className="modal" style={{ width: `min(${largura}px,100%)` }}><h2>{titulo}</h2>{children}</div></div>;
}

export function CampoBeneficiario({ cad, valor, aoMudar, obrigatorio, placeholder }: { cad: Pick<Cad, 'beneficiarios'>; valor: number | null; aoMudar: (b: Beneficiario | null) => void; obrigatorio?: boolean; placeholder?: string }) {
  const [txt, setTxt] = useState(rotuloB(cad.beneficiarios.find(b => b.id === valor)));
  return (
    <>
      <input list="lote-benef" value={txt} required={obrigatorio} placeholder={placeholder || 'Nome ou CPF/CNPJ'} style={txt && !cad.beneficiarios.some(x => rotuloB(x) === txt) ? { borderColor: 'var(--neg)' } : undefined} title={txt && !cad.beneficiarios.some(x => rotuloB(x) === txt) ? 'Escolha um cadastro da lista ou apague' : ''} onChange={e => { setTxt(e.target.value); const b = cad.beneficiarios.find(x => rotuloB(x) === e.target.value); aoMudar(b || null); }} />
      <datalist id="lote-benef">{cad.beneficiarios.filter(b => b.ativo).map(b => <option key={b.id} value={rotuloB(b)} />)}</datalist>
    </>
  );
}

/* ---------------- Transferência entre contas ---------------- */
export function ModalTransferencia({ cad, hoje, aoFechar, aoSalvar }: { cad: Cad; hoje: string; aoFechar: () => void; aoSalvar: () => void }) {
  const [f, setF] = usePersistente('lote:transf', { origem: '', destino: '', data: hoje, valor: '', status: 'pago' as Status, obs: '' });
  const [erro, setErro] = useState('');
  const ativas = cad.contas.filter(c => c.ativa);
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    if (f.origem === f.destino) { setErro('Escolha contas diferentes.'); return; }
    const g = cad.grupos.find(x => x.nome === 'Transferências');
    const nome = (id: string) => cad.contas.find(c => String(c.id) === id)?.nome;
    const id = crypto.randomUUID(), valor = Number(f.valor), pago = f.status === 'pago';
    const base = { vencimento: f.data, data_pagamento: pago ? f.data : null, grupo_id: g!.id, valor, status: f.status, transferencia_id: id, observacao: f.obs || null, forma_pagamento: 'Transferência (TED)' };
    const { error } = await supabase.from('lancamentos').insert([
      { ...base, tipo: 'saida', conta_id: Number(f.origem), favorecido: 'Transferência para ' + nome(f.destino) },
      { ...base, tipo: 'entrada', conta_id: Number(f.destino), favorecido: 'Transferência de ' + nome(f.origem) },
    ]);
    if (error) { setErro(error.message); return; }
    aoSalvar();
  }
  return (
    <Modal titulo="Transferência entre contas" aoFechar={aoFechar}>
      <form className="form" onSubmit={salvar}>
        <label>Conta de origem<select required value={f.origem} onChange={e => setF({ ...f, origem: e.target.value })}><option value="" disabled>Selecione</option>{ativas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
        <label>Conta de destino<select required value={f.destino} onChange={e => setF({ ...f, destino: e.target.value })}><option value="" disabled>Selecione</option>{ativas.filter(c => String(c.id) !== f.origem).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
        <label>Data<DataBR required value={f.data} onChange={e => setF({ ...f, data: e.target.value })} /></label>
        <label>Valor (R$)<CampoValor min="0.01" required value={f.valor} onChange={e => setF({ ...f, valor: e.target.value })} /></label>
        <label>Status<select value={f.status} onChange={e => setF({ ...f, status: e.target.value as Status })}>{(['pago', 'agendado', 'previsto'] as Status[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        <label>Observação<input value={f.obs} onChange={e => setF({ ...f, obs: e.target.value })} placeholder="Ex.: aplicação, resgate" /></label>
        <p className="full" style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Gera uma saída na conta de origem e uma entrada na de destino, ligadas entre si. Fica fora do resultado (DRE), como movimentação entre contas.</p>
        {erro && <div className="err full">{erro}</div>}
        <div className="actions full"><button type="button" className="btn ghost" onClick={aoFechar}>Cancelar</button><button className="btn">Transferir</button></div>
      </form>
    </Modal>
  );
}

/* ---------------- Previsões em lote: repetição mensal ---------------- */
export function ModalRepeticao({ cad, hoje, aoFechar, aoSalvar }: { cad: Cad; hoje: string; aoFechar: () => void; aoSalvar: (n: number) => void }) {
  const mesAtual = hoje.slice(0, 7);
  const [f, setF] = usePersistente('lote:repet', { tipo: 'saida', conta: '', grupo: '', sub: '', benef: null as number | null, fav: '', valor: '', dia: hoje.slice(8, 10), de: mesAtual, ate: `${hoje.slice(0, 4)}-12`, reaj: '', mesReaj: '', status: 'previsto' as Status, ref: true });
  const [erro, setErro] = useState('');
  const meses = useMemo(() => { const r: string[] = []; let m = f.de; while (m <= f.ate && r.length < 60) { r.push(m); m = somaMeses(m + '-01', 1).slice(0, 7); } return r; }, [f.de, f.ate]);
  const valorDo = (m: string) => { const v = Number(f.valor || 0); return f.reaj && f.mesReaj && m >= f.mesReaj ? Math.round(v * (1 + Number(f.reaj) / 100) * 100) / 100 : v; };
  const total = meses.reduce((a, m) => a + valorDo(m), 0);
  const g = cad.grupos.find(x => x.id === Number(f.grupo));
  const exige = f.tipo === 'saida' && f.ate >= '2027-01' && !ESPECIAIS.includes(g?.nome || '') && cad.contas.find(c => c.id === Number(f.conta))?.tipo !== 'aplicacao';
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    if (!meses.length) { setErro('Período inválido.'); return; }
    if (exige && !f.benef) { setErro('A partir de 01/01/2027, escolha um fornecedor / beneficiário cadastrado.'); return; }
    const linhas = meses.map(m => ({
      tipo: f.tipo, conta_id: f.conta ? Number(f.conta) : null, vencimento: somaMeses(`${m}-${f.dia.padStart(2, '0')}`, 0),
      grupo_id: Number(f.grupo), subgrupo_id: f.sub ? Number(f.sub) : null, beneficiario_id: f.benef, favorecido: f.fav,
      referencia: f.ref ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : null, valor: valorDo(m), status: f.status, observacao: 'previsão em lote',
    }));
    const { error } = await supabase.from('lancamentos').insert(linhas);
    if (error) { setErro(error.message); return; }
    aoSalvar(linhas.length);
  }
  return (
    <Modal titulo="Previsões em lote · repetição mensal" largura={920} aoFechar={aoFechar}>
      <form className="form form4" onSubmit={salvar}>
        <label>Tipo<select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}><option value="saida">Saída</option><option value="entrada">Entrada</option></select></label>
        <label>Conta<select value={f.conta} onChange={e => setF({ ...f, conta: e.target.value })}><option value="">A definir</option>{cad.contas.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
        <label>Grupo<select required value={f.grupo} onChange={e => setF({ ...f, grupo: e.target.value, sub: '' })}><option value="" disabled>Selecione</option>{cad.grupos.filter(x => !ESPECIAIS.includes(x.nome)).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
        <label>Subgrupo<select value={f.sub} onChange={e => setF({ ...f, sub: e.target.value })}><option value="">·</option>{cad.subgrupos.filter(s => s.grupo_id === Number(f.grupo)).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
        <label className="span2">{rotuloParte(f.tipo)} cadastrado{exige ? ' *' : ''}<CampoBeneficiario cad={cad} valor={f.benef} obrigatorio={exige} aoMudar={b => setF(x => ({ ...x, benef: b?.id ?? null, fav: b ? b.nome : x.fav, grupo: x.grupo || (b?.grupo_id ? String(b.grupo_id) : ''), sub: x.sub || (b?.subgrupo_id ? String(b.subgrupo_id) : '') }))} /></label>
        {!f.benef && <label className="span2">{rotuloParte(f.tipo)}<input required value={f.fav} onChange={e => setF({ ...f, fav: e.target.value })} /></label>}
        <label>Valor mensal (R$)<CampoValor min="0.01" required value={f.valor} onChange={e => setF({ ...f, valor: e.target.value })} /></label>
        <label>Dia do vencimento<input type="number" min={1} max={31} required value={f.dia} onChange={e => setF({ ...f, dia: e.target.value })} /></label>
        <label>De (mês)<input type="month" required value={f.de} onChange={e => setF({ ...f, de: e.target.value })} /></label>
        <label>Até (mês)<input type="month" required value={f.ate} onChange={e => setF({ ...f, ate: e.target.value })} /></label>
        <label>Reajuste (%) · opcional<CampoValor value={f.reaj} onChange={e => setF({ ...f, reaj: e.target.value })} /></label>
        <label>A partir de (mês)<input type="month" value={f.mesReaj} onChange={e => setF({ ...f, mesReaj: e.target.value })} disabled={!f.reaj} /></label>
        <label>Status<select value={f.status} onChange={e => setF({ ...f, status: e.target.value as Status })}><option value="previsto">Previsto</option><option value="confirmado">Confirmado</option></select></label>
        <label className="span2" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20 }}><input type="checkbox" checked={f.ref} onChange={e => setF({ ...f, ref: e.target.checked })} /> Referência = mês/ano</label>
        <p className="full" style={{ margin: 0, fontSize: 13 }}>Serão criados <b>{meses.length}</b> lançamentos, total de <b>{brl(total)}</b>. Dia inexistente no mês vai para o último dia.</p>
        {erro && <div className="err full">{erro}</div>}
        <div className="actions full"><button type="button" className="btn ghost" onClick={aoFechar}>Cancelar</button><button className="btn">Criar previsões</button></div>
      </form>
    </Modal>
  );
}

/* ---------------- Copiar selecionados como previsão ---------------- */
export function ModalCopiar({ itens, cad, aoFechar, aoSalvar }: { itens: Lancamento[]; cad: Cad; aoFechar: () => void; aoSalvar: (n: number) => void }) {
  const [f, setF] = usePersistente('lote:copiar', { meses: '1', reaj: '', manterConta: true });
  const [erro, setErro] = useState('');
  const copiaveis = itens.filter(l => !l.fatura_id && !l.transferencia_id);
  const n = Math.max(1, Math.min(24, Number(f.meses) || 1));
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    const fator = 1 + Number(f.reaj || 0) / 100;
    const linhas = copiaveis.flatMap(l => Array.from({ length: n }, (_, k) => {
      const venc = somaMeses(l.vencimento, k + 1);
      return { tipo: l.tipo, conta_id: f.manterConta ? l.conta_id : null, vencimento: venc, grupo_id: l.grupo_id, subgrupo_id: l.subgrupo_id,
        beneficiario_id: l.beneficiario_id, favorecido: l.favorecido, referencia: /^\d{2}\/\d{4}$/.test(l.referencia || '') ? `${venc.slice(5, 7)}/${venc.slice(0, 4)}` : l.referencia,
        documento: null, valor: Math.round(Number(l.valor) * fator * 100) / 100, status: 'previsto', forma_pagamento: l.forma_pagamento, observacao: 'previsão copiada' };
    }));
    const { error } = await supabase.from('lancamentos').insert(linhas);
    if (error) { setErro(error.message.includes('beneficiário') ? 'Algum lançamento cairia em 2027 sem beneficiário. Informe o beneficiário nos originais antes de copiar.' : error.message); return; }
    aoSalvar(linhas.length);
  }
  return (
    <Modal titulo={`Copiar ${copiaveis.length} lançamento(s) como previsão`} aoFechar={aoFechar}>
      <form className="form" onSubmit={salvar}>
        <label>Repetir nos próximos (meses)<input type="number" min={1} max={24} value={f.meses} onChange={e => setF({ ...f, meses: e.target.value })} /></label>
        <label>Reajuste (%) · opcional<CampoValor value={f.reaj} onChange={e => setF({ ...f, reaj: e.target.value })} /></label>
        <label className="full" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={f.manterConta} onChange={e => setF({ ...f, manterConta: e.target.checked })} /> Manter a conta dos originais</label>
        <p className="full" style={{ margin: 0, fontSize: 13 }}>Serão criados <b>{copiaveis.length * n}</b> lançamentos com status Previsto, no mesmo dia de vencimento dos meses seguintes.
          {itens.length > copiaveis.length && <> {itens.length - copiaveis.length} item(ns) de fatura de cartão ou transferência ficam de fora.</>}</p>
        {erro && <div className="err full">{erro}</div>}
        <div className="actions full"><button type="button" className="btn ghost" onClick={aoFechar}>Cancelar</button><button className="btn" disabled={!copiaveis.length}>Copiar</button></div>
      </form>
    </Modal>
  );
}

/* ---------------- Alteração em lote ---------------- */
export function ModalAlterarLote({ itens, cad, hoje, aoFechar, aoSalvar }: { itens: Lancamento[]; cad: Cad; hoje: string; aoFechar: () => void; aoSalvar: (n: number) => void }) {
  const [usar, setUsar] = usePersistente('lote:alterar-usar', { status: false, conta: false, venc: false, grupo: false, benef: false, cliente: false, valor: false });
  const [v, setV] = usePersistente('lote:alterar', { status: 'confirmado' as Status, dataPag: hoje, conta: '', vencModo: 'data', vencData: hoje, vencN: '0', grupo: '', sub: '', benef: null as number | null, cliente: null as number | null, valorModo: 'pct', valor: '' });
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);
  const especiais = itens.filter(l => l.fatura_id || l.transferencia_id).length;

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    if (!Object.values(usar).some(Boolean)) { setErro('Marque ao menos um campo para alterar.'); return; }
    if (usar.status && v.status === 'pago' && !usar.conta && itens.some(l => !l.conta_id)) { setErro('Há itens sem conta. Marque também "Conta" para baixar como Pago.'); return; }
    setProcessando(true);
    const b = cad.beneficiarios.find(x => x.id === v.benef);
    let ok = 0; const falhas: string[] = [];
    for (const l of itens) {
      const especial = !!(l.fatura_id || l.transferencia_id);
      const d: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
      if (usar.conta) d.conta_id = v.conta ? Number(v.conta) : null;
      if (usar.status) { d.status = v.status; d.data_pagamento = v.status === 'pago' ? v.dataPag : null; }
      if (usar.venc) d.vencimento = v.vencModo === 'data' ? v.vencData : v.vencModo === 'dias' ? somaDiasISO(l.vencimento, Number(v.vencN)) : somaMeses(l.vencimento, Number(v.vencN));
      if (!especial && usar.grupo) { d.grupo_id = Number(v.grupo); d.subgrupo_id = v.sub ? Number(v.sub) : null; }
      if (!especial && usar.cliente && l.tipo === 'saida') d.cliente_id = v.cliente;
      if (!especial && usar.benef) { d.beneficiario_id = b?.id ?? null; if (b) d.favorecido = b.nome; }
      if (!especial && usar.valor) d.valor = v.valorModo === 'fixo' ? Number(v.valor) : Math.round(Number(l.valor) * (1 + Number(v.valor) / 100) * 100) / 100;
      const { error } = await supabase.from('lancamentos').update(d).eq('id', l.id);
      if (error) falhas.push(`${l.favorecido || 'Lançamento'} (${dataBR(l.vencimento)}): ${error.message}`); else ok++;
    }
    setProcessando(false);
    if (falhas.length) { setErro(`${ok} alterado(s). Não foi possível alterar ${falhas.length}: ${falhas.slice(0, 3).join(' | ')}`); return; }
    aoSalvar(ok);
  }
  const marca = (k: keyof typeof usar, t: string) => <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontWeight: 600, color: 'var(--navy)', alignSelf: 'center', marginTop: 0 }}><input type="checkbox" checked={usar[k]} onChange={e => setUsar({ ...usar, [k]: e.target.checked })} /> {t}</label>;
  return (
    <Modal titulo={`Alterar ${itens.length} lançamento(s) em lote`} largura={820} aoFechar={aoFechar}>
      <form className="form" onSubmit={salvar}>
        <div className="full lote">
        {marca('status', 'Status')}
        {usar.status && <><label>Novo status<select value={v.status} onChange={e => setV({ ...v, status: e.target.value as Status })}>{(['previsto', 'confirmado', 'agendado', 'pago'] as Status[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
          {v.status === 'pago' ? <label>Data do pagamento<DataBR required value={v.dataPag} onChange={e => setV({ ...v, dataPag: e.target.value })} /></label> : <span />}</>}
        </div>
        <div className="full lote">
        {marca('conta', 'Conta')}
        {usar.conta && <label className="span2">Nova conta<select value={v.conta} onChange={e => setV({ ...v, conta: e.target.value })}><option value="">A definir</option>{cad.contas.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>}
        </div>
        <div className="full lote">
        {marca('venc', 'Vencimento')}
        {usar.venc && <><label>Como alterar<select value={v.vencModo} onChange={e => setV({ ...v, vencModo: e.target.value })}><option value="data">Nova data para todos</option><option value="dias">Adiar/antecipar em dias</option><option value="meses">Adiar/antecipar em meses</option></select></label>
          {v.vencModo === 'data' ? <label>Nova data<DataBR required value={v.vencData} onChange={e => setV({ ...v, vencData: e.target.value })} /></label>
            : <label>{v.vencModo === 'dias' ? 'Dias' : 'Meses'} (negativo antecipa)<input type="number" required value={v.vencN} onChange={e => setV({ ...v, vencN: e.target.value })} /></label>}</>}
        </div>
        <div className="full lote">
        {marca('grupo', 'Grupo e subgrupo')}
        {usar.grupo && <><label>Grupo<select required value={v.grupo} onChange={e => setV({ ...v, grupo: e.target.value, sub: '' })}><option value="" disabled>Selecione</option>{cad.grupos.filter(x => !ESPECIAIS.includes(x.nome)).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
          <label>Subgrupo<select value={v.sub} onChange={e => setV({ ...v, sub: e.target.value })}><option value="">·</option>{cad.subgrupos.filter(s => s.grupo_id === Number(v.grupo)).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label></>}
        </div>
        <div className="full lote">
        {marca('benef', ROTULO_PARTE)}
        {usar.benef && <label className="span2">Fornecedor / cliente cadastrado (também atualiza o nome no lançamento)<CampoBeneficiario cad={cad} valor={v.benef} aoMudar={b => setV(x => ({ ...x, benef: b?.id ?? null }))} /></label>}
        </div>
        <div className="full lote">
        {marca('cliente', 'Cliente relacionado (contas a pagar)')}
        {usar.cliente && <label className="span2">Cliente para quem a despesa foi feita (em branco remove)<CampoBeneficiario cad={cad} valor={v.cliente} aoMudar={b => setV(x => ({ ...x, cliente: b?.id ?? null }))} /></label>}
        </div>
        <div className="full lote">
        {marca('valor', 'Valor')}
        {usar.valor && <><label>Como alterar<select value={v.valorModo} onChange={e => setV({ ...v, valorModo: e.target.value })}><option value="pct">Reajuste em %</option><option value="fixo">Novo valor para todos</option></select></label>
          <label>{v.valorModo === 'pct' ? 'Percentual (negativo reduz)' : 'Valor (R$)'}<CampoValor required value={v.valor} onChange={e => setV({ ...v, valor: e.target.value })} /></label></>}
        </div>
        {especiais > 0 && <p className="full" style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>{especiais} item(ns) de fatura de cartão ou transferência: só status, conta e vencimento são alterados.</p>}
        {erro && <div className="err full">{erro}</div>}
        <div className="actions full"><button type="button" className="btn ghost" onClick={aoFechar}>Cancelar</button><button className="btn" disabled={processando}>{processando ? 'Aplicando…' : 'Aplicar'}</button></div>
      </form>
    </Modal>
  );
}
