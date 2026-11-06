import { useEffect, useState } from 'react';
import CampoValor from './CampoValor';
import DataBR from './DataBR';
import { supabase, type Beneficiario, type CentroCusto, type Conta, type Grupo, type Subgrupo } from '../lib/supabase';
import { brl, hojeISO, STATUS_LABEL, rotuloParte } from '../lib/format';
import { OpcoesCentro, nomeCentro, centroPadrao } from '../lib/useCadastros';
import { formatarDocumento } from '../lib/documento';
import { usePersistente, limparRascunhos } from '../lib/rascunho';
import { carregarDicionario, invalidarDicionario, sugerir } from '../lib/sugestao';

interface Cad { contas: Conta[]; grupos: Grupo[]; subgrupos: Subgrupo[]; centros: CentroCusto[]; beneficiarios: Beneficiario[] }
interface LinhaC { parte: string; venc: string; valor: string; ref: string; doc: string; grupo: string; sub: string; cli?: string; sugerido?: boolean }
const rotuloB = (b?: Beneficiario) => (b ? `${b.nome} · ${formatarDocumento(b.documento)}` : '');
const ESPECIAIS = ['Transferências', 'Pagamento de fatura'];
const nova = (venc: string): LinhaC => ({ parte: '', venc, valor: '', ref: '', doc: '', grupo: '', sub: '' });

