import { useEffect, useRef, useState } from 'react';
import {
  X, Copy, Check, UploadCloud, Bot, Folder, Database, Factory, Boxes, Cpu, Truck, Wrench,
  ShieldCheck, Users, Package, FileSpreadsheet, AlertCircle, AlertTriangle, CheckCircle2, Info,
} from 'lucide-react';

export const CATEGORY_ICONS = {
  bot: Bot, folder: Folder, database: Database, factory: Factory, boxes: Boxes, cpu: Cpu,
  truck: Truck, wrench: Wrench, shield: ShieldCheck, users: Users, package: Package, sheet: FileSpreadsheet,
};
export const CategoryIcon = ({ name, size = 18 }) => {
  const Icon = CATEGORY_ICONS[name] ?? Folder;
  return <Icon size={size} />;
};

export function Modal({ open, title, onClose, children, footer, width = 520 }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="glass-strong modal" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const Badge = ({ color = 'blue', children, title }) => (
  <span className={`badge badge-${color}`} title={title}>{children}</span>
);

export const Spinner = () => <span className="spinner" />;

export const Loading = ({ text = 'Cargando…' }) => (
  <div className="loading"><Spinner /> {text}</div>
);

export function EmptyState({ icon: Icon = Database, title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={24} /></div>
      <h3>{title}</h3>
      {children && <p style={{ margin: '0 0 16px' }}>{children}</p>}
      {action}
    </div>
  );
}

const ALERT_ICONS = { error: AlertCircle, warning: AlertTriangle, success: CheckCircle2, info: Info };
export function Alert({ type = 'info', children }) {
  const Icon = ALERT_ICONS[type];
  return <div className={`alert alert-${type}`}><Icon size={16} /><div>{children}</div></div>;
}

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return [copied, copy];
}

export function CodeBlock({ children }) {
  const [copied, copy] = useCopy();
  return (
    <pre className="code-block">
      <button type="button" className="copy-btn" onClick={() => copy(children)}>
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copiado' : 'Copiar'}
      </button>
      {children}
    </pre>
  );
}

export function FileDropzone({ file, onFile, accept = '.xlsx,.xls,.csv', hint = 'Formatos: .xlsx, .xls, .csv' }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const pick = (f) => f && onFile(f);
  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
    >
      <input
        ref={input} type="file" accept={accept} hidden
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }}
      />
      <div className="dropzone-icon">{file ? <FileSpreadsheet size={24} /> : <UploadCloud size={24} />}</div>
      {file ? (
        <>
          <div style={{ fontWeight: 600 }}>{file.name}</div>
          <div className="muted small">{(file.size / 1024).toFixed(1)} KB · clic para cambiar</div>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 600 }}>Arrastra tu archivo aquí o haz clic para seleccionar</div>
          <div className="muted small">{hint}</div>
        </>
      )}
    </div>
  );
}
