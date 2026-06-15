import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  css: {
    postcss: resolve('postcss.config.js')
  },
  build: {
    outDir: resolve('dist'),
    emptyOutDir: true
  },
  test: {
    root: resolve('.')
  }
})
