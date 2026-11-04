import { Fragment, useEffect, useMemo, useState } from 'react';
import DataBR from './DataBR';
import { supabase, type CentroCusto, type Grupo, type Subgrupo } from '../lib/supabase';
import { OpcoesCentro, nomeCentro } from '../lib/useCadastros';
import { usePersistente, limparRascunhos } from '../lib/rascunho';
import { invalidarDicionario } from '../lib/sugestao';

interface LinhaDRE { id: number; nome: string; ordem: number }
const NATUREZA = { receita: 'Receita', despesa: 'Despesa', movimentacao: 'Movimentação' } as Record<string, string>;
/** Nomes usados por rotinas automáticas do app: não podem ser renomeados */
const SISTEMA_G = ['Rendimentos', 'Impostos', 'Transferências', 'Pagamento de fatura', 'Despesas financeiras', 'Receitas financeiras', 'Honorários'];
const SISTEMA_S = ['IRRF', 'Multa/juros por atraso'];

interface Recl { deGrupo: string; deSub: string; paraGrupo: string; paraSub: string; inicio: string; fim: string; texto: string; centro: string; inativar: boolean }

export default function PlanoContas({ aoMudar, avisar }: { aoMudar: () => void; avisar: (m: string) => void }) {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [subs, setSubs] = useState<Subgrupo[]>([]);
  const [linhas, setLinhas] = useState<LinhaDRE[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  const [uso, setUso] = useState<Map<string, number>>(new Map());
  const [versao, setVersao] = useState(0);
  const [abertos, setAbertos] = usePersistente<number[]>('plano:abertos', []);
  const [busca, setBusca] = useState('');
  const [inativos, setInativos] = useState(false);
  const [novoG, setNovoG] = usePersistente<{ nome: string; natureza: string; linha: string; centro: string } | null>('plano:novo-grupo', null);
  const [novoS, setNovoS] = usePersistente<{ grupo: string; nome: string; centro: string } | null>('plano:novo-sub', null);
  const [recl, setRecl] = usePersistente<Recl | null>('plano:recl', null);
  const [simul, setSimul] = useState<{ lancamentos: number; compras: number; beneficiarios: number } | null>(null);
  const [erro, setErro] = useState('');
  const [proc, setProc] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('grupos').select('*').order('nome'), supabase.from('subgrupos').select('*').order('nome'),
      supabase.from('linhas_dre').select('*').order('ordem'), supabase.from('centros_custo').select('*').order('ordem'), supabase.rpc('uso_plano'),
    ]).then(([g, s, l, c, u]) => {
      setGrupos((g.data as Grupo[]) || []); setSubs((s.data as Subgrupo[]) || []); setLinhas((l.data as LinhaDRE[]) || []); setCentros((c.data as CentroCusto[]) || []);
      const m = new Map<string, number>();
      ((u.data as { grupo_id: number; subgrupo_id: number | null; n: number }[]) || []).forEach(x => {
        m.set(`g${x.grupo_id}`, (m.get(`g${x.grupo_id}`) || 0) + Number(x.n)); if (x.subgrupo_id) m.set(`s${x.subgrupo_id}`, Number(x.n));
      });
      setUso(m);
    });
  }, [versao]);

  async function gravar(tabela: 'grupos' | 'subgrupos', id: number, dados: Record<string, unknown>) {
    const { error } = await supabase.from(tabela).update(dados).eq('id', id);
    if (error) { avisar('Erro: ' + (error.code === '23505' ? 'já existe um item com esse nome.' : error.message)); return; }
    avisar('Alteração salva'); setVersao(v => v + 1); aoMudar(); invalidarDicionario();
  }

  async function criarGrupo(e: React.FormEvent) {
    e.preventDefault(); if (!novoG) return;
    const { error } = await supabase.from('grupos').insert({ nome: novoG.nome.trim(), natureza: novoG.natureza, linha_dre_id: novoG.linha ? Number(novoG.linha) : null, centro_custo_id: novoG.centro ? Number(novoG.centro) : null });
    if (error) { setErro(error.code === '23505' ? 'Já existe um grupo com esse nome.' : error.message); return; }
    setNovoG(null); setErro(''); avisar('Grupo incluído'); setVersao(v => v + 1); aoMudar();
  }
  async function criarSub(e: React.FormEvent) {
    e.preventDefault(); if (!novoS) return;
    const { error } = await supabase.from('subgrupos').insert({ grupo_id: Number(novoS.grupo), nome: novoS.nome.trim(), centro_custo_id: novoS.centro ? Number(novoS.centro) : null });
    if (error) { setErro(error.code === '23505' ? 'Já existe esse subgrupo no grupo.' : error.message); return; }
    setNovoS(null); setErro(''); avisar('Subgrupo incluído'); setVersao(v => v + 1); aoMudar();
  }

  const args = (r: Recl, aplicar: boolean) => ({
    p_de_grupo: Number(r.deGrupo), p_de_sub: r.deSub === '' ? null : Number(r.deSub), p_para_grupo: Number(r.paraGrupo), p_para_sub: r.paraSub ? Number(r.paraSub) : null,
    p_inicio: r.inicio || null, p_fim: r.fim || null, p_texto: r.texto || null, p_centro: r.centro === '' ? null : Number(r.centro), p_aplicar: aplicar,
  });
  async function simular() {
    if (!recl) return; setErro(''); setSimul(null);
    const { data, error } = await supabase.rpc('reclassificar', args(recl, false));
    if (error) { setErro(error.message); return; }
    setSimul((data as typeof simul[])[0]);
  }
  async function aplicar() {
    if (!recl) return; setErro(''); setProc(true);
    const { data, error } = await supabase.rpc('reclassificar', args(recl, true));
    if (!error && recl.inativar && Number(recl.deSub) > 0) await supabase.from('subgrupos').update({ ativo: false }).eq('id', Number(recl.deSub));
    setProc(false);
    if (error) { setErro(error.message); return; }
    const r = (data as { lancamentos: number; compras: number; beneficiarios: number }[])[0];
    avisar(`Reclassificados: ${r.lancamentos} lançamento(s), ${r.compras} compra(s) de cartão${r.beneficiarios ? `, ${r.beneficiarios} beneficiário(s)` : ''}`);
    setRecl(null); setSimul(null); limparRascunhos('plano:recl'); setVersao(v => v + 1); aoMudar(); invalidarDicionario();
  }
  const abrirRecl = (g: number, s?: number) => { setErro(''); setSimul(null); setRecl({ deGrupo: String(g), deSub: s ? String(s) : '', paraGrupo: String(g), paraSub: '', inicio: '', fim: '', texto: '', centro: '', inativar: !!s }); };

  const q = busca.trim().toLowerCase();
  const lista = useMemo(() => grupos.filter(g => (inativos || g.ativo) && (!q || g.nome.toLowerCase().includes(q) || subs.some(s => s.grupo_id === g.id && s.nome.toLowerCase().includes(q)))), [grupos, subs, inativos, q]);
  const aberto = (id: number) => abertos.includes(id) || (!!q && subs.some(s => s.grupo_id === id && s.nome.toLowerCase().includes(q)));
  const alternar = (id: number) => setAbertos(abertos.includes(id) ? abertos.filter(x => x !== id) : [...abertos, id]);
  const selCentro = (valor: number | null | undefined, padrao: string, aoMudar: (v: number | null) => void) => (
    <select value={valor ?? ''} onChange={e => aoMudar(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 160 }}><option value="">{padrao}</option><OpcoesCentro centros={centros.filter(c => c.ativo)} /></select>
  );
  const subsDe = (g: string, todos = false) => subs.filter(s => s.grupo_id === Number(g) && (todos || s.ativo !== false));

  return (
    <>
      <div className="filters">
        <input placeholder="Buscar grupo ou subgrupo" value={busca} onChange={e => setBusca(e.target.value)} style={{ minWidth: 240 }} />
        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={inativos} onChange={e => setInativos(e.target.checked)} /> Mostrar inativos</label>
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => { setErro(''); setNovoG({ nome: '', natureza: 'despesa', linha: '', centro: '' }); }}>+ Grupo</button>
        <button className="btn ghost" onClick={() => { setErro(''); setNovoS({ grupo: '', nome: '', centro: '' }); }}>+ Subgrupo</button>
        <button className="btn gold" onClick={() => abrirRecl(grupos[0]?.id)}>Reclassificar lançamentos</button>
      </div>
      <table className="compacta">
        <thead><tr><th>Grupo / subgrupo</th><th>Natureza</th><th>Linha do DRE</th><th>Centro de custo padrão</th><th className="c">Restrito</th><th className="c">Ativo</th><th className="r">Lanç.</th><th /></tr></thead>
        <tbody>{lista.map(g => {
          const sg = subs.filter(s => s.grupo_id === g.id && (inativos || s.ativo !== false));
          const fixo = SISTEMA_G.includes(g.nome);
          return (
            <Fragment key={g.id}>
              <tr style={{ background: '#FBF9F3', opacity: g.ativo ? 1 : 0.55 }}>
                <td style={{ whiteSpace: 'nowrap' }}><span style={{ cursor: 'pointer', display: 'inline-block', width: 16 }} onClick={() => alternar(g.id)}>{sg.length ? (aberto(g.id) ? '▾' : '▸') : ''}</span>
                  <input key={g.nome} defaultValue={g.nome} disabled={fixo} title={fixo ? 'Usado por rotinas automáticas do app; não pode ser renomeado' : ''} style={{ fontWeight: 700, width: 160 }}
                    onBlur={e => e.target.value.trim() && e.target.value.trim() !== g.nome && gravar('grupos', g.id, { nome: e.target.value.trim() })} />
                  <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>{sg.length}</span></td>
                <td><select value={g.natureza} disabled={fixo} onChange={e => gravar('grupos', g.id, { natureza: e.target.value })}>{Object.entries(NATUREZA).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>
                <td><select value={g.linha_dre_id ?? ''} onChange={e => gravar('grupos', g.id, { linha_dre_id: e.target.value ? Number(e.target.value) : null })}><option value="">·</option>{linhas.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}</select></td>
                <td>{selCentro(g.centro_custo_id, 'Geral (sem centro)', v => gravar('grupos', g.id, { centro_custo_id: v }))}</td>
                <td className="c"><input type="checkbox" checked={g.restrito} onChange={e => gravar('grupos', g.id, { restrito: e.target.checked })} /></td>
                <td className="c"><input type="checkbox" checked={g.ativo} disabled={fixo} onChange={e => gravar('grupos', g.id, { ativo: e.target.checked })} /></td>
                <td className="r">{(uso.get(`g${g.id}`) || 0).toLocaleString('pt-BR')}</td>
                <td><button className="btn ghost mini" onClick={() => abrirRecl(g.id)}>Reclassificar</button></td>
              </tr>
              {aberto(g.id) && sg.map(s => {
                const fixoS = SISTEMA_S.includes(s.nome);
                return (
                  <tr key={s.id} style={{ opacity: s.ativo === false ? 0.55 : 1, background: q && s.nome.toLowerCase().includes(q) ? '#FFF8E6' : undefined }}>
                    <td style={{ paddingLeft: 30 }}><input key={s.nome} defaultValue={s.nome} disabled={fixoS} style={{ width: 146 }}
                      onBlur={e => e.target.value.trim() && e.target.value.trim() !== s.nome && gravar('subgrupos', s.id, { nome: e.target.value.trim() })} /></td>
                    <td><select value={s.grupo_id} disabled={fixoS} title="Mover para outro grupo: os lançamentos deste subgrupo acompanham" onChange={e => gravar('subgrupos', s.id, { grupo_id: Number(e.target.value) })}>
                      {grupos.filter(x => x.ativo || x.id === s.grupo_id).map(x => <option key={x.id} value={x.id}>{x.id === s.grupo_id ? 'Neste grupo' : '→ ' + x.nome}</option>)}</select></td>
                    <td><select value={s.linha_dre_id ?? ''} onChange={e => gravar('subgrupos', s.id, { linha_dre_id: e.target.value ? Number(e.target.value) : null })}><option value="">Do grupo</option>{linhas.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}</select></td>
                    <td>{selCentro(s.centro_custo_id, 'Do grupo' + (g.centro_custo_id ? ` (${nomeCentro(centros, g.centro_custo_id)})` : ''), v => gravar('subgrupos', s.id, { centro_custo_id: v }))}</td>
                    <td />
                    <td className="c"><input type="checkbox" checked={s.ativo !== false} disabled={fixoS} onChange={e => gravar('subgrupos', s.id, { ativo: e.target.checked })} /></td>
                    <td className="r">{(uso.get(`s${s.id}`) || 0).toLocaleString('pt-BR')}</td>
                    <td><button className="btn ghost mini" onClick={() => abrirRecl(g.id, s.id)} title="Reclassificar ou mesclar com outro subgrupo">Reclassificar</button></td>
                  </tr>);
              })}
            </Fragment>);
        })}</tbody>
      </table>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>
        Alterações de nome, linha do DRE e centro de custo valem para todo o histórico. O centro do subgrupo prevalece sobre o do grupo, e o informado no lançamento prevalece sobre ambos; sem centro, o valor entra no Geral.
        Mover um subgrupo leva junto os lançamentos dele. Para juntar subgrupos repetidos, use "Reclassificar / mesclar". Grupos restritos não aparecem em detalhe para o perfil Financeiro.
      </p>
      <div className="mt" style={{ fontSize: 12.5 }}><b>Centros de custo:</b> {centros.filter(c => !c.pai_id).map(c => `${c.nome}${centros.some(f => f.pai_id === c.id) ? ` (${centros.filter(f => f.pai_id === c.id).map(f => f.nome).join(', ')})` : ''}`).join(' · ')}</div>

      {novoG && (
        <div className="modal-bg open">
          <div className="modal"><h2>Novo grupo</h2>
            <form className="form" onSubmit={criarGrupo}>
              <label>Nome<input required value={novoG.nome} onChange={e => setNovoG({ ...novoG, nome: e.target.value })} /></label>
              <label>Natureza<select value={novoG.natureza} onChange={e => setNovoG({ ...novoG, natureza: e.target.value })}>{Object.entries(NATUREZA).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
              <label>Linha do DRE<select required value={novoG.linha} onChange={e => setNovoG({ ...novoG, linha: e.target.value })}><option value="" disabled>Selecione</option>{linhas.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}</select></label>
              <label>Centro de custo padrão<select value={novoG.centro} onChange={e => setNovoG({ ...novoG, centro: e.target.value })}><option value="">Geral (sem centro)</option><OpcoesCentro centros={centros.filter(c => c.ativo)} /></select></label>
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setNovoG(null)}>Cancelar</button><button className="btn">Incluir</button></div>
            </form>
          </div>
        </div>
      )}
      {novoS && (
        <div className="modal-bg open">
          <div className="modal"><h2>Novo subgrupo</h2>
            <form className="form" onSubmit={criarSub}>
              <label>Grupo<select required value={novoS.grupo} onChange={e => setNovoS({ ...novoS, grupo: e.target.value })}><option value="" disabled>Selecione</option>{grupos.filter(g => g.ativo).map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select></label>
              <label>Nome<input required value={novoS.nome} onChange={e => setNovoS({ ...novoS, nome: e.target.value })} /></label>
              <label className="full">Centro de custo padrão<select value={novoS.centro} onChange={e => setNovoS({ ...novoS, centro: e.target.value })}><option value="">Do grupo</option><OpcoesCentro centros={centros.filter(c => c.ativo)} /></select></label>
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setNovoS(null)}>Cancelar</button><button className="btn">Incluir</button></div>
            </form>
          </div>
        </div>
      )}
      {recl && (
        <div className="modal-bg open">
          <div className="modal" style={{ width: 'min(820px, 96vw)' }}><h2>Reclassificar lançamentos anteriores</h2>
            <form className="form form4" onSubmit={e => { e.preventDefault(); simul ? aplicar() : simular(); }}>
              <p className="full proto" style={{ margin: 0 }}>Altera a classificação dos lançamentos e das compras de cartão já registrados. Simule primeiro para ver quantos itens serão alterados.</p>
              <label className="span2">De: grupo<select required value={recl.deGrupo} onChange={e => { setSimul(null); setRecl({ ...recl, deGrupo: e.target.value, deSub: '' }); }}>{grupos.map(g => <option key={g.id} value={g.id}>{g.nome}{g.ativo ? '' : ' (inativo)'}</option>)}</select></label>
              <label className="span2">De: subgrupo<select value={recl.deSub} onChange={e => { setSimul(null); setRecl({ ...recl, deSub: e.target.value, inativar: Number(e.target.value) > 0 }); }}>
                <option value="">Todos os subgrupos</option><option value="0">Sem subgrupo</option>{subsDe(recl.deGrupo, true).map(s => <option key={s.id} value={s.id}>{s.nome} ({uso.get(`s${s.id}`) || 0}){s.ativo === false ? ' · inativo' : ''}</option>)}</select></label>
              <label className="span2">Para: grupo<select required value={recl.paraGrupo} onChange={e => { setSimul(null); setRecl({ ...recl, paraGrupo: e.target.value, paraSub: '' }); }}>{grupos.filter(g => g.ativo).map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select></label>
              <label className="span2">Para: subgrupo<select value={recl.paraSub} onChange={e => { setSimul(null); setRecl({ ...recl, paraSub: e.target.value }); }}>
                <option value="">Sem subgrupo</option>{subsDe(recl.paraGrupo).filter(s => String(s.id) !== recl.deSub).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
              <label>A partir de (opcional)<DataBR value={recl.inicio} onChange={e => { setSimul(null); setRecl({ ...recl, inicio: e.target.value }); }} /></label>
              <label>Até (opcional)<DataBR value={recl.fim} onChange={e => { setSimul(null); setRecl({ ...recl, fim: e.target.value }); }} /></label>
              <label className="span2">Só com o texto (opcional)<input placeholder="Parte do favorecido, referência ou estabelecimento" value={recl.texto} onChange={e => { setSimul(null); setRecl({ ...recl, texto: e.target.value }); }} /></label>
              <label className="span2">Centro de custo<select value={recl.centro} onChange={e => { setSimul(null); setRecl({ ...recl, centro: e.target.value }); }}>
                <option value="">Não alterar</option><option value="0">Usar o padrão do plano</option><OpcoesCentro centros={centros.filter(c => c.ativo)} /></select></label>
              {Number(recl.deSub) > 0 && !recl.inicio && !recl.fim && !recl.texto && <label className="span2" style={{ flexDirection: 'row', gap: 8, alignItems: 'center', fontWeight: 400 }}>
                <input type="checkbox" checked={recl.inativar} onChange={e => setRecl({ ...recl, inativar: e.target.checked })} style={{ width: 'auto' }} /> Inativar o subgrupo de origem depois (mesclar)</label>}
              {simul && <div className="full ok">Serão alterados {simul.lancamentos} lançamento(s) e {simul.compras} compra(s) de cartão{simul.beneficiarios ? `; ${simul.beneficiarios} beneficiário(s) terão a classificação padrão atualizada` : ''}. Transferências e pagamentos de fatura não são alterados.</div>}
              {erro && <div className="err full">{erro}</div>}
              <div className="actions full"><button type="button" className="btn ghost" onClick={() => setRecl(null)}>Cancelar</button>
                {simul ? <button className="btn" disabled={proc || !(simul.lancamentos + simul.compras + simul.beneficiarios)}>{proc ? 'Reclassificando…' : 'Confirmar reclassificação'}</button> : <button className="btn">Simular</button>}</div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
