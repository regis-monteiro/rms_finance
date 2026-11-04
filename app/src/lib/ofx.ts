/** Leitura de extratos OFX (versões 1.x em SGML e 2.x em XML) */
export interface TransacaoOFX { fitid: string; data: string; valor: number; tipo: 'entrada' | 'saida'; nome: string; memo: string; trntype: string; documento: string; provisorio?: boolean }
export interface ExtratoOFX { banco: string; agencia: string; conta: string; inicio: string; fim: string; saldo: number | null; dataSaldo: string | null; transacoes: TransacaoOFX[]; avisos?: string[] }

/** Decodifica respeitando o charset do cabeçalho (bancos brasileiros costumam usar 1252) */
export function decodificar(buf: ArrayBuffer) {
  const inicio = new TextDecoder('latin1').decode(buf.slice(0, 600));
  const utf = /CHARSET:\s*(UTF-?8)|encoding="utf-8"/i.test(inicio) && !/CHARSET:\s*1252/i.test(inicio);
  return new TextDecoder(utf ? 'utf-8' : 'windows-1252').decode(buf);
}

const tag = (bloco: string, nome: string) => {
  const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : '';
};
const dataOFX = (s: string) => (/^\d{8}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');
const numero = (s: string) => {
  const t = s.trim();
  if (!t) return NaN;
  // aceita 1234.56, -1234,56 e 1.234,56
  const n = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return Number(n);
};
const limpar = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

export function lerOFX(texto: string): ExtratoOFX {
  if (!/<OFX>/i.test(texto)) throw new Error('O arquivo não parece ser um extrato OFX.');
  const corpo = texto.slice(texto.search(/<OFX>/i));
  const blocos = corpo.split(/<STMTTRN>/i).slice(1).map(b => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  const transacoes: TransacaoOFX[] = [];
  blocos.forEach((b, i) => {
    const valor = numero(tag(b, 'TRNAMT')), data = dataOFX(tag(b, 'DTPOSTED'));
    if (!data || !Number.isFinite(valor) || valor === 0) return;
    const nome = limpar(tag(b, 'NAME')), memo = limpar(tag(b, 'MEMO'));
    transacoes.push({
      fitid: tag(b, 'FITID') || `${data}|${valor}|${i}`, data, valor: Math.abs(Math.round(valor * 100) / 100),
      tipo: valor > 0 ? 'entrada' : 'saida', nome, memo, trntype: tag(b, 'TRNTYPE'), documento: tag(b, 'CHECKNUM') || tag(b, 'REFNUM'),
    });
  });
  const ledger = corpo.split(/<LEDGERBAL>/i)[1] || '';
  const saldo = ledger ? numero(tag(ledger, 'BALAMT')) : NaN;
  const datas = transacoes.map(t => t.data).sort();
  return {
    banco: tag(corpo, 'BANKID') || tag(corpo, 'ORG'), agencia: tag(corpo, 'BRANCHID'), conta: tag(corpo, 'ACCTID'),
    inicio: dataOFX(tag(corpo, 'DTSTART')) || datas[0] || '', fim: dataOFX(tag(corpo, 'DTEND')) || datas[datas.length - 1] || '',
    saldo: Number.isFinite(saldo) ? saldo : null, dataSaldo: ledger ? dataOFX(tag(ledger, 'DTASOF')) || null : null, transacoes,
  };
}

/** Texto do extrato usado para descrever e classificar a transação */
export const descricaoOFX = (t: TransacaoOFX) => [t.nome, t.memo].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ');

/** Busca o extrato direto no banco (Inter), pela função do servidor */
export async function buscarExtratoBanco(banco: 'inter', inicio: string, fim: string, token: string): Promise<ExtratoOFX> {
  const r = await fetch(`/api/extrato?banco=${banco}&inicio=${inicio}&fim=${fim}`, { headers: { Authorization: 'Bearer ' + token } });
  let j: (ExtratoOFX & { erro?: string }) | null = null;
  try { j = await r.json(); } catch { /* resposta vazia */ }
  if (!r.ok || !j) throw new Error(j?.erro || `O servidor não respondeu (${r.status}).`);
  return { banco: j.banco, agencia: '', conta: '', inicio: j.inicio, fim: j.fim, saldo: j.saldo ?? null, dataSaldo: j.dataSaldo ?? null, transacoes: j.transacoes || [], avisos: j.avisos || [] };
}
