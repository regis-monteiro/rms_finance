import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [modo, setModo] = useState<'entrar' | 'criar' | 'esqueci'>('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [nome, setNome] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true); setMsg(null);
    if (modo === 'entrar') {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
      if (error) setMsg({ t: 'err', m: 'E-mail ou senha incorretos.' });
    } else if (modo === 'criar') {
      const { error } = await supabase.auth.signUp({ email, password: senha, options: { data: { nome } } });
      setMsg(error ? { t: 'err', m: error.message } : { t: 'ok', m: 'Cadastro feito. Confirme pelo link enviado ao seu e-mail e depois entre.' });
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      setMsg(error ? { t: 'err', m: error.message } : { t: 'ok', m: 'Enviamos um link para redefinir a senha.' });
    }
    setEnviando(false);
  }

  return (
    <div className="login">
      <div className="box">
        <div className="logo"><img src="/logo-rms-marfim.png" alt="RMS Organização Contábil" /><span>Finance</span></div>
        <form onSubmit={enviar}>
          {modo === 'criar' && <label>Nome<input value={nome} onChange={e => setNome(e.target.value)} required /></label>}
          <label>E-mail<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
          {modo !== 'esqueci' && <label>Senha<input type="password" minLength={8} value={senha} onChange={e => setSenha(e.target.value)} required /></label>}
          {msg && <div className={msg.t}>{msg.m}</div>}
          <button className="btn" disabled={enviando}>{modo === 'entrar' ? 'Entrar' : modo === 'criar' ? 'Criar acesso' : 'Enviar link'}</button>
        </form>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 12.5 }}>
          {modo !== 'entrar' ? <a href="#" onClick={() => setModo('entrar')}>Voltar para o login</a> : <a href="#" onClick={() => setModo('criar')}>Primeiro acesso</a>}
          {modo === 'entrar' && <a href="#" onClick={() => setModo('esqueci')}>Esqueci a senha</a>}
        </div>
      </div>
    </div>
  );
}
