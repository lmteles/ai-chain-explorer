# AI Chain Explorer: project memory

## Mission
A clickable, source-grounded map of the money relationships among the AI infrastructure players:
Microsoft, Amazon, Alphabet, Meta, Nvidia, Apple, Tesla, TSMC, ASML, plus OpenAI, Anthropic, Oracle,
and supporting nodes (SoftBank, Broadcom, AMD, Samsung). The user must be able to follow the rabbit hole:
click any company or relationship, see the dollars, see who said so and when, and see how big the
problem is if that relationship breaks.

The analytical frame is Steve Eisman's concentration-risk argument: two labs feed the clouds, the clouds
feed Nvidia and TSMC, TSMC feeds on ASML, and equity flows back up to the labs. The graph must make that
loop, and every other loop, visible and measurable.

## Decisions (4 Oct 2026) — these override BUILD_PROMPTS.md and DEPLOY_GITHUB.md where they conflict
1. **Static-first architecture** (DEPLOY_GITHUB.md). Vite + React + TS, hash routing, data as JSON under
   `public/data/`. No server, no SQLite, no Drizzle. Reason: a read-mostly graph of a few hundred facts does
   not need a database, and SQLite cannot be written on Vercel/Pages anyway. Hosting: GitHub Pages.
2. **LLM spend is zero by default.** No scheduled LLM calls (no daily briefs). Any model call happens only when
   Leo explicitly asks, using Sonnet (`claude-sonnet-5-5`), with a hard per-call `max_tokens` and a daily call
   cap. PDF/news extraction (M5, M6) is run on request inside a Claude Code session, which writes proposals
   JSON; no API key is required for it. The in-browser Ask (M8) is click-only, user-pasted key, capped.
3. **Quotes: Financial Modeling Prep.** US listings and ADRs (TSM, ASML) are covered; 9984.T and 005930.KS show
   "not covered" rather than a scraped figure.
4. **Local toolchain:** Node 25 locally, Node 22 in CI; pnpm installed via npm (Node 25 ships no corepack).
   Project lives at `~/Documents/Magnificent 7` (not on a synced drive: sync and `node_modules` do not mix).

## Non-negotiable rules
1. **Never invent a number.** Every figure stored or displayed carries: value, unit, period, as_of date,
   source id(s), status and confidence. If a source does not give a figure, store `null` and show "undisclosed".
2. **Direction rule.** A relation points from whoever pays cash to whoever receives it. Equity: investor to
   investee. Compute commitment: buyer (lab) to seller (cloud). Chip purchase: buyer to chip company.
   Licence and rental: licensee/renter to licensor (e.g. Alphabet pays Apple for search default). Debt: lender
   to borrower.
3. **Never mix amount bases or currencies.** `committed`, `up_to`, `invested`, `annual`, `backlog_share`,
   `share_pct`, `ownership_pct`, `proxy_share`, `capacity` are different things; USD and EUR are different
   things. The UI never sums across either without saying so.
4. **No scraping of paywalled sources.** Bloomberg and FT only via licensed APIs; adapters stay disabled stubs
   (`ENABLE_BLOOMBERG`, `ENABLE_FT`) and the UI says "not licensed". Respect robots.txt and site terms.
5. **LLM analysis is grounded.** Ask may only state numbers present in the data, citing fact ids. Missing data
   is stated as missing. Nothing an LLM finds becomes a fact without the review queue.
6. **Extracted numbers need a human.** Anything parsed from PDFs, transcripts, news or an LLM goes to
   `public/data/proposals/` on a branch and is approved by merging a pull request.
7. **Neutrality notice.** Anthropic is a node and the assistant is built by Anthropic. Persistent notice; the
   model treats OpenAI and Anthropic symmetrically.
8. **Not investment advice.** Footer banner on every page; the simulator is a first-order illustration.
9. **Staleness is visible.** Older than 90 days: amber badge; older than 180 days: red.

## Stack
- Vite + React 19 + TypeScript strict, hash routing (hand-rolled, no router library), Tailwind. No component library.
- Sparklines and the simulator bar chart are inline SVG; no charting library.
- Graph: Cytoscape.js. Tier view uses a **preset layout** (y fixed by tier, x ordered within tier; computed
  once, so no jitter); `cytoscape-fcose` for the force view. Parallel edges: `curve-style: bezier`.
  `d3-sankey` for flows.
