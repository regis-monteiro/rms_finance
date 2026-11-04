import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Perfil } from './supabase';
import { limparRascunhos } from './rascunho';

interface Usuario { id: string; nome: string; email: string; perfil: Perfil; ativo: boolean }
interface Ctx { session: Session | null; usuario: Usuario | null; carregando: boolean; sair: () => void }

const AuthCtx = createContext<Ctx>({ session: null, usuario: null, carregando: true, sair: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setUsuario(null); setCarregando(false); return; }
    setCarregando(true);
    supabase.from('usuarios').select('*').eq('id', session.user.id).single()
      .then(({ data }) => { setUsuario(data as Usuario | null); setCarregando(false); });
  }, [session]);

  return (
    <AuthCtx.Provider value={{ session, usuario, carregando, sair: () => { limparRascunhos(); supabase.auth.signOut(); } }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
export const podeEditar = (p?: Perfil) => p === 'diretor' || p === 'financeiro';
