import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Mismo puerto que el backend: backend/.env, sobrescrito por backend/.env.local si existe
  const backendEnv = loadEnv(mode, path.resolve(__dirname, '../backend'), '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': `http://localhost:${backendEnv.PORT || 4000}` },
    },
  };
});
