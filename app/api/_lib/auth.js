// Confere o usuário logado no app (Supabase) antes de consultar o banco
const URL_PADRAO = 'https://qahmwkocnupbasvcjqbp.supabase.co';
const CHAVE_PADRAO = 'sb_publishable_luIwWTTScE73tdeK_RUDbQ_5xZDIR2x'; // chave pública do app

export async function usuarioAutorizado(req) {
  const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || URL_PADRAO).replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const chave = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || CHAVE_PADRAO;
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const h = { apikey: chave, Authorization: 'Bearer ' + token };
  const u = await fetch(base + '/auth/v1/user', { headers: h });
  if (!u.ok) return null;
  const user = await u.json();
  if (!user?.id) return null;
  const p = await fetch(`${base}/rest/v1/usuarios?select=perfil,ativo&id=eq.${encodeURIComponent(user.id)}`, { headers: h });
  if (!p.ok) return null;
  const [perfil] = await p.json();
  if (!perfil?.ativo || !['diretor', 'financeiro'].includes(perfil.perfil)) return null;
  return { id: user.id, perfil: perfil.perfil };
}
