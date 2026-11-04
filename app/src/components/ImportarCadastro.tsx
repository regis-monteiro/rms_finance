import { useMemo, useState } from 'react';
import { supabase, type Beneficiario } from '../lib/supabase';
import { documentoValido, formatarDocumento, soDigitos } from '../lib/documento';

/** Campos do cadastro que podem vir da planilha */
const CAMPOS: { k: keyof Beneficiario; t: string; dicas: RegExp }[] = [
  { k: 'nome', t: 'Nome / razão social *', dicas: /^(nome|raz[aã]o|razao social|cliente|sacado|pagador|empresa|nome do cliente|nome completo)/i },
  { k: 'documento', t: 'CPF / CNPJ *', dicas: /(cpf|cnpj|documento|doc\b|inscri)/i },
  { k: 'nome_fantasia', t: 'Nome fantasia', dicas: /fantasia/i },
  { k: 'email', t: 'E-mail', dicas: /e-?mail/i },
  { k: 'telefone', t: 'Telefone', dicas: /(telefone|fone|celular|whats)/i },
  { k: 'cep', t: 'CEP', dicas: /^cep/i },
  { k: 'logradouro', t: 'Logradouro', dicas: /(logradouro|endere[cç]o|rua)/i },
  { k: 'numero', t: 'Número', dicas: /^(n[uú]mero|n[º°o]\.?|num)$/i },
  { k: 'complemento', t: 'Complemento', dicas: /complemento/i },
  { k: 'bairro', t: 'Bairro', dicas: /bairro/i },
  { k: 'cidade', t: 'Cidade', dicas: /(cidade|munic[ií]pio)/i },
  { k: 'uf', t: 'UF', dicas: /^(uf|estado)$/i },
  { k: 'pix_chave', t: 'Chave PIX', dicas: /pix/i },
  { k: 'observacao', t: 'Observação', dicas: /(observa|obs\b|nota)/i },
];

type Linha = Record<string, string>;
type Situacao = 'novo' | 'existe' | 'repetido' | 'invalido' | 'sem_nome';
const SIT: Record<Situacao, string> = { novo: 'Novo', existe: 'Já cadastrado', repetido: 'Repetido na planilha', invalido: 'CPF/CNPJ inválido ou ausente', sem_nome: 'Sem nome' };
const COR: Record<Situacao, string> = { novo: 'pago', existe: 'conf', repetido: 'prev', invalido: 'venc', sem_nome: 'venc' };

/** CPF/CNPJ vindo do Excel como número perde zeros à esquerda: tenta completar */
function normalizarDocumento(v: string) {
  const d = soDigitos(v);
  if (documentoValido(d)) return d;
  if (d.length < 11 && documentoValido(d.padStart(11, '0'))) return d.padStart(11, '0');
  if (d.length < 14 && documentoValido(d.padStart(14, '0'))) return d.padStart(14, '0');
  return d;
}
function tipoPix(chave: string) {
  const c = chave.trim(), d = soDigitos(c);
  if (c.includes('@')) return 'email';
  if ((d.length === 11 || d.length === 14) && documentoValido(d) && !/^\+/.test(c)) return 'cpf_cnpj';
  if (/^\+?\d[\d\s()-]{9,}$/.test(c)) return 'telefone';
  return 'aleatoria';
}

function lerCSV(texto: string): string[][] {
  const sep = (texto.split('\n')[0].match(/;/g) || []).length >= (texto.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const out: string[][] = []; let linha: string[] = [], campo = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) { if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c; continue; }
    if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; linha.push(campo); out.push(linha); linha = []; campo = ''; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); out.push(linha); }
  return out;
}

async function lerPlanilha(f: File): Promise<string[][]> {
  if (/\.csv$/i.test(f.name) || f.type === 'text/csv') {
    const buf = await f.arrayBuffer();
    let t = new TextDecoder('utf-8').decode(buf);
    if (t.includes('�')) t = new TextDecoder('windows-1252').decode(buf);
    return lerCSV(t.replace(/^﻿/, ''));
  }
  if (/\.xls$/i.test(f.name)) throw new Error('Arquivo .xls antigo: abra no Excel e salve como .xlsx ou .csv.');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await f.arrayBuffer());
  const ws = wb.worksheets.find(w => w.actualRowCount > 1) || wb.worksheets[0];
  if (!ws) throw new Error('A planilha está vazia.');
  const linhas: string[][] = [];
  ws.eachRow({ includeEmpty: false }, row => {
    const vals: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const cel = row.getCell(c), v = cel.value as unknown;
      let s = '';
      if (v == null) s = '';
      else if (typeof v === 'object' && v && 'text' in (v as object)) s = String((v as { text: unknown }).text);
      else if (typeof v === 'object' && v && 'result' in (v as object)) s = String((v as { result: unknown }).result ?? '');
      else if (typeof v === 'object' && v && 'richText' in (v as object)) s = ((v as { richText: { text: string }[] }).richText).map(x => x.text).join('');
      else if (v instanceof Date) s = v.toISOString().slice(0, 10);
      else s = String(v);
      vals.push(s.trim());
    }
    linhas.push(vals);
  });
  return linhas;
}

