import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    testTimeout: 10000,
    // Playwright specs run via `npm run test:e2e`, not Vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
  build: {
    outDir: "../graupel/react",
    emptyOutDir: true,
  },
})
