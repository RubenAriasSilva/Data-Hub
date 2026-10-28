// Modo SQL: interpreta CREATE TABLE / ALTER TABLE (dialecto MySQL) y lo traduce a la
// definición de columnas del Data Hub. Nunca se ejecuta el SQL del usuario: se valida y
// se aplica con las mismas operaciones que el formulario.
import { HttpError } from '../utils/httpError.js';
import { DATA_TYPES } from '../utils/types.js';
import { validateNewColumn, validateColumnUpdate, validateColumnDrop } from './columnService.js';

const SYSTEM_COLUMNS = ['_id', '_created_at', '_updated_at'];

const sqlError = (message, token) => new HttpError(400, token?.line ? `Línea ${token.line}: ${message}` : message);

// ---------------------------------------------------------------- tokenizador

/** Tokens: { type: 'word' | 'qident' | 'string' | 'number' | 'punct', value, line } */
export function tokenize(sql) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const src = String(sql ?? '');

  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { line += 1; i += 1; continue; }
    if (/\s/.test(ch)) { i += 1; continue; }

    if ((ch === '-' && src[i + 1] === '-') || ch === '#') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw sqlError('Comentario /* sin cerrar', { line });
      line += (src.slice(i, end).match(/\n/g) || []).length;
      i = end + 2;
      continue;
    }

    if (ch === '`' || ch === "'" || ch === '"') {
      const startLine = line;
      let value = '';
      i += 1;
      for (;;) {
        if (i >= src.length) throw sqlError(ch === '`' ? 'Identificador sin cerrar' : 'Texto sin cerrar', { line: startLine });
        if (src[i] === ch) {
          if (src[i + 1] === ch) { value += ch; i += 2; continue; } // '' o `` escapados
          i += 1;
          break;
        }
        if (src[i] === '\\' && ch !== '`' && i + 1 < src.length) { value += src[i + 1]; i += 2; continue; }
        if (src[i] === '\n') line += 1;
        value += src[i];
        i += 1;
      }
      tokens.push({ type: ch === '`' ? 'qident' : 'string', value, line: startLine });
      continue;
    }

    const word = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (word) {
      tokens.push({ type: 'word', value: word[0], line });
      i += word[0].length;
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num) {
      tokens.push({ type: 'number', value: num[0], line });
      i += num[0].length;
      continue;
    }
    if ('(),;.='.includes(ch)) {
      tokens.push({ type: 'punct', value: ch, line });
      i += 1;
      continue;
    }
    throw sqlError(`Carácter inesperado "${ch}"`, { line });
  }
  return tokens;
}

