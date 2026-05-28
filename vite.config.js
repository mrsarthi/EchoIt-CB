import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { resolve } from 'path'
import fs from 'fs'

import packageJson from './package.json'

// Parse Android version from build.gradle
let androidVersion = '1.0.0';
try {
  const gradlePath = resolve(__dirname, 'android/app/build.gradle');
  if (fs.existsSync(gradlePath)) {
    const gradleContent = fs.readFileSync(gradlePath, 'utf8');
    const versionMatch = gradleContent.match(/versionName\s+"([^"]+)"/);
    if (versionMatch && versionMatch[1]) {
      androidVersion = versionMatch[1];
    }
  }
} catch (error) {
  console.warn('Could not parse Android version from build.gradle', error);
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    // build.gradle is the single source of truth for version across all platforms
    '__APP_VERSION__': JSON.stringify(androidVersion),
    '__ANDROID_VERSION__': JSON.stringify(androidVersion),
  },
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    nodePolyfills({
      // To add only specific polyfills, add them here. If no option is passed, adds all.
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  // Base path for Electron - use relative paths for production
  base: './',
  build: {
    // Output directory
    outDir: 'dist',
    // Generate sourcemaps for debugging
    sourcemap: true,
    // Optimize for production
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // Keep console logs for debugging
      },
    },
    // Chunk splitting for better caching
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        auth: resolve(__dirname, 'public/auth.html'),
      },
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          crypto: ['tweetnacl', 'tweetnacl-util'],
          web3: ['ethers'],
        },
      },
    },
  },
  // Optimize dev server
  server: {
    port: 5173,
    strictPort: true,
  },
})
