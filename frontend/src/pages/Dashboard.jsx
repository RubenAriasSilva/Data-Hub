import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderTree, Table2, Rows3, UploadCloud, History } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Loading, EmptyState } from '../components/ui';
import { fmtNumber, fmtDateTime, STATUS, SOURCES, tablePath } from '../utils/format';

function Metric({ icon: Icon, label, value, sub }) {
  return (
    <div className="glass metric-card animate-in">
      <div className="metric-icon"><Icon size={18} /></div>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { health } = useApp();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const ready = health?.db?.ready;

  useEffect(() => {
    if (ready) api.get('/stats').then(setStats).catch(() => setStats(null));
  }, [ready]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Resumen de la información administrada en el Data Hub</p>
        </div>
      </div>

      {!stats ? (ready ? <Loading /> : null) : (
        <div className="stack">
          <div className="grid grid-metrics">
            <Metric icon={FolderTree} label="Categorías" value={fmtNumber(stats.categories)} />
            <Metric icon={Table2} label="Tablas" value={fmtNumber(stats.tables)} />
            <Metric icon={Rows3} label="Registros" value={fmtNumber(stats.rows)} />
            <Metric
              icon={UploadCloud} label="Cargas hoy" value={fmtNumber(stats.today.uploads)}
              sub={`${fmtNumber(stats.today.inserted)} nuevas · ${fmtNumber(stats.today.updated)} actualizadas`}
            />
          </div>

          <div className="grid grid-2">
            <div className="glass">
              <div className="card-pad" style={{ paddingBottom: 8 }}><p className="section-title">Últimas cargas</p></div>
              {stats.recent.length === 0 ? (
                <EmptyState icon={History} title="Sin cargas todavía">Sube un Excel o envía datos por la API.</EmptyState>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Tabla</th><th>Origen</th><th className="num">Filas</th><th>Estado</th><th>Fecha</th></tr></thead>
                    <tbody>
                      {stats.recent.map((u) => (
                        <tr key={u.id} className="clickable" onClick={() => navigate(`${tablePath(u)}?tab=history`)}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{u.table_name}</div>
                            <div className="muted small">{u.category_name}{u.application_name ? ` · ${u.application_name}` : ''}</div>
                          </td>
                          <td><Badge color={SOURCES[u.source]?.color ?? 'gray'}>{SOURCES[u.source]?.label ?? u.source}</Badge></td>
                          <td className="num">{fmtNumber(u.rows_total)}</td>
                          <td><Badge color={STATUS[u.status]?.color}>{STATUS[u.status]?.label ?? u.status}</Badge></td>
                          <td className="nowrap muted small">{fmtDateTime(u.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="glass">
              <div className="card-pad" style={{ paddingBottom: 8 }}><p className="section-title">Tablas con más registros</p></div>
              {stats.top_tables.length === 0 ? (
                <EmptyState icon={Table2} title="Aún no hay tablas">Crea la primera desde una categoría del menú.</EmptyState>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Tabla</th><th>Categoría</th><th className="num">Registros</th></tr></thead>
                    <tbody>
                      {stats.top_tables.map((t) => (
                        <tr key={t.id}>
                          <td><Link to={tablePath(t)} style={{ fontWeight: 600 }}>{t.name}</Link></td>
                          <td className="muted">{t.category_name}{t.application_name ? ` · ${t.application_name}` : ''}</td>
                          <td className="num">{fmtNumber(t.row_count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
