import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const PERFIL = { diretor: 'Diretor', financeiro: 'Financeiro', consulta: 'Consulta' };

export default function Layout() {
  const { usuario, sair } = useAuth();
  const p = usuario?.perfil;
  const item = (to: string, txt: string, ok = true) => ok && <NavLink to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{txt}</NavLink>;
  const opera = p === 'diretor' || p === 'financeiro';
  return (
    <div className="app">
      <aside>
        <div className="brand"><img src="/logo-rms-marfim.png" alt="RMS Organização Contábil" /><span>Finance</span></div>
        <nav>
          {item('/', 'Dashboard')}
          {item('/lancamentos', 'Lançamentos', opera)}
          {item('/pagar', 'Contas a pagar', opera)}
          {item('/receber', 'Contas a receber')}
          {item('/cartoes', 'Cartões', opera)}
          <div className="sep">Análises</div>
          {item('/dre', 'DRE / Análise do fluxo')}
          {item('/comparativos', 'Comparativos')}
          {opera && <div className="sep">Configurações</div>}
          {item('/cadastros', 'Cadastros', opera)}
          {item('/usuarios', 'Usuários', p === 'diretor')}
          {item('/importacao', 'Importação', p === 'diretor')}
        </nav>
        <div className="user">
          <b>{usuario?.nome}</b>Perfil: {p ? PERFIL[p] : '·'}
          <div><button onClick={sair}>Sair</button></div>
        </div>
      </aside>
      <main><Outlet /></main>
    </div>
  );
}

export function Cabecalho({ titulo, sub, children }: { titulo: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="top">
      <div><h1>{titulo}</h1><p>{sub}</p></div>
      <div className="filters" style={{ margin: 0 }}>{children}</div>
    </div>
  );
}
