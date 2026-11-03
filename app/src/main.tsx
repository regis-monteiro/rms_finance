import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth';
import { configurado } from './lib/supabase';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Lancamentos from './pages/Lancamentos';
import Cadastros from './pages/Cadastros';
import EmBreve from './pages/EmBreve';
import Pagar from './pages/Pagar';
import Cartoes from './pages/Cartoes';

function App() {
  const { session, usuario, carregando } = useAuth();
  if (!configurado) return <div className="empty">Configuração pendente: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.</div>;
  if (carregando) return <div className="empty">Carregando…</div>;
  if (!session) return <Login />;
  if (!usuario || !usuario.ativo) return <div className="empty">Seu acesso ainda não foi liberado. Fale com um diretor.</div>;
  const p = usuario.perfil, opera = p === 'diretor' || p === 'financeiro', dir = p === 'diretor';
  const so = (ok: boolean, el: JSX.Element) => (ok ? el : <Navigate to="/" replace />);
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="lancamentos" element={so(opera, <Lancamentos />)} />
        <Route path="pagar" element={so(opera, <Pagar />)} />
        <Route path="receber" element={<EmBreve titulo="Contas a receber" />} />
        <Route path="cartoes" element={so(opera, <Cartoes />)} />
        <Route path="dre" element={<EmBreve titulo="DRE / Análise do fluxo" />} />
        <Route path="comparativos" element={<EmBreve titulo="Comparativos" />} />
        <Route path="cadastros" element={so(dir, <Cadastros />)} />
        <Route path="usuarios" element={so(dir, <EmBreve titulo="Usuários" />)} />
        <Route path="importacao" element={so(dir, <EmBreve titulo="Importação" />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider>
  </React.StrictMode>
);
