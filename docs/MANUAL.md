# AI Chain Explorer: user manual

## In one paragraph

AI Chain Explorer is a map of who pays whom in the AI build-out. The AI labs (OpenAI, Anthropic) pay the clouds (Microsoft, Amazon, Alphabet, Oracle); the clouds buy chips (Nvidia, Broadcom, AMD); chip firms buy wafers from fabs (TSMC, Samsung); fabs buy machines from ASML. Money also flows back up as investment. Every number on the map says where it came from, how sure we are of it, and how old it is. The point is Steve Eisman's question: how concentrated is all this, and who gets hurt if one link breaks?

**Open it here:** https://lmteles.github.io/ai-chain-explorer/ (bookmark it; works on phone too; no login).

---

## 1. The screen at a glance

| Area | What it is |
|---|---|
| **Top bar** | *Filters* button (left), *Follow the money*, *Simulator*, *Review queue*, *Go to company* (right) |
| **Strip under the top bar** | The 10-year US Treasury yield with Eisman's 5% line (red when above 4.9%), federal debt, interest on the debt, and *Data sources* (turns red if a data feed is failing) |
| **The map** (centre) | Companies in five rows: 1 Demand (labs), 2 Cloud, 3 Chips, 4 Fab, 5 Tools |
| **Right-hand panel** | Opens when you click something. Close with × or Esc |
| **Bottom-left buttons** | PNG, SVG, Ledger CSV, Brief (PDF), Copy link |
| **Top-right box on the map** | *Loops*: where money comes back round |

## 2. How to read the map

**Circles are companies.** Colour = row (gold labs, navy clouds, teal chips, grey-blue fabs, brown tools). Size = 2026 capex guidance (or revenue, if you switch it in *Filters*). A small circle with a dashed ring means "no figure".

**Arrows are money**, always pointing **from the payer to the payee**. Investor → company it invests in. Buyer → seller.

| What you see | What it means |
|---|---|
| Arrow colour | The kind of deal: blue compute commitment, gold equity investment, teal chip purchase, green wafer purchase, purple tool purchase, red licence, orange rental, grey debt |
| Thick line | Big amount (log scale, so $300bn is not 60× thicker than $5bn) |
| Thin line with a hollow arrowhead | Amount not disclosed |
| Solid / dashed / dotted | High / medium / low confidence |
| Faded | Only "claimed" or "unverified" |
| Two curved arrows between the same pair | Money going both ways, e.g. Anthropic commits to Amazon, Amazon invests in Anthropic |

**Never add up different amounts.** "Committed over 10 years", "up to", "invested" and "a year" are different things. The app never sums them, and neither should you.

## 3. Things you can do

### Look at a company
Click a circle (or use *Go to company*). The right panel has four tabs:
- **Overview**: market value with a one-year price line, latest SEC filings, and every figure we hold, newest filed figures first. Struck-through figures have been replaced by a filed one.
- **Money**: who it pays and who pays it, biggest first. Click any row to open that relationship.
- **Concentration**: how much of its revenue or backlog depends on each counterparty (e.g. Oracle: 50% of its backlog is OpenAI).
- **Claims**: what Eisman said about it, and how to check it.

### Look at a relationship
Click an arrow (or a row in *Money*). You get a plain-English sentence ("Alphabet invests in Anthropic: up to $40bn."), the amount and its basis, status, confidence, the sources with links, and any deals going the other way. The *Events* tab shows dated news events you approved.

### Focus on one company's neighbours
Double-click a company. Everything not directly connected fades. Esc clears it.

### Follow the money
- **Step by step:** in a company panel press *Where does the money go next?*. Pick a payee; the map moves there and the trail grows at the top left. "Loops back" means the money returns to a company already on your trail.
- **All at once:** *Follow the money* in the top bar draws a flow diagram from any company, 1 to 4 steps deep. Each column is a step. Paths are never added up: dollars are not conserved along a chain.

### See where money comes back round (loops)
Open *Loops* on the map. A loop is money going out (commitments, chip purchases) and coming back as investment. "25% round trip" means 25 cents come back as investment per dollar committed. "Not computable" means part of the loop has no disclosed amount; the reason is shown. Click a loop to light it up.

### Test a shock (simulator)
*Simulator* in the top bar. Pick a scenario button (e.g. *OpenAI under-funds its commitments*) and read *Who moves most*. Everything is adjustable:
- the size of the cut (slider);
- **damping**: 0 = only direct effects; higher = victims pass part of their loss on down the chain;
- horizon (1, 3 or 5 years);
- the *Exposure shares* table at the bottom: type a percentage to override a share or fill in one marked "not computable".

Remember the banner: **an illustration, not a forecast.** "Estimate" tags mean a share was worked out rather than stated by a source.

### Ask a question
Open any company or relationship and press **Ask about this**. Paste your Anthropic API key (kept only until you close the tab), edit the question if you like, press *Ask*. The answer:
- uses only figures in this database, each followed by a small chip you can click to open its source row;
- groups figures by Filed / Reported / Claimed / Unverified;
- ends with "What would change this view";
- is checked automatically: a green tick means every number matched the data; a red box lists anything that did not.