/** Lançamento de várias contas a pagar ou a receber de uma vez, com classificação comum e sugestão pelo histórico */
export function ModalLancarContas({ tipo, cad, aoFechar, aoSalvar, aoGravar }: { tipo: 'entrada' | 'saida'; cad: Cad; aoFechar: () => void; aoSalvar: (m: string) => void; aoGravar?: (m: string) => void }) {
  const receber = tipo === 'entrada';
  const honor = cad.grupos.find(g => g.nome === 'Honorários'), mens = cad.subgrupos.find(s => s.grupo_id === honor?.id && s.nome === 'Mensalidade');
  const chave = 'lote-contas:' + tipo;
  const [f, setF] = usePersistente(chave, () => ({
    conta: '', status: 'confirmado', forma: receber ? 'Boleto' : 'Boleto', grupo: receber && honor ? String(honor.id) : '', sub: receber && mens ? String(mens.id) : '', centro: '',
    linhas: Array.from({ length: 10 }, () => nova(hojeISO())),
  }));
  const [dic, setDic] = useState<Awaited<ReturnType<typeof carregarDicionario>>>([]);
  const [erro, setErro] = useState('');
  const [proc, setProc] = useState(false);
  const [ok, setOk] = useState('');
  useEffect(() => { carregarDicionario().then(setDic); }, []);

  const benef = (t: string) => cad.beneficiarios.find(b => rotuloB(b) === t || b.nome === t);
  const gruposTipo = cad.grupos.filter(g => !ESPECIAIS.includes(g.nome) && (receber ? g.natureza !== 'despesa' : g.natureza !== 'receita'));
  const nomeG = (id: string) => cad.grupos.find(g => String(g.id) === id)?.nome || '';
  const setL = (i: number, campo: keyof LinhaC, v: string) => {
    const linhas = f.linhas.map((l, j) => {
      if (j !== i) return l;
      const x = { ...l, [campo]: v } as LinhaC;
      if (campo === 'grupo') { x.sub = ''; x.sugerido = false; }
      // Ao escolher o cliente / fornecedor, sugere a classificação pelo histórico quando ela difere da comum
      if (campo === 'parte' && !l.grupo && dic.length) {
        const b = benef(v), s = sugerir(dic, { tipo, beneficiario_id: b?.id, texto: b?.nome || v }).opcoes[0];
        if (s && String(s.grupo_id) !== f.grupo && gruposTipo.some(g => g.id === s.grupo_id)) { x.grupo = String(s.grupo_id); x.sub = s.subgrupo_id ? String(s.subgrupo_id) : ''; x.sugerido = true; }
      }
      return x;
    });
    setF({ ...f, linhas });
  };
  const preenchidas = f.linhas.filter(l => Number(l.valor) > 0);
  const total = preenchidas.reduce((a, l) => a + Number(l.valor), 0);
  const fechar = () => { limparRascunhos(chave); aoFechar(); };

  async function salvar(continuar = false) {
    setErro('');
    if (!preenchidas.length) { setErro('Preencha ao menos uma linha com valor.'); return; }
    const regs = [];
    for (const [i, l] of f.linhas.entries()) {
      if (!(Number(l.valor) > 0)) continue;
      const b = benef(l.parte), grupo = l.grupo || f.grupo;
      if (!l.parte.trim()) { setErro(`Linha ${i + 1}: informe o ${receber ? 'cliente' : 'fornecedor'}.`); return; }
      if (!l.venc) { setErro(`Linha ${i + 1}: informe o vencimento.`); return; }
      if (!grupo) { setErro(`Linha ${i + 1}: escolha o grupo (na linha ou no padrão do lote).`); return; }
      const cli = !receber && (l.cli || '').trim() ? benef((l.cli || '').trim()) : null;
      if (!receber && (l.cli || '').trim() && !cli) { setErro(`Linha ${i + 1}: cliente relacionado não encontrado no cadastro. Escolha da lista ou apague.`); return; }
      if (!receber && l.venc >= '2027-01-01' && !b) { setErro(`Linha ${i + 1}: a partir de 01/01/2027, escolha um fornecedor / beneficiário cadastrado.`); return; }
      regs.push({
        tipo, conta_id: f.conta ? Number(f.conta) : null, vencimento: l.venc, grupo_id: Number(grupo), subgrupo_id: (l.grupo ? l.sub : f.sub) ? Number(l.grupo ? l.sub : f.sub) : null,
        centro_custo_id: f.centro && !l.grupo ? Number(f.centro) : null, beneficiario_id: b?.id ?? null, favorecido: b?.nome || l.parte.trim(), ...(receber ? {} : { cliente_id: cli?.id ?? null }),
        referencia: l.ref.trim() || null, documento: l.doc.trim() || null, valor: Math.round(Number(l.valor) * 100) / 100, status: f.status, forma_pagamento: f.forma, observacao: 'lançado em lote',
      });
    }
    setProc(true);
    const { error } = await supabase.from('lancamentos').insert(regs);
    setProc(false);
    if (error) { setErro(error.message); return; }
    invalidarDicionario(); limparRascunhos(chave);
    const m = `${regs.length} conta(s) a ${receber ? 'receber' : 'pagar'} lançada(s), total de ${brl(total)}.`;
    if (continuar && aoGravar) {
      // grade nova em branco, mantendo conta, status, forma e classificação padrão
      setF({ ...f, linhas: Array.from({ length: 10 }, () => nova(f.linhas[0]?.venc || hojeISO())) }); setOk(m + ' Grade pronta para o próximo lote.'); aoGravar(m);
    } else aoSalvar(m);
  }

  return (
    <div className="modal-bg open">
      <div className="modal" style={{ width: 'min(1220px, 97vw)' }}><h2>{receber ? 'Novas contas a receber' : 'Novas contas a pagar'}</h2>
        <div className="form form4" style={{ marginBottom: 10 }}>
          <label>Conta<select value={f.conta} onChange={e => setF({ ...f, conta: e.target.value })}><option value="">A definir</option>{cad.contas.filter(c => c.ativa && c.tipo !== 'aplicacao').map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
          <label>Status<select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{(['previsto', 'confirmado', 'agendado'] as const).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
          <label>Forma de {receber ? 'recebimento' : 'pagamento'}<select value={f.forma} onChange={e => setF({ ...f, forma: e.target.value })}>{['Boleto', 'PIX', 'Débito em conta', 'Transferência (TED)', 'Espécie'].map(x => <option key={x}>{x}</option>)}</select></label>
          <span />
          <label>Grupo padrão do lote<select value={f.grupo} onChange={e => setF({ ...f, grupo: e.target.value, sub: '' })}><option value="">Selecione</option>{gruposTipo.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select></label>
          <label>Subgrupo padrão<select value={f.sub} onChange={e => setF({ ...f, sub: e.target.value })}><option value="">·</option>{cad.subgrupos.filter(s => s.grupo_id === Number(f.grupo)).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
          <label className="span2">Centro de custo<select value={f.centro} onChange={e => setF({ ...f, centro: e.target.value })}>
            <option value="">{'Padrão do plano: ' + (nomeCentro(cad.centros, centroPadrao(cad.grupos, cad.subgrupos, Number(f.grupo), Number(f.sub))) || 'Geral')}</option><OpcoesCentro centros={cad.centros} /></select></label>
        </div>
        <datalist id="lote-partes">{cad.beneficiarios.filter(b => b.ativo).map(b => <option key={b.id} value={rotuloB(b)} />)}</datalist>
        <div style={{ maxHeight: '48vh', overflow: 'auto' }}>
          <table className="compacta lote-contas">
            <thead><tr><th style={{ width: 26 }}>#</th><th>{rotuloParte(tipo)}</th><th>Vencimento</th><th className="r">Valor (R$)</th><th>Referência</th><th>Documento</th><th>Grupo (se diferente do padrão)</th><th>Subgrupo</th>{!receber && <th>Cliente relacionado</th>}<th /></tr></thead>
            <tbody>{f.linhas.map((l, i) => (
              <tr key={i}>
                <td style={{ color: 'var(--muted)' }}>{i + 1}</td>
                <td style={{ minWidth: 230 }}><input list="lote-partes" value={l.parte} placeholder="Nome ou CPF/CNPJ" onChange={e => setL(i, 'parte', e.target.value)} style={{ width: '100%', borderColor: l.parte && !benef(l.parte) ? '#E6C77A' : undefined }} title={l.parte && !benef(l.parte) ? 'Não cadastrado: entra só com o nome' : ''} /></td>
                <td><DataBR value={l.venc} onChange={e => setL(i, 'venc', e.target.value)} style={{ width: 128 }} /></td>
                <td className="r"><CampoValor value={l.valor} onChange={e => setL(i, 'valor', e.target.value)} style={{ width: 110, textAlign: 'right' }} /></td>
                <td><input value={l.ref} placeholder="Competência" onChange={e => setL(i, 'ref', e.target.value)} style={{ width: 100 }} /></td>
                <td><input value={l.doc} placeholder="NF / boleto" onChange={e => setL(i, 'doc', e.target.value)} style={{ width: 100 }} /></td>
                <td><select value={l.grupo} onChange={e => setL(i, 'grupo', e.target.value)} style={{ width: 160 }}><option value="">{f.grupo ? 'Padrão: ' + nomeG(f.grupo) : 'Padrão do lote'}</option>{gruposTipo.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select>
                  {l.sugerido && <div style={{ fontSize: 11, color: '#8A6A12' }}>sugerido pelo histórico</div>}</td>
                <td><select value={l.sub} disabled={!l.grupo} onChange={e => setL(i, 'sub', e.target.value)} style={{ width: 130 }}><option value="">·</option>{cad.subgrupos.filter(s => s.grupo_id === Number(l.grupo)).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></td>
                {!receber && <td><input list="lote-partes" value={l.cli || ''} placeholder="Opcional" onChange={e => setL(i, 'cli', e.target.value)} style={{ width: 170, borderColor: l.cli && !benef(l.cli) ? 'var(--neg)' : undefined }} title={l.cli && !benef(l.cli) ? 'Escolha um cadastro da lista ou apague' : ''} /></td>}
                <td><button className="btn ghost mini" title="Repetir esta linha" onClick={() => setF({ ...f, linhas: [...f.linhas.slice(0, i + 1), { ...l, valor: '', doc: '', sugerido: false }, ...f.linhas.slice(i + 1)] })}>⧉</button></td>
              </tr>))}</tbody>
          </table>
        </div>
        <div className="filters" style={{ margin: '8px 0 0' }}>
          <button className="btn ghost mini" onClick={() => setF({ ...f, linhas: [...f.linhas, ...Array.from({ length: 10 }, () => nova(f.linhas[f.linhas.length - 1]?.venc || hojeISO()))] })}>+ 10 linhas</button>
          <span style={{ flex: 1 }} />
          <span>Contas: <b>{preenchidas.length}</b></span><span>Total: <b className={receber ? 'pos' : 'neg'}>{brl(total)}</b></span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' }}>Linhas sem valor são ignoradas. Nomes não cadastrados entram só com o nome{receber ? '' : ' (a partir de 01/01/2027, pagamentos exigem fornecedor cadastrado)'}. Ao escolher o {receber ? 'cliente' : 'fornecedor'}, o app sugere o grupo usado nos lançamentos anteriores quando ele é diferente do padrão.</p>
        {erro && <div className="err mt">{erro}</div>}
        {ok && <div className="ok mt">{ok}</div>}
        <div className="actions"><button className="btn ghost" onClick={fechar}>Fechar</button>
          {aoGravar && <button className="btn ghost" disabled={proc} onClick={() => salvar(true)}>Lançar e abrir outro lote</button>}
          <button className="btn" disabled={proc} onClick={() => salvar()}>{proc ? 'Gravando…' : `Lançar ${preenchidas.length || ''} conta(s)`}</button></div>
      </div>
    </div>
  );
}
