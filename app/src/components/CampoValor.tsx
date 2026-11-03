import { useEffect, useState } from 'react';

/**
 * Campo numérico sempre no padrão brasileiro (1.234,56), independente do idioma do navegador.
 * Mantém a assinatura de um <input type="number">: onChange/onBlur recebem { target: { value } }
 * com o número em texto no formato "1234.56" (ou "" quando vazio).
 */
type Ev = { target: { value: string } };
interface Props {
  value?: string | number | null; defaultValue?: string | number | null; required?: boolean; disabled?: boolean; placeholder?: string;
  style?: React.CSSProperties; casas?: number; min?: string | number; max?: string | number; step?: string;
  onChange?: (e: Ev) => void; onBlur?: (e: Ev) => void;
}
const formatar = (v: string | number | null | undefined, casas: number) => {
  if (v === '' || v == null || isNaN(Number(v))) return '';
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
};
/** "1.234,56" -> "1234.56" */
const paraNumero = (t: string) => {
  const limpo = t.replace(/[^\d,-]/g, '').replace(/(?!^)-/g, '');
  if (!limpo || limpo === '-') return '';
  const [int, dec] = limpo.split(',');
  return dec !== undefined ? `${int || '0'}.${dec}` : int;
};

export default function CampoValor({ value, defaultValue, required, disabled, placeholder, style, casas = 2, min, max, onChange, onBlur }: Props) {
  const controlado = value !== undefined;
  const [txt, setTxt] = useState(formatar(controlado ? value : defaultValue, casas));
  const [foco, setFoco] = useState(false);
  useEffect(() => { if (controlado && !foco) setTxt(formatar(value, casas)); }, [value, foco]);

  const fora = (n: string) => (n !== '' && ((min !== undefined && Number(n) < Number(min)) || (max !== undefined && Number(n) > Number(max))));
  return (
    <input value={txt} inputMode="decimal" required={required} disabled={disabled} placeholder={placeholder ?? (casas ? '0,00' : '0')}
      style={{ textAlign: 'right', ...style }}
      onFocus={() => setFoco(true)}
      onChange={e => {
        const t = e.target.value.replace(/[^\d,.-]/g, '').replace(/\./g, '');
        const partes = t.split(','); const ok = partes.length > 2 ? partes[0] + ',' + partes.slice(1).join('') : t;
        const [i, d] = ok.split(','); const final = d !== undefined ? `${i},${d.slice(0, casas)}` : i;
        setTxt(final); onChange?.({ target: { value: paraNumero(final) } });
      }}
      onBlur={e => {
        setFoco(false);
        const n = paraNumero(txt); setTxt(formatar(n, casas));
        (e.target as HTMLInputElement).setCustomValidity(fora(n) ? `Valor fora do limite${min !== undefined ? ' (mínimo ' + formatar(min, casas) + ')' : ''}${max !== undefined ? ' (máximo ' + formatar(max, casas) + ')' : ''}` : '');
        onBlur?.({ target: { value: n } });
      }} />
  );
}
