import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Table2, Pencil, Trash2, AppWindow, BookOpen, Download, Upload } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Loading, EmptyState, Alert, FileDropzone, Spinner } from '../components/ui';
import CategoryFormModal from '../components/CategoryFormModal';
import TableCards from '../components/TableCards';
import { fmtDateTime, collectionLabels } from '../utils/format';

const README_ACCEPT = '.md,.markdown,.txt';
// La librería de Markdown solo se descarga al abrir la documentación
const Markdown = lazy(() => import('../components/Markdown'));

/** Documentación de la aplicación: un README en Markdown que se sube como archivo. */
function DocsPanel({ app, onChanged }) {
  const { toast } = useApp();
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const replaceInput = useRef(null);

  const upload = async (f) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      await api.put(`/applications/${app.id}/readme`, fd);
      toast('Documentación actualizada');
      setFile(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('¿Eliminar la documentación de esta aplicación?')) return;
    try {
      await api.del(`/applications/${app.id}/readme`);
      toast('Documentación eliminada');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([app.readme], { type: 'text/markdown;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${app.slug}_README.md` });
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!app.readme) {
    return (
      <div className="glass card-pad stack">
        <EmptyState icon={BookOpen} title="Sin documentación">
          Sube un archivo README en Markdown (.md); se mostrará con formato como en GitHub.
        </EmptyState>
        {error && <Alert type="error">{error}</Alert>}
        <FileDropzone file={file} onFile={(f) => { setError(null); setFile(f); }} accept={README_ACCEPT} hint="Formato: .md" />
        <div className="row">
          <div className="spacer" />
          <button type="button" className="btn-primary" disabled={!file || busy} onClick={() => upload(file)}>
            {busy ? <Spinner /> : <Upload size={16} />} Subir documentación
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <span className="muted small">Actualizada {fmtDateTime(app.readme_updated_at)}</span>
        <div className="spacer" />
        <input
          ref={replaceInput} type="file" accept={README_ACCEPT} hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }}
        />
        <button type="button" className="btn-ghost btn-sm" onClick={download}><Download size={14} /> Descargar</button>
        <button type="button" className="btn-ghost btn-sm" onClick={remove}><Trash2 size={14} /> Eliminar</button>
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => replaceInput.current?.click()}>
          {busy ? <Spinner /> : <Upload size={14} />} Reemplazar .md
        </button>
      </div>
      {error && <Alert type="error">{error}</Alert>}
      <div className="glass card-pad"><Suspense fallback={<Loading />}><Markdown>{app.readme}</Markdown></Suspense></div>
    </div>
  );
}

export default function ApplicationPage() {
  const { categorySlug, appSlug } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { health, refreshCategories, toast } = useApp();
  const labels = collectionLabels(health?.mongo?.enabled);
  const [app, setApp] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const ready = health?.db?.ready;
  const base = `/c/${categorySlug}/a/${appSlug}`;
  const tab = params.get('tab') === 'docs' ? 'docs' : 'tables';

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
          <Link to={`${base}/new`} className="btn-primary"><Plus size={16} /> {labels.newItem}</Link>
        </div>
      </div>

      <div className="glass tabs">
        <button type="button" className={`tab${tab === 'tables' ? ' active' : ''}`} onClick={() => setParams({})}>
          <Table2 size={15} /> {labels.plural} ({app.tables.length})
        </button>
        <button type="button" className={`tab${tab === 'docs' ? ' active' : ''}`} onClick={() => setParams({ tab: 'docs' })}>
          <BookOpen size={15} /> Documentación
        </button>
      </div>

      <div className="animate-in" key={tab}>
        {tab === 'docs' && <DocsPanel app={app} onChanged={load} />}
        {tab === 'tables' && (app.tables.length === 0 ? (
          <div className="glass">
            <EmptyState
              icon={Table2} title={`Esta aplicación aún no tiene ${labels.none}`}
              action={<Link to={`${base}/new`} className="btn-primary"><Plus size={16} /> {labels.create}</Link>}
            >
              {labels.one === 'tabla'
                ? 'Crea una tabla definiendo sus columnas, escribiendo SQL o detectándolas a partir de un Excel de ejemplo.'
                : 'Crea una tabla MySQL (columnas, SQL o Excel de ejemplo) o una colección MongoDB (formulario, código mongosh o archivo de datos).'}
            </EmptyState>
          </div>
        ) : (
          <TableCards tables={app.tables} />
        ))}
      </div>

      <CategoryFormModal open={editing} kind="application" category={app} onClose={() => setEditing(false)} onSaved={load} />
    </>
  );
}