Repeating the same question is free (cached). Each answer costs roughly $0.02–0.05; the panel shows today's spend and lets you set daily caps. This is billed to your Anthropic API account, not your Claude plan.

### Go back in time
*Filters* → *As known on* → pick a date. The map shows only what was published by then; filed figures roll back to the quarter that was current. Press *Today* to return.

### Export and share
- **Copy link**: the address always holds exactly what you are looking at (selection, filters, date). Send it and the other person sees the same view.
- **PNG / SVG**: picture of the map (SVG for slides you can resize).
- **Ledger CSV**: every relationship with its sources, for Excel.
- **Brief (PDF)**: one page on the current selection; choose "Save as PDF" in the print dialog. Allow pop-ups if nothing appears.

## 4. How much to trust a number

Every figure carries three labels. Read them before quoting anything.

| Label | Values, best first |
|---|---|
| **Status** (where it comes from) | **Filed** (a company filing) · **Filed, name inferred** (filed, but the filing says "Customer A"; the name is our inference) · **Reported** (press) · **Claimed** (said by Eisman) · **Unverified** (a lead to check) |
| **Confidence** | High · medium · low |
| **Age badge** | Green: under 90 days · amber: 90–180 · red: over 180 · grey "undated": the source gave no date |

Two honest caveats about today's data: 26 of 34 relationships are undated, and most OpenAI amounts are undisclosed, so OpenAI's side often shows "not computable" where Anthropic's has numbers. That is a gap in disclosure, not a judgement.

## 5. What runs by itself, and what needs you

**Automatic** (GitHub, free, no AI): SEC filings daily; yield, debt and share prices hourly on weekdays; news headlines every six hours; TSMC/ASML documents weekly. The site redeploys after each update. If a feed fails twice running, GitHub opens an issue and *Data sources* turns red; the site keeps the last good data.

**Needs you:**
1. **Review queue.** Numbers read from documents and news are *proposals* until you approve them. Approving only works on your Mac (the public site is read-only):
   ```bash
   cd ~/Documents/Magnificent\ 7 && git pull && pnpm dev
   ```
   Open http://localhost:5173/#/review. For each item: read the quoted snippet (or open the slide for "read from slide" items), then *Approve*, *Reject* or *Edit*. When done, publish:
   ```bash
   cd ~/Documents/Magnificent\ 7 && git add -A && git commit -m "Review: approve proposals" && git push
   ```
2. **News triage.** New stories pile up under *From the news → stories awaiting triage*. Ask Claude Code: "triage the news for AI Chain Explorer". It turns stories into proposals for you to review. No API cost.
3. **New investor documents.** Ask Claude Code: "extract the new TSMC and ASML documents".

**A sensible weekly routine (15 minutes):** glance at *Data sources*; ask Claude to triage news; clear the review queue; push.

## 6. Answering the key questions quickly

| Question | Where |
|---|---|
| How much of Oracle's backlog depends on one customer, and who says so? | Click Oracle → *Concentration* |
| Which of the big tech firms are paid by, and invest in, the same lab? | *Loops* box on the map |
| If Nvidia's top customer cut orders 30%, who moves most? | *Simulator* → *Nvidia customer concentration event* |
| What share of TSMC's revenue sits with two customers; filed or estimated? | Click TSMC → *Concentration* (status shows on each edge) |
| Where does money loop back, committed versus invested? | *Loops* box; *Follow the money* page |
| Which numbers are stale? | Amber and red age badges in each panel (a single list is not built yet) |

## 7. When something looks wrong

| Problem | What to do |
|---|---|
| A figure seems wrong | Open it, check the source link and status. Ask Claude Code: "show me the source row for this figure and reproduce it by hand". |
| *Data sources* is red | Open it: it names the feed and the error. One failure is usually temporary; GitHub opens an issue after two. |
| "Showing seed data only" note on the map | A live data file failed to load; the map falls back to the curated starting data. |
| Ask says the key was rejected | Check the key in the Anthropic Console; keys start with `sk-ant-`. |
| Brief (PDF) does nothing | Allow pop-ups for the site. |
| News is stale | GDELT throttles heavy users; the automatic job retries. Ask Claude to check *Data sources*. |

## 8. Glossary

- **RPO / backlog**: revenue a company is contracted to receive in future (remaining performance obligations).
- **Capex**: capital expenditure, money spent on data centres and equipment.
- **TTM**: trailing twelve months.
- **Up to**: a ceiling, not money paid.
- **Proxy**: a region or group standing in for a company (e.g. "Taiwan" for TSMC in ASML's sales).
- **Round trip**: equity coming back ÷ dollars going out round a loop.
- **Damping**: how much of a loss a company passes on as its own spending cut.

*Not investment advice. Anthropic is a node in this graph and the Ask assistant is built by Anthropic; it is instructed to treat OpenAI and Anthropic symmetrically.*
