# Data Hub

Administración de información por **categorías** (la primera es **RPAs**). Cada categoría contiene tablas MySQL que se crean desde el frontend, se alimentan con archivos Excel (`.xlsx` / `.xls`) o por HTTP, y se consultan desde otras aplicaciones.

Stack: **Express 5 + React 18 (Vite) + Node.js + MySQL 8**.

## Requisitos

- Node.js 20 o superior
- Servidor MySQL 8 (o MariaDB 10.6+) accesible

## Despliegue en un equipo (producción)

Ver **[DEPLOY.md](DEPLOY.md)**. Resumen:

- **Windows:** `instalar-windows.cmd` instala MySQL como servicio (sin XAMPP) y deja la app corriendo con PM2 y arranque automático.
- **Linux:** `bash scripts/linux/install.sh`.

## Desarrollo

1. Necesitas un MySQL corriendo. En Windows, la forma más simple es instalarlo como servicio con `scripts\windows\setup-mysql.ps1` (ver [DEPLOY.md](DEPLOY.md)). Ese script también crea `backend\.env` con las credenciales.
2. Instala las dependencias:
   ```
   npm run install:all
   ```
3. Solo si no usaste `setup-mysql.ps1`, crea el `.env` y edita las credenciales:
   - CMD: `copy backend\.env.example backend\.env`
   - PowerShell / Linux: `cp backend/.env.example backend/.env`
4. Arranca en modo desarrollo (API en http://localhost:4000, frontend en http://localhost:5173):
   ```
   npm run dev
   ```

Al arrancar, el backend crea la base de datos (`DB_NAME`), las tablas de metadatos y la categoría **RPAs**. Si MySQL no está disponible, la API responde 503 y reintenta la conexión cada 10 s.

Producción: `npm run build` y luego `npm start`. El backend sirve el frontend compilado en el mismo puerto.

## Cómo funciona

1. **Crear tabla** (Categoría → *Nueva tabla*): para cada columna se define el *nombre en Excel* (puede tener espacios, acentos, símbolos), el *nombre en BD* (se sugiere automáticamente, p. ej. `Número de Orden` → `numero_de_orden`), el *tipo* y si es *clave*. Con *Detectar desde Excel* se proponen las columnas a partir de un archivo de ejemplo.
2. La tabla física se llama `dh_<categoria>_<tabla>` e incluye `_id`, `_created_at` y `_updated_at`. Las columnas clave forman un índice `UNIQUE`.
3. **Cargar Excel**: los encabezados se comparan sin distinguir mayúsculas, acentos ni espacios extra. Se hace **upsert**: si la clave ya existe, la fila se actualiza; si no, se inserta. Las filas con valores inválidos se rechazan individualmente y se reportan (fila, columna, motivo). Cada carga queda en el **Historial**.
4. **Editar columnas** (pestaña *Estructura*): se puede cambiar el nombre en Excel, el nombre en BD y el tipo. Al cambiar el tipo, los datos existentes se convierten; si algún valor no es compatible, se listan los problemas y la tabla no se modifica.

Tipos: Texto (`VARCHAR(255)`), Texto largo (`TEXT`), Entero (`BIGINT`), Decimal (`DECIMAL(18,4)`), Fecha (`DATE`), Fecha y hora (`DATETIME`), Booleano (`TINYINT(1)`). Las fechas en texto se aceptan como `AAAA-MM-DD` o `DD/MM/AAAA`.

## API pública

Sin autenticación (pensada para red interna). Base: `http://<servidor>:4000/api/v1`. Cada tabla tiene salidas y entradas:

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/:categoria/:tabla` | **Salida (Power BI)**: CSV con todas las filas y los encabezados originales del Excel |
| GET | `/api/v1/:categoria/:tabla?format=json` | **Salida (apps/RPAs)**: JSON paginado (`page`, `limit` ≤ 5000, `sort`, `order`, `q`, `updated_since`, `?<columna>=valor`). También con `Accept: application/json` |
| POST | `/api/v1/:categoria/:tabla/upload` | **Entrada**: upsert desde Excel (multipart, campo `file`) |

Power BI: *Obtener datos → Web*, pegar la URL del GET y *Cargar*.

La carga responde `200` (`status: success | partial`) o `422` si ninguna fila fue válida, con `inserted`, `updated`, `failed` y `errors`.

En la pestaña **API** de cada tabla hay ejemplos listos para copiar (Power BI, curl y Python).

## Pruebas

```bash
npm test   # pruebas unitarias del backend (conversión de tipos, lectura de Excel, validación)
```
