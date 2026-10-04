# Running the AI Chain Explorer online from GitHub

## Short answer
Yes, with one architectural change. GitHub Pages serves static files only, so it cannot run a server or a
database. The workaround is to make the app **static-first**: a scheduled GitHub Action fetches the data,
writes it as JSON files into the repository, and rebuilds the site. The browser then draws the clickable
graph from those files. You open `https://<your-username>.github.io/<repo>/` and click.

"Live" therefore means refreshed on a schedule (for example hourly for yields, daily for filings), not
tick-by-tick. For a map of multi-billion-dollar commitments that is the right cadence.

## What runs where
| Need | Where it runs | Cost |
|---|---|---|
| Clickable graph, drawers, flows, simulator | Your browser, from static files on GitHub Pages | Free (public repo) |
| Data refresh (SEC, FRED, news, TSMC/ASML) | GitHub Actions on a schedule; keys held in repository Secrets | Free quota; check current limits |
| Human review of proposed facts | A pull request: you approve by merging | Free |
| Daily written analysis per node and edge | GitHub Action calls the Anthropic API, saves JSON | Pay per API use |
| Live "Ask" questions | Browser calls the Anthropic API with your own key, typed into the page | Pay per API use |
| Building the app with no local setup | GitHub Codespaces (browser VS Code with a terminal) | 120 core-hours a month on GitHub Free |

Limits to know before you start:
- **Pages is public on a free personal account.** Publishing a Pages site privately needs an organisation account
  on a paid tier. The seed data is already public-sourced, but do not put anything confidential in the repository.
- **A static site cannot hold a secret.** API keys live only in Repository Secrets (used by Actions). Never put
  a key in the front-end code.
- **Scheduled Actions can be delayed and can be paused.** GitHub may disable scheduled workflows in repositories
  with no recent activity, so check the Actions tab if data goes stale. Verify the current rule in GitHub Docs.
- **Alternative if you want a real server:** import the repository into Vercel (free tier available) and it
  deploys on every push with API routes and cron. The static plan below also deploys there unchanged.

## Stack change (replaces the Next.js + SQLite assumptions in CLAUDE.md)
- Vite + React + TypeScript, **hash routing** (`/#/node/anthropic`) so deep links work on Pages
- Cytoscape.js, d3-sankey, Recharts as before
- No server, no SQLite. Data lives in `public/data/`:
  - `seed/seed_graph.json` (hand-curated, committed)
  - `live/metrics.json`, `live/metric_history.json`, `live/macro.json`, `live/filings.json` (written by Actions)
  - `approved/facts.json` (facts you approved by merging a pull request)
  - `briefs/<id>.json` (daily grounded analysis per node and edge)
- Zod validates every JSON file at load; the app refuses to render a number that fails validation.
- Ingest scripts remain Node scripts under `/scripts`; they now write JSON instead of database rows.
- Vite config: `base: '/<repo-name>/'`.

## Click path (no local machine required)
1. **GitHub**: New repository, public, add a README. Name it, for example, `ai-chain-explorer`.
2. **Add the kit**: Add file, Upload files: `CLAUDE.md`, `BUILD_PROMPTS.md`, `DEPLOY_GITHUB.md`, `data/seed_graph.json`.
3. **Open Codespaces**: green Code button, Codespaces tab, Create codespace on main. A browser editor opens.
4. **Install Claude Code in the terminal** following Anthropic's current install instructions, sign in, then run `claude`.
5. Paste **Prompt S0** below, then the milestones from `BUILD_PROMPTS.md` as amended in the table further down.
6. **Settings, Pages, Source: GitHub Actions.**
7. **Settings, Secrets and variables, Actions, New repository secret**: add `SEC_USER_AGENT`, `FRED_API_KEY`,
   `QUOTES_API_KEY`, `ANTHROPIC_API_KEY` as you reach those milestones.
8. Commit the two workflow files below to `.github/workflows/`, push, and open the Actions tab. When the deploy
   job turns green, the site URL appears in the job summary.
9. Stop the codespace when finished (it consumes free hours while running).

