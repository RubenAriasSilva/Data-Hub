import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Eraser, Key, X, Save } from 'lucide-react';
import { api } from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { Badge, Modal, Alert, Spinner, Loading } from '../../../components/ui';
import { FIELD_PATH_RE, parentPath } from '../../../utils/format';

const MAX_KEY_FIELDS = 5;

export default function MongoStructureTab({ table, onChanged }) {
  const navigate = useNavigate();
  const { toast, refreshCategories } = useApp();
  const [info, setInfo] = useState({ name: table.name, description: table.description ?? '', sheet_name: table.sheet_name ?? '' });
  const [savingInfo, setSavingInfo] = useState(false);
  const [keys, setKeys] = useState(table.key_fields);
  const [keyInput, setKeyInput] = useState('');
  const [savingKeys, setSavingKeys] = useState(false);
  const [fields, setFields] = useState(null);
  const [danger, setDanger] = useState(null); // 'truncate' | 'drop'
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/tables/${table.id}/fields`).then(setFields).catch((err) => { setFields([]); setError(err.message); });
  }, [table.id, table.row_count]);

  const keysChanged = keys.join('|') !== table.key_fields.join('|');
  const keyError = keyInput.trim() && !FIELD_PATH_RE.test(keyInput.trim())
    ? 'Usa letras, números y _ separados por punto (ej. cliente.id)' : null;

  const addKey = (k = keyInput.trim()) => {
    if (!k || !FIELD_PATH_RE.test(k) || keys.includes(k) || keys.length >= MAX_KEY_FIELDS) return;
    setKeys((ks) => [...ks, k]);
    setKeyInput('');
  };

  const saveInfo = async () => {
    setSavingInfo(true);
    try {
      await api.put(`/tables/${table.id}`, info);
      toast('Información actualizada');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingInfo(false);
    }
  };

  const saveKeys = async () => {
    setSavingKeys(true);
    setError(null);
    try {
      await api.put(`/tables/${table.id}/keys`, { key_fields: keys });
      toast('Campos clave actualizados');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingKeys(false);
    }
  };

  const doDanger = async () => {
    setBusy(true);
    setError(null);
    try {
      if (danger === 'truncate') {
        await api.del(`/tables/${table.id}/rows`);
        toast('Se eliminaron todos los documentos');
        setDanger(null);
        onChanged();
      } else {
        await api.del(`/tables/${table.id}`);
        toast('Colección eliminada');
        await refreshCategories();
        navigate(parentPath(table));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const keyCandidates = (fields ?? []).filter((f) => !f.types.includes('object') && !f.types.includes('array')
    && !['_created_at', '_updated_at'].includes(f.path) && !keys.includes(f.path) && f.path !== '_id');

  return (
    <div className="stack">
      <div className="glass card-pad">
        <p className="section-title">Información</p>
        <div className="grid grid-2" style={{ gap: '0 16px' }}>
          <div className="field">
            <label className="form-label">Nombre</label>
            <input value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} />
          </div>
          <div className="field">
            <label className="form-label">Hoja del Excel</label>
            <input value={info.sheet_name} placeholder="Vacío = primera hoja" onChange={(e) => setInfo({ ...info, sheet_name: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Descripción</label>
            <input value={info.description} onChange={(e) => setInfo({ ...info, description: e.target.value })} />
          </div>
        </div>
        <div className="row">
          <span className="muted small">Identificador <span className="code-inline">{table.slug}</span> · Colección MongoDB <span className="code-inline">{table.db_table}</span></span>
          <div className="spacer" />
          <button type="button" className="btn-primary btn-sm" onClick={saveInfo} disabled={savingInfo || !info.name.trim()}>
            {savingInfo && <Spinner />} Guardar
          </button>
        </div>
      </div>

      <div className="glass card-pad">
        <p className="section-title">Campos clave</p>
        <p className="muted small" style={{ marginTop: 0 }}>
          Identifican cada documento para actualizarlo al recargar (upsert). Al cambiarlos se reconstruye el índice único;
          si hay documentos repetidos para la clave nueva, el cambio se rechaza.
        </p>
        {error && <div className="field"><Alert type="error">{error}</Alert></div>}
        <div className="row">
          {keys.map((k) => (
            <span key={k} className="badge badge-blue mono">
              <Key size={10} /> {k}
              <button type="button" className="btn-ghost btn-icon" style={{ padding: 0, marginLeft: 2 }} title="Quitar" onClick={() => setKeys((ks) => ks.filter((x) => x !== k))}>
                <X size={12} />
              </button>
            </span>
          ))}
          {!keys.length && <span className="muted small">Sin campos clave: cada carga inserta documentos nuevos.</span>}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input
            className={`mono${keyError ? ' invalid' : ''}`} style={{ maxWidth: 280 }} value={keyInput} placeholder="codigo o cliente.id" list="mongo-key-candidates"
            onChange={(e) => setKeyInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKey(); } }}
          />
          <datalist id="mongo-key-candidates">
            {keyCandidates.map((f) => <option key={f.path} value={f.path} />)}
          </datalist>
          <button type="button" className="btn-secondary btn-sm" onClick={() => addKey()} disabled={!keyInput.trim() || Boolean(keyError) || keys.length >= MAX_KEY_FIELDS}>
            <Plus size={14} /> Agregar
          </button>
          <div className="spacer" />
          {keysChanged && <button type="button" className="btn-ghost btn-sm" onClick={() => setKeys(table.key_fields)}>Descartar</button>}
          <button type="button" className="btn-primary btn-sm" onClick={saveKeys} disabled={!keysChanged || savingKeys}>
            {savingKeys ? <Spinner /> : <Save size={14} />} Guardar claves
          </button>
        </div>
        {keyError && <div className="field-error">{keyError}</div>}
      </div>

      <div className="glass">
        <div className="card-pad" style={{ paddingBottom: 8 }}>
          <p className="section-title" style={{ margin: 0 }}>Campos detectados</p>
          <div className="muted small">Calculados sobre una muestra de hasta 200 documentos. MongoDB no exige estructura: cada documento puede tener campos distintos.</div>
        </div>
        {!fields ? <Loading /> : fields.length === 0 ? (
          <div className="card-pad muted small">La colección no tiene documentos.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Campo</th><th>Tipos</th><th className="num">Presente en</th><th /></tr></thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.path}>
                    <td className="mono small" style={{ paddingLeft: 16 + (f.path.split('.').length - 1) * 16 }}>
                      {keys.includes(f.path) && <Key size={11} style={{ color: 'var(--accent)', marginRight: 4 }} />}
                      {f.path}
                    </td>
                    <td><div className="row" style={{ gap: 4 }}>{f.types.map((t) => <Badge key={t} color="gray">{t}</Badge>)}</div></td>
                    <td className="num">{f.percent}%</td>
                    <td>{['_created_at', '_updated_at', '_id'].includes(f.path) && <Badge color="blue">Sistema</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="glass card-pad">
        <p className="section-title" style={{ color: 'var(--error)' }}>Zona de riesgo</p>
        <div className="row">
          <button type="button" className="btn-danger" onClick={() => { setConfirmText(''); setError(null); setDanger('truncate'); }}><Eraser size={15} /> Vaciar colección</button>
          <button type="button" className="btn-danger" onClick={() => { setConfirmText(''); setError(null); setDanger('drop'); }}><Trash2 size={15} /> Eliminar colección</button>
        </div>
      </div>

      <Modal
        open={Boolean(danger)} title={danger === 'drop' ? 'Eliminar colección' : 'Vaciar colección'} onClose={() => setDanger(null)}
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setDanger(null)}>Cancelar</button>
            <button type="button" className="btn-danger" onClick={doDanger} disabled={busy || confirmText !== table.slug}>
              {busy && <Spinner />} {danger === 'drop' ? 'Eliminar definitivamente' : 'Vaciar'}
            </button>
          </>
        )}
      >
        {error && <div className="field"><Alert type="error">{error}</Alert></div>}
        <Alert type="warning">
          {danger === 'drop'
            ? 'Se eliminará la colección MongoDB, todos sus documentos y su historial. Las aplicaciones que usen su API dejarán de funcionar.'
            : 'Se eliminarán todos los documentos. Los campos clave y el historial se conservan.'}
        </Alert>
        <div className="field" style={{ marginTop: 14 }}>
          <label className="form-label">Escribe <span className="code-inline">{table.slug}</span> para confirmar</label>
          <input className="mono" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
