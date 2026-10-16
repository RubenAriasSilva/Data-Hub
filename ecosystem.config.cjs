// Configuración de PM2. Un solo proceso: el backend también sirve el frontend compilado (frontend/dist).
//   npm run deploy        -> compila y arranca/recarga con PM2
//   pm2 logs data-hub     -> logs en vivo
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'data-hub',
      cwd: path.join(__dirname, 'backend'),
      script: 'src/server.js',
      env: { NODE_ENV: 'production' },
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 3000,
      max_memory_restart: '512M',
      time: true, // marca de tiempo en los logs
    },
  ],
};
