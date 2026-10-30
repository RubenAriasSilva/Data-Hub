# Despliegue del Data Hub

En producción corre **un solo proceso** bajo PM2: el backend sirve la API y también el frontend compilado. Todo queda en un puerto (por defecto **4000**). MySQL corre como **servicio del sistema**, sin XAMPP, y ambos arrancan solos al encender el equipo.

```
Encendido ─► servicio MySQL ─► PM2 ─► Data Hub  (http://<equipo>:4000)
```

Si MySQL tarda en arrancar, la app espera y reintenta la conexión cada 10 s.

---

## Windows (10 / 11 / Server)

**Requisitos:** [Node.js LTS](https://nodejs.org) (20 o superior) y [Git](https://git-scm.com) para clonar el repositorio.

```powershell
git clone https://github.com/RubenAriasSilva/Data-Hub.git
cd Data-Hub
.\instalar-windows.cmd
```

`instalar-windows.cmd` hace dos pasos (también se puede abrir con doble clic):

1. **`scripts\windows\setup-mysql.ps1`**: pide permiso de administrador y luego:
   - descarga MySQL 8.4 LTS (~250 MB) en `C:\mysql`;
   - lo registra como servicio **MySQL84** con inicio automático;
   - crea la base `data_hub` y el usuario `datahub` con una contraseña aleatoria;
   - escribe las credenciales en `backend\.env`.

   Al final muestra la contraseña de **root**; guárdala, porque no se almacena en ningún archivo.
2. **`scripts\windows\deploy.ps1`**:
   - instala las dependencias y compila el frontend;
   - instala PM2 si falta y deja la app corriendo;
   - registra el arranque automático al iniciar sesión (carpeta *Inicio* de Windows);
   - verifica la app y muestra las URLs de acceso.

**Opciones útiles:**

```powershell
# MySQL en otro puerto (p. ej. si ya hay un XAMPP en el 3306)
powershell -ExecutionPolicy Bypass -File scripts\windows\setup-mysql.ps1 -Port 3307

# Equipo sin internet: descarga antes mysql-8.4.6-winx64.zip y pásalo
powershell -ExecutionPolicy Bypass -File scripts\windows\setup-mysql.ps1 -ZipPath D:\mysql-8.4.6-winx64.zip

# Abrir el puerto en el firewall para que otras computadoras accedan (terminal de administrador)
powershell -ExecutionPolicy Bypass -File scripts\windows\deploy.ps1 -OpenFirewall
```

**Si ya tienes un MySQL** (otro servidor, XAMPP, etc.), omite el paso 1. Ejecuta solo `deploy.ps1`: si no existe `backend\.env`, te pedirá los datos de conexión.

**Arranque automático:** PM2 se restaura al **iniciar sesión** en Windows. En un servidor que debe levantar la app sin que nadie inicie sesión, configura el inicio de sesión automático del usuario o registra PM2 como servicio con [pm2-installer](https://github.com/jessety/pm2-installer).

## Linux (Ubuntu / SUSE)

```bash
git clone https://github.com/RubenAriasSilva/Data-Hub.git
cd Data-Hub
bash scripts/linux/install.sh          # instala MySQL (Ubuntu) o MariaDB (SUSE) si falta + despliega
bash scripts/linux/install.sh --skip-mysql   # si MySQL ya está configurado en backend/.env
```

El script hace lo siguiente:
- instala `mysql-server` (Ubuntu, `apt`) o `mariadb` (SUSE, `zypper`) y lo habilita en systemd;
- crea la base y el usuario `datahub`, y escribe `backend/.env`;
- compila el frontend y arranca la app con PM2;
- registra PM2 en systemd con `pm2 startup`, así la app arranca con el equipo aunque nadie inicie sesión.

En SUSE, Node.js se instala con `sudo zypper install nodejs22 npm22`. En SLES requiere el módulo *Web and Scripting*. Ver los pasos completos en el [README](README.md).

---

## Actualizar a una nueva versión

```bash
git pull
# Windows
powershell -ExecutionPolicy Bypass -File scripts\windows\deploy.ps1
# Linux
bash scripts/linux/install.sh --skip-mysql
```

Los scripts son idempotentes: reinstalan dependencias, recompilan y recargan la app sin tocar los datos.

## Operación diaria

| Acción | Comando |
|---|---|
| Estado | `pm2 status` |
| Logs en vivo | `pm2 logs data-hub` |
| Reiniciar (p. ej. tras editar `.env`) | `pm2 restart data-hub --update-env` |
| Detener / iniciar | `pm2 stop data-hub` / `pm2 start data-hub` |
| MySQL (Windows) | `net stop MySQL84` / `net start MySQL84` |
| MySQL (Ubuntu) | `sudo systemctl stop mysql` / `sudo systemctl start mysql` |
| MariaDB (SUSE) | `sudo systemctl stop mariadb` / `sudo systemctl start mariadb` |
| Salud de la app | `http://localhost:4000/api/health` |

Desde la raíz del repositorio también puedes usar `npm run deploy`, `npm run deploy:status`, `npm run deploy:logs`, `npm run deploy:restart` y `npm run deploy:stop`.

## Configuración (`backend/.env`)

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `4000` | Puerto de la app (web y API) |
| `HOST` | `0.0.0.0` | `0.0.0.0` = accesible desde la red; `127.0.0.1` = solo este equipo |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | | Conexión MySQL. La base se crea si no existe |
| `MONGO_URI`, `MONGO_DB` | vacío, `data_hub` | MongoDB opcional para tablas de tipo MongoDB (ver README). Vacío = deshabilitado |
| `MAX_UPLOAD_MB` | `20` | Tamaño máximo de los archivos Excel |

Después de cambiar `.env`, ejecuta `pm2 restart data-hub --update-env`.

## Respaldo de datos

```bash
mysqldump -u root -p data_hub > respaldo_data_hub.sql      # respaldar
mysql -u root -p data_hub < respaldo_data_hub.sql          # restaurar
```

En Windows, los ejecutables están en `C:\mysql\mysql-8.4.6-winx64\bin\`.

Si usas tablas MongoDB, respáldalas también (`mongodump` y `mongorestore` vienen en las MongoDB Database Tools):

```bash
mongodump --uri "mongodb://127.0.0.1:27017" --db data_hub --out respaldo_mongo      # respaldar
mongorestore --uri "mongodb://127.0.0.1:27017" respaldo_mongo                       # restaurar
```

Un `.bson` de `mongodump` también se puede cargar directamente en una colección desde *Cargar datos → BSON*.

## Problemas comunes

- **"El puerto 3306 ya está en uso"**: hay otro MySQL o un XAMPP corriendo. Detenlo, o usa `-Port 3307` y la app tomará ese puerto desde `.env`.
- **La interfaz dice "Sin conexión a MySQL"**: revisa el servicio (`Get-Service MySQL84` o `systemctl status mysql`, o `systemctl status mariadb` en SUSE) y las credenciales en `backend/.env`.
- **Otras computadoras no pueden entrar**: abre el puerto en el firewall (`-OpenFirewall` en Windows, `sudo ufw allow 4000/tcp` en Ubuntu, `sudo firewall-cmd --permanent --add-port=4000/tcp && sudo firewall-cmd --reload` en SUSE) y usa la IP que muestra el script.
- **PowerShell bloquea el script**: ejecútalo con `powershell -ExecutionPolicy Bypass -File ...` o usa `instalar-windows.cmd`.
