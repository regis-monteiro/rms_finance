// GET /api/extrato?banco=inter|efi&inicio=AAAA-MM-DD&fim=AAAA-MM-DD
// Busca o extrato direto no banco para a tela de Conciliação. Só para Diretor e Financeiro logados.
// As credenciais ficam em variáveis de ambiente da Vercel e nunca vão para o navegador.
import { usuarioAutorizado } from './_lib/auth.js';
import { ErroBanco } from './_lib/http.js';
import { extratoInter } from './_lib/inter.js';
import { extratoEfi } from './_lib/efi.js';

const iso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const hojeSP = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido.' });
    const usuario = await usuarioAutorizado(req);
    if (!usuario) return res.status(401).json({ erro: 'Acesso não autorizado.' });
    const { banco, inicio, fim } = req.query || {};
    if (!iso(inicio) || !iso(fim) || inicio > fim) return res.status(400).json({ erro: 'Período inválido.' });
    const dias = (new Date(fim) - new Date(inicio)) / 86400000;
    if (dias > 89) return res.status(400).json({ erro: 'Escolha um período de até 90 dias.' });
    const hoje = hojeSP(), fimOk = fim > hoje ? hoje : fim;
    if (banco === 'inter') return res.status(200).json(await extratoInter(inicio, fimOk));
    if (banco === 'efi') return res.status(200).json(await extratoEfi(inicio, fimOk, hoje));
    return res.status(400).json({ erro: 'Banco não suportado.' });
  } catch (e) {
    const status = e instanceof ErroBanco ? e.status : 500;
    return res.status(status).json({ erro: e instanceof ErroBanco ? e.message : 'Falha ao consultar o banco: ' + (e?.message || 'erro desconhecido') });
  }
}
