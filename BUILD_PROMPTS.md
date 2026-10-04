# How to use this kit

1. Create an empty folder, copy in `CLAUDE.md`, `BUILD_PROMPTS.md` and `data/seed_graph.json`.
2. Open the folder in Claude Code (`claude`) and press Shift+Tab to enter plan mode.
3. Paste **Prompt 0**. Approve the plan, then paste the milestones **one at a time**. Do not skip ahead:
   each milestone ends with acceptance checks. Run them before moving on.
4. Keep API keys in `.env.local`. Start with only `SEC_USER_AGENT`; everything else can come later.

The order is deliberate. You get a working clickable graph on seed data at milestone 2, live filings at
milestone 3, and the contagion simulator at milestone 9. Each step is usable on its own.

---

## Prompt 0: kickoff

```
Read CLAUDE.md fully, then data/seed_graph.json. Do not write code yet.
Produce a plan for the whole project as milestones M0 to M10 matching BUILD_PROMPTS.md, naming the
files you will create in each, the riskiest assumption in each, and any question you need answered.
Challenge anything in CLAUDE.md that is ambiguous or technically unsound, and propose a fix.
Keep the plan under 600 words.
```

---

## M0: scaffold, schema, seed

```
Scaffold a Next.js 15 App Router project (TypeScript strict, Tailwind, shadcn/ui, pnpm) and set up
Drizzle with SQLite. Implement the schema from CLAUDE.md including metric_history, pending_review,
adapter_runs and llm_cache. Write lib/db/seed.ts that loads data/seed_graph.json, validates it with Zod,
and fails loudly if any relation references a missing entity or source.
Add scripts: pnpm db:push, pnpm db:seed, pnpm test, pnpm typecheck.
Tests: referential integrity of the seed; every relation has a status and confidence; amount_basis is
never 'undisclosed' when amount is non-null; direction rule spot-checks (e.g. r_amzn_anth goes from
amazon to anthropic).
```
**Accept when:** `pnpm db:seed` prints counts of 16 / 34 / 17 / 16 and all tests pass.

---

## M1: the graph canvas

```
Build the home page: a full-height Cytoscape canvas.
- Default layout: five horizontal swimlanes by tier (1 demand, 2 cloud, 3 chips, 4 fab, 5 tools) using
  cytoscape-dagre with rank constraints. A toggle switches to cytoscape-fcose force layout.
- Node size selectable by metric (capex guidance, revenue, none), with a legend. Colour by tier.
- Edge width is log-scaled from amount; undisclosed amounts are thin dashed lines. Edge colour by
  relation type; line style by status/confidence as per CLAUDE.md conventions. Arrowheads follow the
  direction rule.
- Parallel edges between the same pair (e.g. anthropic and amazon: commitment one way, equity the
  other) must be drawn as separate curved edges so the circular flow is visible.
- Left filter panel: relation type checkboxes, minimum USD slider, confidence filter, status filter.
- Legend with the direction rule and the "never sum across bases" warning.
Use a dark-on-light palette with navy, teal and gold accents. No layout jitter on re-render.
```
**Accept when:** all 16 nodes and 34 edges render; toggling filters hides edges without moving nodes;
the OpenAI-Nvidia-Anthropic-Amazon loops are visually distinguishable.

---

## M2: click-through drawers (the rabbit hole starts here)

```
Add a right-hand drawer. Clicking a node opens NodeDrawer with tabs:
 1. Overview: every metric for the entity with value, unit, period, as_of, a confidence chip and source chips
    that link to the source URL. Show low/high when a range exists.
 2. Money: two tables, "Pays" and "Is paid by", sorted by USD, with amount_basis shown beside each number.
    Rows are clickable and focus the edge on the canvas.
 3. Concentration: the top counterparties as a share of this entity's revenue or backlog where data allows
    (e.g. Oracle RPO 50% OpenAI; Nvidia receivables 70% from five customers; TSMC Nvidia 19% / Apple 17%).
 4. Claims: any Eisman claims that mention the entity, each with its "how to verify" note.
Clicking an edge opens EdgeDrawer: relation type, direction in plain English ("Anthropic commits to pay
Amazon..."), amount with basis, status, confidence, period, evidence list (sources), notes, and a
"Related edges" list (reverse direction, same pair). Double-click a node to expand and highlight its
neighbours and fade the rest. Keep a breadcrumb trail of the nodes visited; clicking a crumb returns to it.
Add StalenessBadge (amber over 90 days, red over 180) and a URL that encodes the selected node/edge and filters.
```
**Accept when:** from the Anthropic node you can reach, in three clicks, the Google equity edge, its
sources and its confidence rating; reloading the URL restores the view.

