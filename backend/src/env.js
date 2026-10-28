// Se importa primero en server.js para que las variables existan antes de cargar los demás módulos.
// Se carga backend/.env sin importar el directorio desde el que se lance el proceso (npm, PM2, servicio).
// override: el .env manda sobre el entorno del sistema (p. ej. SUSE define HOST=<nombre del equipo>).
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(dir, '.env'), quiet: true, override: true });
// .env.local (opcional, no se versiona): sobrescribe valores para desarrollo, p. ej. otro PORT y DB_NAME
// para probar en el mismo equipo donde corre producción sin tocarla. Producción (PM2, NODE_ENV=production)
// lo ignora: suele correr desde la misma carpeta.
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.join(dir, '.env.local'), quiet: true, override: true });
}
