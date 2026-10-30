import { Alert, Badge } from '../../components/ui';
import { fmtNumber, STATUS } from '../../utils/format';

/** Resultado de una carga (Excel o API): métricas, avisos y errores por fila. */
/** mongo: textos de documentos/campos en lugar de filas/columnas. */
export default function UploadResult({ result, mongo = false }) {
  const status = STATUS[result.status] ?? STATUS.error;
  const errors = result.errors ?? [];
  const errorCount = result.error_count ?? errors.length;
  return (
    <div className="stack">
      <div className="row">
        <Badge color={status.color}>{status.label}</Badge>
        {result.duration_ms !== undefined && <span className="muted small">{fmtNumber(result.duration_ms)} ms</span>}
      </div>
      {(result.total !== undefined || result.rows_total !== undefined) && (
        <div className="grid grid-metrics">
          {[
            [mongo ? 'Documentos leídos' : 'Filas leídas', result.total ?? result.rows_total],
            [mongo ? 'Insertados' : 'Insertadas', result.inserted],
            [mongo ? 'Actualizados' : 'Actualizadas', result.updated],
            [mongo ? 'Rechazados' : 'Rechazadas', result.failed],
          ].map(([label, value]) => (
            <div key={label} className="glass metric-card" style={{ padding: '14px 16px' }}>
              <div className="metric-value" style={{ fontSize: '1.4rem' }}>{fmtNumber(value)}</div>
              <div className="metric-label">{label}</div>
            </div>
          ))}
        </div>
      )}
      {result.db_error && (
        <Alert type="error">
          {mongo ? 'Error de MongoDB (la carga se detuvo en ese documento)' : 'Error de base de datos (no se guardó ninguna fila)'}: {result.db_error}
        </Alert>
      )}
      {result.warnings?.map((w) => <Alert key={w} type="warning">{w}</Alert>)}
      {errors.length > 0 && (
        <div className="glass">
          <div className="card-pad" style={{ paddingBottom: 8 }}>
            <p className="section-title" style={{ margin: 0 }}>
              Errores ({fmtNumber(errorCount)}{errorCount > errors.length ? `, mostrando ${errors.length}` : ''})
            </p>
          </div>
          <div className="table-wrap" style={{ maxHeight: 360 }}>
            <table>
              <thead><tr><th className="num">{mongo ? 'Documento' : 'Fila'}</th><th>{mongo ? 'Campo' : 'Columna'}</th><th>Valor</th><th>Problema</th></tr></thead>
              <tbody>
                {errors.map((e, i) => (
                  <tr key={i}>
                    <td className="num">{e.row}</td>
                    <td>{e.column ?? '—'}</td>
                    <td className="mono small">{e.value === null || e.value === undefined ? '—' : String(e.value)}</td>
                    <td style={{ color: 'var(--error)' }}>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
