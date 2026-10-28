import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Rows3, UploadCloud, Columns3, PlugZap, History, Download } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Alert, Badge, Loading } from '../components/ui';
import { fmtNumber } from '../utils/format';
import DataTab from './table/DataTab';
import UploadTab from './table/UploadTab';
import StructureTab from './table/StructureTab';
import ApiTab from './table/ApiTab';
import HistoryTab from './table/HistoryTab';

const TABS = [
  { id: 'data', label: 'Datos', icon: Rows3 },
  { id: 'upload', label: 'Cargar datos', icon: UploadCloud },
  { id: 'structure', label: 'Estructura', icon: Columns3 },
  { id: 'api', label: 'API', icon: PlugZap },
  { id: 'history', label: 'Historial', icon: History },
];

export default function TableDetailPage() {
  const { categorySlug, appSlug, tableSlug } = useParams();
  const [params, setParams] = useSearchParams();
  const { health } = useApp();
  const [table, setTable] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0); // fuerza recarga de pestañas tras cambios
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'data';
  const ready = health?.db?.ready;

  const load = useCallback(async () => {
    try {
      setTable(await api.get(`/categories/${categorySlug}${appSlug ? `/apps/${appSlug}` : ''}/tables/${tableSlug}`));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [categorySlug, appSlug, tableSlug]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const changed = useCallback(() => {
    load();
    setVersion((v) => v + 1);
  }, [load]);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!table) return ready ? <Loading /> : null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{table.name}</h1>
          <p className="page-subtitle">{table.description || `Tabla de ${table.application_name ?? table.category_name}`}</p>
          <div className="row" style={{ marginTop: 10 }}>
            <Badge color="blue">{fmtNumber(table.row_count)} registros</Badge>
            <Badge color="gray">{table.columns.length} columnas</Badge>
            <span className="code-inline">{table.db_table}</span>
          </div>
        </div>
        <div className="row">
          <a className="btn-secondary" href={`/api/tables/${table.id}/export`}><Download size={16} /> Exportar Excel</a>
          <button type="button" className="btn-primary" onClick={() => setParams({ tab: 'upload' })}><UploadCloud size={16} /> Cargar datos</button>
        </div>
      </div>

      <div className="glass tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={`tab${tab === id ? ' active' : ''}`} onClick={() => setParams({ tab: id })}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div className="animate-in" key={tab}>
        {tab === 'data' && <DataTab table={table} version={version} onChanged={changed} />}
        {tab === 'upload' && <UploadTab table={table} onUploaded={changed} />}
        {tab === 'structure' && <StructureTab table={table} onChanged={changed} />}
        {tab === 'api' && <ApiTab table={table} />}
        {tab === 'history' && <HistoryTab table={table} version={version} />}
      </div>
    </>
  );
}
