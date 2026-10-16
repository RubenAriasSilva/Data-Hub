import { useEffect, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Trash2, Rows3 } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Loading, EmptyState, Alert, Badge } from '../../components/ui';
import { fmtNumber, fmtDateTime } from '../../utils/format';

function Cell({ value, type }) {
  if (value === null || value === undefined) return <td className="null">—</td>;
  if (type === 'boolean') return <td><Badge color={value ? 'green' : 'gray'}>{value ? 'Sí' : 'No'}</Badge></td>;
  if (type === 'int' || type === 'decimal') return <td className="num">{fmtNumber(value)}</td>;
  if (type === 'date' || type === 'datetime') return <td className="nowrap">{value}</td>;
  return <td title={String(value).length > 60 ? String(value) : undefined}>{String(value).length > 80 ? `${String(value).slice(0, 80)}…` : String(value)}</td>;
}

export default function DataTab({ table, version, onChanged }) {
  const { toast } = useApp();
  const [query, setQuery] = useState({ page: 1, limit: 50, sort: '_id', order: 'desc', q: '' });
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Búsqueda con retardo para no consultar en cada tecla
  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.q === search ? q : { ...q, q: search, page: 1 })), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '')).toString();
    api.get(`/tables/${table.id}/rows?${qs}`)
      .then((d) => { setData(d); setError(null); })
      .catch((err) => setError(err.message));
  }, [table.id, query, version]);

  const sortBy = (col) => setQuery((q) => ({
    ...q, sort: col, order: q.sort === col && q.order === 'asc' ? 'desc' : 'asc', page: 1,
  }));

  const removeRow = async (row) => {
    if (!window.confirm(`¿Eliminar la fila #${row._id}?`)) return;
    try {
      await api.del(`/tables/${table.id}/rows/${row._id}`);
      toast('Fila eliminada');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const SortIcon = ({ col }) => (query.sort === col ? (query.order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null);

  return (
    <div className="glass">
      <div className="card-pad row">
        <div style={{ position: 'relative', width: 320, maxWidth: '100%' }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--txt4)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar en todas las columnas…" style={{ paddingLeft: 34 }} />
        </div>
        <div className="spacer" />
        {data && <span className="muted small">{fmtNumber(data.total)} registros</span>}
      </div>

      {error && <div style={{ padding: '0 20px 20px' }}><Alert type="error">{error}</Alert></div>}
      {!data ? <Loading /> : data.rows.length === 0 ? (
        <EmptyState icon={Rows3} title={query.q ? 'Sin resultados' : 'La tabla está vacía'}>
          {query.q ? 'Prueba con otro término de búsqueda.' : 'Carga un Excel o envía datos por la API para comenzar.'}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="sortable num" onClick={() => sortBy('_id')}># <SortIcon col="_id" /></th>
                  {table.columns.map((c) => (
                    <th key={c.id} className={`sortable${c.data_type === 'int' || c.data_type === 'decimal' ? ' num' : ''}`} onClick={() => sortBy(c.db_name)} title={c.db_name}>
                      {c.excel_name} {c.is_key && <span style={{ color: 'var(--accent)' }}>●</span>} <SortIcon col={c.db_name} />
                    </th>
                  ))}
                  <th className="sortable" onClick={() => sortBy('_updated_at')}>Actualizado <SortIcon col="_updated_at" /></th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row._id}>
                    <td className="num muted">{row._id}</td>
                    {table.columns.map((c) => <Cell key={c.id} value={row[c.db_name]} type={c.data_type} />)}
                    <td className="nowrap muted small">{fmtDateTime(row._updated_at)}</td>
                    <td><button type="button" className="btn-ghost btn-icon" title="Eliminar fila" onClick={() => removeRow(row)}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-pad row">
            <span className="muted small">Página {data.page} de {data.pages}</span>
            <div className="spacer" />
            <select value={query.limit} onChange={(e) => setQuery((q) => ({ ...q, limit: Number(e.target.value), page: 1 }))} style={{ width: 'auto' }}>
              {[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n} por página</option>)}
            </select>
            <button type="button" className="btn-secondary btn-sm" disabled={data.page <= 1} onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}><ChevronLeft size={14} /></button>
            <button type="button" className="btn-secondary btn-sm" disabled={data.page >= data.pages} onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}><ChevronRight size={14} /></button>
          </div>
        </>
      )}
    </div>
  );
}
