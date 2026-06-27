import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      crypto: path.resolve(__dirname, 'src/crypto-shim.js'),
      path: path.resolve(__dirname, 'src/path-shim.js'),
      events: path.resolve(__dirname, 'src/events-shim.js'),
      http: path.resolve(__dirname, 'src/http-shim.js'),
      https: path.resolve(__dirname, 'src/http-shim.js'),
      url: path.resolve(__dirname, 'src/http-shim.js'),
      'node:sqlite': path.resolve(__dirname, 'src/http-shim.js'),
      buffer: 'buffer'
    }
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /client/, /src\/.*-shim\.js/]
    }
  },
  optimizeDeps: {
    include: ['decentrachat-client-sdk']
  },
  server: {
    watch: {
      ignored: ['**/test-results/**', '**/playwright-report/**']
    }
  },
  define: {
    global: 'globalThis',
    process: {
      env: {}
    }
  },
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : []
  }
})
