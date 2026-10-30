import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Plus, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { CategoryIcon, Alert } from './ui';
import CategoryFormModal from './CategoryFormModal';

function Sidebar() {
  const { categories, health } = useApp();
  const [creating, setCreating] = useState(false);
  const dbReady = health?.db?.ready;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="/Data_Hub.png" alt="Data Hub" style={{ width: 34, height: 34, objectFit: 'contain' }} />
        <div>
          <div className="sidebar-brand-title">Data Hub</div>
          <div className="sidebar-brand-sub">Smart Factory</div>
        </div>
      </div>
      <nav>
        <NavLink to="/" end className="sidebar-item">
          <LayoutDashboard size={18} /><span>Dashboard</span>
        </NavLink>
      </nav>
      <div className="sidebar-section">
        <p className="section-title">Categorías</p>
        <button type="button" className="btn-ghost btn-icon" title="Nueva categoría" onClick={() => setCreating(true)} disabled={!dbReady}>
          <Plus size={16} />
        </button>
      </div>
      <nav>
        {categories.map((c) => (
          <NavLink key={c.id} to={`/c/${c.slug}`} className="sidebar-item">
            <CategoryIcon name={c.icon} />
            <span>{c.name}</span>
            <span className="count">{c.table_count}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer" title={health?.db?.error ?? ''}>
        <span className={`status-dot ${dbReady ? 'ok' : health ? 'down' : ''}`} />
        <span>{dbReady ? `MySQL · ${health.db.database}` : health ? 'MySQL sin conexión' : 'Conectando…'}</span>
      </div>
      {health?.mongo?.enabled && (
        <div className="sidebar-footer" title={health.mongo.error ?? ''} style={{ marginTop: 0, paddingTop: 0 }}>
          <span className={`status-dot ${health.mongo.ready ? 'ok' : 'down'}`} />
          <span>{health.mongo.ready ? `MongoDB · ${health.mongo.database}` : 'MongoDB sin conexión'}</span>
        </div>
      )}
      <CategoryFormModal open={creating} onClose={() => setCreating(false)} />
    </aside>
  );
}

function Topbar() {
  const { pathname } = useLocation();
  const { categories } = useApp();
  const parts = pathname.split('/').filter(Boolean);
  const crumbs = [{ to: '/', label: 'Data Hub' }];
  if (parts[0] === 'c' && parts[1]) {
    const cat = categories.find((c) => c.slug === parts[1]);
    crumbs.push({ to: `/c/${parts[1]}`, label: cat?.name ?? parts[1] });
    // Nivel opcional de aplicación: /c/<cat>/a/<app>/...
    let rest = parts.slice(2);
    if (rest[0] === 'a' && rest[1]) {
      crumbs.push({ to: `/c/${parts[1]}/a/${rest[1]}`, label: rest[1] });
      rest = rest.slice(2);
    }
    if (rest[0] === 'new') crumbs.push({ label: 'Nueva tabla' });
    if (rest[0] === 't' && rest[1]) crumbs.push({ label: rest[1] });
  } else crumbs.push({ label: 'Dashboard' });

  return (
    <header className="topbar">
      {crumbs.map((c, i) => (
        <span key={i} className="row" style={{ gap: 8 }}>
          {i > 0 && <ChevronRight size={14} />}
          {i === crumbs.length - 1 ? <span className="current">{c.label}</span> : <Link to={c.to}>{c.label}</Link>}
        </span>
      ))}
    </header>
  );
}

export default function Layout() {
  const { health } = useApp();
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <Topbar />
        <main className="content">
          {health && !health.db?.ready && (
            <div style={{ marginBottom: 20 }}>
              <Alert type="error">
                <strong>Sin conexión a MySQL.</strong> {health.db?.error} — revisa <span className="code-inline">backend/.env</span>. Se reintenta automáticamente.
              </Alert>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