---

## M3: live filings from SEC EDGAR

```
Implement lib/adapters/sec.ts against data.sec.gov. Respect SEC_USER_AGENT, cache responses on disk for
24h and throttle to under 8 requests per second.
For each entity with a cik, fetch companyfacts and extract, for the last 8 quarters:
 - cash capex (try PaymentsToAcquirePropertyPlantAndEquipment, then PaymentsToAcquireProductiveAssets;
   log which tag matched),
 - operating cash flow and derived free cash flow,
 - revenue, and for Oracle RevenueRemainingPerformanceObligation,
 - any ConcentrationRiskPercentage facts with customer dimension members.
Write them into metrics and metric_history with source = the EDGAR accession URL and status 'filed'.
Handle quarterly-versus-year-to-date cash flow facts correctly (cash flow values are cumulative within a
fiscal year; derive discrete quarters by subtraction) and add unit tests with recorded fixtures for
Microsoft (June fiscal year) and Alphabet.
Also fetch the latest 10-Q, 10-K and 8-K links per entity into a filings table and show them in the node drawer.
Script: pnpm ingest:sec. Record each run in adapter_runs.
```
**Accept when:** Alphabet shows a Q2 2026 capex and free cash flow figure from the filing, with a link,
and the seed's "background_unverified" figures are visibly superseded where a filing exists.

---

## M4: macro and market data

```
Implement FRED (DGS10), US Treasury Fiscal Data (total debt and interest expense) and a quotes adapter
behind a provider interface (QUOTES_PROVIDER). Add a header strip: 10-year yield with Eisman's 5% line,
and an alert style when above 4.9%. Add market cap and a 1-year sparkline to each public node's Overview
tab. Cache aggressively; show "as of" timestamps and a staleness badge. Never block rendering on a failed
adapter: degrade to the last stored value and show the failure in a /sources page.
```

---

## M5: TSMC and ASML via investor materials (with a human in the loop)

```
TSMC and ASML are foreign filers, so build lib/adapters/ir-tsmc.ts and ir-asml.ts that download the latest
quarterly management report / results presentation from the official investor pages (store the PDF hash).
Extract with Claude structured output (Zod schema): TSMC revenue by platform, customer concentration
("client A", "client B" shares), capex guidance; ASML net sales, EUV unit shipments, sales by region,
guidance range. Every extracted figure must include the page number and a verbatim snippet. Write results
to pending_review, never directly to metrics.
Build the /review page: a table of proposed facts with the snippet, a diff against the current value, and
Approve / Reject / Edit buttons. Approved rows become metrics with status 'filed' and source = the PDF URL.
```
**Accept when:** the TSMC Nvidia 19% / Apple 17% relation edges can be upgraded from "reported" to "filed" through the review page.

---

## M6: news and events discovery

```
Implement GDELT DOC 2.0 and RSS adapters. For each pair of connected entities, run a daily query for new
deal language (invest, commitment, gigawatt, capacity, agreement). Cluster headlines by story, and for each
cluster ask Claude to propose a structured edit: new relation, changed amount, or no change, with the exact
headline text as evidence. Insert proposals into pending_review with a "news" origin and the originating URL.
Create lib/adapters/bloomberg.ts and ft.ts as typed stubs implementing the same interface, disabled unless
ENABLE_BLOOMBERG / ENABLE_FT is true, each throwing a clear "licence required" error. Do not implement
scraping of any paywalled site.
Add an "Events" tab on edges showing approved events as a timeline (announced, revised, closed).
```

---

## M7: follow the money, loops and flows

```
Add lib/graph/paths.ts and cycles.ts.
1. Follow-the-money: given a node and a depth (1 to 4), return all downstream paths by relation type with
   cumulative USD where amount bases are compatible. Render as a Sankey (d3-sankey) on /flows, with a node
   picker and a "show only high-confidence" toggle.
2. Loop finder: detect directed cycles across equity + compute_commitment + chip_purchase edges
   (e.g. Anthropic to Amazon (commitment), Amazon to Anthropic (equity)). For each cycle compute the
   round-trip ratio: dollars returning as equity divided by dollars committed, only where both amounts are
   non-null and on compatible bases, otherwise label "not computable". List the cycles in a panel and
   highlight one on the canvas when selected.
3. Rabbit-hole mode: from any node, a button "Where does the money go next?" steps the highlight one
   tier at a time and adds each hop to the breadcrumb.
Unit-test the cycle finder on the seed (it must find the Anthropic-Amazon, Anthropic-Alphabet,
Anthropic-Microsoft and Anthropic-Nvidia loops) and the round-trip ratio on a hand-built example.
```

