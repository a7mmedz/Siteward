import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Run `npx pwa-assets-generator` after changing public/logo.svg; the PNGs are committed.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#1E4FA3' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#1E4FA3' } },
  },
  images: ['public/logo.svg'],
});
