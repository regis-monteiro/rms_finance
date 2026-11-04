// API Banking do Banco Inter Empresas: extrato completo e saldo (somente consulta)
import { requisitar, ErroBanco, detalhe, pem } from './http.js';

const BASE = () => (process.env.INTER_BASE_URL || 'https://cdpj.partners.bancointer.com.br').replace(/\/$/, '');

function credenciais() {
  const c = { id: process.env.INTER_CLIENT_ID, segredo: process.env.INTER_CLIENT_SECRET, cert: pem(process.env.INTER_CERT), key: pem(process.env.INTER_KEY), conta: process.env.INTER_CONTA || '' };
  if (!c.id || !c.segredo || !c.cert || !c.key) throw new ErroBanco('A integração com o Inter ainda não foi configurada na Vercel.', 400);
  return c;
}

async function token(c) {
  const corpo = new URLSearchParams({ client_id: c.id, client_secret: c.segredo, grant_type: 'client_credentials', scope: 'extrato.read' }).toString();
  const r = await requisitar(BASE() + '/oauth/v2/token', { metodo: 'POST', corpo, cert: c.cert, key: c.key, cabecalhos: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (r.status !== 200 || !r.json?.access_token) throw new ErroBanco('O Inter recusou as credenciais: ' + detalhe(r));
  return r.json.access_token;
}

const nomeDe = (t) => {
  const d = t.detalhes || {};
  const k = Object.keys(d).find(x => /^nome/i.test(x) && d[x]);
  return k ? String(d[k]) : '';
};

export async function extratoInter(inicio, fim) {
  const c = credenciais(), tk = await token(c);
  const h = { Authorization: 'Bearer ' + tk, ...(c.conta ? { 'x-conta-corrente': c.conta } : {}) };
  const opt = { cert: c.cert, key: c.key, cabecalhos: h };
  const transacoes = [];
  let completo = true;
  for (let pagina = 0; pagina < 50; pagina++) {
    const r = await requisitar(`${BASE()}/banking/v2/extrato/completo?dataInicio=${inicio}&dataFim=${fim}&pagina=${pagina}&tamanhoPagina=1000`, opt);
    if (r.status !== 200) { if (pagina === 0) { completo = false; break; } throw new ErroBanco('Erro ao ler o extrato do Inter: ' + detalhe(r)); }
    for (const t of r.json?.transacoes || []) {
      const valor = Math.abs(Number(t.valor)); if (!valor) continue;
      const data = String(t.dataTransacao || t.dataInclusao || t.dataEntrada || '').slice(0, 10);
      transacoes.push({ fitid: 'inter:' + (t.idTransacao || `${data}|${t.tipoOperacao}|${valor}|${t.titulo}|${t.descricao}`), data, valor, tipo: t.tipoOperacao === 'D' ? 'saida' : 'entrada',
        nome: nomeDe(t) || String(t.titulo || '').trim(), memo: String(t.descricao || '').trim(), trntype: String(t.tipoTransacao || ''), documento: '' });
    }
    if (r.json?.ultimaPagina !== false || !(r.json?.totalPaginas > pagina + 1)) break;
  }
  if (!completo) {
    // Extrato simples, quando o completo não estiver liberado na integração
    const r = await requisitar(`${BASE()}/banking/v2/extrato?dataInicio=${inicio}&dataFim=${fim}`, opt);
    if (r.status !== 200) throw new ErroBanco('Erro ao ler o extrato do Inter: ' + detalhe(r));
    const vistos = new Map();
    for (const t of r.json?.transacoes || []) {
      const valor = Math.abs(Number(t.valor)); if (!valor) continue;
      const data = String(t.dataEntrada || t.dataTransacao || '').slice(0, 10), base = `${data}|${t.tipoOperacao}|${valor}|${t.titulo}|${t.descricao}`;
      const k = (vistos.get(base) || 0) + 1; vistos.set(base, k);
      transacoes.push({ fitid: `inter:${base}|${k}`, data, valor, tipo: t.tipoOperacao === 'D' ? 'saida' : 'entrada', nome: String(t.titulo || '').trim(), memo: String(t.descricao || '').trim(), trntype: String(t.tipoTransacao || ''), documento: '' });
    }
  }
  let saldo = null;
  const s = await requisitar(`${BASE()}/banking/v2/saldo?dataSaldo=${fim}`, opt);
  if (s.status === 200 && s.json) saldo = ['disponivel', 'bloqueadoCheque', 'bloqueadoJudicialmente', 'bloqueadoAdministrativo'].reduce((a, k) => a + Number(s.json[k] || 0), 0);
  return { banco: 'Inter', inicio, fim, saldo, dataSaldo: saldo == null ? null : fim, transacoes, avisos: completo ? [] : ['Extrato simplificado: o extrato completo não está liberado nesta integração.'] };
}
