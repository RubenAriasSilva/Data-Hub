import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, ArrowUp, ArrowDown, Wand2, Code2, Save, Key, TableProperties, FileCode2, Database, Leaf, X, FileUp, Terminal, FileJson } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Alert, Modal, FileDropzone, Spinner, CodeBlock } from '../components/ui';
import { DATA_TYPES, IDENT_RE, FIELD_PATH_RE, ENGINES, slugify, normalizeHeader, buildCreateSql } from '../utils/format';

let uid = 1;
const newColumn = (data = {}) => ({
  uid: uid++, excel_name: '', db_name: '', data_type: 'text', is_key: false, nullable: true, dbTouched: false, ...data,
});

const MAX_DB_NAME = 64; // límite de MySQL para nombres de tabla (también se aplica a las colecciones)
const MAX_KEY_FIELDS = 5;

const MONGO_EXAMPLE = `// Código mongosh: se interpreta, no se ejecuta. Una sola colección.
db.createCollection("users");
db.users.createIndex({ name: 1 }, { unique: true, collation: { locale: "es", strength: 1 } });
db.users.createIndex({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });

// Opcional: documentos iniciales
db.users.insertMany([
  { name: "Juan Pérez", email: "juan.perez@empresa.com", role: "admin", createdAt: ISODate("2026-10-01T00:00:00Z") }
]);`;
// Código mongosh (db.…, use …), opcionalmente tras comentarios
const MONGOSH_RE = /^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*(?:db\s*\.|use\s+\w)/;
const DATA_ACCEPT = '.json,.ndjson,.jsonl,.bson,.xlsx,.xls,.csv';

