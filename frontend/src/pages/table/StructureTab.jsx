import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Eraser, Key, FileCode2, Eye } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Modal, Alert, Spinner, CodeBlock } from '../../components/ui';
import { DATA_TYPES, IDENT_RE, slugify, fmtNumber, parentPath } from '../../utils/format';

export default function StructureTab({ table, onChanged }) {
  const navigate = useNavigate();
  const { toast, refreshCategories } = useApp();
  const [info, setInfo] = useState({ name: table.name, description: table.description ?? '', sheet_name: table.sheet_name ?? '' });
  const [savingInfo, setSavingInfo] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newCol, setNewCol] = useState({ excel_name: '', db_name: '', data_type: 'text', dbTouched: false });
  const [editCol, setEditCol] = useState(null);
  const [convErrors, setConvErrors] = useState([]);
  const [danger, setDanger] = useState(null); // 'truncate' | 'drop'
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [currentSql, setCurrentSql] = useState('');
  const [alterText, setAlterText] = useState('');
  const [preview, setPreview] = useState(null); // { plan, warnings } de la vista previa

  const run = async (fn, okMsg) => {
    setBusy(true);
    setError(null);
    setConvErrors([]);
    try {
      await fn();
      if (okMsg) toast(okMsg);
      return true;
    } catch (err) {
      setError(err.message);
      setConvErrors(err.data?.details?.errors ?? []);
      return false;
    } finally {
      setBusy(false);
    }
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

  const addColumn = async () => {
    const ok = await run(() => api.post(`/tables/${table.id}/columns`, newCol), 'Columna agregada');
    if (ok) {
      setAdding(false);
      setNewCol({ excel_name: '', db_name: '', data_type: 'text', dbTouched: false });
      onChanged();
    }
  };

  const original = editCol && table.columns.find((c) => c.id === editCol.id);
  const typeChanged = Boolean(original) && editCol.data_type !== original.data_type;
  const dbNameChanged = Boolean(original) && editCol.db_name !== original.db_name;

  const saveColumn = async () => {
    const { excel_name, db_name, data_type } = editCol;
    const ok = await run(() => api.put(`/tables/${table.id}/columns/${editCol.id}`, { excel_name, db_name, data_type }), 'Columna actualizada');
    if (ok) {
      setEditCol(null);
      onChanged();
    }
  };

  const doDanger = async () => {
    if (danger === 'truncate') {
      const ok = await run(() => api.del(`/tables/${table.id}/rows`), 'Se eliminaron todos los registros');
      if (ok) { setDanger(null); onChanged(); }
    } else {
      const ok = await run(() => api.del(`/tables/${table.id}`), 'Tabla eliminada');
      if (ok) {
        await refreshCategories();
        navigate(parentPath(table));
      }
    }
  };

  const openModal = (setter) => { setError(null); setConvErrors([]); setter(); };

  // Modo SQL: ALTER TABLE validado por el backend; primero vista previa, luego aplicar
  const openSql = () => openModal(async () => {
    setPreview(null);
    setAlterText(`ALTER TABLE ${table.slug}\n  ADD COLUMN nueva_columna VARCHAR(255) COMMENT 'Nueva columna';`);
    setSqlOpen(true);
    try {
      setCurrentSql((await api.get(`/tables/${table.id}/sql`)).sql);
    } catch (err) {
      setCurrentSql(`-- ${err.message}`);
    }
  });

  const previewSql = () => run(async () => {
    setPreview(await api.post(`/tables/${table.id}/sql`, { sql: alterText, dryRun: true }));
  });

  const applySql = async () => {
    let result = null;
    const ok = await run(async () => {
      result = await api.post(`/tables/${table.id}/sql`, { sql: alterText });
    });
    if (ok) {
      toast(result.applied ? `${result.applied} cambio(s) aplicado(s)` : 'El SQL no generó cambios', result.applied ? 'success' : 'info');
      setSqlOpen(false);
    }
    // Aunque falle un paso, los anteriores pueden haberse aplicado: se recarga igual
    onChanged();
  };

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
          <span className="muted small">Identificador <span className="code-inline">{table.slug}</span> · Tabla MySQL <span className="code-inline">{table.db_table}</span></span>
          <div className="spacer" />
          <button type="button" className="btn-primary btn-sm" onClick={saveInfo} disabled={savingInfo || !info.name.trim()}>
            {savingInfo && <Spinner />} Guardar
          </button>
        </div>
      </div>

      <div className="glass">
        <div className="card-pad row" style={{ paddingBottom: 8 }}>
          <p className="section-title" style={{ margin: 0 }}>Columnas</p>
          <div className="spacer" />
          <button type="button" className="btn-ghost btn-sm" onClick={openSql}><FileCode2 size={14} /> Editar con SQL</button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => openModal(() => setAdding(true))}><Plus size={14} /> Agregar columna</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th className="num">#</th><th>Nombre en Excel</th><th>Nombre en BD</th><th>Tipo</th><th>Tipo SQL</th><th>Atributos</th><th /></tr></thead>
            <tbody>
              {table.columns.map((c, i) => (
                <tr key={c.id}>
                  <td className="num muted">{i + 1}</td>
                  <td style={{ fontWeight: 500 }}>{c.excel_name}</td>
                  <td className="mono small">{c.db_name}</td>
                  <td>{DATA_TYPES[c.data_type]?.label}</td>
                  <td className="mono small muted">{DATA_TYPES[c.data_type]?.sql}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {c.is_key && <Badge color="blue"><Key size={10} /> Clave</Badge>}
                      {c.nullable ? <Badge color="gray">Opcional</Badge> : <Badge color="orange">Obligatorio</Badge>}
                    </div>
                  </td>
                  <td>
                    <button type="button" className="btn-ghost btn-icon" title="Editar columna" onClick={() => openModal(() => setEditCol({ ...c }))}>
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-pad muted small">
          Además se generan <span className="code-inline">_id</span>, <span className="code-inline">_created_at</span> y <span className="code-inline">_updated_at</span>.
          Al cambiar el tipo, los datos existentes se convierten; si algún valor no es compatible, no se modifica nada.
        </div>
      </div>

      <div className="glass card-pad">
        <p className="section-title" style={{ color: 'var(--error)' }}>Zona de riesgo</p>
        <div className="row">
          <button type="button" className="btn-danger" onClick={() => openModal(() => { setConfirmText(''); setDanger('truncate'); })}><Eraser size={15} /> Vaciar tabla</button>
          <button type="button" className="btn-danger" onClick={() => openModal(() => { setConfirmText(''); setDanger('drop'); })}><Trash2 size={15} /> Eliminar tabla</button>
        </div>
      </div>

      <Modal
        open={adding} title="Agregar columna" onClose={() => setAdding(false)}
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={addColumn} disabled={busy || !newCol.excel_name.trim() || !IDENT_RE.test(newCol.db_name)}>
              {busy && <Spinner />} Agregar
            </button>
          </>
        )}
      >
        {error && <div className="field"><Alert type="error">{error}</Alert></div>}
        <div className="field">
          <label className="form-label">Nombre en Excel</label>
          <input
            value={newCol.excel_name} autoFocus
            onChange={(e) => setNewCol((c) => ({ ...c, excel_name: e.target.value, db_name: c.dbTouched ? c.db_name : slugify(e.target.value) }))}
          />
        </div>
        <div className="field">
          <label className="form-label">Nombre en BD</label>
          <input
            className={`mono${newCol.db_name && !IDENT_RE.test(newCol.db_name) ? ' invalid' : ''}`} value={newCol.db_name}
            onChange={(e) => setNewCol((c) => ({ ...c, db_name: e.target.value, dbTouched: true }))}
          />
        </div>
        <div className="field">
          <label className="form-label">Tipo</label>
          <select value={newCol.data_type} onChange={(e) => setNewCol((c) => ({ ...c, data_type: e.target.value }))}>
            {Object.entries(DATA_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </select>
        </div>
        <div className="field-hint">Las columnas nuevas son opcionales (las filas existentes quedan vacías) y no pueden ser clave.</div>
      </Modal>

      <Modal
        open={Boolean(editCol)} title="Editar columna" onClose={() => setEditCol(null)}
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditCol(null)}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={saveColumn} disabled={busy || !editCol?.excel_name.trim() || !IDENT_RE.test(editCol?.db_name ?? '')}>
              {busy && <Spinner />} Guardar
            </button>
          </>
        )}
      >
        {error && <div className="field"><Alert type="error">{error}</Alert></div>}
        {editCol && (
          <>
            <div className="field">
              <label className="form-label">Nombre en Excel</label>
              <input value={editCol.excel_name} autoFocus onChange={(e) => setEditCol({ ...editCol, excel_name: e.target.value })} />
            </div>
            <div className="field">
              <label className="form-label">Nombre en BD</label>
              <input
                className={`mono${IDENT_RE.test(editCol.db_name) ? '' : ' invalid'}`} value={editCol.db_name}
                onChange={(e) => setEditCol({ ...editCol, db_name: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="form-label">Tipo</label>
              <select value={editCol.data_type} onChange={(e) => setEditCol({ ...editCol, data_type: e.target.value })}>
                {Object.entries(DATA_TYPES)
                  .filter(([k]) => !(editCol.is_key && k === 'longtext'))
                  .map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
              </select>
            </div>
            {(dbNameChanged || typeChanged) && (
              <Alert type="warning">
                {dbNameChanged && <>Las aplicaciones que lean la API en JSON verán el campo como <span className="code-inline">{editCol.db_name}</span> en lugar de <span className="code-inline">{original.db_name}</span>. </>}
                {typeChanged && <>Los {fmtNumber(table.row_count)} registros se convertirán de {DATA_TYPES[original.data_type]?.label} a {DATA_TYPES[editCol.data_type]?.label}; si algún valor no es compatible, no se cambia nada.</>}
              </Alert>
            )}
            {convErrors.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 12, maxHeight: 220 }}>
                <table>
                  <thead><tr><th className="num">_id</th><th>Valor</th><th>Problema</th></tr></thead>
                  <tbody>
                    {convErrors.map((e) => (
                      <tr key={e._id}><td className="num muted">{e._id}</td><td className="mono small">{String(e.value)}</td><td className="small">{e.message}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal
        open={sqlOpen} title="Editar con SQL" width={760} onClose={() => setSqlOpen(false)}
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setSqlOpen(false)}>Cancelar</button>
            <button type="button" className="btn-secondary" onClick={previewSql} disabled={busy || !alterText.trim()}>
              <Eye size={15} /> Vista previa
            </button>
            <button type="button" className="btn-primary" onClick={applySql} disabled={busy || !preview?.plan.length}>
              {busy && <Spinner />} Aplicar
            </button>
          </>
        )}
      >
        <p className="form-label">Estructura actual</p>
        <div style={{ maxHeight: 180, overflow: 'auto', marginBottom: 14 }}><CodeBlock>{currentSql || '…'}</CodeBlock></div>
        <label className="form-label">ALTER TABLE</label>
        <textarea
          className="mono" rows={7} spellCheck={false} value={alterText} style={{ width: '100%', resize: 'vertical' }}
          onChange={(e) => { setAlterText(e.target.value); setPreview(null); }}
        />
        <div className="field-hint" style={{ marginBottom: 12 }}>
          Admite <span className="code-inline">ADD COLUMN</span>, <span className="code-inline">MODIFY COLUMN</span>, <span className="code-inline">CHANGE COLUMN</span>,
          {' '}<span className="code-inline">RENAME COLUMN … TO …</span> y <span className="code-inline">DROP COLUMN</span>, separadas por comas o en varias sentencias.
          {' '}<span className="code-inline">COMMENT '…'</span> cambia el nombre en Excel. Al cambiar el tipo se convierten los datos. Usa “Vista previa” antes de aplicar.
        </div>
        {error && <div className="field"><Alert type="error">{error}</Alert></div>}
        {preview && (
          <div className="stack" style={{ gap: 8 }}>
            {preview.plan.length > 0 && (
              <Alert type="info">
                <strong>Se aplicará:</strong>
                <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>{preview.plan.map((p) => <li key={p}>{p}</li>)}</ol>
              </Alert>
            )}
            {preview.warnings.map((w) => <Alert key={w} type="warning">{w}</Alert>)}
          </div>
        )}
        {convErrors.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12, maxHeight: 220 }}>
            <table>
              <thead><tr><th className="num">_id</th><th>Valor</th><th>Problema</th></tr></thead>
              <tbody>
                {convErrors.map((e) => (
                  <tr key={e._id}><td className="num muted">{e._id}</td><td className="mono small">{String(e.value)}</td><td className="small">{e.message}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(danger)} title={danger === 'drop' ? 'Eliminar tabla' : 'Vaciar tabla'} onClose={() => setDanger(null)}
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
            ? 'Se eliminará la tabla MySQL, su estructura, todos sus registros y su historial. Las aplicaciones que usen su API dejarán de funcionar.'
            : 'Se eliminarán todos los registros. La estructura y el historial se conservan.'}
        </Alert>
        <div className="field" style={{ marginTop: 14 }}>
          <label className="form-label">Escribe <span className="code-inline">{table.slug}</span> para confirmar</label>
          <input className="mono" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