export function ImportarCadastro({ existentes, aoFechar, aoConcluir }: { existentes: Beneficiario[]; aoFechar: () => void; aoConcluir: (m: string) => void }) {
  const [arquivo, setArquivo] = useState('');
  const [cab, setCab] = useState<string[]>([]);
  const [dados, setDados] = useState<string[][]>([]);
  const [mapa, setMapa] = useState<Partial<Record<keyof Beneficiario, number>>>({});
  const [completar, setCompletar] = useState(true);
  const [filtro, setFiltro] = useState<Situacao | ''>('');
  const [erro, setErro] = useState('');
  const [proc, setProc] = useState(false);

  async function abrir(f: File) {
    setErro('');
    try {
      const todas = (await lerPlanilha(f)).filter(l => l.some(c => c.trim()));
      if (todas.length < 2) throw new Error('Não encontrei linhas de dados na planilha.');
      // Cabeçalho: a primeira linha (entre as 15 primeiras) que tenha nome e documento reconhecíveis
      let h = todas.slice(0, 15).findIndex(l => l.some(c => CAMPOS[0].dicas.test(c)) && l.some(c => CAMPOS[1].dicas.test(c)));
      if (h < 0) h = 0;
      const cabecalho = todas[h].map((c, i) => c || `Coluna ${i + 1}`);
      const m: Partial<Record<keyof Beneficiario, number>> = {};
      CAMPOS.forEach(({ k, dicas }) => { const i = cabecalho.findIndex((c, j) => dicas.test(c.trim()) && !(k === 'nome' && /fantasia/i.test(c)) && !Object.values(m).includes(j)); if (i >= 0) m[k] = i; });
      setArquivo(f.name); setCab(cabecalho); setDados(todas.slice(h + 1)); setMapa(m);
    } catch (e) { setErro((e as Error).message); }
  }

  const porDoc = useMemo(() => new Map(existentes.map(b => [b.documento, b])), [existentes]);
  const linhas = useMemo(() => {
    const vistos = new Set<string>();
    return dados.map((l, i) => {
      const v: Linha = {};
      CAMPOS.forEach(({ k }) => { const c = mapa[k]; if (c != null) v[k] = (l[c] || '').trim(); });
      const doc = normalizarDocumento(v.documento || '');
      let sit: Situacao = 'novo';
      if (!v.nome) sit = 'sem_nome';
      else if (!documentoValido(doc)) sit = 'invalido';
      else if (vistos.has(doc)) sit = 'repetido';
      else if (porDoc.has(doc)) sit = 'existe';
      if (documentoValido(doc)) vistos.add(doc);
      return { n: i + 1, v, doc, sit };
    }).filter(x => Object.values(x.v).some(Boolean));
  }, [dados, mapa, porDoc]);
  const cont = (s: Situacao) => linhas.filter(l => l.sit === s).length;

  const registro = (v: Linha, doc: string) => {
    const r: Record<string, unknown> = { nome: v.nome, documento: doc, ativo: true };
    for (const { k } of CAMPOS) if (k !== 'nome' && k !== 'documento' && v[k]) r[k] = v[k];
    if (r.cep) r.cep = soDigitos(String(r.cep)).padStart(8, '0').slice(0, 8);
    if (r.uf) r.uf = String(r.uf).toUpperCase().slice(0, 2);
    if (r.pix_chave) r.pix_tipo = tipoPix(String(r.pix_chave));
    return r;
  };

  async function importar() {
    setErro(''); setProc(true);
    let novos = 0, atualizados = 0;
    try {
      const ins = linhas.filter(l => l.sit === 'novo').map(l => registro(l.v, l.doc));
      for (let i = 0; i < ins.length; i += 200) {
        const r = await supabase.from('beneficiarios').insert(ins.slice(i, i + 200));
        if (r.error) throw new Error(r.error.message);
        novos += Math.min(200, ins.length - i);
      }
      if (completar) {
        for (const l of linhas.filter(x => x.sit === 'existe')) {
          const atual = porDoc.get(l.doc)!, novo = registro(l.v, l.doc), dif: Record<string, unknown> = {};
          for (const [k, val] of Object.entries(novo)) if (!['nome', 'documento', 'ativo'].includes(k) && val && !(atual as unknown as Record<string, unknown>)[k]) dif[k] = val;
          if (dif.pix_chave && atual.pix_chave) delete dif.pix_tipo;
          if (Object.keys(dif).length) { const r = await supabase.from('beneficiarios').update(dif).eq('id', atual.id); if (!r.error) atualizados++; }
        }
      }
      aoConcluir(`${novos} cadastro(s) incluído(s)${completar ? `, ${atualizados} já existente(s) completado(s)` : ''}.`);
    } catch (e) { setErro(`Importação interrompida após ${novos} inclusão(ões): ${(e as Error).message}`); }
    setProc(false);
  }

  const visiveis = linhas.filter(l => !filtro || l.sit === filtro);
  return (
    <div className="modal-bg open">
      <div className="modal" style={{ width: 'min(1180px, 96vw)' }}><h2>Importar fornecedores / clientes</h2>
        {!arquivo ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>Envie uma planilha Excel (.xlsx) ou CSV com uma linha por cadastro. Obrigatórios: nome e CPF/CNPJ. Também podem vir nome fantasia, e-mail, telefone, endereço, chave PIX e observação. Na próxima tela você confere as colunas e o resultado antes de gravar.</p>
            <label className="btn gold" style={{ display: 'inline-block', cursor: 'pointer' }}>Escolher planilha
              <input type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) abrir(f); e.target.value = ''; }} /></label>
            {erro && <div className="err mt">{erro}</div>}
            <div className="actions"><button className="btn ghost" onClick={aoFechar}>Cancelar</button></div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: -6 }}>{arquivo} · {linhas.length} linha(s). Confira a coluna de cada campo:</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 8, fontSize: 12 }}>
              {CAMPOS.map(({ k, t }) => (
                <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontWeight: 600, color: 'var(--navy)' }}>{t}
                  <select value={mapa[k] ?? ''} onChange={e => setMapa({ ...mapa, [k]: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ fontSize: 12, padding: '4px 6px' }}>
                    <option value="">·</option>{cab.map((c, i) => <option key={i} value={i}>{c}</option>)}</select></label>))}
            </div>
            <div className="filters" style={{ margin: '12px 0 6px' }}>
              <div className="tabs" style={{ margin: 0, border: 0 }}>
                {([['', `Todas (${linhas.length})`], ...(Object.keys(SIT) as Situacao[]).map(s => [s, `${SIT[s]} (${cont(s)})`])] as [Situacao | '', string][]).map(([k, t]) =>
                  <button key={k} className={filtro === k ? 'on' : ''} onClick={() => setFiltro(k)}>{t}</button>)}
              </div>
            </div>
            <div style={{ maxHeight: '42vh', overflow: 'auto' }}>
              <table className="compacta"><thead><tr><th>#</th><th>Nome</th><th>CPF / CNPJ</th><th>E-mail</th><th>Telefone</th><th>Cidade</th><th>Situação</th></tr></thead>
                <tbody>{visiveis.slice(0, 500).map(l => (
                  <tr key={l.n}><td style={{ color: 'var(--muted)' }}>{l.n}</td><td>{l.v.nome || '·'}</td><td>{l.doc ? formatarDocumento(l.doc) : '·'}</td><td>{l.v.email || '·'}</td><td>{l.v.telefone || '·'}</td><td>{l.v.cidade || '·'}</td>
                    <td><span className={'st ' + COR[l.sit]}>{SIT[l.sit]}</span>{l.sit === 'existe' && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{porDoc.get(l.doc)?.nome}</div>}</td></tr>))}</tbody></table>
              {visiveis.length > 500 && <p style={{ fontSize: 12, color: 'var(--muted)' }}>Mostrando 500 de {visiveis.length} linhas.</p>}
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 10 }}><input type="checkbox" checked={completar} onChange={e => setCompletar(e.target.checked)} />
              Nos já cadastrados, completar só os campos que estão vazios (nada do que já existe é alterado)</label>
            {erro && <div className="err mt">{erro}</div>}
            <div className="actions">
              <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => { setArquivo(''); setDados([]); }}>Trocar planilha</button>
              <button className="btn ghost" onClick={aoFechar}>Cancelar</button>
              <button className="btn" disabled={proc || mapa.nome == null || mapa.documento == null || !(cont('novo') || (completar && cont('existe')))} onClick={importar}>
                {proc ? 'Importando…' : `Importar ${cont('novo')} novo(s)${completar && cont('existe') ? ` e completar ${cont('existe')}` : ''}`}</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' }}>Linhas com CPF/CNPJ inválido ou ausente, sem nome ou repetidas não são importadas. CPF/CNPJ sem zeros à esquerda (comum quando o Excel trata como número) é completado automaticamente.</p>
          </>
        )}
      </div>
    </div>
  );
}
