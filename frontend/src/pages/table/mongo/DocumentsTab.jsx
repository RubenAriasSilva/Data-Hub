import { useEffect, useMemo, useState } from 'react';
import {
  Search, ChevronLeft, ChevronRight, Trash2, Pencil, Braces, Table2, Filter, ArrowUp, ArrowDown, FileJson,
} from 'lucide-react';
import { api } from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { Loading, EmptyState, Alert, Modal, Spinner } from '../../../components/ui';
import { fmtNumber, fmtDateTime } from '../../../utils/format';
import JsonView, { summarize } from './JsonView';

const SYSTEM = new Set(['_id', '_created_at', '_updated_at']);

/** _id como texto para la URL ({"$oid": "…"} -> "…"). */
const docId = (doc) => String(doc._id?.$oid ?? doc._id);
const dateOf = (v) => (v?.$date ? v.$date : v);
const withoutSystem = (doc) => Object.fromEntries(Object.entries(doc).filter(([k]) => !SYSTEM.has(k)));

export default function DocumentsTab({ table, version, onChanged }) {
  const { toast } = useApp();
  const [query, setQuery] = useState({ page: 1, limit: 25, sort: '_id', order: 'desc', q: '', filter: '' });
  const [search, setSearch] = useState('');
  const [filterText, setFilterText] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [view, setView] = useState('docs'); // 'docs' | 'table'
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // { id, text }
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState(null);

  // Búsqueda con retardo para no consultar en cada tecla
  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.q === search ? q : { ...q, q: search, page: 1 })), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '')).toString();
    api.get(`/tables/${table.id}/documents?${qs}`)
      .then((d) => { setData(d); setError(null); })
      .catch((err) => setError(err.message));
  }, [table.id, query, version]);

  // Columnas de la vista tabla: campos de primer nivel presentes en la página
  const columns = useMemo(() => {
    const seen = new Set();
    for (const d of data?.documents ?? []) for (const k of Object.keys(d)) if (!SYSTEM.has(k)) seen.add(k);
    return [...seen];
  }, [data]);

  const applyFilter = () => {
    const text = filterText.trim();
    if (text) {
      try {
        JSON.parse(text);
      } catch (err) {
        setError(`Filtro: JSON inválido (${err.message})`);
        return;
      }
    }
    setQuery((q) => ({ ...q, filter: text, page: 1 }));
  };

  const sortBy = (field) => setQuery((q) => ({
    ...q, sort: field, order: q.sort === field && q.order === 'asc' ? 'desc' : 'asc', page: 1,
  }));

  const removeDoc = async (doc) => {
    if (!window.confirm(`¿Eliminar el documento ${docId(doc)}?`)) return;
    try {
      await api.del(`/tables/${table.id}/documents/${encodeURIComponent(docId(doc))}`);
      toast('Documento eliminado');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const openEdit = (doc) => {
    setEditError(null);
    setEditing({ id: docId(doc), text: JSON.stringify(withoutSystem(doc), null, 2) });
  };

  const saveEdit = async () => {
    let body;
    try {
      body = JSON.parse(editing.text);
    } catch (err) {
      setEditError(`JSON inválido: ${err.message}`);
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await api.put(`/tables/${table.id}/documents/${encodeURIComponent(editing.id)}`, body);
      toast('Documento actualizado');
      setEditing(null);
      onChanged();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const SortIcon = ({ field }) => (query.sort === field ? (query.order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null);
  const viewTab = (id, Icon, label) => (
    <button type="button" className={`tab${view === id ? ' active' : ''}`} onClick={() => setView(id)}><Icon size={15} /> {label}</button>
  );
  const actions = (doc) => (
    <div className="icon-btns">
      <button type="button" className="btn-ghost btn-icon" title="Editar documento" onClick={() => openEdit(doc)}><Pencil size={14} /></button>
      <button type="button" className="btn-ghost btn-icon" title="Eliminar documento" onClick={() => removeDoc(doc)}><Trash2 size={14} /></button>
    </div>
  );

  return (
    <div className="stack">
      <div className="glass">
        <div className="card-pad row">
          <div style={{ position: 'relative', width: 300, maxWidth: '100%' }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--txt4)' }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar texto en los documentos…" style={{ paddingLeft: 34 }} />
          </div>
          <button type="button" className={`btn-${showFilter || query.filter ? 'secondary' : 'ghost'} btn-sm`} onClick={() => setShowFilter((s) => !s)}>
            <Filter size={14} /> Filtro MongoDB{query.filter ? ' (activo)' : ''}
          </button>
          <div className="spacer" />
          {data && <span className="muted small">{fmtNumber(data.total)} documentos</span>}
          <div className="tabs" style={{ margin: 0 }}>
            {viewTab('docs', Braces, 'Documentos')}
            {viewTab('table', Table2, 'Cuadrícula')}
          </div>
        </div>
        {showFilter && (
          <div className="card-pad" style={{ paddingTop: 0 }}>
            <textarea
              className="mono" rows={3} spellCheck={false} value={filterText} style={{ width: '100%', resize: 'vertical' }}
              placeholder={'{ "estado": "activo", "total": { "$gte": 100 } }'}
              onChange={(e) => setFilterText(e.target.value)}
            />
            <div className="row" style={{ marginTop: 8 }}>
              <span className="muted small">
                Sintaxis de <span className="code-inline">find()</span>: operadores como <span className="code-inline">$gte</span>, <span className="code-inline">$in</span>, <span className="code-inline">$regex</span>; campos anidados con punto (<span className="code-inline">"cliente.id"</span>).
              </span>
              <div className="spacer" />
              {query.filter && <button type="button" className="btn-ghost btn-sm" onClick={() => { setFilterText(''); setQuery((q) => ({ ...q, filter: '', page: 1 })); }}>Quitar</button>}
              <button type="button" className="btn-primary btn-sm" onClick={applyFilter}><Filter size={14} /> Aplicar</button>
            </div>
          </div>
        )}
      </div>

      {error && <Alert type="error">{error}</Alert>}
      {!data ? <Loading /> : data.documents.length === 0 ? (
        <div className="glass">
          <EmptyState icon={FileJson} title={query.q || query.filter ? 'Sin resultados' : 'La colección está vacía'}>
            {query.q || query.filter ? 'Prueba con otro término o filtro.' : 'Carga un JSON, BSON, Excel o envía documentos por la API para comenzar.'}
          </EmptyState>
        </div>
      ) : (
        <>
          {view === 'docs' ? (
            <div className="stack">
              {data.documents.map((doc) => (
                <div key={docId(doc)} className="glass doc-card">
                  <div className="row doc-card-head">
                    <span className="mono small">_id: <strong>{docId(doc)}</strong></span>
                    <div className="spacer" />
                    <span className="muted small">Actualizado {fmtDateTime(dateOf(doc._updated_at))}</span>
                    {actions(doc)}
                  </div>
                  <JsonView value={withoutSystem(doc)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="glass">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="sortable" onClick={() => sortBy('_id')}>_id <SortIcon field="_id" /></th>
                      {columns.map((c) => <th key={c} className="sortable" onClick={() => sortBy(c)}>{c} <SortIcon field={c} /></th>)}
                      <th className="sortable" onClick={() => sortBy('_updated_at')}>Actualizado <SortIcon field="_updated_at" /></th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.documents.map((doc) => (
                      <tr key={docId(doc)}>
                        <td className="mono small muted">{docId(doc)}</td>
                        {columns.map((c) => {
                          const text = summarize(doc[c]);
                          return text === null
                            ? <td key={c} className="null">—</td>
                            : <td key={c} title={text.length > 60 ? text : undefined}>{text.length > 80 ? `${text.slice(0, 80)}…` : text}</td>;
                        })}
                        <td className="nowrap muted small">{fmtDateTime(dateOf(doc._updated_at))}</td>
                        <td>{actions(doc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="glass card-pad row">
            <span className="muted small">Página {data.page} de {data.pages}</span>
            <div className="spacer" />
            {view === 'docs' && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => sortBy('_id')}>
                Orden: {query.sort} {query.order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              </button>
            )}
            <select value={query.limit} onChange={(e) => setQuery((q) => ({ ...q, limit: Number(e.target.value), page: 1 }))} style={{ width: 'auto' }}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} por página</option>)}
            </select>
            <button type="button" className="btn-secondary btn-sm" disabled={data.page <= 1} onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}><ChevronLeft size={14} /></button>
            <button type="button" className="btn-secondary btn-sm" disabled={data.page >= data.pages} onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}><ChevronRight size={14} /></button>
          </div>
        </>
      )}

      <Modal
        open={Boolean(editing)} title={`Editar documento ${editing?.id ?? ''}`} width={720} onClose={() => setEditing(null)}
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={saveEdit} disabled={saving}>{saving && <Spinner />} Guardar</button>
          </>
        )}
      >
        {editError && <div className="field"><Alert type="error">{editError}</Alert></div>}
        <p className="muted small" style={{ marginTop: 0 }}>
          Se reemplaza el documento completo; <span className="code-inline">_id</span> y las fechas de sistema se conservan.
          Tipos extendidos: <span className="code-inline">{'{"$date": "2024-01-31T00:00:00Z"}'}</span>, <span className="code-inline">{'{"$oid": "…"}'}</span>.
        </p>
        {editing && (
          <textarea
            className="mono" rows={18} spellCheck={false} value={editing.text} style={{ width: '100%', resize: 'vertical' }}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          />
        )}
      </Modal>
    </div>
  );
}
