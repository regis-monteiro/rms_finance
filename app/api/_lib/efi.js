// Efí Bank: extrato CNAB 240 (D+1) e Pix recebidos no dia (somente consulta)
import forge from 'node-forge';
import { requisitar, ErroBanco, detalhe } from './http.js';
import { lerCNAB240 } from './cnab.js';

const EXT = () => (process.env.EFI_EXTRATOS_URL || 'https://extratos.api.efipay.com.br').replace(/\/$/, '');
const PIX = () => (process.env.EFI_PIX_URL || 'https://pix.api.efipay.com.br').replace(/\/$/, '');

/** O certificado do Efí vem em .p12; convertido em memória para certificado e chave */
function credenciais() {
  const id = process.env.EFI_CLIENT_ID, segredo = process.env.EFI_CLIENT_SECRET, p12 = process.env.EFI_CERT_P12;
  if (!id || !segredo || !p12) throw new ErroBanco('A integração com o Efí ainda não foi configurada na Vercel.', 400);
  try {
    const der = forge.util.decode64(p12.replace(/\s+/g, ''));
    const pkcs = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), process.env.EFI_CERT_SENHA || '');
    const certs = pkcs.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    const chaves = pkcs.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || pkcs.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
    if (!certs.length || !chaves.length) throw new Error('sem certificado ou chave');
    return { id, segredo, cert: certs.map(b => forge.pki.certificateToPem(b.cert)).join('\n'), key: forge.pki.privateKeyToPem(chaves[0].key) };
  } catch (e) { throw new ErroBanco('Não foi possível ler o certificado do Efí (EFI_CERT_P12): ' + e.message, 400); }
}