// ---------------------------------------------------------------- parser

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
    this.warnings = [];
  }

  peek(offset = 0) { return this.tokens[this.pos + offset]; }

  next() {
    const t = this.tokens[this.pos];
    if (!t) throw sqlError('El SQL termina antes de lo esperado', this.tokens.at(-1));
    this.pos += 1;
    return t;
  }

  isWord(kw, offset = 0) {
    const t = this.peek(offset);
    return t?.type === 'word' && t.value.toUpperCase() === kw;
  }

  isPunct(p) { return this.peek()?.type === 'punct' && this.peek().value === p; }

  accept(...kws) {
    if (kws.every((kw, i) => this.isWord(kw, i))) {
      this.pos += kws.length;
      return true;
    }
    return false;
  }

  expect(kw) {
    if (!this.accept(kw)) throw sqlError(`Se esperaba ${kw}${this.peek() ? ` y se encontró "${this.peek().value}"` : ''}`, this.peek());
  }

  expectPunct(p) {
    if (!this.isPunct(p)) throw sqlError(`Se esperaba "${p}"${this.peek() ? ` y se encontró "${this.peek().value}"` : ''}`, this.peek());
    this.pos += 1;
  }

  /** Identificador (con o sin backticks). Devuelve { name (minúsculas), original, line }. */
  ident(what = 'un nombre') {
    const t = this.peek();
    if (!t || (t.type !== 'word' && t.type !== 'qident')) throw sqlError(`Se esperaba ${what}`, t ?? this.tokens.at(-1));
    this.pos += 1;
    return { name: t.value.toLowerCase(), original: t.value, line: t.line };
  }

  /** Nombre de tabla, admite base.tabla. */
  tableName() {
    let id = this.ident('el nombre de la tabla');
    if (this.isPunct('.')) {
      this.pos += 1;
      id = this.ident('el nombre de la tabla');
    }
    return id;
  }

  warn(message) {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  /** Salta una expresión simple (valor DEFAULT): token, función(...) o (...). */
  skipValue() {
    if (this.isPunct('(')) return this.skipParens();
    this.next();
    if (this.isPunct('(')) this.skipParens();
  }

  skipParens() {
    this.expectPunct('(');
    let depth = 1;
    while (depth > 0) {
      const t = this.next();
      if (t.type === 'punct' && t.value === '(') depth += 1;
      if (t.type === 'punct' && t.value === ')') depth -= 1;
    }
  }

  /** Lista entre paréntesis de números: VARCHAR(255), DECIMAL(18,4). */
  typeArgs() {
    const args = [];
    if (!this.isPunct('(')) return args;
    this.pos += 1;
    while (!this.isPunct(')')) {
      const t = this.next();
      if (t.type === 'number') args.push(Number(t.value));
      else if (!(t.type === 'punct' && t.value === ',')) throw sqlError(`Valor inesperado "${t.value}" en el tipo`, t);
    }
    this.pos += 1;
    return args;
  }

  dataType() {
    const t = this.next();
    if (t.type !== 'word') throw sqlError('Se esperaba el tipo de la columna', t);
    const name = t.value.toUpperCase();
    if (name === 'DOUBLE') this.accept('PRECISION');
    const args = this.typeArgs();
    while (this.accept('UNSIGNED') || this.accept('SIGNED') || this.accept('ZEROFILL')) { /* sin efecto */ }
    const type = mapType(name, args);
    if (!type) throw sqlError(`Tipo no soportado: ${t.value}. Usa VARCHAR, TEXT, INT/BIGINT, DECIMAL, DATE, DATETIME o BOOLEAN`, t);
    return type;
  }

  /** nombre tipo [atributos]. Termina antes de "," o ")" o al final de la sentencia. */
  columnDef() {
    const id = this.ident('el nombre de la columna');
    if (SYSTEM_COLUMNS.includes(id.name)) throw sqlError(`"${id.name}" es una columna del sistema; el Data Hub la crea automáticamente`, id);
    const column = {
      db_name: id.name, excel_name: id.original, data_type: this.dataType(),
      is_key: false, nullable: true, nullSpecified: false, comment: false, line: id.line,
    };

    for (;;) {
      const t = this.peek();
      if (!t || (t.type === 'punct' && [',', ')', ';'].includes(t.value))) break;
      if (this.accept('NOT', 'NULL')) { column.nullable = false; column.nullSpecified = true; }
      else if (this.accept('NULL')) { column.nullable = true; column.nullSpecified = true; }
      else if (this.accept('PRIMARY', 'KEY') || this.accept('KEY')) { column.is_key = true; column.nullable = false; }
      else if (this.accept('UNIQUE')) { this.accept('KEY'); column.is_key = true; column.nullable = false; }
      else if (this.accept('COMMENT')) {
        const s = this.next();
        if (s.type !== 'string') throw sqlError('COMMENT debe ir seguido de un texto entre comillas', s);
        column.excel_name = s.value.trim();
        column.comment = true;
      } else if (this.accept('DEFAULT')) { this.skipValue(); this.warn('DEFAULT se ignora: los valores vienen del Excel'); }
      else if (this.accept('AUTO_INCREMENT')) this.warn('AUTO_INCREMENT se ignora: el Data Hub ya numera las filas en _id');
      else if (this.accept('ON', 'UPDATE')) this.skipValue();
      else if (this.accept('CHARACTER', 'SET') || this.accept('CHARSET') || this.accept('COLLATE')) this.next();
      else if (this.accept('FIRST')) this.warn('FIRST/AFTER se ignoran: las columnas nuevas se agregan al final');
      else if (this.accept('AFTER')) { this.ident(); this.warn('FIRST/AFTER se ignoran: las columnas nuevas se agregan al final'); }
      else throw sqlError(`Atributo no soportado: "${t.value}"`, t);
    }
    return column;
  }

  /** (col1, col2(10) ASC, ...) */
  columnList() {
    const names = [];
    this.expectPunct('(');
    for (;;) {
      names.push(this.ident('el nombre de una columna'));
      if (this.isPunct('(')) this.skipParens();
      this.accept('ASC');
      this.accept('DESC');
      if (this.isPunct(',')) { this.pos += 1; continue; }
      this.expectPunct(')');
      return names;
    }
  }

  /** Salta hasta la siguiente "," o ")" del nivel actual (restricciones ignoradas). */
  skipItem() {
    while (this.peek() && !this.isPunct(',') && !this.isPunct(')')) {
      if (this.isPunct('(')) this.skipParens();
      else this.next();
    }
  }

  endOfStatement() { return !this.peek() || this.isPunct(';'); }
}

