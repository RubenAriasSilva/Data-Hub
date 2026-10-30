import { useEffect, useState } from 'react';
import { Trash2, Terminal, Eye } from 'lucide-react';
import { api } from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { Badge, Modal, Alert, Spinner, Loading } from '../../../components/ui';

const keyText = (key) => Object.entries(key).map(([k, v]) => `${k}: ${v}`).join(', ');

function attributes(ix) {
  const out = [];
  if (ix.system) out.push(['Sistema', 'gray']);
  if (ix.key_index) out.push(['Clave', 'blue']);
  if (ix.unique) out.push(['Único', 'green']);
  if (ix.partialFilterExpression) out.push(['Parcial', 'orange']);
  if (ix.sparse) out.push(['Sparse', 'orange']);
  if (ix.collation) out.push([`Collation ${ix.collation.locale}${ix.collation.strength ? `/${ix.collation.strength}` : ''}`, 'gray']);
  if (ix.expireAfterSeconds !== undefined) out.push([`TTL ${ix.expireAfterSeconds} s`, 'gray']);
  if (ix.hidden) out.push(['Oculto', 'gray']);
  return out;
}

const scriptExample = (table) => `// Código mongosh sobre esta colección (el nombre después de db. se ignora)
db.${table.slug}.createIndex({ email: 1 }, { unique: true, collation: { locale: "es", strength: 2 } });
// db.${table.slug}.dropIndex("email_1");
// db.${table.slug}.insertMany([ { ... } ]);`;

/** Índices de una colección MongoDB: listado, eliminación y alta con código mongosh. */
export default function IndexesSection({ table, onChanged }) {
  const { toast } = useApp();
  const [indexes, setIndexes] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState(null);

  useEffect(() => {
    api.get(`/tables/${table.id}/indexes`).then((d) => { setIndexes(d); setError(null); }).catch((err) => setError(err.message));
  }, [table]);

  const remove = async (ix) => {
    if (!window.confirm(`¿Eliminar el índice "${ix.name}"?`)) return;
    try {
      await api.del(`/tables/${table.id}/indexes/${encodeURIComponent(ix.name)}`);
      toast('Índice eliminado');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const openModal = () => {
    setText(scriptExample(table));
    setPreview(null);
    setModalError(null);
    setOpen(true);
  };

  const send = async (dryRun) => {
    setBusy(true);
    setModalError(null);
    try {
      const res = await api.post(`/tables/${table.id}/script`, { script: text, dryRun });
      if (dryRun) setPreview(res);
      else {
        const loaded = (res.loads ?? []).reduce((n, l) => n + l.inserted + l.updated, 0);
        toast(`${res.applied} paso(s) aplicado(s)${loaded ? ` · ${loaded} documento(s) cargado(s)` : ''}`);
        setOpen(false);
      }
    } catch (err) {
      setModalError(err.message);
    } finally {
      setBusy(false);
      // Aunque falle un paso, los anteriores pueden haberse aplicado: se recarga igual
      if (!dryRun) onChanged();
    }
  };

  return (
    <div className="glass">
      <div className="card-pad row" style={{ paddingBottom: 8 }}>
        <div>
          <p className="section-title" style={{ margin: 0 }}>Índices</p>
          <div className="muted small">Los marcados como Sistema y Clave los administra el Data Hub.</div>
        </div>
        <div className="spacer" />
        <button type="button" className="btn-secondary btn-sm" onClick={openModal}><Terminal size={14} /> Agregar con código</button>
      </div>
      {error && <div style={{ padding: '0 20px 16px' }}><Alert type="error">{error}</Alert></div>}
      {!indexes ? (!error && <Loading />) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nombre</th><th>Campos</th><th>Atributos</th><th /></tr></thead>
            <tbody>
              {indexes.map((ix) => (
                <tr key={ix.name}>
                  <td className="mono small">{ix.name}</td>
                  <td className="mono small">{`{ ${keyText(ix.key)} }`}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {attributes(ix).map(([label, color]) => <Badge key={label} color={color}>{label}</Badge>)}
                    </div>
                    {ix.partialFilterExpression && <div className="mono small muted" style={{ marginTop: 4 }}>{JSON.stringify(ix.partialFilterExpression)}</div>}
                  </td>
                  <td>
                    {!ix.system && !ix.key_index && (
                      <button type="button" className="btn-ghost btn-icon" title="Eliminar índice" onClick={() => remove(ix)}><Trash2 size={14} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open} title="Agregar índices o documentos con código mongosh" width={760} onClose={() => setOpen(false)}
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="button" className="btn-secondary" onClick={() => send(true)} disabled={busy || !text.trim()}><Eye size={16} /> Vista previa</button>
            <button type="button" className="btn-primary" onClick={() => send(false)} disabled={busy || !text.trim()}>{busy && <Spinner />} Aplicar</button>
          </>
        )}
      >
        {modalError && <div className="field"><Alert type="error">{modalError}</Alert></div>}
        <p className="muted small" style={{ marginTop: 0 }}>
          Se admiten <span className="code-inline">createIndex</span>, <span className="code-inline">createIndexes</span>, <span className="code-inline">dropIndex</span>,
          {' '}<span className="code-inline">insertOne</span> e <span className="code-inline">insertMany</span>. Se aplican en orden; si un paso falla, los anteriores quedan aplicados.
        </p>
        <textarea
          className="mono" rows={12} spellCheck={false} value={text} style={{ width: '100%', resize: 'vertical' }}
          onChange={(e) => { setText(e.target.value); setPreview(null); }}
        />
        {preview && (
          <div style={{ marginTop: 12 }}>
            <p className="section-title" style={{ marginBottom: 6 }}>Pasos</p>
            {preview.plan.length
              ? <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>{preview.plan.map((p, i) => <li key={i} className="mono">{p}</li>)}</ol>
              : <div className="muted small">El código no genera cambios.</div>}
            {preview.warnings.map((w) => <div key={w} style={{ marginTop: 8 }}><Alert type="warning">{w}</Alert></div>)}
          </div>
        )}
      </Modal>
    </div>
  );
}
