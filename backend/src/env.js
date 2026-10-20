// Se importa primero en server.js para que las variables existan antes de cargar los demás módulos.
// Se carga backend/.env sin importar el directorio desde el que se lance el proceso (npm, PM2, servicio).
// override: el .env manda sobre el entorno del sistema (p. ej. SUSE define HOST=<nombre del equipo>).
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'), quiet: true, override: true });
