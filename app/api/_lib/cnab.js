// Extrato de conta corrente no padrão FEBRABAN CNAB 240 (segmento E)
const n = (s) => Number(s.replace(/\D/g, '') || '0');
const data = (s) => (/^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}` : '');
const txt = (s) => s.replace(/\s+/g, ' ').trim();

export function lerCNAB240(conteudo) {
  const linhas = String(conteudo).split(/\r?\n/).map(l => l.replace(/\r$/, '')).filter(l => l.length >= 200);
  const transacoes = [];
  let saldo = null, dataSaldo = null;
  for (const l of linhas) {
    const tipo = l[7];
    if (tipo === '3' && l[13] === 'E') {
      const dataLanc = data(l.slice(142, 150)) || data(l.slice(134, 142));
      const valor = n(l.slice(150, 168)) / 100;
      if (!dataLanc || !valor) continue;
      const dc = l[168];
      const historico = txt(l.slice(176, 201)), documento = txt(l.slice(201, 240)), complemento = txt(l.slice(113, 133));
      transacoes.push({
        data: dataLanc, valor, tipo: dc === 'D' ? 'saida' : 'entrada', nome: historico || 'Lançamento', memo: [complemento, documento].filter(Boolean).join(' · '),
        trntype: txt(l.slice(169, 172)), documento, chave: `${dataLanc}|${dc}|${valor.toFixed(2)}|${documento}|${historico}`,
      });
    } else if (tipo === '5') {
      const d = data(l.slice(142, 150)), v = n(l.slice(150, 168)) / 100;
      if (d) { saldo = l[168] === 'D' ? -v : v; dataSaldo = d; }
    }
  }
  return { transacoes, saldo, dataSaldo };
}
