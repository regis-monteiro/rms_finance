// Requisições HTTPS com certificado do cliente (mTLS), exigido pelas APIs do Inter e do Efí
import https from 'node:https';

export function requisitar(url, { metodo = 'GET', cabecalhos = {}, corpo, cert, key, timeout = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const dados = corpo == null ? null : Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: metodo, cert, key, timeout,
      headers: { Accept: 'application/json', ...(dados ? { 'Content-Length': dados.length } : {}), ...cabecalhos },
    }, res => {
      const partes = [];
      res.on('data', c => partes.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(partes), texto = buf.toString('utf8');
        let json = null; try { json = texto ? JSON.parse(texto) : null; } catch { /* não é JSON */ }
        resolve({ status: res.statusCode || 0, texto, json, buf, tipo: String(res.headers['content-type'] || '') });
      });
    });
    req.on('timeout', () => req.destroy(new Error('O banco demorou para responder.')));
    req.on('error', reject);
    if (dados) req.write(dados);
    req.end();
  });
}

export class ErroBanco extends Error {
  constructor(msg, status = 502) { super(msg); this.status = status; }
}

/** Mensagem do banco, sem repetir dados sensíveis */
export function detalhe(r) {
  const j = r.json || {};
  return String(j.mensagem || j.message || j.title || j.detail || j.error_description || j.error || r.texto || '').slice(0, 200);
}

/** Aceita PEM com quebras reais, com "\n" escrito ou em base64 */
export function pem(v) {
  if (!v) return '';
  let s = String(v).trim();
  if (!s.includes('-----BEGIN')) { try { s = Buffer.from(s, 'base64').toString('utf8').trim(); } catch { /* segue */ } }
  return s.replace(/\\n/g, '\n');
}
