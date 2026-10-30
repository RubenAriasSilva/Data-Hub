import { useNavigate } from 'react-router-dom';
import { Table2 } from 'lucide-react';
import { Badge } from './ui';
import { fmtNumber, fmtRelative, STATUS, tablePath, engineOf, isMongo } from '../utils/format';

/** Cuadrícula de tarjetas de tablas (de una categoría o de una aplicación). */
export default function TableCards({ tables }) {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cards">
      {tables.map((t) => (
        <div key={t.id} className="glass clickable table-card animate-in" onClick={() => navigate(tablePath(t))}>
          <div className="table-card-head">
            <div className="table-card-icon"><Table2 size={18} /></div>
            <div style={{ minWidth: 0 }}>
              <div className="table-card-name">{t.name}</div>
            </div>
          </div>
          {t.description && <div className="muted small">{t.description}</div>}
          <div className="table-card-meta">
            <span><strong>{fmtNumber(t.row_count)}</strong> {engineOf(t).records}</span>
            {isMongo(t)
              ? <span><strong>{t.key_fields?.length || 0}</strong> claves</span>
              : <span><strong>{t.column_count}</strong> columnas</span>}
          </div>
          <div className="row">
            <Badge color={engineOf(t).color}>{engineOf(t).label}</Badge>
            {t.last_upload_status
              ? <Badge color={STATUS[t.last_upload_status]?.color}>{STATUS[t.last_upload_status]?.label}</Badge>
              : <Badge color="gray">Sin cargas</Badge>}
            <span className="muted small">{fmtRelative(t.last_upload_at)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
