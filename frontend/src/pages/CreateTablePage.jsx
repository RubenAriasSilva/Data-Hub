import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, ArrowUp, ArrowDown, Wand2, Code2, Save, Key } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Alert, Modal, FileDropzone, Spinner, CodeBlock } from '../components/ui';
import { DATA_TYPES, IDENT_RE, slugify, normalizeHeader, buildCreateSql } from '../utils/format';

let uid = 1;
const newColumn = (data = {}) => ({
  uid: uid++, excel_name: '', db_name: '', data_type: 'text', is_key: false, nullable: true, dbTouched: false, ...data,
});

/** Errores por columna (índice -> mensaje) y errores generales. */
function validate(columns) {
  const byIndex = {};
  const seenDb = new Map();
  const seenExcel = new Map();
  columns.forEach((c, i) => {
    let msg = null;
    if (!c.excel_name.trim()) msg = 'Falta el nombre en Excel';
    else if (!IDENT_RE.test(c.db_name)) msg = 'Nombre en BD inválido: inicia con letra; solo a-z, 0-9 y _';
    else if (c.is_key && c.data_type === 'longtext') msg = 'Una clave no puede ser Texto largo';
    else if (seenDb.has(c.db_name)) msg = `Nombre en BD repetido (fila ${seenDb.get(c.db_name) + 1})`;
    else if (seenExcel.has(normalizeHeader(c.excel_name))) msg = `Nombre en Excel repetido (fila ${seenExcel.get(normalizeHeader(c.excel_name)) + 1})`;
    if (msg) byIndex[i] = msg;
    if (!seenDb.has(c.db_name)) seenDb.set(c.db_name, i);
    if (!seenExcel.has(normalizeHeader(c.excel_name))) seenExcel.set(normalizeHeader(c.excel_name), i);
  });
  const general = [];
  if (!columns.some((c) => c.is_key)) general.push('Marca al menos una columna como clave: se usa para actualizar filas existentes (upsert).');
  if (columns.filter((c) => c.is_key && c.data_type === 'text').length > 3) general.push('Máximo 3 columnas clave de tipo Texto.');
  return { byIndex, general };
}

