import { useEffect, useMemo, useState } from 'react';
import { carregarDicionario, divergente, sugerir, type Opcao } from '../lib/sugestao';
import type { Grupo, Subgrupo } from '../lib/supabase';
import { dataBR } from '../lib/format';

interface Props {
  tipo: string; beneficiario_id: number | null | undefined; texto: string | undefined;
  grupo_id: number | null | undefined; subgrupo_id: number | null | undefined;
  grupos: Grupo[]; subgrupos: Subgrupo[]; aoUsar: (o: Opcao) => void;
}

/** Compara com lançamentos anteriores parecidos: sugere a classificação e avisa divergências */
export default function SugestaoClassificacao({ tipo, beneficiario_id, texto, grupo_id, subgrupo_id, grupos, subgrupos, aoUsar }: Props) {
  const [dic, setDic] = useState<Awaited<ReturnType<typeof carregarDicionario>>>([]);
  const [termo, setTermo] = useState(texto || '');
  useEffect(() => { carregarDicionario().then(setDic); }, []);
  useEffect(() => { const t = setTimeout(() => setTermo(texto || ''), 350); return () => clearTimeout(t); }, [texto]);

  const s = useMemo(() => (dic.length && (beneficiario_id || termo.trim().length >= 3) ? sugerir(dic, { tipo, beneficiario_id, texto: termo }) : null), [dic, tipo, beneficiario_id, termo]);
  if (!s || !s.opcoes.length) return null;

  const nome = (o: Opcao) => [grupos.find(g => g.id === o.grupo_id)?.nome || '?', subgrupos.find(x => x.id === o.subgrupo_id)?.nome].filter(Boolean).join(' · ');
  const melhor = s.opcoes[0];
  const escolhida = grupo_id ? s.opcoes.find(o => o.grupo_id === Number(grupo_id) && (o.subgrupo_id ?? null) === (subgrupo_id ? Number(subgrupo_id) : null)) : undefined;
  const igualMelhor = escolhida === melhor;
  const div = divergente(s);
  const fora = !!grupo_id && !escolhida;
  const cor = fora || (div && !igualMelhor) ? '#8A6A12' : 'var(--muted)';

  return (
    <div className="full sugestao" style={{ borderColor: fora || div ? '#E6C77A' : undefined }}>
      {!grupo_id || !igualMelhor ? (
        <div>
          <b>Sugestão:</b> {nome(melhor)} <span style={{ color: 'var(--muted)' }}>({melhor.n} lançamento{melhor.n > 1 ? 's' : ''} parecido{melhor.n > 1 ? 's' : ''}, último em {dataBR(melhor.ultima)})</span>{' '}
          <button type="button" className="btn ghost mini" onClick={() => aoUsar(melhor)}>Usar</button>
        </div>
      ) : <div style={{ color: 'var(--pos)' }}>✓ Classificação igual à dos lançamentos parecidos ({melhor.n}).</div>}
      {fora && <div style={{ color: cor }}>Atenção: nenhum lançamento parecido foi classificado em {[grupos.find(g => g.id === Number(grupo_id))?.nome, subgrupos.find(x => x.id === Number(subgrupo_id))?.nome].filter(Boolean).join(' · ')}.</div>}
      {div && (
        <div style={{ color: cor }}>
          {fora || !igualMelhor ? 'Lançamentos parecidos têm classificações diferentes:' : 'Atenção: há lançamentos parecidos com outras classificações:'}{' '}
          {s.opcoes.slice(0, 4).map((o, i) => (
            <span key={i}>{i > 0 && ' · '}<a href="#" onClick={e => { e.preventDefault(); aoUsar(o); }}>{nome(o)}</a> ({o.n})</span>
          ))}
        </div>
      )}
    </div>
  );
}
