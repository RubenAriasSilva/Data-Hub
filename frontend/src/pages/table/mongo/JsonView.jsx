import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

// Documentos en EJSON relajado: { "$oid": "…" } y { "$date": "…" } se muestran como valor simple
const ejsonScalar = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== 1 || !keys[0].startsWith('$')) return null;
  const inner = v[keys[0]];
  if (keys[0] === '$oid') return { kind: 'oid', text: `ObjectId("${inner}")` };
  if (keys[0] === '$date') return { kind: 'date', text: typeof inner === 'string' ? inner : JSON.stringify(inner) };
  return { kind: 'other', text: JSON.stringify(v) };
};

/** Texto corto de un valor (celdas de la vista tabla y encabezados plegados). */
export function summarize(v) {
  if (v === null || v === undefined) return null;
  const scalar = ejsonScalar(v);
  if (scalar) return scalar.kind === 'oid' ? v.$oid : scalar.text;
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'object') return `{${Object.keys(v).length} campos}`;
  return String(v);
}

function Scalar({ value }) {
  if (value === null) return <span className="json-null">null</span>;
  const scalar = ejsonScalar(value);
  if (scalar) return <span className={scalar.kind === 'date' ? 'json-date' : 'json-oid'}>{scalar.text}</span>;
  if (typeof value === 'string') return <span className="json-str">"{value}"</span>;
  if (typeof value === 'number') return <span className="json-num">{value}</span>;
  if (typeof value === 'boolean') return <span className="json-bool">{String(value)}</span>;
  return <span>{JSON.stringify(value)}</span>;
}

function Node({ name, value, depth }) {
  const isContainer = value !== null && typeof value === 'object' && !ejsonScalar(value);
  const [open, setOpen] = useState(depth < 1);
  const label = name !== undefined && <span className="json-key">{name}: </span>;
  if (!isContainer) return <div className="json-line">{label}<Scalar value={value} /></div>;

  const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
  const [openCh, closeCh] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  if (!entries.length) return <div className="json-line">{label}<span className="json-punct">{openCh}{closeCh}</span></div>;
  return (
    <div>
      <button type="button" className="json-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label}
        <span className="json-punct">{openCh}</span>
        {!open && <span className="json-punct"> {summarize(value)} {closeCh}</span>}
      </button>
      {open && (
        <>
          <div className="json-children">
            {entries.map(([k, v]) => <Node key={k} name={k} value={v} depth={depth + 1} />)}
          </div>
          <div className="json-line json-punct">{closeCh}</div>
        </>
      )}
    </div>
  );
}

/** Vista plegable de un documento JSON. */
export default function JsonView({ value }) {
  return (
    <div className="json-view">
      {Object.entries(value).map(([k, v]) => <Node key={k} name={k} value={v} depth={0} />)}
    </div>
  );
}
