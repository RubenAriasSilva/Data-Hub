import { useState } from 'react';
import { UploadCloud, Download, Key, FileSpreadsheet, Braces } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Alert, FileDropzone, Spinner, Badge } from '../../components/ui';
import { DATA_TYPES, sampleValue } from '../../utils/format';
import UploadResult from './UploadResult';

/** Ejemplo de 2 filas con los nombres en Excel de la tabla. */
const jsonExample = (columns) => JSON.stringify(
  { rows: [0, 1].map((i) => Object.fromEntries(columns.map((c) => [c.excel_name, sampleValue(c.data_type, i)]))) },
  null,
  2,
);

export default function UploadTab({ table, onUploaded }) {
  const { toast } = useApp();
  const [format, setFormat] = useState('excel'); // 'excel' | 'json'
  const [jsonMode, setJsonMode] = useState('file'); // 'file' | 'text'
  const [file, setFile] = useState(null);
  const [jsonText, setJsonText] = useState(() => jsonExample(table.columns));
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const reset = () => { setFile(null); setResult(null); setError(null); };
  const writing = format === 'json' && jsonMode === 'text';

  const upload = async () => {
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      let res;
      if (writing) {
        let body;
        try {
          body = JSON.parse(jsonText);
        } catch (err) {
          setError({ message: `JSON inválido: ${err.message}` });
          return;
        }
        res = await api.post(`/tables/${table.id}/json`, body);
      } else {
        const fd = new FormData();
        fd.append('file', file);
        res = await api.post(`/tables/${table.id}/upload`, fd);
        setFile(null);
      }
      setResult(res);
      toast(`Carga completada: ${res.inserted} nuevas, ${res.updated} actualizadas`, res.status === 'success' ? 'success' : 'info');
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

  const tab = (active, onClick, Icon, label) => (
    <button type="button" className={`tab${active ? ' active' : ''}`} onClick={onClick}>
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <div className="grid grid-side">
      <div className="stack">
        <div className="glass card-pad">
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="tabs" style={{ margin: 0 }}>
              {tab(format === 'excel', () => { setFormat('excel'); reset(); }, FileSpreadsheet, 'Excel')}
              {tab(format === 'json', () => { setFormat('json'); reset(); }, Braces, 'JSON')}
            </div>
            {format === 'json' && (
              <div className="tabs" style={{ margin: 0 }}>
                {tab(jsonMode === 'file', () => { setJsonMode('file'); reset(); }, UploadCloud, 'Archivo .json')}
                {tab(jsonMode === 'text', () => { setJsonMode('text'); reset(); }, Braces, 'Escribir JSON')}
              </div>
            )}
          </div>

          {format === 'excel' && <FileDropzone file={file} onFile={(f) => { reset(); setFile(f); }} />}
          {format === 'json' && jsonMode === 'file' && (
            <FileDropzone file={file} onFile={(f) => { reset(); setFile(f); }} accept=".json" hint="Formato: .json" />
          )}
          {writing && (
            <textarea
              className="mono" rows={14} spellCheck={false} value={jsonText} style={{ width: '100%', resize: 'vertical' }}
              onChange={(e) => { setJsonText(e.target.value); setResult(null); setError(null); }}
            />
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <span className="muted small">
              {format === 'excel'
                ? <>Hoja: <strong>{table.sheet_name || 'primera hoja'}</strong> · </>
                : <>Un arreglo <span className="code-inline">[ {'{…}'} ]</span> o <span className="code-inline">{'{ "rows": [ … ] }'}</span> · </>}
              Las filas con la misma clave se actualizan; las nuevas se insertan.
            </span>
            <div className="spacer" />
            <button type="button" className="btn-primary" disabled={(writing ? !jsonText.trim() : !file) || uploading} onClick={upload}>
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
          <p className="section-title" style={{ margin: 0 }}>{format === 'excel' ? 'Encabezados esperados' : 'Campos esperados'}</p>
          <div className="spacer" />
          {format === 'excel' && <a className="btn-ghost btn-sm" href={`/api/tables/${table.id}/template`}><Download size={14} /> Plantilla</a>}
        </div>
        <div>
          {table.columns.map((c) => (
            <div key={c.id} className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontWeight: 500 }}>
                {c.is_key && <Key size={12} style={{ color: 'var(--accent)', marginRight: 4 }} />}
                {c.excel_name}
                {!c.nullable && !c.is_key && <span style={{ color: 'var(--error)' }}> *</span>}
                {format === 'json' && <span className="mono muted small"> · {c.db_name}</span>}
              </span>
              <Badge color="gray">{DATA_TYPES[c.data_type]?.label}</Badge>
            </div>
          ))}
        </div>
        <div className="divider" />
        <div className="muted small">
          {format === 'excel'
            ? <>Los encabezados se comparan sin distinguir mayúsculas, acentos ni espacios extra. Fechas aceptadas: celdas de fecha de Excel, <span className="code-inline">AAAA-MM-DD</span> o <span className="code-inline">DD/MM/AAAA</span>.</>
            : <>Cada campo puede usar el nombre en Excel o el nombre en BD. Los campos que no existen en la tabla se ignoran y se avisa. Fechas como <span className="code-inline">AAAA-MM-DD</span> o <span className="code-inline">DD/MM/AAAA</span>.</>}
        </div>
      </div>
    </div>
  );
}
