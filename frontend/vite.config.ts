import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// A Vercel build without the API URL would silently point every user at localhost.
if (process.env.VERCEL && !process.env.VITE_API_URL) {
  throw new Error('Set VITE_API_URL (e.g. https://siteward-api.onrender.com/api) in Vercel.');
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The user decides when to load a new version (UpdatePrompt), so a half-filled form is
      // never reloaded under them.
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Siteward',
        short_name: 'Siteward',
        description: 'Field inspections that work without signal.',
        theme_color: '#1E4FA3',
        background_color: '#EEF4FC',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell: everything the build emits, including the bundled Inter font.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // SPA: any navigation (e.g. /inspections/123 opened offline) gets the cached index.html.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // First install takes control of the open page at once, so it works offline immediately.
        clientsClaim: true,
      },
    }),
  ],
  server: { port: 5173 },
  preview: { port: 4173 },
});