function mapType(name, args) {
  switch (name) {
    case 'VARCHAR': case 'CHAR': case 'NVARCHAR': case 'NCHAR': case 'VARCHAR2': return 'text';
    case 'TEXT': case 'TINYTEXT': case 'MEDIUMTEXT': case 'LONGTEXT': return 'longtext';
    case 'TINYINT': return args[0] === 1 ? 'boolean' : 'int';
    case 'INT': case 'INTEGER': case 'BIGINT': case 'SMALLINT': case 'MEDIUMINT': return 'int';
    case 'BOOL': case 'BOOLEAN': case 'BIT': return 'boolean';
    case 'DECIMAL': case 'NUMERIC': case 'DEC': case 'FLOAT': case 'DOUBLE': case 'REAL': return 'decimal';
    case 'DATE': return 'date';
    case 'DATETIME': case 'TIMESTAMP': return 'datetime';
    default: return null;
  }
}

/** Divide los tokens en sentencias separadas por ";" (vacías se descartan). */
function statements(tokens) {
  const list = [[]];
  for (const t of tokens) {
    if (t.type === 'punct' && t.value === ';') list.push([]);
    else list.at(-1).push(t);
  }
  return list.filter((s) => s.length);
}

const publicColumn = (c) => ({
  excel_name: c.excel_name, db_name: c.db_name, data_type: c.data_type, is_key: c.is_key, nullable: c.nullable,
});

// ---------------------------------------------------------------- CREATE TABLE

/** CREATE TABLE -> { slug, columns, warnings } (las columnas se validan después con validateColumns). */
export function parseCreateTable(sql) {
  const stmts = statements(tokenize(sql));
  if (stmts.length !== 1) throw sqlError('Escribe exactamente una sentencia CREATE TABLE');
  const p = new Parser(stmts[0]);
  p.expect('CREATE');
  p.accept('TEMPORARY');
  p.expect('TABLE');
  p.accept('IF', 'NOT', 'EXISTS');
  const table = p.tableName();
  p.expectPunct('(');

  const columns = [];
  const keyGroups = [];
  for (;;) {
    // CONSTRAINT [nombre] PRIMARY KEY / UNIQUE / FOREIGN KEY / CHECK
    if (p.accept('CONSTRAINT') && !['PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK'].some((kw) => p.isWord(kw))) p.ident();
    if (p.accept('PRIMARY', 'KEY')) keyGroups.push(p.columnList());
    else if (p.accept('UNIQUE')) {
      if (!p.accept('KEY')) p.accept('INDEX');
      if (!p.isPunct('(')) p.ident();
      keyGroups.push(p.columnList());
    } else if (p.isWord('KEY') || p.isWord('INDEX') || p.isWord('FOREIGN') || p.isWord('CHECK') || p.isWord('FULLTEXT')) {
      p.warn('Índices, FOREIGN KEY y CHECK se ignoran: el Data Hub crea su propio índice de clave');
      p.skipItem();
    } else columns.push(p.columnDef());

    if (p.isPunct(',')) { p.pos += 1; continue; }
    p.expectPunct(')');
    break;
  }
  if (!p.endOfStatement()) p.warn('Las opciones de tabla (ENGINE, CHARSET…) se ignoran');

  if (keyGroups.length > 1) p.warn('El Data Hub usa una sola clave: se combinaron todas las PRIMARY KEY/UNIQUE en una clave compuesta');
  for (const id of keyGroups.flat()) {
    const col = columns.find((c) => c.db_name === id.name);
    if (!col) throw sqlError(`La clave usa la columna "${id.original}", que no está definida`, id);
    col.is_key = true;
    col.nullable = false;
  }
  if (!columns.length) throw sqlError('Define al menos una columna');
  return { slug: table.name.replace(/^dh_/, ''), name: table.original, columns: columns.map(publicColumn), warnings: p.warnings };
}

