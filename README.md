# AI Chain Explorer

A clickable, source-grounded map of the money flowing between AI labs, clouds, chipmakers, fabs and toolmakers. Every figure carries its source, status (filed, reported, claimed, unverified), confidence and age.

**Live:** https://lmteles.github.io/ai-chain-explorer/ · **How to use it:** [docs/MANUAL.md](docs/MANUAL.md)

Not investment advice. Anthropic is a node in this graph and the optional Ask assistant is built by Anthropic.

## For developers

```bash
pnpm install
pnpm dev            # http://localhost:5173 (the review queue writes only here)
pnpm test           # unit tests; pnpm e2e for the browser click-through
pnpm ingest:sec     # also ingest:macro, ingest:news, ingest:ir (need .env.local, see .env.example)
```

Static site (Vite + React + TypeScript) on GitHub Pages; data lives as JSON in `public/data/`, refreshed by GitHub Actions. Project rules and conventions: [CLAUDE.md](CLAUDE.md).
