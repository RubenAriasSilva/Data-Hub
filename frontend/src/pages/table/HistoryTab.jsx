import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Loading, EmptyState, Alert, Modal } from '../../components/ui';
import { fmtNumber, fmtDateTime, STATUS, SOURCES, isMongo } from '../../utils/format';
import UploadResult from './UploadResult';

export default function HistoryTab({ table, version }) {
  const mongo = isMongo(table);
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.get(`/tables/${table.id}/uploads?limit=200`).then(setLogs).catch((err) => setError(err.message));
  }, [table.id, version]);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!logs) return <Loading />;

  return (
    <div className="glass">
      {logs.length === 0 ? (
        <EmptyState icon={History} title="Sin cargas registradas">Cada carga por Excel o API queda registrada aquí.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Origen</th><th>Archivo</th><th className="num">{mongo ? 'Documentos' : 'Filas'}</th><th className="num">{mongo ? 'Insertados' : 'Insertadas'}</th>
                <th className="num">{mongo ? 'Actualizados' : 'Actualizadas'}</th><th className="num">{mongo ? 'Rechazados' : 'Rechazadas'}</th><th>Estado</th><th className="num">Duración</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="clickable" onClick={() => setSelected(l)}>
                  <td className="nowrap">{fmtDateTime(l.created_at)}</td>
                  <td><Badge color={SOURCES[l.source]?.color ?? 'gray'}>{SOURCES[l.source]?.label ?? l.source}</Badge></td>
                  <td className="small">{l.filename ?? '—'}</td>
                  <td className="num">{fmtNumber(l.rows_total)}</td>
                  <td className="num" style={{ color: 'var(--success)' }}>{fmtNumber(l.inserted)}</td>
                  <td className="num" style={{ color: 'var(--accent)' }}>{fmtNumber(l.updated)}</td>
                  <td className="num" style={{ color: l.failed ? 'var(--error)' : undefined }}>{fmtNumber(l.failed)}</td>
                  <td><Badge color={STATUS[l.status]?.color}>{STATUS[l.status]?.label ?? l.status}</Badge></td>
                  <td className="num muted small">{fmtNumber(l.duration_ms)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={Boolean(selected)} title={`Carga #${selected?.id ?? ''}`} onClose={() => setSelected(null)} width={820}>
        {selected && (
          <UploadResult
            mongo={mongo}
            result={{
              ...selected,
              errors: selected.details?.errors,
              error_count: selected.details?.error_count,
              warnings: selected.details?.warnings,
              db_error: selected.details?.db_error,
            }}
          />
        )}
      </Modal>
    </div>
  );
}