// ---------------------------------------------------------------- ALTER TABLE

/**
 * ALTER TABLE (una o varias sentencias, una o varias cláusulas) -> { tables, ops, warnings }.
 * ops: { op: 'add', column } | { op: 'modify', name, column } | { op: 'change', name, column }
 *    | { op: 'rename', name, to } | { op: 'drop', name }
 */
export function parseAlterTable(sql) {
  const stmts = statements(tokenize(sql));
  if (!stmts.length) throw sqlError('Escribe al menos una sentencia ALTER TABLE');
  const ops = [];
  const tables = [];
  const warnings = [];

  for (const stmt of stmts) {
    const p = new Parser(stmt);
    p.expect('ALTER');
    p.expect('TABLE');
    tables.push(p.tableName());
    for (;;) {
      const start = p.peek();
      if (p.accept('ADD')) {
        if (p.isWord('PRIMARY') || p.isWord('UNIQUE') || p.isWord('INDEX') || p.isWord('KEY') || p.isWord('CONSTRAINT') || p.isWord('FOREIGN')) {
          throw sqlError('Agregar índices o claves no está soportado: la clave se define al crear la tabla', start);
        }
        p.accept('COLUMN');
        if (p.isPunct('(')) throw sqlError('Agrega las columnas una por una: ADD COLUMN nombre TIPO', start);
        ops.push({ op: 'add', column: p.columnDef(), line: start.line });
      } else if (p.accept('MODIFY')) {
        p.accept('COLUMN');
        const column = p.columnDef();
        ops.push({ op: 'modify', name: column.db_name, column, line: start.line });
      } else if (p.accept('CHANGE')) {
        p.accept('COLUMN');
        const old = p.ident('el nombre actual de la columna');
        ops.push({ op: 'change', name: old.name, column: p.columnDef(), line: start.line });
      } else if (p.accept('RENAME', 'COLUMN')) {
        const old = p.ident('el nombre actual de la columna');
        p.expect('TO');
        const to = p.ident('el nombre nuevo de la columna');
        ops.push({ op: 'rename', name: old.name, to: to.name, line: start.line });
      } else if (p.accept('DROP')) {
        if (p.isWord('PRIMARY') || p.isWord('INDEX') || p.isWord('KEY') || p.isWord('FOREIGN')) {
          throw sqlError('Eliminar índices o claves no está soportado', start);
        }
        p.accept('COLUMN');
        p.accept('IF', 'EXISTS');
        ops.push({ op: 'drop', name: p.ident('el nombre de la columna').name, line: start.line });
      } else {
        throw sqlError(
          `Operación no soportada${start ? `: "${start.value}"` : ''}. Usa ADD COLUMN, MODIFY COLUMN, CHANGE COLUMN, RENAME COLUMN o DROP COLUMN`,
          start ?? stmt.at(-1),
        );
      }
      if (p.isPunct(',')) { p.pos += 1; continue; }
      if (!p.endOfStatement()) throw sqlError(`Se esperaba "," o ";" y se encontró "${p.peek().value}"`, p.peek());
      break;
    }
    warnings.push(...p.warnings.filter((w) => !warnings.includes(w)));
  }
  return { tables, ops, warnings };
}

/**
 * Valida las operaciones contra la tabla simulando cada cambio en orden (sin tocar la BD).
 * Devuelve { steps, warnings } donde cada paso es
 * { kind: 'add', raw } | { kind: 'update', column, changes } | { kind: 'drop', column }, con su description.
 * column es el nombre en BD que tendrá la columna justo antes de ese paso (ejecutando en orden),
 * así funciona también con columnas agregadas o renombradas en el mismo SQL.
 */
