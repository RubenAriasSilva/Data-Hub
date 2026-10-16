// Identificadores seguros para MySQL: minúsculas, dígitos y guion bajo, iniciando con letra.
export const IDENT_RE = /^[a-z][a-z0-9_]{0,63}$/;

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** "Número de Orden" -> "numero_de_orden" */
export function slugify(input, max = 64) {
  let s = stripAccents(String(input ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (/^[0-9]/.test(s)) s = `c_${s}`;
  return s.slice(0, max).replace(/_+$/, '');
}

export function isValidIdentifier(name, max = 64) {
  return typeof name === 'string' && name.length <= max && IDENT_RE.test(name);
}

/** Normaliza encabezados de Excel para compararlos: sin acentos, espacios colapsados, minúsculas. */
export function normalizeHeader(h) {
  return stripAccents(String(h ?? '')).trim().replace(/\s+/g, ' ').toLowerCase();
}
