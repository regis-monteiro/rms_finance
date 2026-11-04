import type { Status } from './supabase';

export const brl = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dataBR = (iso: string | null) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '·');
/** Data no padrão dd/mm/aaaa (mantido o nome por compatibilidade) */
export const diaMes = (iso: string) => dataBR(iso);
export const hojeISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const somaDias = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export const STATUS_LABEL: Record<Status | 'vencido', string> = {
  previsto: 'Previsto', confirmado: 'Confirmado', agendado: 'Agendado', pago: 'Pago', vencido: 'Vencido',
};
const CLS: Record<Status | 'vencido', string> = { previsto: 'prev', confirmado: 'conf', agendado: 'agen', pago: 'pago', vencido: 'venc' };

export const statusEfetivo = (status: Status, vencimento: string) =>
  status !== 'pago' && vencimento < hojeISO() ? 'vencido' : status;
export const classeStatus = (s: Status | 'vencido') => CLS[s];

/** Quem está do outro lado do lançamento: fornecedor nos pagamentos, cliente nos recebimentos */
export const rotuloParte = (tipo?: string | null) => (tipo === 'entrada' ? 'Cliente / Origem' : 'Fornecedor / Beneficiário');
export const ROTULO_PARTE = 'Fornecedor / Cliente';