---

## M8: grounded "Ask" assistant

```
Build lib/llm/ask.ts using the Anthropic SDK with tool use. Tools (read-only, backed by SQLite):
get_entity(id), get_relation(id), list_relations(filter), get_metric(entity, key), find_paths(from, to, depth),
compute_exposure(entity), get_claims(entity). The system prompt must require that:
 - every number in the answer is followed by a fact id in brackets, e.g. [r_goog_anth] or [m_goog_q2fcf];
 - missing data is stated as "not in the database", never estimated;
 - the answer separates Filed, Reported, Claimed and Unverified figures;
 - OpenAI and Anthropic are treated symmetrically and the Anthropic relationship is disclosed;
 - the answer ends with "What would change this view", listing the data points to watch.
Add an "Ask about this" button on every node and edge drawer. Stream the answer, render fact ids as chips
that open the underlying row. Cache by (question, data version) in llm_cache and add a daily cost cap.
Write a test that fails if the model's answer contains a number that is not in the retrieved tool results.
```

---

## M9: contagion simulator (the size of the problem)

```
Add lib/graph/exposure.ts and simulate.ts and a Simulator panel.
Exposure of j to i: share_{j<-i} = revenue (or backlog) j receives from i divided by j's total revenue
(or backlog), using relation amounts where available and share_pct otherwise; mark estimates.
Scenario inputs: pick a node or edge, set a shock from 0 to 100% (e.g. "OpenAI cuts commitments by 30%"),
choose a horizon. First-order propagation: delta_j = sum_i shock_i * share_{j<-i} * revenue_j, applied
tier by tier downward, with an optional second-order damping factor the user can edit.
Output: a ranked table of nodes by dollar and percentage-of-revenue impact, the path that carries the most
dollars to each node, and a bar chart. Every assumption (shares, damping) is editable and displayed.
Banner: "First-order illustration, not a forecast."
Include these preset scenarios: OpenAI under-funds commitments (Oracle exposure ~50% of RPO per Eisman);
Anthropic growth stalls; Nvidia customer concentration event (one of the five top customers cuts orders 30%);
TSMC capacity shock; 10-year yield above 5%.
Tests with hand-computed numbers for a three-node toy graph.
```

---

## M10: time travel, export, deploy, schedule

```
1. As-of slider: render the graph as at a chosen date using valid_from / valid_to and metric_history.
2. Export: PNG and SVG of the canvas; CSV of the relationship ledger with source URLs; a one-page PDF
   brief for the current selection.
3. Share links that encode view state.
4. Deploy to Vercel. Add GitHub Actions cron: ingest:sec daily, ingest:macro hourly on weekdays,
   ingest:news every 6 hours, ingest:ir weekly. Fail the job and open an issue if an adapter fails twice.
5. A /sources page listing every adapter, last success, rows written, and any licence-required stubs.
6. Playwright e2e: open app, click Anthropic, click the Google equity edge, open the Ask drawer, confirm
   fact-id chips render and the neutrality notice is visible.
```

---

## Appendix A: prompts for when something goes wrong

- **Numbers look wrong:** "Show me the source row and tag for this figure, and reproduce the calculation by hand. Do not change code until you have explained the discrepancy."
- **Adapter breaks:** "Print the raw payload for the failing entity, identify the changed field, and add a fixture test that reproduces it before fixing."
- **Graph is a hairball:** "Add progressive disclosure: collapse tiers 4 and 5 into group nodes and expand on click, and cap visible edges by minimum USD."
- **LLM overreaches:** "Add a regression test using this answer text and make the validator reject it."

## Appendix B: questions the finished tool should answer in under three clicks

1. How much of Oracle's backlog depends on one customer, and where is that stated?
2. Which of the Seven are paid by, and invest in, the same lab?
3. If Nvidia's top customer cut orders by 30%, which nodes move most?
4. What share of TSMC's revenue sits with two customers, and is that figure filed or estimated?
5. Where does the money loop back, and how much of it is committed rather than invested?
6. Which numbers on screen are older than 90 days?
