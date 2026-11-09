import { soDigitos } from './documento';

export interface Telefone { numero: string; descricao: string; principal: boolean }

/** (11) 98765-4321 para celular (11 dígitos) ou (11) 3456-7890 para fixo (10 dígitos), formatando enquanto digita */
export function formatarTelefone(v: string) {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  const ddd = d.slice(0, 2), r = d.slice(2);
  if (d.length <= 6) return `(${ddd}) ${r}`;
  if (d.length <= 10) return `(${ddd}) ${r.slice(0, 4)}-${r.slice(4)}`;
  return `(${ddd}) ${r.slice(0, 5)}-${r.slice(5)}`;
}
export const telefoneValido = (v: string) => [10, 11].includes(soDigitos(v).length);

/** Lista de telefones do cadastro, com um principal; aceita o campo antigo (texto único) */
export function lerTelefones(lista: Telefone[] | null | undefined, antigo?: string | null): Telefone[] {
  const l = (lista || []).filter(t => soDigitos(t.numero));
  if (l.length) return l.some(t => t.principal) ? l : l.map((t, i) => ({ ...t, principal: i === 0 }));
  return antigo && soDigitos(antigo) ? [{ numero: soDigitos(antigo), descricao: '', principal: true }] : [];
}
export const telefonePrincipal = (l: Telefone[]) => { const p = l.find(t => t.principal) || l[0]; return p ? formatarTelefone(p.numero) : null; };
