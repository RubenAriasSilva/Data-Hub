import { useState } from 'react';
import { UploadCloud, Download, Key } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Alert, FileDropzone, Spinner, Badge } from '../../components/ui';
import { DATA_TYPES } from '../../utils/format';
import UploadResult from './UploadResult';

export default function UploadTab({ table, onUploaded }) {
  const { toast } = useApp();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const upload = async () => {
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post(`/tables/${table.id}/upload`, fd);
      setResult(res);
      toast(`Carga completada: ${res.inserted} nuevas, ${res.updated} actualizadas`, res.status === 'success' ? 'success' : 'info');
      setFile(null);
      onUploaded();
    } catch (err) {
      // 422 trae el resultado detallado de la carga fallida
      if (err.data?.status) {
        setResult(err.data);
        onUploaded();
      } else setError({ message: err.message, details: err.data?.details });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid grid-side">
      <div className="stack">
        <div className="glass card-pad">
          <p className="section-title">Archivo</p>
          <FileDropzone file={file} onFile={(f) => { setFile(f); setResult(null); setError(null); }} />
          <div className="row" style={{ marginTop: 14 }}>
            <span className="muted small">
              Hoja: <strong>{table.sheet_name || 'primera hoja'}</strong> · Las filas con la misma clave se actualizan; las nuevas se insertan.
            </span>
            <div className="spacer" />
            <button type="button" className="btn-primary" disabled={!file || uploading} onClick={upload}>
              {uploading ? <Spinner /> : <UploadCloud size={16} />} {uploading ? 'Procesando…' : 'Cargar'}
            </button>
          </div>
        </div>
        {error && (
          <Alert type="error">
            {error.message}
            {error.details?.headers && <div className="small" style={{ marginTop: 6 }}>Encabezados encontrados: {error.details.headers.join(', ')}</div>}
          </Alert>
        )}
        {result && <UploadResult result={result} />}
      </div>

      <div className="glass card-pad">
        <div className="row" style={{ marginBottom: 12 }}>
          <p className="section-title" style={{ margin: 0 }}>Encabezados esperados</p>
          <div className="spacer" />
          <a className="btn-ghost btn-sm" href={`/api/tables/${table.id}/template`}><Download size={14} /> Plantilla</a>
        </div>
        <div>
          {table.columns.map((c) => (
            <div key={c.id} className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontWeight: 500 }}>
                {c.is_key && <Key size={12} style={{ color: 'var(--accent)', marginRight: 4 }} />}
                {c.excel_name}
                {!c.nullable && !c.is_key && <span style={{ color: 'var(--error)' }}> *</span>}
              </span>
              <Badge color="gray">{DATA_TYPES[c.data_type]?.label}</Badge>
            </div>
          ))}
        </div>
        <div className="divider" />
        <div className="muted small">
          Los encabezados se comparan sin distinguir mayúsculas, acentos ni espacios extra. Fechas aceptadas: celdas de fecha de Excel, <span className="code-inline">AAAA-MM-DD</span> o <span className="code-inline">DD/MM/AAAA</span>.
        </div>
      </div>
    </div>
  );
}
