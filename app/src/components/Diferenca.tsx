import { brl } from '../lib/format';
import { interpretarBaixa } from '../lib/descontos';

/** Mostra o que a diferença entre o em aberto e o valor efetivo representa: desconto, multa/juros ou pagamento parcial */
export default function Diferenca({ aberto, efetivo, parcial, entrada, aoParcial, semDesconto }: { aberto: number; efetivo: number; parcial: boolean; entrada?: boolean; aoParcial?: (p: boolean) => void; semDesconto?: boolean }) {
  const x = interpretarBaixa(aberto, efetivo, parcial || !!semDesconto);
  if ('erro' in x) return <span style={{ fontSize: 12, color: 'var(--neg)' }}>{x.erro}</span>;
  const menor = Math.round(efetivo * 100) < Math.round(aberto * 100);
  return (
    <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', fontSize: 12.5, whiteSpace: 'nowrap' }}>
      {x.juros > 0 && <span className="neg" style={{ color: entrada ? 'var(--pos)' : 'var(--neg)' }}>+ {brl(x.juros)} multa/juros</span>}
      {x.desconto > 0 && <span style={{ color: entrada ? 'var(--neg)' : 'var(--pos)' }}>− {brl(x.desconto)} desconto</span>}
      {x.parcial && <span style={{ color: 'var(--muted)' }}>parcial: saldo de {brl(aberto - efetivo)} continua em aberto</span>}
      {!menor && !x.juros && <span style={{ color: 'var(--muted)' }}>·</span>}
      {menor && aoParcial && !semDesconto && <label style={{ flexDirection: 'row', alignItems: 'center', gap: 4, fontWeight: 400, margin: 0 }} title="Mantém a diferença em aberto em vez de dar desconto">
        <input type="checkbox" checked={parcial} onChange={e => aoParcial(e.target.checked)} style={{ width: 'auto' }} /> parcial</label>}
    </span>
  );
}