- Data: JSON files validated by Zod at load and in every script. One hook, `useGraphData()`.
- Jobs: Node scripts under `/scripts`, run by GitHub Actions; they write JSON, never call an LLM on a schedule.
- Tests: Vitest (unit, adapter fixtures), Playwright (click-through against the built site).
- Package manager: pnpm.

## Repository layout
```
/src/routes          #/ , #/flows , #/sources   (node/edge selection lives in the URL query, not routes)
/src/components      Graph, NodeDrawer, EdgeDrawer, Filters, Legend, StalenessBadge, Sankey, Simulator, MacroStrip
/src/lib/data        schema.ts (Zod), load.ts, useGraphData.ts, fmt.ts
/src/lib/graph       paths.ts, cycles.ts, exposure.ts, simulate.ts
/src/lib/llm         ask.ts, prompts.ts, validate.ts        (browser, user key, click-only)
/scripts/adapters    sec.ts, fred.ts, treasury.ts, quotes.ts, gdelt.ts, rss.ts, bloomberg.ts (stub), ft.ts (stub)
/scripts             ingest-sec.ts, ingest-macro.ts, ingest-news.ts, check-seed.ts
/public/data         seed/seed_graph.json, live/*.json, approved/facts.json, proposals/*.json, runs.json
/tests               unit/, fixtures/, e2e/
```

