import { useState } from 'react';
import type { Conta, Grupo, Subgrupo } from '../lib/supabase';
import { brl, dataBR } from '../lib/format';
import { reunirNoLote, temOQueReunir, type Candidato, type TarifaLote } from '../lib/lotes';

interface Props {
  pendentes: Candidato[];
  cad: { contas: Conta[]; grupos: Grupo[]; subgrupos: Subgrupo[] };
  /** Na baixa em lote de recebimentos o lote é sempre criado; recusar só evita juntar ao lote do dia */
  sempreCriar?: boolean;
  tarifa?: TarifaLote | null;
  aoConcluir: (msg: string) => void;
}

/** Pergunta se as baixas do dia (mesma conta e mesma classificação) devem ir para o lote do dia */
export default function ConfirmarLotes({ pendentes, cad, sempreCriar, tarifa, aoConcluir }: Props) {
  const reunir = pendentes.filter(temOQueReunir);
  const [marc, setMarc] = useState<Record<number, boolean>>(() => Object.fromEntries(reunir.map((_, i) => [i, true])));
  const [proc, setProc] = useState(false);
  const [erro, setErro] = useState('');
  const nome = (c: Candidato) => [cad.grupos.find(g => g.id === c.chave.grupo_id)?.nome, cad.subgrupos.find(s => s.id === c.chave.subgrupo_id)?.nome].filter(Boolean).join(' · ');
  const conta = (id: number) => cad.contas.find(c => c.id === id)?.nome || '';

  async function executar(aceitar: boolean) {
    setProc(true); setErro('');
    let n = 0;
    for (const c of pendentes) {
      const i = reunir.indexOf(c), junta = aceitar && i >= 0 && marc[i];
      let r: string | null = null;
      if (junta) { r = await reunirNoLote(c, true, tarifa); n++; }
      else if (sempreCriar) r = await reunirNoLote({ ...c, lote: null, avulsos: [] }, false, tarifa);
      if (r) { setErro(r); setProc(false); return; }
    }
    setProc(false);
    aoConcluir(n ? `${n} lote(s) do dia atualizado(s).` : '');
  }

  return (
    <div className="modal-bg open">
      <div className="modal" style={{ maxWidth: 640 }}>
        <h2>Incluir no lote do dia?</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>Já existem baixas no mesmo dia, na mesma conta e com a mesma classificação. Marque as que devem ser reunidas em um único lote.</p>
        {reunir.map((c, i) => {
          const tot = [...c.novos, ...c.avulsos].reduce((a, l) => a + Number(l.valor), 0) + (c.lote ? Number(c.lote.total) : 0);
          const qtd = c.novos.length + c.avulsos.length + (c.lote ? Number(c.lote.quantidade) : 0);
          return (
            <label key={i} className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, marginBottom: 8, cursor: 'pointer', fontWeight: 400 }}>
              <input type="checkbox" checked={!!marc[i]} onChange={e => setMarc({ ...marc, [i]: e.target.checked })} style={{ width: 'auto', marginTop: 3 }} />
              <div style={{ fontSize: 13 }}>
                <b>{c.chave.natureza === 'entrada' ? 'Recebimentos' : 'Pagamentos'} de {dataBR(c.chave.data)}</b> · {conta(c.chave.conta_id)} · {nome(c)}
                <div style={{ color: 'var(--muted)' }}>
                  {c.lote ? `Lote existente com ${c.lote.quantidade} item(ns) (${brl(c.lote.total)})` : 'Nenhum lote ainda'}
                  {c.avulsos.length > 0 && ` · ${c.avulsos.length} baixa(s) avulsa(s): ${c.avulsos.slice(0, 3).map(l => l.favorecido).join(', ')}${c.avulsos.length > 3 ? '…' : ''}`}
                  {` · ${c.novos.length} nova(s)`}
                </div>
                <div>Lote resultante: {qtd} item(ns), {brl(Math.round(tot * 100) / 100)}</div>
              </div>
            </label>
          );
        })}
        {erro && <div className="err mt">{erro}</div>}
        <div className="actions">
          <button className="btn ghost" disabled={proc} onClick={() => executar(false)}>{sempreCriar ? 'Criar lote separado' : 'Não agrupar'}</button>
          <button className="btn" disabled={proc} onClick={() => executar(true)}>{proc ? 'Processando…' : 'Incluir no lote'}</button>
        </div>
      </div>
    </div>
  );
}
