# Data Hub

Administración de información por **categorías** (la primera es **RPAs**). Cada categoría contiene tablas MySQL que se crean desde el frontend, se alimentan con archivos Excel (`.xlsx` / `.xls`) o por HTTP, y se consultan desde otras aplicaciones.

Stack: **Express 5 + React 18 (Vite) + Node.js + MySQL 8**.

## Requisitos

- Node.js 20 o superior
- Servidor MySQL 8 (o MariaDB 10.6+) accesible

## Despliegue en un equipo (producción)

Ver **[DEPLOY.md](DEPLOY.md)**. Resumen:

- **Windows:** `instalar-windows.cmd` instala MySQL como servicio (sin XAMPP) y deja la app corriendo con PM2 y arranque automático.
- **Linux:** `bash scripts/linux/install.sh` (detalle abajo).

### Linux (Ubuntu 22.04 / 24.04, SUSE Linux Enterprise 15 / openSUSE Leap 15)

El script `scripts/linux/install.sh` detecta la distribución e instala la base de datos como servicio (MySQL en Ubuntu, MariaDB en SUSE), compila el frontend y deja la app corriendo con PM2. La app arranca sola al encender el servidor.

**Requisitos:** un usuario con `sudo`, acceso a internet, y `git` y `curl` instalados.

1. **Instala Node.js 20 o superior y las herramientas** (si `node --version` no responde o es menor):
   ```bash
   # Ubuntu
   sudo apt-get install -y git curl
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs

   # SUSE (SLES 15 / openSUSE Leap 15)
   sudo zypper --non-interactive install git curl nodejs22 npm22   # o nodejs20 npm20
   ```
   En SLES, los paquetes de Node.js vienen en el módulo *Web and Scripting*. Si `zypper` no los encuentra, actívalo con `sudo SUSEConnect -p sle-module-web-scripting/15.<SP>/x86_64`, usando el Service Pack del servidor (p. ej. `15.6`).
2. **Clona el repositorio.** El servidor despliega la rama que clones: los cambios tienen que estar en `main`, o indica la rama con `-b`.
   ```bash
   git clone https://github.com/RubenAriasSilva/Data-Hub.git
   cd Data-Hub
   ```
3. **Ejecuta el instalador**, sin `sudo`. El script lo pide solo cuando lo necesita:
   ```bash
   bash scripts/linux/install.sh                # instala MySQL (Ubuntu) o MariaDB (SUSE) si falta y despliega
   bash scripts/linux/install.sh --skip-mysql   # si ya tienes MySQL: antes edita backend/.env (cp backend/.env.example backend/.env)
   ```
   El script hace lo siguiente:
   - instala `mysql-server` (Ubuntu, con `apt`) o `mariadb` (SUSE, con `zypper`) y lo habilita en systemd;
   - crea la base `data_hub` y el usuario `datahub` con una contraseña aleatoria, y la guarda en `backend/.env`;
   - instala las dependencias y compila el frontend;
   - arranca la app con PM2 y registra PM2 en systemd;
   - verifica `/api/health` y muestra las URLs de acceso.
4. **Abre el puerto** si el servidor tiene firewall, para que otras computadoras entren:
   ```bash
   sudo ufw allow 4000/tcp                                                      # Ubuntu
   sudo firewall-cmd --permanent --add-port=4000/tcp && sudo firewall-cmd --reload   # SUSE
   ```
5. **Comprueba** que la app responde:
   ```bash
   curl http://localhost:4000/api/health   # {"status":"ok",...}
   ```
   Luego abre `http://<ip-del-servidor>:4000` en el navegador.

**Actualizar a una nueva versión:**
```bash
cd Data-Hub && git pull && bash scripts/linux/install.sh --skip-mysql
```

**Operación:**
- Estado: `pm2 status`
- Logs: `pm2 logs data-hub`
- Reiniciar tras editar `backend/.env`: `pm2 restart data-hub --update-env`
- Base de datos: `sudo systemctl status mysql` (Ubuntu) o `sudo systemctl status mariadb` (SUSE)

Respaldo, configuración y problemas comunes: ver [DEPLOY.md](DEPLOY.md).

> **Debian:** no trae el paquete `mysql-server`, así que el instalador falla en ese paso. Instala antes MySQL o MariaDB (`sudo apt-get install -y mariadb-server`), configura `backend/.env` y ejecuta el script con `--skip-mysql`.

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

