import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pages hosts this project below /<repository>/; local dev stays at /.
  base: process.env.GITHUB_ACTIONS ? '/telc-c1-trainer/' : '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
})
