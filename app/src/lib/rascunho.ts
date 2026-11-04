import { useEffect, useState } from 'react';

/**
 * Estado que sobrevive à troca de tela: fica guardado no navegador até ser salvo ou cancelado.
 * Valor null/undefined apaga o rascunho.
 */
const PREF = 'rms-rascunho:';

export function usePersistente<T>(chave: string, inicial: T | (() => T)) {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(PREF + chave);
      if (s != null) return JSON.parse(s) as T;
    } catch { /* navegador sem armazenamento: segue sem rascunho */ }
    return typeof inicial === 'function' ? (inicial as () => T)() : inicial;
  });
  useEffect(() => {
    try {
      if (v === null || v === undefined) localStorage.removeItem(PREF + chave);
      else localStorage.setItem(PREF + chave, JSON.stringify(v));
    } catch { /* ignora */ }
  }, [chave, v]);
  return [v, setV] as const;
}

/** Apaga os rascunhos cujo nome começa com o prefixo (vazio = todos) */
export function limparRascunhos(prefixo = '') {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(PREF + prefixo)).forEach(k => localStorage.removeItem(k));
  } catch { /* ignora */ }
}

/** Leitura e gravação direta (para rascunhos com chave variável, como o mês) */
export function lerRascunho<T>(chave: string): T | null {
  try { const s = localStorage.getItem(PREF + chave); return s == null ? null : (JSON.parse(s) as T); } catch { return null; }
}
export function gravarRascunho(chave: string, v: unknown) {
  try {
    if (v == null || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)) localStorage.removeItem(PREF + chave);
    else localStorage.setItem(PREF + chave, JSON.stringify(v));
  } catch { /* ignora */ }
}