## Data model (`src/lib/data/schema.ts` is the source of truth; types are `z.infer`ed from it)
```ts
type Tier = 1 | 2 | 3 | 4 | 5; // 1 demand, 2 cloud, 3 chips, 4 fab, 5 tools
type Entity = { id: string; name: string; type: 'lab'|'cloud'|'chip'|'chip_buyer'|'fab'|'tools'|'investor';
  tier: Tier; ticker: string | null; cik: string | null; private: boolean; country: string | null };

type RelationType = 'compute_commitment'|'equity'|'chip_purchase'|'wafer_purchase'|'tool_purchase'|'licence'|'rental'|'debt';
type AmountBasis = 'committed'|'up_to'|'invested'|'annual'|'backlog_share'|'share_pct'|'ownership_pct'
  |'proxy_share'|'capacity'|'undisclosed';
type Status = 'filed'|'filed_inferred_name'|'reported'|'claimed_by_eisman'|'background_unverified';
type Confidence = 'high'|'medium'|'low';

type Relation = { id: string; from_id: string; to_id: string; type: RelationType;
  amount: number | null; unit: 'USD_bn'|'EUR_bn'; amount_basis: AmountBasis; share_pct: number | null;
  capacity_gw: number | null; period: string | null; status: Status; confidence: Confidence;
  source_ids: string[]; as_of: string | null; as_of_inferred?: boolean; note: string;
  valid_from?: string; valid_to?: string };

type Metric = { id: string; entity_id: string; key: string; value: number; low: number | null; high: number | null;
  unit: string; period: string; status: Status; source_ids: string[]; confidence: Confidence;
  as_of: string | null; as_of_inferred?: boolean; note?: string };

type Source = { id: string; publisher: string; title: string; url: string; published: string | null;
  kind: 'filing'|'ir'|'press'|'transcript'|'analyst'|'blog'|'background';
  reliability: 'primary'|'secondary'|'claim_by_named_person'|'weak'|'unverified'; retrieved_at?: string };

type Claim = { id: string; speaker: string; text: string; entity_ids: string[]; source_ids: string[]; verify: string };
```
Status notes: `filed_inferred_name` = the share is filed but the customer is anonymised ("Customer A") and the
name is our inference. `ownership_pct` = equity stake, not a revenue share. `proxy_share` = a figure for a
country or group used as a proxy for a company (e.g. Taiwan's share of ASML sales standing in for TSMC).
`as_of` defaults to the earliest `published` date of the fact's sources, with `as_of_inferred: true`; `null` = undated,
shown as a grey "undated" badge (never as fresh). Dates may be month-precision (`2026-07`); staleness treats them as the 1st.

## Seed data
`public/data/seed/seed_graph.json` holds 16 entities, 34 relations, 17 metrics, 16 sources and 5 Eisman claims.
Rows marked `background_unverified` or `confidence: low` are leads to verify, not facts. The first job of the
live adapters is to replace those rows with filed numbers. Seed checks: referential integrity; confidence no
higher than the best cited source's reliability allows (weak/unverified ⇒ low; claim_by_named_person ⇒ ≤ medium).

## Data sources
| Source | Access | Use | Caveat |
|---|---|---|---|
| SEC EDGAR XBRL companyfacts | Free; `User-Agent` with name and email; < 8 req/s | Capex, OCF, revenue, RPO, concentration % | Tag names vary; try in order, log the match. TSMC/ASML file 20-F/6-K |
| SEC EDGAR submissions | Free | Latest 10-Q, 10-K, 8-K links | |
| FRED `DGS10` | Free, **no key**: official CSV download (`fredgraph.csv`) | 10-year yield vs Eisman's 5% line | `FRED_API_KEY` not needed |
| US Treasury Fiscal Data | Free | Federal debt, interest expense | |
| FMP quotes | Free key | Price, market cap, 1-year sparkline | US listings and ADRs only |
| TSMC / ASML results packs and TSMC 20-F, **via SEC EDGAR** (6-K / 20-F) | Free | Customer A/B shares, platform and region mix, capex, guidance | investor.tsmc.com is behind a bot challenge: never bypass it. Extracted on request in Claude Code → proposals |
| GDELT DOC 2.0, newsroom RSS (OpenAI, Nvidia, Microsoft, Google, Meta) | Free | Deal discovery by connected pair | Headlines only. GDELT throttles hard: 10 s gap, one retry after 30 s |
| Bloomberg, FT | Paid licence | Optional | Disabled stubs; no scraping |
| OpenAI, Anthropic financials | None official | Curated claims only | Never shown as filed |

Cash capex = `PaymentsToAcquirePropertyPlantAndEquipment` (Amazon: `PaymentsToAcquireProductiveAssets`); store
finance-lease additions separately and show both "cash capex" and "capex incl. leases". FCF = OCF − cash capex.
Cash-flow facts are year-to-date within a fiscal year: derive discrete quarters by subtraction, and prefer the
latest-filed value when a period is restated. Oracle RPO: `RevenueRemainingPerformanceObligation`.
Review workflow (M5): `pnpm ingest:ir` downloads the latest packs, writes `public/data/ir/documents.json` (sha256 per
file) and keeps plain text in `.cache/ir/`. Extraction happens in a Claude Code session on request, writing
`public/data/proposals/<document_id>.json`; every fact has a locator, a page for slide images and a verbatim snippet.
`pnpm check:proposals` must pass: text snippets found verbatim, every value present in its snippet, slides exist.
Decisions are made on `#/review` under `pnpm dev` (dev-only `POST /__review`, localhost origin only) or by PR. Only
`approved` proposals become facts (metrics `filed`; edge shares `filed_inferred_name` when the filing withholds the name).
**Claude never approves its own extractions.** ASML regional shares are of net *system* sales, not total net sales.
News workflow (M6): `pnpm ingest:news` (env `NEWS_TIMESPAN_DAYS`, default 1) clusters deal headlines into stories in
`public/data/news/clusters.json`. Triage happens in a Claude Code session on request: each story becomes a proposal in
`public/data/proposals/news-<date>.json` (`new_relation`, `amount_change` or `event`, evidence = exact headline + URL)
or is marked `triage: no_change`. Approved news edges are `reported`/medium at most, never `filed`; every approval
leaves an event on the edge (Events tab). Bloomberg and FT are typed stubs that throw `LicenceRequiredError`.
Concentration: `ConcentrationRiskPercentage1`. **The companyfacts API omits dimensional facts**, so customer members are
not available from it: such percentages are stored unnamed with a note. Naming them needs the filing's XBRL instance.
Quarter labels are calendar quarters by period midpoint (`quarterLabel`); fact ids are `sec_<entity>_<key>_<q>`, stable
across runs. `pnpm ingest:sec` writes `public/data/live/sec.json` and appends to `public/data/runs.json`; the SEC cache
lives in `.cache/sec` (24h). A seed metric with the same entity, key and period gets `superseded_by`.

## Environment variables (`.env.local` locally, Repository Secrets in Actions; never in front-end code)
```
SEC_USER_AGENT="Name email"   # real value only in .env.local / Secrets: the repo will be public
FRED_API_KEY=
QUOTES_API_KEY=          # FMP
ENABLE_BLOOMBERG=false
ENABLE_FT=false
```
The Anthropic key is never stored in the repo: Ask takes it from a settings box into `sessionStorage`.

## Conventions
- Money is a number in billions with an explicit unit; format with one helper, `fmtMoney()`.
- Edge width is log-scaled from `amount`; undisclosed amounts render as a 1px line with a **hollow arrowhead**, never zero
  (not dashed: dashes already mean medium confidence).
- Colour encodes tier (nodes) and relation type (edges). Line style encodes **confidence only**: solid = high,
  dashed = medium, dotted = low. Status is shown by opacity (filed 100%, reported 85%, claimed/unverified 55%)
  and a badge in the drawer.
- Path and Sankey views show each hop's own amount; they never imply that dollars are conserved along a path.
  A path carries a **bottleneck** (smallest hop, only when all hops are disclosed USD on one basis), never a sum.
  The Sankey has one column per hop (`entity@hop`), so loops never break it; undisclosed edges are listed, not drawn.
- Loops (`cycles.ts`): equity + compute_commitment + chip_purchase, ≤ 6 legs. Round trip = equity back ÷ dollars out,
  only when every leg is disclosed USD on committed / up_to / invested; otherwise "not computable" with the reason.
- Every adapter returns `{ rows, fetched_at, source }`, validated by Zod, and has a fixture test.
- All HTTP goes through `scripts/adapters/http.ts` (`cachedGet`): disk cache, per-host throttle, and `redact()` so API
  keys never reach cache names, errors or the published `runs.json`. A failed adapter keeps its last stored file.
- `pnpm ingest:macro` writes `live/macro.json` (FRED + Treasury) and `live/quotes.json` (skipped without `QUOTES_API_KEY`).
- Small commits; run `pnpm typecheck && pnpm test` before each.

## Milestone amendments (apply when running BUILD_PROMPTS.md)
| M | Change |
|---|---|
| M0 | Vite scaffold, Zod schema + loader, `scripts/check-seed.ts` (replaces db:seed; prints 16/34/17/16). Migrate seed: add `published` to sources, `status` to metrics, `entity_ids` to claims, inferred `as_of`; fix bases on r_msft_openai, r_tsmc_asml, r_samsung_asml; fix the confidence/source mismatches |
| M1–M2, M7, M9 | UI unchanged; data via `useGraphData()`; URL query holds selection and filters |
| M3, M4 | Scripts write `public/data/live/*.json`; failures logged to `runs.json`; UI degrades to last stored value |
| M5, M6 | No scheduled extraction; run on request; output to `public/data/proposals/`; review = pull request |
| M8 | Done: `src/lib/llm/` (ask, tools, prompts, validate, limits). `claude-sonnet-5-5`, low effort, 2,000 output tokens per call, ≤ 6 tool rounds, daily caps (10 answers / 30k output tokens, editable), cache keyed by question + scope + data fingerprint. **No refusal fallbacks**: they could route to a pricier model, against the Sonnet-only rule. Key in `sessionStorage` only. Tests use a scripted stream and sample answers: never the API |
| M9 | Done: `exposure.ts` + `simulate.ts` + `#/simulate`. Shares: stated > proxy > annual ÷ filed revenue > commitment ÷ its period ÷ revenue (all but stated are estimates); equity and debt excluded (funding, not revenue); else "not computable" with an override box. Second order only flows to lower tiers. Supply mode for TSMC runs upstream with editable dependence. Backlog is a stock: never multiplied by the horizon, never added to revenue |
| M10 | GitHub Pages + two workflows from DEPLOY_GITHUB.md (use `pnpm/action-setup` before `setup-node` cache) |

## Definition of done for any feature
1. Works with seed data offline. 2. Shows provenance for every number. 3. Has a test. 4. Keyboard accessible.
5. States its limits in the UI where a number could mislead.
