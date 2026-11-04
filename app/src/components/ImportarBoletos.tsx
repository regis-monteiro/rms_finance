import { useMemo, useState } from 'react';
import { supabase, type Beneficiario, type CentroCusto, type Conta, type Grupo, type Lancamento, type Subgrupo } from '../lib/supabase';
import { brl, dataBR } from '../lib/format';
import { OpcoesCentro, nomeCentro, centroPadrao } from '../lib/useCadastros';
import { formatarDocumento } from '../lib/documento';
import { invalidarDicionario } from '../lib/sugestao';

interface Cad { contas: Conta[]; grupos: Grupo[]; subgrupos: Subgrupo[]; centros: CentroCusto[]; beneficiarios: Beneficiario[] }
type Campo = 'cliente' | 'boleto' | 'referencia' | 'vencimento' | 'parcela' | 'valor' | 'conta';
const CAMPOS: { k: Campo; t: string; dicas: RegExp; obrig?: boolean }[] = [
  { k: 'cliente', t: 'Cliente *', dicas: /(cliente|sacado|pagador|raz[aã]o|^nome)/i, obrig: true },
  { k: 'vencimento', t: 'Vencimento *', dicas: /vencimento/i, obrig: true },
  { k: 'valor', t: 'Valor *', dicas: /(total|valor)/i, obrig: true },
  { k: 'boleto', t: 'Número do boleto', dicas: /(n[uú]mero|nosso n|boleto|identifica)/i },
  { k: 'referencia', t: 'Referência', dicas: /(refer|compet)/i },
  { k: 'parcela', t: 'Parcela', dicas: /parcela/i },
  { k: 'conta', t: 'Conta / banco', dicas: /(conta|banco|carteira)/i },
];
type Sit = 'novo' | 'vincular' | 'importado' | 'invalido';
const SIT: Record<Sit, string> = { novo: 'Novo', vincular: 'Usa previsão existente', importado: 'Já importado', invalido: 'Linha inválida' };
const COR: Record<Sit, string> = { novo: 'pago', vincular: 'conf', importado: 'prev', invalido: 'venc' };
const r2 = (v: number) => Math.round(v * 100) / 100;

const SUFIXOS = new Set(['ltda', 'me', 'epp', 'eireli', 'sa', 's', 'a', 'ss', 'cia', 'de', 'da', 'do', 'das', 'dos', 'e']);
const norm = (s: string | null | undefined) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const chave = (s: string | null | undefined) => norm(s).split(' ').filter(w => w && !SUFIXOS.has(w)).join(' ');
const dice = (a: string, b: string) => {
  const A = new Set(a.split(' ').filter(Boolean)), B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let c = 0; A.forEach(w => B.has(w) && c++);
  return (2 * c) / (A.size + B.size);
};
const rotuloB = (b?: Beneficiario) => (b ? `${b.nome} · ${formatarDocumento(b.documento)}` : '');

function dataISO(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return d.toISOString().slice(0, 10); }
  return '';
}
function numero(v: unknown) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[R$\s]/g, '');
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
}

async function lerPlanilha(f: File): Promise<unknown[][]> {
  if (/\.xls$/i.test(f.name)) throw new Error('Arquivo .xls antigo: abra no Excel e salve como .xlsx.');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await f.arrayBuffer());
  const ws = wb.worksheets.find(w => w.actualRowCount > 1) || wb.worksheets[0];
  if (!ws) throw new Error('A planilha está vazia.');
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, row => {
    const vals: unknown[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = row.getCell(c).value as unknown;
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
        vals.push(o.richText ? o.richText.map(x => x.text).join('') : o.result ?? o.text ?? '');
      } else vals.push(v ?? '');
    }
    out.push(vals);
  });
  return out;
}