export function planAlter(meta, sql) {
  const { tables, ops, warnings } = parseAlterTable(sql);
  const accepted = [meta.table.slug, meta.table.db_table].map((n) => n.toLowerCase());
  for (const t of tables) {
    if (!accepted.includes(t.name)) throw sqlError(`El ALTER TABLE es para "${t.original}", pero esta tabla es "${meta.table.slug}"`, t);
  }

  let columns = meta.columns.map((c) => ({ ...c }));
  let nextTempId = -1; // columnas agregadas en este mismo SQL
  const steps = [];
  const find = (name, op) => {
    const col = columns.find((c) => c.db_name === name);
    if (!col) throw sqlError(`La columna "${name}" no existe`, op);
    return col;
  };
  const label = (type) => DATA_TYPES[type].label;
  const at = (op, fn) => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && !/^Línea/.test(err.message)) throw sqlError(err.message, op);
      throw err;
    }
  };

  for (const op of ops) {
    if (op.op === 'add') {
      if (op.column.is_key || (op.column.nullSpecified && !op.column.nullable)) {
        throw sqlError(`"${op.column.db_name}": las columnas nuevas deben ser opcionales y no clave (la tabla puede tener datos)`, op);
      }
      const raw = publicColumn(op.column);
      const column = at(op, () => validateNewColumn(columns, raw));
      columns.push({ ...column, id: nextTempId-- });
      steps.push({ kind: 'add', raw, description: `Agregar columna ${column.db_name} (${label(column.data_type)}) · Excel "${column.excel_name}"` });
      continue;
    }

    const col = find(op.name, op);
    if (op.op === 'drop') {
      at(op, () => validateColumnDrop(columns, col));
      columns = columns.filter((c) => c !== col);
      steps.push({ kind: 'drop', column: col.db_name, description: `Eliminar columna ${col.db_name} y sus datos` });
      continue;
    }

    const changes = op.op === 'rename'
      ? { db_name: op.to }
      : {
        db_name: op.column.db_name,
        data_type: op.column.data_type,
        ...(op.column.comment ? { excel_name: op.column.excel_name } : {}),
      };
    if (op.column && (op.column.is_key !== col.is_key || (op.column.nullSpecified && op.column.nullable !== col.nullable))) {
      warnings.push(`"${col.db_name}": cambiar clave u obligatorio no está soportado; se conserva como está`);
    }
    const target = at(op, () => validateColumnUpdate(columns, col, changes));
    const parts = [];
    if (target.db_name !== col.db_name) parts.push(`renombrar a ${target.db_name}`);
    if (target.data_type !== col.data_type) parts.push(`cambiar tipo ${label(col.data_type)} → ${label(target.data_type)} (convierte los datos)`);
    if (target.excel_name !== col.excel_name) parts.push(`nombre en Excel "${target.excel_name}"`);
    if (!parts.length) {
      warnings.push(`"${col.db_name}": sin cambios`);
      continue;
    }
    steps.push({ kind: 'update', column: col.db_name, changes, description: `Columna ${col.db_name}: ${parts.join(', ')}` });
    columns = columns.map((c) => (c === col ? { ...c, ...target } : c));
  }
  if (!steps.length && !warnings.length) warnings.push('El SQL no genera cambios');
  return { steps, warnings };
}

// ---------------------------------------------------------------- generador

const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** CREATE TABLE en el dialecto que entiende el modo SQL (sin columnas de sistema). */
export function toCreateSql(slug, columns) {
  const keys = columns.filter((c) => c.is_key).map((c) => `\`${c.db_name}\``);
  const lines = columns.map((c) => [
    `\`${c.db_name}\``,
    DATA_TYPES[c.data_type]?.sql ?? 'VARCHAR(255)',
    c.is_key || !c.nullable ? 'NOT NULL' : 'NULL',
    `COMMENT ${sqlString(c.excel_name)}`,
  ].join(' '));
  if (keys.length) lines.push(`PRIMARY KEY (${keys.join(', ')})`);
  return `CREATE TABLE \`${slug}\` (\n  ${lines.join(',\n  ')}\n);`;
}
