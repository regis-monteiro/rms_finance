import { useState } from 'react';
import { useSignatarios, type Signatario } from './Signatarios';

/** Janela de emissão: escolhe o formato e, quando permitido, os signatários. */
export function ModalEmissao({ titulo, assinatura, extras, aoFechar, aoGerar }: {
  titulo: string; assinatura?: boolean; extras?: React.ReactNode; aoFechar: () => void;
  aoGerar: (formato: 'pdf' | 'xlsx', assinaturas: Signatario[]) => Promise<void>;
}) {
  const sigs = useSignatarios().filter(s => s.ativo);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [gerando, setGerando] = useState<'' | 'pdf' | 'xlsx'>('');
  const [erro, setErro] = useState('');
  async function gerar(f: 'pdf' | 'xlsx') {
    setErro(''); setGerando(f);
    try { await aoGerar(f, sigs.filter(s => sel.has(s.id))); aoFechar(); } catch (e) { setErro((e as Error).message); }
    setGerando('');
  }
  return (
    <div className="modal-bg open" onClick={e => e.target === e.currentTarget && aoFechar()}>
      <div className="modal"><h2>Emitir · {titulo}</h2>
        {extras}
        {assinatura && (
          <div style={{ margin: '6px 0 14px' }}>
            <div style={{ fontWeight: 600, color: 'var(--navy)', marginBottom: 6 }}>Assinatura</div>
            {sigs.length === 0 ? <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0 }}>Nenhum signatário cadastrado. Cadastre em Cadastros → Signatários.</p>
              : sigs.map(s => (
                <label key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '4px 0' }}>
                  <input type="checkbox" checked={sel.has(s.id)} onChange={e => { const n = new Set(sel); e.target.checked ? n.add(s.id) : n.delete(s.id); setSel(n); }} />
                  <b>{s.nome}</b> <span style={{ color: 'var(--muted)' }}>{s.cargo}{s.registro ? ' · ' + s.registro : ''}</span>
                </label>))}
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' }}>O PDF sai com o bloco de assinatura dos selecionados, pronto para assinar no gov.br ou com certificado ICP-Brasil.</p>
          </div>
        )}
        {erro && <div className="err">{erro}</div>}
        <div className="actions">
          <button className="btn ghost" onClick={aoFechar}>Cancelar</button>
          <button className="btn ghost" disabled={!!gerando} onClick={() => gerar('xlsx')}>{gerando === 'xlsx' ? 'Gerando…' : 'Excel'}</button>
          <button className="btn" disabled={!!gerando} onClick={() => gerar('pdf')}>{gerando === 'pdf' ? 'Gerando…' : 'PDF'}</button>
        </div>
      </div>
    </div>
  );
}
