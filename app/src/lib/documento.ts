export const soDigitos = (v: string) => (v || '').replace(/\D/g, '');

export function formatarDocumento(v: string) {
  const d = soDigitos(v).slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})\.(\d{3})\.(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

export function documentoValido(v: string) {
  const d = soDigitos(v);
  if (/^(\d)\1+$/.test(d)) return false;
  if (d.length === 11) {
    for (const k of [0, 1]) {
      let s = 0;
      for (let i = 0; i < 9 + k; i++) s += Number(d[i]) * (10 + k - i);
      let r = (s * 10) % 11; if (r === 10) r = 0;
      if (r !== Number(d[9 + k])) return false;
    }
    return true;
  }
  if (d.length === 14) {
    const calc = (n: number) => {
      const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const s = pesos.reduce((a, p, i) => a + Number(d[i]) * p, 0) % 11;
      return s < 2 ? 0 : 11 - s;
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  return false;
}

export const tipoPessoa = (v: string) => (soDigitos(v).length === 14 ? 'PJ' : 'PF');
export const formatarCep = (v: string) => soDigitos(v).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');

/** Rótulo padrão de um cadastro nas listas de escolha: "Nome · 00.000.000/0000-00" */
export const rotuloCadastro = (b?: { nome: string; documento: string }) => (b ? `${b.nome} · ${formatarDocumento(b.documento)}` : '');

/**
 * Acha o cadastro digitado ou escolhido: pelo rótulo, pelo nome (sem diferenciar maiúsculas)
 * ou pelo CPF/CNPJ digitado com ou sem pontos, barras e traços.
 */
export function acharCadastro<T extends { nome: string; documento: string }>(lista: T[], texto: string | null | undefined): T | undefined {
  const t = (texto || '').trim(); if (!t) return undefined;
  const porRotulo = lista.find(b => rotuloCadastro(b) === t); if (porRotulo) return porRotulo;
  const porNome = lista.find(b => b.nome.toLowerCase() === t.toLowerCase()); if (porNome) return porNome;
  const d = soDigitos(t.includes('·') ? t.split('·').pop()! : t);
  if (d.length === 11 || d.length === 14) return lista.find(b => soDigitos(b.documento) === d);
  return undefined;
}

/** Busca que ignora maiúsculas, acentos e, para CPF/CNPJ, pontos, barras e traços */
export function casaBusca(busca: string, textos: (string | null | undefined)[], documento?: string | null) {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm((busca || '').trim()); if (!q) return true;
  if (norm(textos.filter(Boolean).join(' ')).includes(q)) return true;
  const d = soDigitos(busca);
  return d.length >= 3 && !!documento && soDigitos(documento).includes(d) && /^[\d\s./-]+$/.test(busca.trim());
}
