import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'))
const APP_VERSION = packageJson.version

// Plugin para injetar versão no Service Worker durante o build
const serviceWorkerVersionPlugin = () => {
  return {
    name: 'service-worker-version',
    writeBundle() {
      // Processar o sw.js no diretório dist após ser copiado do public/
      const swDistPath = resolve(__dirname, 'dist/sw.js')
      try {
        let swContent = readFileSync(swDistPath, 'utf-8')
        // Substituir qualquer versão (v1, v2, etc) pela versão atual do app
        swContent = swContent.replace(
          /const CACHE_NAME = ['"]recta-[^'"]+['"];?/,
          `const CACHE_NAME = 'recta-${APP_VERSION}';`
        )
        writeFileSync(swDistPath, swContent, 'utf-8')
      } catch (error) {
        // Arquivo pode não existir ainda, ignorar silenciosamente
        console.warn('Service Worker não encontrado em dist/, pulando injeção de versão')
      }
    }
  }
}

// The page's Content-Security-Policy (index.html) lists the hosts the app may call. A self-hosted build points
// VITE_API_BASE_URL at its own API, so that origin is added to connect-src at build time; without it the browser
// blocks every API request. Nothing changes when the variable is unset or already covered by the policy.
export const apiOriginCspPlugin = (apiBaseUrl: string | undefined) => {
  return {
    name: 'api-origin-csp',
    transformIndexHtml(html: string) {
      let origin: string
      try {
        const url = new URL(apiBaseUrl ?? '')
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return html
        origin = url.origin
      } catch {
        return html
      }
      return html.replace(/connect-src ([^;"]*)/, (match: string, sources: string) =>
        sources.split(/\s+/).includes(origin) ? match : `connect-src ${sources.trimEnd()} ${origin}`
      )
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), serviceWorkerVersionPlugin(), apiOriginCspPlugin(loadEnv(mode, process.cwd(), 'VITE_').VITE_API_BASE_URL)],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
  },
  build: {
    // Optimize chunk splitting for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'firebase-vendor': ['firebase/app', 'firebase/firestore', 'firebase/auth', 'firebase/analytics'],
          'ui-vendor': ['recharts', '@radix-ui/react-popover', 'cmdk'],
          'utils-vendor': ['date-fns', 'zod', 'react-hook-form', '@hookform/resolvers'],
        },
        // Ensure consistent chunk file names
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,
    // Source maps for production debugging (can be disabled for smaller builds)
    sourcemap: false,
    // Minify (using esbuild which is built-in, faster than terser)
    minify: 'esbuild',
    // Ensure assets are properly handled
    assetsDir: 'assets',
    // Build target for better compatibility
    target: 'esnext',
    // Ensure proper module format
    modulePreload: {
      polyfill: true,
    },
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
}))
