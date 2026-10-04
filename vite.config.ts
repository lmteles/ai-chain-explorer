import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { reviewPlugin } from './scripts/review-plugin.ts';

// Published site only (the dev server needs inline scripts): scripts from this site alone, and network calls only
// to this site and the Anthropic API, so an injected script could neither run nor send the Ask key elsewhere.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "connect-src 'self' https://api.anthropic.com", "object-src 'none'", "base-uri 'self'", "form-action 'none'",
].join('; ');
const csp = (): Plugin => ({
  name: 'csp', apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// Relative base + hash routing: the build works under any GitHub Pages repo path.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), reviewPlugin(), csp()],
  test: { include: ['tests/unit/**/*.test.ts'] },
});
