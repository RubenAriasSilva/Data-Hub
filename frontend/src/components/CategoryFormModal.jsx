import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { slugify } from '../utils/format';
import { Modal, Alert, Spinner, CATEGORY_ICONS } from './ui';

/** Crear (category = null) o editar una categoría. */
export default function CategoryFormModal({ open, category, onClose, onSaved }) {
  const { refreshCategories, toast } = useApp();
  const [form, setForm] = useState({ name: '', slug: '', description: '', icon: 'folder' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(category
      ? { name: category.name, slug: category.slug, description: category.description ?? '', icon: category.icon }
      : { name: '', slug: '', description: '', icon: 'folder' });
    setSlugTouched(false);
    setError(null);
  }, [open, category]);

  const set = (k, v) => setForm((f) => {
    const next = { ...f, [k]: v };
    if (k === 'name' && !category && !slugTouched) next.slug = slugify(v, 20);
    return next;
  });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = category
        ? await api.put(`/categories/${category.id}`, form)
        : await api.post('/categories', form);
      await refreshCategories();
      toast(category ? 'Categoría actualizada' : 'Categoría creada');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={category ? 'Editar categoría' : 'Nueva categoría'}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" form="category-form" className="btn-primary" disabled={saving || !form.name.trim()}>
            {saving && <Spinner />} Guardar
          </button>
        </>
      )}
    >
      <form id="category-form" onSubmit={submit}>
        {error && <div className="field"><Alert type="error">{error}</Alert></div>}
        <div className="field">
          <label className="form-label">Nombre</label>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej. RPAs, Calidad, Producción" autoFocus />
        </div>
        <div className="field">
          <label className="form-label">Identificador</label>
          <input
            className="mono" value={form.slug} disabled={Boolean(category)}
            onChange={(e) => { setSlugTouched(true); set('slug', e.target.value); }}
          />
          <div className="field-hint">
            {category ? 'No se puede cambiar: forma parte de las URLs de la API y de los nombres de tabla.' : 'Se usa en las URLs de la API y en el nombre físico de las tablas (máx. 20).'}
          </div>
        </div>
        <div className="field">
          <label className="form-label">Descripción</label>
          <textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="field">
          <label className="form-label">Icono</label>
          <div className="row">
            {Object.entries(CATEGORY_ICONS).map(([key, Icon]) => (
              <button
                key={key} type="button" title={key}
                className={form.icon === key ? 'btn-primary btn-icon' : 'btn-secondary btn-icon'}
                onClick={() => set('icon', key)}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}
