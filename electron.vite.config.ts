import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Native / heavy runtime deps: ship unbundled. better-sqlite3 is rebuilt for the Electron ABI
        // (ADR-004); @xenova/transformers loads ONNX weights from userData at runtime (ADR-001/012).
        external: ['better-sqlite3', '@xenova/transformers']
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      react(),
      tailwindcss(),
      // Ship a strict Content-Security-Policy in the PACKAGED renderer (defence-in-depth atop sandbox +
      // contextIsolation). Build-only: the dev server + React Fast Refresh inject inline scripts that a
      // strict policy would block. The packaged bundle loads only local same-origin assets, embeds
      // portraits as data: URIs, and makes no network calls (all IO is IPC), so 'self' + inline styles is
      // tight but sufficient. Injected at head-start so it governs the bundle's own <script>.
      {
        name: 'ledger-csp-meta',
        apply: 'build',
        transformIndexHtml() {
          return [
            {
              tag: 'meta',
              attrs: {
                'http-equiv': 'Content-Security-Policy',
                content: [
                  "default-src 'self'",
                  "script-src 'self'",
                  "style-src 'self' 'unsafe-inline'",
                  "img-src 'self' data:",
                  "font-src 'self'",
                  "connect-src 'self'",
                  "object-src 'none'",
                  "base-uri 'none'",
                  "frame-src 'none'"
                ].join('; ')
              },
              injectTo: 'head-prepend' as const
            }
          ]
        }
      }
    ]
  }
})
