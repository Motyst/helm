import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // A new build takes over and reloads open windows, so a wall display never runs stale code.
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Helm',
        short_name: 'Helm',
        description: 'A calm, live task board for you and your AI agents.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f1c27',
        theme_color: '#0f1c27',
        categories: ['productivity'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Board', url: '/#/board' },
          { name: 'Done', url: '/#/done' },
        ],
      },
      workbox: {
        // App shell only. Data always comes live from /api (including the SSE stream), never from the cache.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Extra font subsets still load on demand when a page needs them.
        globIgnores: ['**/*-vietnamese-*'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Needed for autoUpdate: the new worker takes over at once and the page reloads onto it.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: false },
    },
  },
});
