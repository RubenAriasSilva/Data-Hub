import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Table2, Pencil, Trash2, AppWindow } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Loading, EmptyState, Alert, CategoryIcon } from '../components/ui';
import CategoryFormModal from '../components/CategoryFormModal';
import TableCards from '../components/TableCards';
import { collectionLabels } from '../utils/format';

export default function CategoryPage() {
  const { categorySlug } = useParams();
  const navigate = useNavigate();
  const { health, refreshCategories, toast } = useApp();
  const labels = collectionLabels(health?.mongo?.enabled);
  const [category, setCategory] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [creatingApp, setCreatingApp] = useState(false);
  const ready = health?.db?.ready;

  const load = useCallback(async () => {
    setError(null);
    try {
      setCategory(await api.get(`/categories/${categorySlug}`));
    } catch (err) {
      setError(err.message);
    }
  }, [categorySlug]);

  useEffect(() => {
    setCategory(null);
    if (ready) load();
  }, [ready, load]);

  const remove = async () => {
    if (!window.confirm(`¿Eliminar la categoría "${category.name}"?`)) return;
    try {
      await api.del(`/categories/${category.id}`);
      await refreshCategories();
      toast('Categoría eliminada');
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (error) return <Alert type="error">{error}</Alert>;
  if (!category) return ready ? <Loading /> : null;

  const empty = category.tables.length === 0 && category.applications.length === 0;

  return (
    <>
      <div className="page-header">
        <div className="row" style={{ gap: 14 }}>
          <div className="table-card-icon" style={{ width: 46, height: 46 }}><CategoryIcon name={category.icon} size={22} /></div>
          <div>
            <h1 className="page-title">{category.name}</h1>
            <p className="page-subtitle">{category.description || 'Sin descripción'}</p>
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn-ghost" onClick={() => setEditing(true)}><Pencil size={15} /> Editar</button>
          {empty && (
            <button type="button" className="btn-ghost" onClick={remove}><Trash2 size={15} /> Eliminar</button>
          )}
          <button type="button" className="btn-secondary" onClick={() => setCreatingApp(true)}><AppWindow size={16} /> Nueva aplicación</button>
          <Link to={`/c/${category.slug}/new`} className="btn-primary"><Plus size={16} /> {labels.newItem}</Link>
        </div>
      </div>

      {empty ? (
        <div className="glass">
          <EmptyState
            icon={Table2} title={`Esta categoría aún no tiene ${labels.none}`}
            action={<Link to={`/c/${category.slug}/new`} className="btn-primary"><Plus size={16} /> {labels.create}</Link>}
          >
            Crea {labels.one === 'tabla' ? 'una tabla' : 'una tabla o colección'} directamente en la categoría, o agrúpalas por aplicación con “Nueva aplicación”.
          </EmptyState>
        </div>
      ) : (
        <div className="stack">
          {category.applications.length > 0 && (
            <div>
              <p className="section-title">Aplicaciones</p>
              <div className="grid grid-cards">
                {category.applications.map((a) => (
                  <div
                    key={a.id} className="glass clickable table-card animate-in"
                    onClick={() => navigate(`/c/${category.slug}/a/${a.slug}`)}
                  >
                    <div className="table-card-head">
                      <div className="table-card-icon"><AppWindow size={18} /></div>
                      <div style={{ minWidth: 0 }}>
                        <div className="table-card-name">{a.name}</div>
                        <div className="mono muted small">{a.slug}</div>
                      </div>
                    </div>
                    {a.description && <div className="muted small">{a.description}</div>}
                    <div className="table-card-meta">
                      <span><strong>{a.table_count}</strong> {Number(a.table_count) === 1 ? labels.one : labels.many}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {category.tables.length > 0 && (
            <div>
              {category.applications.length > 0 && <p className="section-title">{labels.plural}</p>}
              <TableCards tables={category.tables} />
            </div>
          )}
        </div>
      )}

      <CategoryFormModal open={editing} category={category} onClose={() => setEditing(false)} onSaved={load} />
      <CategoryFormModal
        open={creatingApp} kind="application" categoryId={category.id} onClose={() => setCreatingApp(false)}
        onSaved={(app) => navigate(`/c/${category.slug}/a/${app.slug}`)}
      />
    </>
  );
}