export function ImportarBoletos({ cad, aoFechar, aoConcluir }: { cad: Cad; aoFechar: () => void; aoConcluir: (m: string) => void }) {
  const honor = cad.grupos.find(g => g.nome === 'Honorários');
  const mens = cad.subgrupos.find(s => s.grupo_id === honor?.id && s.nome === 'Mensalidade');
  const [arquivo, setArquivo] = useState('');
  const [cab, setCab] = useState<string[]>([]);
  const [dados, setDados] = useState<unknown[][]>([]);
  const [mapa, setMapa] = useState<Partial<Record<Campo, number>>>({});
  const [contasMapa, setContasMapa] = useState<Record<string, string>>({});
  const [contaPadrao, setContaPadrao] = useState('');
  const [classe, setClasse] = useState({ grupo: honor ? String(honor.id) : '', sub: mens ? String(mens.id) : '', centro: '' });
  const [escolhas, setEscolhas] = useState<Record<number, string>>({});   // cliente escolhido à mão (texto do campo)
  const [existentes, setExistentes] = useState<{ docs: Set<string>; abertos: Lancamento[] }>({ docs: new Set(), abertos: [] });
  const [filtro, setFiltro] = useState<Sit | 'sem' | ''>('');
  const [erro, setErro] = useState('');
  const [proc, setProc] = useState(false);

  const porChave = useMemo(() => {
    const m = new Map<string, Beneficiario[]>();
    cad.beneficiarios.forEach(b => [b.nome, b.nome_fantasia].forEach(n => { const k = chave(n); if (k) m.set(k, [...(m.get(k) || []), b]); }));
    return m;
  }, [cad.beneficiarios]);

  /** Cliente do cadastro pelo nome: igual (sem acentos, pontuação e LTDA/ME) ou, se não houver, o mais parecido e sem empate */
  function acharCliente(nome: string): { b?: Beneficiario; aprox?: boolean } {
    const k = chave(nome); if (!k) return {};
    const exato = porChave.get(k); if (exato?.length === 1) return { b: exato[0] };
    let melhor: Beneficiario | undefined, nota = 0, empate = false;
    for (const b of cad.beneficiarios) {
      const s = Math.max(dice(k, chave(b.nome)), dice(k, chave(b.nome_fantasia)));
      if (s > nota + 0.001) { melhor = b; nota = s; empate = false; } else if (Math.abs(s - nota) <= 0.001) empate = true;
    }
    return nota >= 0.8 && !empate ? { b: melhor, aprox: true } : {};
  }

  async function abrir(f: File) {
    setErro('');
    try {
      const todas = (await lerPlanilha(f)).filter(l => l.some(c => String(c ?? '').trim()));
      let h = todas.slice(0, 15).findIndex(l => l.some(c => /vencimento/i.test(String(c))) && l.some(c => /(cliente|sacado|pagador|nome)/i.test(String(c))));
      if (h < 0) throw new Error('Não encontrei o cabeçalho (colunas de cliente e vencimento).');
      const cabecalho = todas[h].map((c, i) => String(c ?? '').trim() || `Coluna ${i + 1}`);
      const m: Partial<Record<Campo, number>> = {};
      CAMPOS.forEach(({ k, dicas }) => { const i = cabecalho.findIndex((c, j) => dicas.test(c) && !Object.values(m).includes(j)); if (i >= 0) m[k] = i; });
      const linhas = todas.slice(h + 1);
      // Já importados (pelo número do boleto) e previsões em aberto nos meses da planilha
      const docs = new Set<string>(), nums = m.boleto != null ? [...new Set(linhas.map(l => String(l[m.boleto!] ?? '').trim()).filter(Boolean))] : [];
      for (let i = 0; i < nums.length; i += 150) {
        const r = await supabase.from('lancamentos').select('documento').eq('tipo', 'entrada').in('documento', nums.slice(i, i + 150));
        ((r.data as { documento: string }[]) || []).forEach(x => docs.add(x.documento));
      }
      const datas = linhas.map(l => (m.vencimento != null ? dataISO(l[m.vencimento]) : '')).filter(Boolean).sort();
      let abertos: Lancamento[] = [];
      if (datas.length) {
        const ini = datas[0].slice(0, 8) + '01', ultimo = datas[datas.length - 1], [a, mm] = ultimo.split('-').map(Number);
        const fim = `${ultimo.slice(0, 8)}${String(new Date(a, mm, 0).getDate()).padStart(2, '0')}`;
        const r = await supabase.from('lancamentos').select('*').eq('tipo', 'entrada').neq('status', 'pago').gte('vencimento', ini).lte('vencimento', fim).range(0, 4999);
        abertos = (r.data as Lancamento[]) || [];
      }
      // Contas: cada nome da planilha ligado a uma conta do app
      const nomesConta = m.conta != null ? [...new Set(linhas.map(l => String(l[m.conta!] ?? '').trim()).filter(Boolean))] : [];
      const cm: Record<string, string> = {};
      nomesConta.forEach(n => {
        const k = norm(n), alvo = cad.contas.filter(c => c.ativa && c.tipo === 'corrente').find(c => { const kc = norm(c.nome); return kc.includes(k) || k.includes(kc.split(' ')[0]) || (/(gerencianet|efi)/.test(k) && /(gerencianet|efi)/.test(kc)); });
        cm[n] = alvo ? String(alvo.id) : '';
      });
      setExistentes({ docs, abertos }); setContasMapa(cm); setEscolhas({});
      setArquivo(f.name); setCab(cabecalho); setDados(linhas); setMapa(m);
    } catch (e) { setErro((e as Error).message); }
  }

  const linhas = useMemo(() => {
    const usados = new Set<number>();
    return dados.map((l, i) => {
      const get = (k: Campo) => (mapa[k] != null ? l[mapa[k]!] : '');
      const nome = String(get('cliente') ?? '').trim(), venc = dataISO(get('vencimento')), valor = r2(numero(get('valor')));
      const boleto = String(get('boleto') ?? '').trim(), ref = String(get('referencia') ?? '').trim(), parcela = String(get('parcela') ?? '').trim();
      const contaTxt = String(get('conta') ?? '').trim(), conta = contasMapa[contaTxt] || contaPadrao;
      const escolhido = escolhas[i] != null ? cad.beneficiarios.find(b => rotuloB(b) === escolhas[i]) : undefined;
      const achado = escolhas[i] != null ? { b: escolhido } : acharCliente(nome);
      let sit: Sit = 'novo', prev: Lancamento | undefined;
      if (!nome || !venc || !(valor > 0)) sit = 'invalido';
      else if (boleto && existentes.docs.has(boleto)) sit = 'importado';
      else {
        const k = chave(nome);
        prev = existentes.abertos.find(p => !usados.has(p.id) && !p.documento && p.vencimento.slice(0, 7) === venc.slice(0, 7) && Math.abs(Number(p.valor) - valor) < 0.005
          && ((achado.b && p.beneficiario_id === achado.b.id) || chave(p.favorecido) === k || dice(chave(p.favorecido), k) >= 0.8));
        if (prev) { sit = 'vincular'; usados.add(prev.id); }
      }
      return { i, nome, venc, valor, boleto, ref: [ref, parcela && `parcela ${parcela}`].filter(Boolean).join(' · '), contaTxt, conta, b: achado.b, aprox: !!achado.aprox, sit, prev };
    }).filter(x => x.nome || x.valor);
  }, [dados, mapa, contasMapa, contaPadrao, escolhas, existentes, porChave]);

  /** Estimativas sem cliente nos meses importados: abatidas pelo total dos boletos novos */
  const estimativas = useMemo(() => {
    const novosMes = new Map<string, number>();
    linhas.filter(l => l.sit === 'novo').forEach(l => novosMes.set(l.venc.slice(0, 7), r2((novosMes.get(l.venc.slice(0, 7)) || 0) + l.valor)));
    return [...novosMes].map(([mes, total]) => {
      const est = existentes.abertos.filter(p => p.vencimento.slice(0, 7) === mes && !p.beneficiario_id && /^estimativa/i.test(p.observacao || '') && cad.grupos.find(g => g.id === p.grupo_id)?.natureza === 'receita');
      let resta = total;
      const ajustes = est.map(e => { const abate = Math.min(Number(e.valor), resta); resta = r2(resta - abate); return { e, novo: r2(Number(e.valor) - abate) }; });
      return { mes, total, ajustes };
    }).filter(x => x.ajustes.length);
  }, [linhas, existentes]);

  const cont = (s: Sit) => linhas.filter(l => l.sit === s).length;
  const semCadastro = linhas.filter(l => l.sit !== 'invalido' && l.sit !== 'importado' && !l.b).length;
  const semConta = linhas.filter(l => (l.sit === 'novo' || l.sit === 'vincular') && !l.conta).length;
  const totalNovo = r2(linhas.filter(l => l.sit === 'novo').reduce((a, l) => a + l.valor, 0));

  async function importar() {
    setErro('');
    if (!classe.grupo) { setErro('Escolha o grupo de receita.'); return; }
    if (semConta) { setErro(`${semConta} boleto(s) sem conta definida: ligue cada banco da planilha a uma conta do app.`); return; }
    setProc(true);
    let n = 0, v = 0;
    try {
      const base = (l: typeof linhas[number]) => ({ conta_id: Number(l.conta), vencimento: l.venc, documento: l.boleto || null, referencia: l.ref || null, forma_pagamento: 'Boleto',
        beneficiario_id: l.b?.id ?? null, favorecido: l.b?.nome || l.nome });
      const novos = linhas.filter(l => l.sit === 'novo').map(l => ({ ...base(l), tipo: 'entrada', status: 'confirmado', valor: l.valor, grupo_id: Number(classe.grupo), subgrupo_id: classe.sub ? Number(classe.sub) : null,
        centro_custo_id: classe.centro ? Number(classe.centro) : null, observacao: 'boleto importado' }));
      for (let i = 0; i < novos.length; i += 200) {
        const r = await supabase.from('lancamentos').insert(novos.slice(i, i + 200));
        if (r.error) throw new Error(r.error.message);
        n += Math.min(200, novos.length - i);
      }
      for (const l of linhas.filter(x => x.sit === 'vincular')) {
        const r = await supabase.from('lancamentos').update({ ...base(l), status: 'confirmado', atualizado_em: new Date().toISOString() }).eq('id', l.prev!.id);
        if (r.error) throw new Error(r.error.message);
        v++;
      }
      for (const m of estimativas) for (const a of m.ajustes) {
        const r = a.novo > 0.004 ? await supabase.from('lancamentos').update({ valor: a.novo, atualizado_em: new Date().toISOString() }).eq('id', a.e.id) : await supabase.from('lancamentos').delete().eq('id', a.e.id);
        if (r.error) throw new Error('Estimativa: ' + r.error.message);
      }
      invalidarDicionario();
      aoConcluir(`${n} boleto(s) lançado(s) em contas a receber, ${v} previsão(ões) atualizada(s) com o boleto${estimativas.length ? ' e estimativa do mês ajustada' : ''}.`);
    } catch (e) { setErro(`Importação interrompida (${n} lançado(s), ${v} atualizado(s)): ${(e as Error).message}`); }
    setProc(false);
  }

  const visiveis = linhas.filter(l => !filtro || (filtro === 'sem' ? !l.b && l.sit !== 'invalido' && l.sit !== 'importado' : l.sit === filtro));
  return (
    <div className="modal-bg open">
      <div className="modal" style={{ width: 'min(1240px, 97vw)' }}><h2>Importar boletos para contas a receber</h2>
        {!arquivo ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>Envie o relatório de boletos em Excel (.xlsx), com uma linha por boleto: cliente, vencimento e valor, e, se houver, número do boleto, referência e banco. Cada boleto vira uma conta a receber. Boletos já importados (pelo número) são ignorados, então o mesmo arquivo pode ser reenviado sem duplicar.</p>
            <label className="btn gold" style={{ display: 'inline-block', cursor: 'pointer' }}>Escolher planilha
              <input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) abrir(f); e.target.value = ''; }} /></label>
            {erro && <div className="err mt">{erro}</div>}
            <div className="actions"><button className="btn ghost" onClick={aoFechar}>Cancelar</button></div>
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 8, fontSize: 12 }}>
              {CAMPOS.map(({ k, t }) => (
                <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontWeight: 600, color: 'var(--navy)' }}>{t}
                  <select value={mapa[k] ?? ''} onChange={e => setMapa({ ...mapa, [k]: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ fontSize: 12, padding: '4px 6px' }}>
                    <option value="">·</option>{cab.map((c, i) => <option key={i} value={i}>{c}</option>)}</select></label>))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, fontSize: 12, marginTop: 10 }}>
              {Object.keys(contasMapa).length ? Object.keys(contasMapa).map(n => (
                <label key={n} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontWeight: 600, color: 'var(--navy)' }}>Banco "{n}" →
                  <select value={contasMapa[n]} onChange={e => setContasMapa({ ...contasMapa, [n]: e.target.value })} style={{ fontSize: 12, padding: '4px 6px', borderColor: contasMapa[n] ? undefined : 'var(--neg)' }}>
                    <option value="">Escolha a conta</option>{cad.contas.filter(c => c.ativa && c.tipo !== 'aplicacao').map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>))
                : <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontWeight: 600, color: 'var(--navy)' }}>Conta de recebimento
                  <select value={contaPadrao} onChange={e => setContaPadrao(e.target.value)} style={{ fontSize: 12, padding: '4px 6px' }}><option value="">Escolha a conta</option>{cad.contas.filter(c => c.ativa && c.tipo !== 'aplicacao').map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontWeight: 600, color: 'var(--navy)' }}>Grupo
                <select value={classe.grupo} onChange={e => setClasse({ ...classe, grupo: e.target.value, sub: '' })} style={{ fontSize: 12, padding: '4px 6px' }}>{cad.grupos.filter(g => g.natureza === 'receita').map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontWeight: 600, color: 'var(--navy)' }}>Subgrupo
                <select value={classe.sub} onChange={e => setClasse({ ...classe, sub: e.target.value })} style={{ fontSize: 12, padding: '4px 6px' }}><option value="">·</option>{cad.subgrupos.filter(s => s.grupo_id === Number(classe.grupo)).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontWeight: 600, color: 'var(--navy)' }}>Centro de custo
                <select value={classe.centro} onChange={e => setClasse({ ...classe, centro: e.target.value })} style={{ fontSize: 12, padding: '4px 6px' }}>
                  <option value="">{'Padrão: ' + (nomeCentro(cad.centros, centroPadrao(cad.grupos, cad.subgrupos, Number(classe.grupo), Number(classe.sub))) || 'Geral')}</option><OpcoesCentro centros={cad.centros} /></select></label>
            </div>
            {estimativas.map(m => (
              <p key={m.mes} className="proto" style={{ margin: '10px 0 0' }}>Previsão estimada de {m.mes.slice(5)}/{m.mes.slice(0, 4)} (sem cliente): {m.ajustes.map(a => `${brl(a.e.valor)} → ${a.novo > 0.004 ? brl(a.novo) : 'removida'}`).join(' · ')}, abatida pelos {brl(m.total)} em boletos novos.</p>
            ))}
            <div className="filters" style={{ margin: '10px 0 6px' }}>
              <div className="tabs" style={{ margin: 0, border: 0 }}>
                {([['', `Todos (${linhas.length})`], ['novo', `${SIT.novo} (${cont('novo')})`], ['vincular', `${SIT.vincular} (${cont('vincular')})`], ['importado', `${SIT.importado} (${cont('importado')})`], ['sem', `Sem cadastro (${semCadastro})`], ['invalido', `${SIT.invalido} (${cont('invalido')})`]] as [Sit | 'sem' | '', string][]).map(([k, t]) =>
                  <button key={k} className={filtro === k ? 'on' : ''} onClick={() => setFiltro(k)}>{t}</button>)}
              </div>
            </div>
            <datalist id="imp-boletos-clientes">{cad.beneficiarios.filter(b => b.ativo).map(b => <option key={b.id} value={rotuloB(b)} />)}</datalist>
            <div style={{ maxHeight: '40vh', overflow: 'auto' }}>
              <table className="compacta"><thead><tr><th>Cliente na planilha</th><th>Cadastro</th><th>Vencimento</th><th>Boleto</th><th>Ref.</th><th>Banco</th><th className="r">Valor</th><th>Situação</th></tr></thead>
                <tbody>{visiveis.map(l => (
                  <tr key={l.i}><td>{l.nome || '·'}</td>
                    <td style={{ minWidth: 240 }}>{l.sit === 'importado' || l.sit === 'invalido' ? (l.b?.nome || '·') :
                      <><input list="imp-boletos-clientes" value={escolhas[l.i] ?? rotuloB(l.b)} placeholder="Não encontrado: escolha ou deixe só o nome" onChange={e => setEscolhas({ ...escolhas, [l.i]: e.target.value })}
                        style={{ width: '100%', fontSize: 12, padding: '3px 6px', borderColor: !l.b ? '#E6C77A' : undefined }} />{l.aprox && <div style={{ fontSize: 11, color: '#8A6A12' }}>Nome aproximado: confira</div>}</>}</td>
                    <td>{l.venc ? dataBR(l.venc) : '·'}</td><td style={{ fontSize: 11 }}>{l.boleto ? (l.boleto.length > 20 ? l.boleto.slice(0, 8) + '…' : l.boleto) : '·'}</td><td>{l.ref || '·'}</td>
                    <td>{l.contaTxt || '·'}</td><td className="r">{l.valor ? brl(l.valor) : '·'}</td>
                    <td><span className={'st ' + COR[l.sit]}>{SIT[l.sit]}</span>{l.prev && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.prev.favorecido}</div>}</td></tr>))}</tbody></table>
            </div>
            {erro && <div className="err mt">{erro}</div>}
            <div className="actions">
              <span style={{ marginRight: 'auto', fontSize: 13 }}>Novos: <b>{cont('novo')}</b> ({brl(totalNovo)}) · previsões atualizadas: <b>{cont('vincular')}</b>{semCadastro ? ` · ${semCadastro} sem cadastro (entram só com o nome)` : ''}</span>
              <button className="btn ghost" onClick={() => { setArquivo(''); setDados([]); }}>Trocar planilha</button>
              <button className="btn ghost" onClick={aoFechar}>Cancelar</button>
              <button className="btn" disabled={proc || CAMPOS.some(c => c.obrig && mapa[c.k] == null) || !(cont('novo') + cont('vincular'))} onClick={importar}>{proc ? 'Importando…' : 'Importar'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
