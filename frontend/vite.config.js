import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: ['socket.io-client'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173
  }
});
