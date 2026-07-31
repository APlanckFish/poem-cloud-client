import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 4178,
  },
  preview: {
    host: '0.0.0.0',
    port: 4178,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    assetsInlineLimit: 4096,
  },
})