export default function CreateTablePage() {
  const { categorySlug } = useParams();
  const navigate = useNavigate();
  const { categories, refreshCategories, toast } = useApp();
  const category = categories.find((c) => c.slug === categorySlug);

  const [info, setInfo] = useState({ name: '', slug: '', description: '', sheet_name: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [columns, setColumns] = useState([newColumn()]);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showSql, setShowSql] = useState(false);
  const [detectOpen, setDetectOpen] = useState(false);
  const [detectFile, setDetectFile] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState(null);

  const validation = useMemo(() => validate(columns), [columns]);
  const hasErrors = Object.keys(validation.byIndex).length > 0 || validation.general.length > 0 || !info.name.trim() || !info.slug;
  const dbTable = `dh_${categorySlug}_${info.slug || '…'}`;

  const setInfoField = (k, v) => setInfo((f) => {
    const next = { ...f, [k]: v };
    if (k === 'name' && !slugTouched) next.slug = slugify(v, 40);
    return next;
  });

  const updateColumn = (i, patch) => setColumns((cols) => cols.map((c, idx) => {
    if (idx !== i) return c;
    const next = { ...c, ...patch };
    if ('excel_name' in patch && !c.dbTouched) next.db_name = slugify(patch.excel_name);
    if ('db_name' in patch) next.dbTouched = true;
    if (patch.is_key) next.nullable = false;
    return next;
  }));

  const move = (i, dir) => setColumns((cols) => {
    const j = i + dir;
    if (j < 0 || j >= cols.length) return cols;
    const copy = [...cols];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });

  const runDetect = async () => {
    if (!detectFile) return;
    setDetecting(true);
    setDetectError(null);
    try {
      const fd = new FormData();
      fd.append('file', detectFile);
      if (info.sheet_name) fd.append('sheet_name', info.sheet_name);
      const res = await api.post('/tables/detect', fd);
      setColumns(res.columns.map((c) => newColumn({ ...c, dbTouched: true })));
      if (!info.name) {
        const base = detectFile.name.replace(/\.(xlsx|xls)$/i, '');
        setInfoField('name', base);
      }
      toast(`${res.columns.length} columnas detectadas en la hoja "${res.sheet}" (${res.rowCount} filas)`, 'info');
      setDetectOpen(false);
      setDetectFile(null);
    } catch (err) {
      setDetectError(err.message);
    } finally {
      setDetecting(false);
    }
  };

  const submit = async () => {
    setShowErrors(true);
    if (!category) {
      setError(`La categoría "${categorySlug}" no existe`);
      return;
    }
    if (hasErrors) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.post('/tables', {
        category_id: category.id,
        ...info,
        columns: columns.map(({ excel_name, db_name, data_type, is_key, nullable }) => ({
          excel_name: excel_name.trim(), db_name, data_type, is_key, nullable,
        })),
      });
      await refreshCategories();
      toast(`Tabla "${created.name}" creada`);
      navigate(`/c/${categorySlug}/t/${created.slug}`);
    } catch (err) {
      setError(err.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Nueva tabla</h1>
          <p className="page-subtitle">
            {category ? `Categoría ${category.name}` : categorySlug} · Define cómo se relaciona cada encabezado del Excel con su columna en la base de datos
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn-secondary" onClick={() => setDetectOpen(true)}><Wand2 size={16} /> Detectar desde Excel</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={saving || (showErrors && hasErrors)}>
            {saving ? <Spinner /> : <Save size={16} />} Crear tabla
          </button>
        </div>
      </div>

      <div className="stack">
        {error && <Alert type="error">{error}</Alert>}

        <div className="glass card-pad">
          <p className="section-title">Información general</p>
          <div className="grid grid-2" style={{ gap: '0 16px' }}>
            <div className="field">
              <label className="form-label">Nombre</label>
              <input
                value={info.name} onChange={(e) => setInfoField('name', e.target.value)} placeholder="Ej. Transacciones SAP"
                className={showErrors && !info.name.trim() ? 'invalid' : ''}
              />
            </div>
            <div className="field">
              <label className="form-label">Identificador</label>
              <input
                className={`mono${showErrors && !/^[a-z][a-z0-9_]{0,39}$/.test(info.slug) ? ' invalid' : ''}`}
                value={info.slug} onChange={(e) => { setSlugTouched(true); setInfoField('slug', e.target.value); }}
              />
              <div className="field-hint">Tabla MySQL: <span className="code-inline">{dbTable}</span> · URL: <span className="code-inline">/api/v1/{categorySlug}/{info.slug || '…'}</span></div>
            </div>
            <div className="field">
              <label className="form-label">Descripción</label>
              <input value={info.description} onChange={(e) => setInfoField('description', e.target.value)} placeholder="Opcional" />
            </div>
            <div className="field">
              <label className="form-label">Hoja del Excel</label>
              <input value={info.sheet_name} onChange={(e) => setInfoField('sheet_name', e.target.value)} placeholder="Vacío = primera hoja" />
            </div>
          </div>
        </div>

        <div className="glass">
          <div className="card-pad row" style={{ paddingBottom: 12 }}>
            <p className="section-title" style={{ margin: 0 }}>Columnas ({columns.length})</p>
            <div className="spacer" />
            <span className="muted small"><Key size={12} /> Clave = identifica cada fila para actualizarla al recargar</span>
          </div>
          <div className="table-wrap">
            <table className="col-editor">
              <thead>
                <tr>
                  <th className="compact">#</th>
                  <th style={{ minWidth: 220 }}>Nombre en Excel</th>
                  <th style={{ minWidth: 200 }}>Nombre en BD</th>
                  <th style={{ minWidth: 140 }}>Tipo</th>
                  <th className="compact">Clave</th>
                  <th className="compact">Opcional</th>
                  <th className="compact" />
                </tr>
              </thead>
              <tbody>
                {columns.map((c, i) => {
                  const err = showErrors ? validation.byIndex[i] : null;
                  return (
                    <tr key={c.uid}>
                      <td className="center muted small">{i + 1}</td>
                      <td>
                        <input
                          value={c.excel_name} placeholder="Ej. Número de Orden"
                          className={err && !c.excel_name.trim() ? 'invalid' : ''}
                          onChange={(e) => updateColumn(i, { excel_name: e.target.value })}
                        />
                        {err && <div className="field-error">{err}</div>}
                      </td>
                      <td>
                        <input
                          className={`mono${c.db_name && !IDENT_RE.test(c.db_name) ? ' invalid' : ''}`}
                          value={c.db_name} placeholder="numero_de_orden"
                          onChange={(e) => updateColumn(i, { db_name: e.target.value })}
                        />
                      </td>
                      <td>
                        <select value={c.data_type} onChange={(e) => updateColumn(i, { data_type: e.target.value })}>
                          {Object.entries(DATA_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                        </select>
                      </td>
                      <td className="center">
                        <input type="checkbox" checked={c.is_key} onChange={(e) => updateColumn(i, { is_key: e.target.checked })} />
                      </td>
                      <td className="center">
                        <input type="checkbox" checked={c.nullable} disabled={c.is_key} onChange={(e) => updateColumn(i, { nullable: e.target.checked })} />
                      </td>
                      <td className="center">
                        <div className="icon-btns">
                          <button type="button" className="btn-ghost btn-icon" onClick={() => move(i, -1)} disabled={i === 0} title="Subir"><ArrowUp size={15} /></button>
                          <button type="button" className="btn-ghost btn-icon" onClick={() => move(i, 1)} disabled={i === columns.length - 1} title="Bajar"><ArrowDown size={15} /></button>
                          <button
                            type="button" className="btn-ghost btn-icon" title="Eliminar" disabled={columns.length === 1}
                            onClick={() => setColumns((cols) => cols.filter((_, idx) => idx !== i))}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card-pad row">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setColumns((cols) => [...cols, newColumn()])}>
              <Plus size={14} /> Agregar columna
            </button>
            <div className="spacer" />
            <button type="button" className="btn-ghost btn-sm" onClick={() => setShowSql((s) => !s)}>
              <Code2 size={14} /> {showSql ? 'Ocultar' : 'Ver'} SQL
            </button>
          </div>
          {showErrors && validation.general.map((g) => (
            <div key={g} style={{ padding: '0 20px 16px' }}><Alert type="warning">{g}</Alert></div>
          ))}
          {showSql && <div style={{ padding: '0 20px 20px' }}><CodeBlock>{buildCreateSql(dbTable, columns)}</CodeBlock></div>}
        </div>
      </div>

      <Modal
        open={detectOpen} title="Detectar columnas desde un Excel" onClose={() => setDetectOpen(false)}
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setDetectOpen(false)}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={runDetect} disabled={!detectFile || detecting}>
              {detecting ? <Spinner /> : <Wand2 size={16} />} Detectar
            </button>
          </>
        )}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Se leerán los encabezados de la {info.sheet_name ? `hoja "${info.sheet_name}"` : 'primera hoja'} y se propondrán nombres y tipos.
          Podrás ajustarlos antes de crear la tabla. Las columnas actuales se reemplazarán.
        </p>
        {detectError && <div className="field"><Alert type="error">{detectError}</Alert></div>}
        <FileDropzone file={detectFile} onFile={setDetectFile} />
      </Modal>
    </>
  );
}
