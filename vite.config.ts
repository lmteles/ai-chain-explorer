import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { reviewPlugin } from './scripts/review-plugin.ts';

// Relative base + hash routing: the build works under any GitHub Pages repo path.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), reviewPlugin()],
  test: { include: ['tests/unit/**/*.test.ts'] },
});
