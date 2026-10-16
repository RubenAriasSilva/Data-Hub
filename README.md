# Data Hub

Administración de información por **categorías** (la primera es **RPAs**). Cada categoría contiene tablas MySQL que se crean desde el frontend, se alimentan con archivos Excel (`.xlsx` / `.xls`) o por HTTP, y se consultan desde otras aplicaciones.

Stack: **Express 5 + React 18 (Vite) + Node.js + MySQL 8**.

## Requisitos

- Node.js 20 o superior
- Servidor MySQL 8 (o MariaDB 10.6+) accesible

## Instalación

```bash
npm run install:all
cp backend/.env.example backend/.env   # editar credenciales de MySQL
npm run dev                            # API en :4000 y frontend en :5173
```

Al arrancar, el backend crea la base de datos (`DB_NAME`), las tablas de metadatos y la categoría **RPAs**. Si MySQL no está disponible, la API responde 503 y reintenta la conexión cada 10 s.

Producción: `npm run build` y luego `npm start`. El backend sirve el frontend compilado en el mismo puerto.

## Cómo funciona

1. **Crear tabla** (Categoría → *Nueva tabla*): para cada columna se define el *nombre en Excel* (puede tener espacios, acentos, símbolos), el *nombre en BD* (se sugiere automáticamente, p. ej. `Número de Orden` → `numero_de_orden`), el *tipo* y si es *clave*. Con *Detectar desde Excel* se proponen las columnas a partir de un archivo de ejemplo.
2. La tabla física se llama `dh_<categoria>_<tabla>` e incluye `_id`, `_created_at` y `_updated_at`. Las columnas clave forman un índice `UNIQUE`.
3. **Cargar Excel**: los encabezados se comparan sin distinguir mayúsculas, acentos ni espacios extra. Se hace **upsert**: si la clave ya existe, la fila se actualiza; si no, se inserta. Las filas con valores inválidos se rechazan individualmente y se reportan (fila, columna, motivo). Cada carga queda en el **Historial**.

Tipos: Texto (`VARCHAR(255)`), Texto largo (`TEXT`), Entero (`BIGINT`), Decimal (`DECIMAL(18,4)`), Fecha (`DATE`), Fecha y hora (`DATETIME`), Booleano (`TINYINT(1)`). Las fechas en texto se aceptan como `AAAA-MM-DD` o `DD/MM/AAAA`.

## API para aplicaciones / RPAs

Sin autenticación (pensada para red interna). Base: `http://<servidor>:4000/api/v1`

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1` | Catálogo de tablas |
| GET | `/api/v1/:categoria/:tabla` | Leer registros: `page`, `limit` (≤5000), `sort`, `order`, `q`, `updated_since`, `<columna>=<valor>` |
| GET | `/api/v1/:categoria/:tabla/schema` | Columnas, tipos y claves |
| GET | `/api/v1/:categoria/:tabla/export` | Descargar .xlsx |
| POST | `/api/v1/:categoria/:tabla` | Upsert JSON: `[{...}]` o `{ "rows": [{...}] }` (llaves por nombre en BD o en Excel) |
| POST | `/api/v1/:categoria/:tabla/upload` | Upsert desde Excel (multipart, campo `file`) |
| DELETE | `/api/v1/:categoria/:tabla?<clave>=<valor>` | Eliminar por clave |

Las escrituras responden `200` (`status: success | partial`) o `422` si ninguna fila fue válida, con `inserted`, `updated`, `failed` y `errors`.

En la pestaña **API** de cada tabla hay ejemplos listos para copiar (curl y Python).

## Pruebas

```bash
npm test   # pruebas unitarias del backend (conversión de tipos, lectura de Excel, validación)
```

## Pendiente

- Reemplazar `frontend/public/ZF_logo.svg` (es un marcador de posición) por el logo oficial `ZF_logo_STD_Blue_3CC.svg`.