const SQL_EXAMPLE = `CREATE TABLE ordenes (
  orden BIGINT NOT NULL COMMENT 'Orden',
  autor VARCHAR(255) COMMENT 'Autor',
  inicio_programado DATE COMMENT 'Inicio programado',
  total DECIMAL(18,4) COMMENT 'Total general',
  PRIMARY KEY (orden)
);`;

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
  const { categorySlug, appSlug } = useParams();
  const navigate = useNavigate();
  const { categories, refreshCategories, toast, health } = useApp();
  const mongoEnabled = Boolean(health?.mongo?.enabled);
  const category = categories.find((c) => c.slug === categorySlug);
  const [application, setApplication] = useState(null);
  const basePath = `/c/${categorySlug}${appSlug ? `/a/${appSlug}` : ''}`;

  // dh_<categoria>[_<aplicacion>]_<tabla> no puede pasar de 64 caracteres
  const prefix = `dh_${categorySlug}_${appSlug ? `${appSlug}_` : ''}`;
  const maxSlug = Math.min(40, MAX_DB_NAME - prefix.length);
  const slugRe = new RegExp(`^[a-z][a-z0-9_]{0,${maxSlug - 1}}$`);

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
  const [mode, setMode] = useState('form'); // 'form' | 'sql'
  const [sqlText, setSqlText] = useState(SQL_EXAMPLE);
  const [sqlWarnings, setSqlWarnings] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [engine, setEngine] = useState('mysql'); // 'mysql' | 'mongodb'
  const [keyFields, setKeyFields] = useState([]);
  const [keyInput, setKeyInput] = useState('');
  const mongo = engine === 'mongodb';
  const [mongoMode, setMongoMode] = useState('form'); // 'form' | 'code'
  const [scriptText, setScriptText] = useState(MONGO_EXAMPLE);
  const [script, setScript] = useState(null); // { text, summary } código interpretado que se aplicará al crear
  const [dataOpen, setDataOpen] = useState(false);
  const [dataFile, setDataFile] = useState(null); // archivo elegido en el modal
  const [initialData, setInitialData] = useState(null); // { file, info } datos que se cargarán al crear
  const scriptInput = useRef(null);

  useEffect(() => {
    if (!appSlug) return;
    api.get(`/categories/${categorySlug}/apps/${appSlug}`).then(setApplication).catch((err) => setError(err.message));
  }, [categorySlug, appSlug]);

  const validation = useMemo(() => validate(columns), [columns]);
  const columnErrors = !mongo && (Object.keys(validation.byIndex).length > 0 || validation.general.length > 0);
  const hasErrors = columnErrors || !info.name.trim() || !slugRe.test(info.slug);
  const keyError = keyInput.trim() && !FIELD_PATH_RE.test(keyInput.trim())
    ? 'Usa letras, números y _ separados por punto (ej. cliente.id)' : null;

  const addKey = () => {
    const k = keyInput.trim();
    if (!k || keyError || keyFields.includes(k) || keyFields.length >= MAX_KEY_FIELDS) return;
    setKeyFields((ks) => [...ks, k]);
    setKeyInput('');
  };
  const dbTable = `${prefix}${info.slug || '…'}`;

  const setInfoField = (k, v) => setInfo((f) => {
    const next = { ...f, [k]: v };
    if (k === 'name' && !slugTouched) next.slug = slugify(v, maxSlug);
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
        const base = detectFile.name.replace(/\.(xlsx|xls|csv)$/i, '');
        setInfoField('name', base);
      }
      const where = res.sheet ? `en la hoja "${res.sheet}"` : 'en el CSV';
      toast(`${res.columns.length} columnas detectadas ${where} (${res.rowCount} filas)`, 'info');
      setDetectOpen(false);
      setDetectFile(null);
    } catch (err) {
      setDetectError(err.message);
    } finally {
      setDetecting(false);
    }
  };

  // Modo SQL: el backend interpreta el CREATE TABLE y el resultado se revisa en el formulario
  const parseSql = async () => {
    // Código mongosh pegado en el modo SQL: se lleva a MongoDB → Código mongosh en vez de fallar
    if (MONGOSH_RE.test(sqlText)) {
      if (!mongoEnabled) {
        setError('Esto es código de MongoDB (db.…), no SQL. Para usarlo, configura MONGO_URI en backend/.env y elige MongoDB en "Base de datos".');
        return;
      }
      setEngine('mongodb');
      setScriptText(sqlText);
      setScript(null);
      setMongoMode('code');
      setError(null);
      toast('Es código de MongoDB: se cambió a MongoDB → Código mongosh. Pulsa "Interpretar código".', 'info');
      return;
    }
    setParsing(true);
    setError(null);
    try {
      const res = await api.post('/tables/sql/parse', { sql: sqlText });
      setColumns(res.columns.map((c) => newColumn({ ...c, dbTouched: true })));
      setInfo((f) => ({ ...f, name: f.name || res.name, slug: slugTouched && f.slug ? f.slug : res.slug.slice(0, maxSlug) }));
      setSlugTouched(true);
      setSqlWarnings(res.warnings);
      setMode('form');
      toast(`${res.columns.length} columnas interpretadas. Revísalas y pulsa "Crear tabla".`, 'info');
    } catch (err) {
      setError(err.message);
    } finally {
      setParsing(false);
    }
  };

  // Código mongosh: el backend lo interpreta (sin ejecutarlo) y se revisa antes de crear
  const parseScript = async () => {
    setParsing(true);
    setError(null);
    try {
      const summary = await api.post('/tables/mongo/parse', { script: scriptText });
      setScript({ text: scriptText, summary });
      // El nombre y el identificador se toman siempre del código (db.createCollection("users") -> users)
      setInfo((f) => ({ ...f, name: summary.collection, slug: slugify(summary.collection, maxSlug) }));
      setSlugTouched(true);
      if (!keyFields.length && summary.suggested_keys.length) setKeyFields(summary.suggested_keys);
      setMongoMode('form');
      toast(`Código interpretado: colección "${summary.collection}", ${summary.index_count} índice(s), ${summary.document_count} documento(s). Revisa y pulsa "Crear colección".`, 'info');
    } catch (err) {
      setError(err.message);
    } finally {
      setParsing(false);
    }
  };

  const loadScriptFile = async (file) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError('El archivo de código excede 20 MB');
      return;
    }
    setScriptText(await file.text());
    setScript(null);
  };

  // Archivo de datos: se lee en el backend (sin guardar) para proponer nombre y claves
  const runDataDetect = async () => {
    if (!dataFile) return;
    setDetecting(true);
    setDetectError(null);
    try {
      const fd = new FormData();
      fd.append('file', dataFile);
      if (info.sheet_name) fd.append('sheet_name', info.sheet_name);
      const res = await api.post('/tables/mongo/detect', fd);
      setInitialData({ file: dataFile, info: res });
      if (!info.name.trim()) setInfoField('name', dataFile.name.replace(/\.[^.]+$/, ''));
      if (!keyFields.length && res.suggested_keys.length) setKeyFields(res.suggested_keys);
      toast(`${res.count} documentos leídos de ${dataFile.name}; se cargarán al crear la colección`, 'info');
      setDataOpen(false);
      setDataFile(null);
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
    if (appSlug && !application) {
      setError(`La aplicación "${appSlug}" no existe`);
      return;
    }
    if (hasErrors) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.post('/tables', {
        category_id: category.id,
        application_id: application?.id,
        ...info,
        db_type: engine,
        ...(mongo
          ? { key_fields: keyFields, script: script?.text }
          : {
            columns: columns.map(({ excel_name, db_name, data_type, is_key, nullable }) => ({
              excel_name: excel_name.trim(), db_name, data_type, is_key, nullable,
            })),
          }),
      });
      await refreshCategories();
      toast(`${ENGINES[engine].Noun} "${created.name}" creada`);
      const loaded = (r) => `${r.inserted} nuevos, ${r.updated} actualizados${r.failed ? `, ${r.failed} rechazados` : ''}`;
      if (created.initial_load) toast(`Documentos del código: ${loaded(created.initial_load)}`, created.initial_load.status === 'success' ? 'success' : 'info');
      if (mongo && initialData) {
        // La colección ya existe: si la carga falla se informa y el detalle queda en el Historial
        const fd = new FormData();
        fd.append('file', initialData.file);
        try {
          const r = await api.post(`/tables/${created.id}/upload`, fd);
          toast(`${initialData.file.name}: ${loaded(r)}`, r.status === 'success' ? 'success' : 'info');
        } catch (err) {
          toast(`${initialData.file.name}: ${err.data?.status ? loaded(err.data) : err.message}`, 'error');
        }
      }
      navigate(`${basePath}/t/${created.slug}`);
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
          <h1 className="page-title">{mongo ? 'Nueva colección' : 'Nueva tabla'}</h1>
          <p className="page-subtitle">
            {category ? `Categoría ${category.name}` : categorySlug}
            {appSlug && ` · Aplicación ${application?.name ?? appSlug}`} · {mongo
              ? 'Colección de documentos JSON libres en MongoDB'
              : 'Define cómo se relaciona cada encabezado del Excel con su columna en la base de datos'}
          </p>
        </div>
        <div className="row">
          {!mongo && <button type="button" className="btn-secondary" onClick={() => setDetectOpen(true)}><Wand2 size={16} /> Detectar desde Excel</button>}
          {mongo && <button type="button" className="btn-secondary" onClick={() => { setDetectError(null); setDataOpen(true); }}><FileUp size={16} /> Crear desde archivo</button>}
          <button type="button" className="btn-primary" onClick={submit} disabled={saving || (showErrors && hasErrors)}>
            {saving ? <Spinner /> : <Save size={16} />} {mongo ? 'Crear colección' : 'Crear tabla'}
          </button>
        </div>
      </div>

      <div className="stack">
        {error && <Alert type="error">{error}</Alert>}

        <div className="glass card-pad">
          <p className="section-title">Información general</p>
          <div className="field">
            <label className="form-label">Base de datos</label>
            <div className="tabs" style={{ margin: 0 }}>
              <button type="button" className={`tab${!mongo ? ' active' : ''}`} onClick={() => setEngine('mysql')}>
                <Database size={15} /> MySQL
              </button>
              <button
                type="button" className={`tab${mongo ? ' active' : ''}`} disabled={!mongoEnabled}
                title={mongoEnabled ? '' : 'Configura MONGO_URI en backend/.env para habilitar MongoDB'}
                onClick={() => setEngine('mongodb')}
              >
                <Leaf size={15} /> MongoDB
              </button>
            </div>
            <div className="field-hint">
              {mongo
                ? 'Documentos JSON sin columnas fijas (objetos anidados y arreglos). Se cargan con JSON, NDJSON, BSON, Excel o CSV.'
                : 'Tabla con columnas y tipos definidos. Se carga con Excel, CSV o JSON.'}
              {!mongoEnabled && ' MongoDB no está configurado (MONGO_URI en backend/.env).'}
            </div>
          </div>
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
                className={`mono${showErrors && !slugRe.test(info.slug) ? ' invalid' : ''}`}
                value={info.slug} onChange={(e) => { setSlugTouched(true); setInfoField('slug', e.target.value); }}
              />
              <div className="field-hint">
                {ENGINES[engine].container}: <span className="code-inline">{dbTable}</span> · URL: <span className="code-inline">/api/{mongo ? 'mongo/' : ''}v1/{categorySlug}{appSlug && `/${appSlug}`}/{info.slug || '…'}</span> · Máx. {maxSlug} caracteres
              </div>
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

        {mongo && (
          <div className="tabs glass" style={{ marginBottom: 0 }}>
            <button type="button" className={`tab${mongoMode === 'form' ? ' active' : ''}`} onClick={() => setMongoMode('form')}>
              <TableProperties size={15} /> Formulario
            </button>
            <button type="button" className={`tab${mongoMode === 'code' ? ' active' : ''}`} onClick={() => setMongoMode('code')}>
              <Terminal size={15} /> Código mongosh
            </button>
          </div>
        )}

        {mongo && mongoMode === 'code' && (
          <div className="glass card-pad">
            <p className="section-title">Definir con código mongosh</p>
            <textarea
              className="mono" rows={16} spellCheck={false} value={scriptText}
              onChange={(e) => setScriptText(e.target.value)} style={{ width: '100%', resize: 'vertical' }}
            />
            <div className="field-hint" style={{ marginTop: 8 }}>
              Se admiten <span className="code-inline">db.createCollection</span>, <span className="code-inline">createIndex</span> / <span className="code-inline">createIndexes</span> (unique, collation, partialFilterExpression, sparse, TTL…)
              e <span className="code-inline">insertOne</span> / <span className="code-inline">insertMany</span> (con <span className="code-inline">ObjectId()</span>, <span className="code-inline">ISODate()</span> o <span className="code-inline">{'{"$oid": …}'}</span>).
              Debe referirse a una sola colección; su nombre se usa como sugerencia, la colección real se llama <span className="code-inline">{dbTable}</span>. El código no se ejecuta: se interpreta y se valida.
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <input ref={scriptInput} type="file" accept=".js,.txt,.mongodb,.mongosh" hidden onChange={(e) => { loadScriptFile(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button" className="btn-secondary btn-sm" onClick={() => scriptInput.current?.click()}><FileUp size={14} /> Subir archivo .js</button>
              <div className="spacer" />
              <button type="button" className="btn-primary" onClick={parseScript} disabled={parsing || !scriptText.trim()}>
                {parsing ? <Spinner /> : <Code2 size={16} />} Interpretar código
              </button>
            </div>
          </div>
        )}

        {mongo && mongoMode === 'form' && script && (
          <div className="glass card-pad">
            <div className="row">
              <p className="section-title" style={{ margin: 0 }}><Terminal size={14} /> Código mongosh que se aplicará al crear</p>
              <div className="spacer" />
              <button type="button" className="btn-ghost btn-sm" onClick={() => setMongoMode('code')}>Editar</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setScript(null)}><X size={14} /> Quitar</button>
            </div>
            <ol className="small" style={{ margin: '10px 0 0', paddingLeft: 20 }}>
              {script.summary.plan.map((step, i) => <li key={i} className="mono">{step}</li>)}
            </ol>
            {script.summary.warnings.map((w) => <div key={w} style={{ marginTop: 8 }}><Alert type="warning">{w}</Alert></div>)}
          </div>
        )}

        {mongo && mongoMode === 'form' && initialData && (
          <div className="glass card-pad">
            <div className="row">
              <p className="section-title" style={{ margin: 0 }}><FileJson size={14} /> Datos iniciales</p>
              <div className="spacer" />
              <button type="button" className="btn-ghost btn-sm" onClick={() => setInitialData(null)}><X size={14} /> Quitar</button>
            </div>
            <div className="muted small" style={{ marginTop: 8 }}>
              <strong>{initialData.file.name}</strong> · {initialData.info.count} documentos · {initialData.info.fields.length} campos detectados.
              Se cargarán justo después de crear la colección (con upsert si hay campos clave).
            </div>
          </div>
        )}

        {mongo && mongoMode === 'form' && (
          <div className="glass card-pad">
            <p className="section-title">Campos clave (opcional)</p>
            <p className="muted small" style={{ marginTop: 0 }}>
              Con campos clave, al cargar un documento cuya clave ya existe se <strong>actualiza</strong> (upsert) en lugar de duplicarse.
              Sin campos clave, cada carga <strong>inserta</strong> documentos nuevos. Para campos anidados usa punto, p. ej. <span className="code-inline">cliente.id</span>.
            </p>
            <div className="row">
              {keyFields.map((k) => (
                <span key={k} className="badge badge-blue mono">
                  <Key size={10} /> {k}
                  <button type="button" className="btn-ghost btn-icon" style={{ padding: 0, marginLeft: 2 }} title="Quitar" onClick={() => setKeyFields((ks) => ks.filter((x) => x !== k))}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              {!keyFields.length && <span className="muted small">Sin campos clave: solo inserción.</span>}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <input
                className={`mono${keyError ? ' invalid' : ''}`} style={{ maxWidth: 320 }} value={keyInput} placeholder="codigo o cliente.id"
                onChange={(e) => setKeyInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKey(); } }}
              />
              <button type="button" className="btn-secondary btn-sm" onClick={addKey} disabled={!keyInput.trim() || Boolean(keyError) || keyFields.length >= MAX_KEY_FIELDS}>
                <Plus size={14} /> Agregar clave
              </button>
            </div>
            {keyError && <div className="field-error">{keyError}</div>}
            <div className="field-hint" style={{ marginTop: 8 }}>Máximo {MAX_KEY_FIELDS} campos. Se crea un índice único con ellos. Se pueden cambiar después en la pestaña Estructura.</div>
          </div>
        )}

        {!mongo && (
          <div className="tabs glass" style={{ marginBottom: 0 }}>
            <button type="button" className={`tab${mode === 'form' ? ' active' : ''}`} onClick={() => setMode('form')}>
              <TableProperties size={15} /> Formulario
            </button>
            <button type="button" className={`tab${mode === 'sql' ? ' active' : ''}`} onClick={() => setMode('sql')}>
              <FileCode2 size={15} /> SQL
            </button>
          </div>
        )}

        {!mongo && mode === 'form' && sqlWarnings.map((w) => <Alert key={w} type="warning">{w}</Alert>)}

        {!mongo && mode === 'sql' && (
          <div className="glass card-pad">
            <p className="section-title">Definir con SQL</p>
            <textarea
              className="mono" rows={14} spellCheck={false} value={sqlText}
              onChange={(e) => setSqlText(e.target.value)} style={{ width: '100%', resize: 'vertical' }}
            />
            <div className="field-hint" style={{ marginTop: 8 }}>
              Escribe un <span className="code-inline">CREATE TABLE</span> (dialecto MySQL). <span className="code-inline">COMMENT '…'</span> es el nombre en Excel;
              {' '}<span className="code-inline">PRIMARY KEY</span> o <span className="code-inline">UNIQUE</span> marcan la clave.
              Tipos: VARCHAR, TEXT, INT/BIGINT, DECIMAL, DATE, DATETIME, BOOLEAN. No se ejecuta en MySQL: se convierte en columnas para que las revises.
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <div className="spacer" />
              <button type="button" className="btn-primary" onClick={parseSql} disabled={parsing || !sqlText.trim()}>
                {parsing ? <Spinner /> : <Code2 size={16} />} Interpretar SQL
              </button>
            </div>
          </div>
        )}

        {!mongo && mode === 'form' && (
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
        )}
      </div>

      <Modal
        open={dataOpen} title="Crear colección desde un archivo de datos" onClose={() => setDataOpen(false)}
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setDataOpen(false)}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={runDataDetect} disabled={!dataFile || detecting}>
              {detecting ? <Spinner /> : <FileUp size={16} />} Usar archivo
            </button>
          </>
        )}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Se leerán los documentos para proponer el nombre y los campos clave (<span className="code-inline">_id</span> si todos lo traen).
          Al pulsar <strong>Crear colección</strong> se crea la colección y se cargan estos datos. Acepta JSON (arreglo, documento o
          {' '}<span className="code-inline">{'{ "documents": [ … ] }'}</span>, con <span className="code-inline">{'{"$oid"}'}</span> / <span className="code-inline">{'{"$date"}'}</span>), NDJSON, BSON (mongodump), Excel y CSV.
        </p>
        {detectError && <div className="field"><Alert type="error">{detectError}</Alert></div>}
        <FileDropzone file={dataFile} onFile={setDataFile} accept={DATA_ACCEPT} hint="Formatos: .json, .ndjson, .jsonl, .bson, .xlsx, .xls, .csv" />
      </Modal>

      <Modal
        open={detectOpen} title="Detectar columnas desde Excel o CSV" onClose={() => setDetectOpen(false)}
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
          Se leerán los encabezados de la {info.sheet_name ? `hoja "${info.sheet_name}"` : 'primera hoja'} (en un CSV, de la primera fila) y se propondrán nombres y tipos.
          Podrás ajustarlos antes de crear la tabla. Las columnas actuales se reemplazarán.
        </p>
        {detectError && <div className="field"><Alert type="error">{detectError}</Alert></div>}
        <FileDropzone file={detectFile} onFile={setDetectFile} />
      </Modal>
    </>
  );
}
