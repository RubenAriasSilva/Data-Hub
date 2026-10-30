import { useEffect, useState } from 'react';
import { UploadCloud, Key, FileSpreadsheet, Braces, Binary } from 'lucide-react';
import { api } from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { Alert, FileDropzone, Spinner, Badge } from '../../../components/ui';
import UploadResult from '../UploadResult';

const FORMATS = {
  json: { label: 'JSON', icon: Braces, accept: '.json,.ndjson,.jsonl', hint: 'Formatos: .json (arreglo o documento), .ndjson / .jsonl (un documento por línea)' },
  bson: { label: 'BSON', icon: Binary, accept: '.bson', hint: 'Formato: .bson (p. ej. la salida de mongodump)' },
  excel: { label: 'Excel / CSV', icon: FileSpreadsheet, accept: '.xlsx,.xls,.csv', hint: 'Formatos: .xlsx, .xls, .csv' },
};

/** Ejemplo con los campos clave de la colección. */
function jsonExample(keys) {
  const base = (i) => {
    const doc = {};
    for (const k of keys.filter((x) => x !== '_id')) {
      const parts = k.split('.');
      let node = doc;
      parts.slice(0, -1).forEach((p) => { node[p] = node[p] ?? {}; node = node[p]; });
      node[parts.at(-1)] = 1000 + i;
    }
    return {
      ...doc,
      nombre: `ejemplo_${i + 1}`,
      cliente: { ...(doc.cliente ?? {}), nombre: 'Ana', ciudad: 'Guadalajara' },
      etiquetas: ['nuevo', 'web'],
      fecha: { $date: '2024-05-15T08:30:00Z' },
    };
  };
  return JSON.stringify({ documents: [base(0), base(1)] }, null, 2);
}

export default function MongoUploadTab({ table, onUploaded }) {
  const { toast } = useApp();
  const [format, setFormat] = useState('json');
  const [jsonMode, setJsonMode] = useState('file'); // 'file' | 'text'
  const [file, setFile] = useState(null);
  const [jsonText, setJsonText] = useState(() => jsonExample(table.key_fields));
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState([]);

  useEffect(() => {
    api.get(`/tables/${table.id}/fields`).then(setFields).catch(() => setFields([]));
  }, [table.id, result]);

  const reset = () => { setFile(null); setResult(null); setError(null); };
  const writing = format === 'json' && jsonMode === 'text';
  const keys = table.key_fields;

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
          setError(`JSON inválido: ${err.message}`);
          return;
        }
        res = await api.post(`/tables/${table.id}/documents`, body);
      } else {
        const fd = new FormData();
        fd.append('file', file);
        res = await api.post(`/tables/${table.id}/upload`, fd);
        setFile(null);
      }
      setResult(res);
      toast(`Carga completada: ${res.inserted} nuevos, ${res.updated} actualizados`, res.status === 'success' ? 'success' : 'info');
      onUploaded();
    } catch (err) {
      // 422 trae el resultado detallado de la carga fallida
      if (err.data?.status) {
        setResult(err.data);
        onUploaded();
      } else setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const tab = (active, onClick, Icon, label) => (
    <button key={label} type="button" className={`tab${active ? ' active' : ''}`} onClick={onClick}>
      <Icon size={15} /> {label}
    </button>
  );
  const userFields = fields.filter((f) => !['_id', '_created_at', '_updated_at'].includes(f.path));

  return (
    <div className="grid grid-side">
      <div className="stack">
        <div className="glass card-pad">
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="tabs" style={{ margin: 0 }}>
              {Object.entries(FORMATS).map(([id, f]) => tab(format === id, () => { setFormat(id); reset(); }, f.icon, f.label))}
            </div>
            {format === 'json' && (
              <div className="tabs" style={{ margin: 0 }}>
                {tab(jsonMode === 'file', () => { setJsonMode('file'); reset(); }, UploadCloud, 'Archivo')}
                {tab(jsonMode === 'text', () => { setJsonMode('text'); reset(); }, Braces, 'Escribir JSON')}
              </div>
            )}
          </div>

          {!writing && (
            <FileDropzone
              key={format} file={file} onFile={(f) => { reset(); setFile(f); }}
              accept={FORMATS[format].accept} hint={FORMATS[format].hint}
            />
          )}
          {writing && (
            <textarea
              className="mono" rows={16} spellCheck={false} value={jsonText} style={{ width: '100%', resize: 'vertical' }}
              onChange={(e) => { setJsonText(e.target.value); setResult(null); setError(null); }}
            />
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <span className="muted small">
              {format === 'excel' && <>Hoja: <strong>{table.sheet_name || 'primera hoja'}</strong> (en CSV se ignora) · </>}
              {keys.length
                ? 'Los documentos con la misma clave se actualizan; los nuevos se insertan.'
                : 'Sin campos clave: todos los documentos se insertan como nuevos.'}
            </span>
            <div className="spacer" />
            <button type="button" className="btn-primary" disabled={(writing ? !jsonText.trim() : !file) || uploading} onClick={upload}>
              {uploading ? <Spinner /> : <UploadCloud size={16} />} {uploading ? 'Procesando…' : 'Cargar'}
            </button>
          </div>
        </div>
        {error && <Alert type="error">{error}</Alert>}
        {result && <UploadResult result={result} />}
      </div>

      <div className="glass card-pad">
        <p className="section-title">Campos clave</p>
        {keys.length ? keys.map((k) => (
          <div key={k} className="row" style={{ marginTop: 6 }}>
            <Key size={12} style={{ color: 'var(--accent)' }} /> <span className="mono">{k}</span>
          </div>
        )) : <div className="muted small">Ninguno (solo inserción). Se configuran en Estructura.</div>}

        <div className="divider" />
        <p className="section-title">Campos detectados</p>
        {userFields.length ? (
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {userFields.map((f) => (
              <div key={f.path} className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                <span className="mono small">{f.path}</span>
                <Badge color="gray">{f.types.join(' | ')}</Badge>
              </div>
            ))}
          </div>
        ) : <div className="muted small">La colección aún no tiene documentos: acepta cualquier estructura.</div>}

        <div className="divider" />
        <div className="muted small">
          {format === 'json' && <>Un documento, un arreglo <span className="code-inline">[ {'{…}'} ]</span> o <span className="code-inline">{'{ "documents": [ … ] }'}</span>. En <span className="code-inline">.ndjson</span>, un documento por línea. Se aceptan tipos extendidos de MongoDB: <span className="code-inline">{'{"$date": …}'}</span>, <span className="code-inline">{'{"$oid": …}'}</span>.</>}
          {format === 'bson' && <>Documentos BSON concatenados, como los que genera <span className="code-inline">mongodump</span> (<span className="code-inline">coleccion.bson</span>). Se conservan los tipos originales (ObjectId, fechas, decimales).</>}
          {format === 'excel' && <>Cada fila es un documento. Un encabezado con punto como <span className="code-inline">cliente.nombre</span> crea un objeto anidado. Las celdas vacías no generan campo. En CSV los números y <span className="code-inline">true/false</span> se detectan solos (los códigos con ceros a la izquierda quedan como texto).</>}
        </div>
      </div>
    </div>
  );
}