async function token(c, url) {
  const r = await requisitar(url, { metodo: 'POST', corpo: { grant_type: 'client_credentials' }, cert: c.cert, key: c.key,
    cabecalhos: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${c.id}:${c.segredo}`).toString('base64') } });
  if (r.status !== 200 || !r.json?.access_token) throw new ErroBanco('O Efí recusou as credenciais: ' + detalhe(r));
  escopos = String(r.json.scope || '');
  return r.json.access_token;
}
let escopos = '';
/** Mensagem clara quando a aplicação do Efí não tem o escopo necessário */
const semEscopo = (r, falta) => (/scope/i.test(detalhe(r)) || r.status === 403
  ? ` Falta liberar o escopo "${falta}" na aplicação do Efí (ambiente de Produção).${escopos ? ' Escopos liberados hoje: ' + escopos + '.' : ''}`
  : '');

const lista = (j, k) => (Array.isArray(j) ? j : Array.isArray(j?.[k]) ? j[k] : Array.isArray(j?.data) ? j.data : []);
const diaDe = (s) => { const m = String(s || '').match(/(\d{4})-?(\d{2})-?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; };
const somaDias = (iso, d) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

export async function extratoEfi(inicio, fim, hoje) {
  const c = credenciais(), avisos = [];
  // 1. Extrato CNAB (gerado no dia seguinte)
  const tk = await token(c, EXT() + '/v1/oauth/token');
  const opt = { cert: c.cert, key: c.key, cabecalhos: { Authorization: 'Bearer ' + tk } };
  const ag = await requisitar(EXT() + '/v1/extrato-cnab/agendamentos', opt);
  if (ag.status === 200 && !lista(ag.json, 'agendamentos').length) {
    const r = await requisitar(EXT() + '/v1/extrato-cnab/agendar', { ...opt, metodo: 'POST', corpo: { periodicidade: 'diario', envia_email: false, comprimir_arquivos: false }, cabecalhos: { ...opt.cabecalhos, 'Content-Type': 'application/json' } });
    avisos.push(r.status < 300 ? 'Geração diária do extrato ativada no Efí: o primeiro arquivo fica disponível amanhã.' : 'Não foi possível ativar a geração diária do extrato no Efí: ' + detalhe(r) + '.' + semEscopo(r, 'API Extratos: criar e revisar recorrências (gn.cnab-statement.statement.write)'));
  }
  const arq = await requisitar(EXT() + '/v1/extrato-cnab/arquivos', opt);
  if (arq.status !== 200) throw new ErroBanco('Erro ao listar os extratos do Efí: ' + detalhe(arq) + '.' + semEscopo(arq, 'API Extratos: consultar arquivos e recorrências (gn.cnab-statement.statement.read)'));
  const arquivos = lista(arq.json, 'arquivos').filter(a => { const d = diaDe(a.data_geracao || a.nome); return d && d >= inicio && d <= somaDias(fim, 3); });
  // Cada arquivo traz um ou mais dias; se dois arquivos repetirem o mesmo dia, vale a maior contagem de cada lançamento
  const porChave = new Map();
  let saldo = null, dataSaldo = null;
  for (let i = 0; i < arquivos.length; i += 5) {
    const lote = await Promise.all(arquivos.slice(i, i + 5).map(a => requisitar(`${EXT()}/v1/extrato-cnab/download/${encodeURIComponent(a.nome)}`, opt)));
    for (const r of lote) {
      if (r.status !== 200) { avisos.push('Um arquivo de extrato do Efí não pôde ser baixado: ' + detalhe(r)); continue; }
      const conteudo = r.json && typeof r.json === 'object' ? Object.values(r.json).find(v => typeof v === 'string' && v.length > 200) || '' : typeof r.json === 'string' ? r.json : r.texto;
      const e = lerCNAB240(conteudo);
      if (e.dataSaldo && (!dataSaldo || e.dataSaldo > dataSaldo)) { dataSaldo = e.dataSaldo; saldo = e.saldo; }
      const doArquivo = new Map();
      for (const t of e.transacoes) { if (t.data >= inicio && t.data <= fim) doArquivo.set(t.chave, [...(doArquivo.get(t.chave) || []), t]); }
      for (const [k, l] of doArquivo) if (l.length > (porChave.get(k)?.length || 0)) porChave.set(k, l);
    }
  }
  const unicos = [];
  for (const [k, l] of porChave) l.forEach((t, i) => { const { chave, ...resto } = t; unicos.push({ ...resto, fitid: `efi:${k}|${i + 1}` }); });
  unicos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  const ultimoDia = unicos.reduce((m, t) => (t.data > m ? t.data : m), dataSaldo || '');

  // 2. Pix recebidos depois do último dia coberto pelo extrato (inclui o dia de hoje)
  const desde = ultimoDia ? somaDias(ultimoDia, 1) : inicio;
  if (fim >= desde) {
    try {
      const tp = await token(c, PIX() + '/oauth/token');
      const op = { cert: c.cert, key: c.key, cabecalhos: { Authorization: 'Bearer ' + tp } };
      for (let pagina = 0; pagina < 20; pagina++) {
        const r = await requisitar(`${PIX()}/v2/pix?inicio=${desde}T00:00:00-03:00&fim=${fim}T23:59:59-03:00&paginacao.paginaAtual=${pagina}&paginacao.itensPorPagina=1000`, op);
        if (r.status !== 200) { avisos.push('Pix do dia não consultados: ' + detalhe(r) + '.' + semEscopo(r, 'API Pix: consultar Pix (pix.read)')); break; }
        for (const p of r.json?.pix || []) {
          const valor = Number(p.valor); if (!valor) continue;
          const nome = p.pagador?.nome || p.infoPagador || 'Pix recebido';
          unicos.push({ fitid: 'efipix:' + (p.endToEndId || p.txid), data: String(p.horario || '').slice(0, 10), valor, tipo: 'entrada', nome: 'PIX RECEBIDO ' + nome, memo: p.infoPagador || '', trntype: 'PIX', documento: p.txid || '', provisorio: true });
        }
        const pag = r.json?.parametros?.paginacao;
        if (!pag || pag.paginaAtual + 1 >= pag.quantidadeDePaginas) break;
      }
    } catch (e) { avisos.push('Pix do dia não consultados: ' + e.message); }
  }
  if (!arquivos.length) avisos.push('Nenhum arquivo de extrato do Efí no período. O extrato é gerado no dia seguinte ao movimento.');
  return { banco: 'Efí', inicio, fim, saldo, dataSaldo, transacoes: unicos, avisos, hoje };
}
