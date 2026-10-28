import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Table2, Pencil, Trash2, AppWindow } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Loading, EmptyState, Alert } from '../components/ui';
import CategoryFormModal from '../components/CategoryFormModal';
import TableCards from '../components/TableCards';

export default function ApplicationPage() {
  const { categorySlug, appSlug } = useParams();
  const navigate = useNavigate();
  const { health, refreshCategories, toast } = useApp();
  const [app, setApp] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const ready = health?.db?.ready;
  const base = `/c/${categorySlug}/a/${appSlug}`;

  const load = useCallback(async () => {
    setError(null);
    try {
      setApp(await api.get(`/categories/${categorySlug}/apps/${appSlug}`));
    } catch (err) {
      setError(err.message);
    }
  }, [categorySlug, appSlug]);

  useEffect(() => {
    setApp(null);
    if (ready) load();
  }, [ready, load]);

  const remove = async () => {
    if (!window.confirm(`¿Eliminar la aplicación "${app.name}"?`)) return;
    try {
      await api.del(`/applications/${app.id}`);
      await refreshCategories();
      toast('Aplicación eliminada');
      navigate(`/c/${categorySlug}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (error) return <Alert type="error">{error}</Alert>;
  if (!app) return ready ? <Loading /> : null;

  return (
    <>
      <div className="page-header">
        <div className="row" style={{ gap: 14 }}>
          <div className="table-card-icon" style={{ width: 46, height: 46 }}><AppWindow size={22} /></div>
          <div>
            <h1 className="page-title">{app.name}</h1>
            <p className="page-subtitle">{app.description || `Aplicación de ${app.category_name}`}</p>
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn-ghost" onClick={() => setEditing(true)}><Pencil size={15} /> Editar</button>
          {app.tables.length === 0 && (
            <button type="button" className="btn-ghost" onClick={remove}><Trash2 size={15} /> Eliminar</button>
          )}
          <Link to={`${base}/new`} className="btn-primary"><Plus size={16} /> Nueva tabla</Link>
        </div>
      </div>

      {app.tables.length === 0 ? (
        <div className="glass">
          <EmptyState
            icon={Table2} title="Esta aplicación aún no tiene tablas"
            action={<Link to={`${base}/new`} className="btn-primary"><Plus size={16} /> Crear tabla</Link>}
          >
            Crea una tabla definiendo sus columnas, escribiendo SQL o detectándolas a partir de un Excel de ejemplo.
          </EmptyState>
        </div>
      ) : (
        <TableCards tables={app.tables} />
      )}

      <CategoryFormModal open={editing} kind="application" category={app} onClose={() => setEditing(false)} onSaved={load} />
    </>
  );
}