Si en el mismo equipo ya corre producción (PM2 en el puerto 4000 con la base `data_hub`), crea `backend/.env.local` para no chocar con ella ni tocar sus datos. No se versiona, sobrescribe lo que haya en `.env` y producción (`NODE_ENV=production`) lo ignora; el frontend de desarrollo usa ese mismo puerto:
```
PORT=4001
DB_NAME=data_hub_dev
```

Al arrancar, el backend crea la base de datos (`DB_NAME`), las tablas de metadatos y la categoría **RPAs**. Si MySQL no está disponible, la API responde 503 y reintenta la conexión cada 10 s.

Producción: `npm run build` y luego `npm start`. El backend sirve el frontend compilado en el mismo puerto.

## Cómo funciona

0. **Organización**: cada categoría puede tener tablas directas (p. ej. *RPAs → iw39*) y/o **aplicaciones** que agrupan tablas (*Categoría → Aplicación → Tablas*). Las aplicaciones se crean desde la página de la categoría (*Nueva aplicación*).
1. **Crear tabla** (Categoría o Aplicación → *Nueva tabla*): para cada columna se define el *nombre en Excel* (puede tener espacios, acentos, símbolos), el *nombre en BD* (se sugiere automáticamente, p. ej. `Número de Orden` → `numero_de_orden`), el *tipo* y si es *clave*. Con *Detectar desde Excel* se proponen las columnas a partir de un archivo de ejemplo. En la pestaña **SQL** se puede escribir un `CREATE TABLE` (ver *Modo SQL*).
2. La tabla física se llama `dh_<categoria>_<tabla>` (o `dh_<categoria>_<aplicacion>_<tabla>`, máx. 64 caracteres) e incluye `_id`, `_created_at` y `_updated_at`. Las columnas clave forman un índice `UNIQUE`.
3. **Cargar Excel**: los encabezados se comparan sin distinguir mayúsculas, acentos ni espacios extra. Se hace **upsert**: si la clave ya existe, la fila se actualiza; si no, se inserta. Las filas con valores inválidos se rechazan individualmente y se reportan (fila, columna, motivo). Cada carga queda en el **Historial**.
4. **Editar columnas** (pestaña *Estructura*): se puede cambiar el nombre en Excel, el nombre en BD y el tipo. Al cambiar el tipo, los datos existentes se convierten; si algún valor no es compatible, se listan los problemas y la tabla no se modifica. También se puede hacer con *Editar con SQL*.

Tipos: Texto (`VARCHAR(255)`), Texto largo (`TEXT`), Entero (`BIGINT`), Decimal (`DECIMAL(18,4)`), Fecha (`DATE`), Fecha y hora (`DATETIME`), Booleano (`TINYINT(1)`). Las fechas en texto se aceptan como `AAAA-MM-DD` o `DD/MM/AAAA`.

### Modo SQL

El SQL no se ejecuta en MySQL: el Data Hub lo interpreta (dialecto MySQL) y lo aplica con las mismas validaciones que el formulario.

- **Crear** (`CREATE TABLE`): `COMMENT '…'` es el nombre en Excel (si falta, se usa el nombre de la columna); `PRIMARY KEY`/`UNIQUE` marcan la clave. Tipos: `VARCHAR/CHAR` → Texto, `TEXT` → Texto largo, `INT/BIGINT/SMALLINT` → Entero, `DECIMAL/FLOAT/DOUBLE` → Decimal, `DATE`, `DATETIME/TIMESTAMP`, `BOOLEAN/TINYINT(1)`. El resultado se carga en el formulario para revisarlo antes de crear.
- **Editar** (`ALTER TABLE`, pestaña *Estructura → Editar con SQL*): `ADD COLUMN` (siempre opcional y no clave), `MODIFY COLUMN` / `CHANGE COLUMN` (cambia tipo convirtiendo los datos, nombre en BD y, con `COMMENT`, el nombre en Excel), `RENAME COLUMN a TO b` y `DROP COLUMN` (no en columnas clave). Primero *Vista previa* muestra los pasos; el DDL de MySQL no es transaccional, así que si un paso falla los anteriores quedan aplicados y se indica cuál falló.

```sql
ALTER TABLE ordenes
  ADD COLUMN moneda VARCHAR(255) COMMENT 'Moneda',
  MODIFY COLUMN autor TEXT,
  RENAME COLUMN monto TO total;
```

## API pública

Sin autenticación (pensada para red interna). Base: `http://<servidor>:4000/api/v1`. Cada tabla tiene salidas y entradas. Para tablas dentro de una aplicación la ruta incluye la aplicación: `/api/v1/:categoria/:aplicacion/:tabla` (y `.../upload`).

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
