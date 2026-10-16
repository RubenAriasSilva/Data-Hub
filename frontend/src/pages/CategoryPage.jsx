import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Table2, Pencil, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Loading, EmptyState, Alert, CategoryIcon } from '../components/ui';
import CategoryFormModal from '../components/CategoryFormModal';
import { fmtNumber, fmtRelative, STATUS } from '../utils/format';

export default function CategoryPage() {
  const { categorySlug } = useParams();
  const navigate = useNavigate();
  const { health, refreshCategories, toast } = useApp();
  const [category, setCategory] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
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
          {category.tables.length === 0 && (
            <button type="button" className="btn-ghost" onClick={remove}><Trash2 size={15} /> Eliminar</button>
          )}
          <Link to={`/c/${category.slug}/new`} className="btn-primary"><Plus size={16} /> Nueva tabla</Link>
        </div>
      </div>

      {category.tables.length === 0 ? (
        <div className="glass">
          <EmptyState
            icon={Table2} title="Esta categoría aún no tiene tablas"
            action={<Link to={`/c/${category.slug}/new`} className="btn-primary"><Plus size={16} /> Crear tabla</Link>}
          >
            Crea una tabla definiendo sus columnas, o detéctalas a partir de un Excel de ejemplo.
          </EmptyState>
        </div>
      ) : (
        <div className="grid grid-cards">
          {category.tables.map((t) => (
            <div
              key={t.id} className="glass clickable table-card animate-in"
              onClick={() => navigate(`/c/${category.slug}/t/${t.slug}`)}
            >
              <div className="table-card-head">
                <div className="table-card-icon"><Table2 size={18} /></div>
                <div style={{ minWidth: 0 }}>
                  <div className="table-card-name">{t.name}</div>
                  <div className="mono muted small">{t.db_table}</div>
                </div>
              </div>
              {t.description && <div className="muted small">{t.description}</div>}
              <div className="table-card-meta">
                <span><strong>{fmtNumber(t.row_count)}</strong> registros</span>
                <span><strong>{t.column_count}</strong> columnas</span>
              </div>
              <div className="row">
                {t.last_upload_status
                  ? <Badge color={STATUS[t.last_upload_status]?.color}>{STATUS[t.last_upload_status]?.label}</Badge>
                  : <Badge color="gray">Sin cargas</Badge>}
                <span className="muted small">{fmtRelative(t.last_upload_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <CategoryFormModal open={editing} category={category} onClose={() => setEditing(false)} onSaved={load} />
    </>
  );
}
