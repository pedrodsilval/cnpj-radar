import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth':        'http://localhost:3000',
      '/cnpj':        'http://localhost:3000',
      '/leads':       'http://localhost:3000',
      '/certidoes':   'http://localhost:3000',
      '/uploads':     'http://localhost:3000',
      '/credenciais': 'http://localhost:3000',
      '/painel':      'http://localhost:3000',
      '/dashboard':   'http://localhost:3000',
      '/tarefas':     'http://localhost:3000',
      '/workflow-runs': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    globals: true,
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
