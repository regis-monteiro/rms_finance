import { useEffect, useRef, useState } from 'react';

/**
 * Campo de data sempre no formato dd/mm/aaaa, independente do idioma do navegador.
 * Recebe e devolve a data em AAAA-MM-DD, com a mesma assinatura de um <input type="date">
 * (onChange/onBlur recebem { target: { value } }).
 */
type Ev = { target: { value: string } };
interface Props {
  value?: string; defaultValue?: string; required?: boolean; disabled?: boolean; style?: React.CSSProperties;
  onChange?: (e: Ev) => void; onBlur?: (e: Ev) => void;
}
const paraBR = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const mascara = (t: string) => { const d = t.replace(/\D/g, '').slice(0, 8); return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };
const paraISO = (br: string) => {
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!m) return null;
  const [, d, mm, a] = m.map(Number) as unknown as number[];
  const dt = new Date(a, mm - 1, d);
  return dt.getFullYear() === a && dt.getMonth() === mm - 1 && dt.getDate() === d ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

export default function DataBR({ value, defaultValue, required, disabled, style, onChange, onBlur }: Props) {
  const controlado = value !== undefined;
  const [txt, setTxt] = useState(paraBR(controlado ? value : defaultValue));
  const [invalida, setInvalida] = useState(false);
  const nativo = useRef<HTMLInputElement>(null);
  useEffect(() => { if (controlado) setTxt(paraBR(value)); }, [value]);

  const mudar = (t: string) => {
    const m = mascara(t); setTxt(m);
    const iso = paraISO(m);
    setInvalida(m.length === 10 && !iso);
    if (iso) onChange?.({ target: { value: iso } });
    else if (!m) onChange?.({ target: { value: '' } });
  };
  return (
    <span style={{ display: 'flex', gap: 4, ...style }}>
      <input value={txt} placeholder="dd/mm/aaaa" inputMode="numeric" required={required} disabled={disabled} maxLength={10}
        pattern="\d{2}/\d{2}/\d{4}" title="Data no formato dd/mm/aaaa"
        style={{ flex: 1, minWidth: 0, borderColor: invalida ? 'var(--neg)' : undefined }}
        onChange={e => mudar(e.target.value)}
        onBlur={() => { const iso = paraISO(txt); if (onBlur) onBlur({ target: { value: iso || '' } }); }} />
      <button type="button" className="btn ghost" disabled={disabled} title="Abrir calendário" style={{ padding: '0 8px' }}
        onClick={() => { const n = nativo.current; if (!n) return; n.value = paraISO(txt) || ''; try { n.showPicker(); } catch { n.focus(); } }}>📅</button>
      <input ref={nativo} type="date" tabIndex={-1} aria-hidden style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
        onChange={e => { const iso = e.target.value; if (!iso) return; setTxt(paraBR(iso)); setInvalida(false); onChange?.({ target: { value: iso } }); onBlur?.({ target: { value: iso } }); }} />
    </span>
  );
}