## Workflow 1: build and deploy (`.github/workflows/deploy.yml`)
```yaml
name: Deploy site
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck && pnpm test
      - run: pnpm build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

## Workflow 2: refresh data (`.github/workflows/refresh-data.yml`)
```yaml
name: Refresh data
on:
  schedule:
    - cron: '23 * * * 1-5'   # hourly on weekdays: macro and yields
    - cron: '17 6 * * *'     # daily: filings, news, briefs
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
  actions: write
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - name: Macro (hourly)
        if: github.event.schedule == '23 * * * 1-5' || github.event_name == 'workflow_dispatch'
        run: pnpm ingest:macro
        env:
          FRED_API_KEY: ${{ secrets.FRED_API_KEY }}
          QUOTES_API_KEY: ${{ secrets.QUOTES_API_KEY }}
      - name: Filings, news, briefs (daily)
        if: github.event.schedule == '17 6 * * *' || github.event_name == 'workflow_dispatch'
        run: |
          pnpm ingest:sec
          pnpm ingest:news
          pnpm ingest:ir
          pnpm briefs
        env:
          SEC_USER_AGENT: ${{ secrets.SEC_USER_AGENT }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - name: Open a pull request for proposed facts (human review)
        uses: peter-evans/create-pull-request@v6
        with:
          branch: data/proposals
          title: 'Review: proposed facts'
          commit-message: 'data: proposed facts for review'
          add-paths: public/data/proposals/**
          body: 'Approve a fact by keeping it in the file and merging; delete a row to reject it.'
      - name: Commit machine-verified data and redeploy
        run: |
          git config user.name "data-bot"
          git config user.email "data-bot@users.noreply.github.com"
          git add public/data/live public/data/briefs
          git diff --cached --quiet || (git commit -m "data: refresh $(date -u +%F\ %H:%M)" && git push)
          gh workflow run deploy.yml
        env:
          GH_TOKEN: ${{ github.token }}
```
Note: a push made with the built-in token does not trigger other workflows, which is why the last step
starts the deploy workflow explicitly.

## How review works without a server
Anything parsed from a PDF, a headline or an LLM is written to `public/data/proposals/` on a separate branch
and opened as a pull request. You read the snippet beside each proposed number, delete the rows you reject,
and merge. A merge moves approved rows into `approved/facts.json`, and the next deploy shows them as
"filed". This keeps CLAUDE.md rule 6 (a human approves extracted numbers) with no database.

## How "Ask" works without a server
Two tiers, both key-safe:
1. **Daily briefs (no key needed by the reader).** The daily Action calls the Anthropic API once per node
   and edge, with the same grounding rules as before (every number followed by a fact id), and saves
   `briefs/<id>.json`. Clicking a node or edge shows its brief instantly. Cap the run at a fixed number of calls.
2. **Live questions (your own key).** A settings box lets you paste your own Anthropic key. It is held in
   `sessionStorage` only, never committed, and the browser calls the API directly with the header
   `anthropic-dangerous-direct-browser-access: true`. Retrieval runs in the browser over the JSON files.
   Use this only on your own device. Do not share the site with the key pre-filled.
Both tiers keep the neutrality notice about Anthropic, and the validator that rejects any number not found
in the retrieved facts.

## Amendments to the milestones
| Milestone | Change for the static plan |
|---|---|
| M0 | Vite + React + TS, hash router, Zod loaders for `public/data/**`. No Drizzle, no SQLite. Tests unchanged |
| M1, M2, M7, M9 | No change to the UI; they read JSON through one `useGraphData()` hook |
| M3, M4 | Scripts write `public/data/live/*.json`; run in Actions; add fixture tests as before |
| M5, M6 | Output goes to `public/data/proposals/`; review is the pull request, not a `/review` page |
| M8 | Replace with the two-tier Ask above; the "number must exist in retrieved facts" test stays |
| M10 | Replace Vercel and cron steps with the two workflows above; keep e2e test against the built site |

## Prompt S0: convert the plan to the static architecture
```
Read CLAUDE.md, BUILD_PROMPTS.md and DEPLOY_GITHUB.md. DEPLOY_GITHUB.md overrides CLAUDE.md wherever they conflict
(stack, data storage, review flow, Ask). Do not write code yet. Produce a revised plan for M0 to M10 under the
static GitHub Pages architecture: list the files per milestone, the JSON schemas under public/data, the two
GitHub Actions workflows, and every place where a server was assumed and what replaces it. Flag any feature that
cannot work without a server and propose the closest static alternative. Keep it under 600 words.
```

## Checklist before you call it done
- [ ] The site opens at the Pages URL and every drawer works from a deep link
- [ ] No API key appears anywhere in the built `dist/` folder (search for `sk-`)
- [ ] Every number on screen shows source, as-of date and a confidence chip
- [ ] The Actions tab shows a green refresh run within the last day
- [ ] The neutrality notice and the "not investment advice" banner are visible
