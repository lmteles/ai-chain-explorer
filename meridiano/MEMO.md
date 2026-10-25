# Meridiano: decision memo (living document)

Owner: Leo Teles. Last updated: 25 Oct 2026. Edit freely; record every change in the changelog at the end.

This memo holds the decisions taken so far and the reasons for them. The build instructions live in
`BUILD_PROMPTS.md`, the website brief in `WEBSITE_PROMPT.md`, and the security and privacy review in
`SECURITY_PRIVACY.md`. When a decision here changes, update those files too.

---

## 1. What we sell

- **Product:** Meridiano Comex. A weekly paid edition (Saturday, 7h) that translates geopolitics into impact on
  foreign trade, corporate finance and board decisions. Every claim has a source; every story carries a
  "for the world / for you" reading and a lens tag (Comex, CFO, Board).
- **Why this niche:** the founder has formal conflict-of-interest rules, so no selling through the institutional
  network; sales come from LinkedIn, Instagram and cold outreach. A narrow, high-price niche needs ~120 paying
  readers for R$10–20k/month, which is reachable; a cheap general digest would need 300–500+.
- **Brand exposure:** brand only, no founder face. Expert "Point and Counterpoint" articles bring named people
  and their reach.
- **Language:** Portuguese first; Spanish and English editions after 200 paying readers in Portuguese.

## 2. Prices (hypotheses to test)

| Plan | Price | Notes |
|---|---|---|
| Free | R$0 | 3 stories + map |
| Founding member | R$67/month for as long as the subscription runs | First 50 only. No fake scarcity counters |
| Subscriber | R$97/month or R$970/year | Full edition, debate, archive |
| Team | R$1,200/month | Up to 5 readers, lens for the company's sector |

Consumer law: online purchases carry a 7-day right of withdrawal (CDC art. 49). Cancellation must be as easy
as subscribing.

## 3. Company and tax

- Run through the founder's existing Brazilian company while it fits (CNAE 6319-4/00 to be added; regime to be
  checked by the accountant). Written clearance from the employer on the side activity comes first.
- Revenue from customers abroad that brings in foreign currency is an export of services: exempt from ISS, PIS and
  COFINS (Simples Nacional included) when the result occurs abroad. IRPJ, CSLL and CPP still apply.
- A foreign company does not avoid Brazilian tax for a resident (Law 14.754/2023). Revisit only if raising
  capital, if foreign revenue passes ~25%, or if a publisher deal demands it.
- The 2027 tax reform (CBS/IBS) changes parameters: the tax module must keep rates and rules as data, not code.

## 4. News access: how we read the outlets legally

Principle: we sell judgement, not content. Each card carries **our own headline**, the original headline quoted
as the source, a link, and our own synthesis from several sources. We never reproduce article text, never bypass
paywalls or bot protection, and never feed personal-subscription text into the AI pipeline.

| Layer | Source | What we get | Cost | When |
|---|---|---|---|---|
| 1. Detect | **GDELT DOC 2.0 API** | URL, title, domain, language, date, tone; 3-month rolling window; 65+ languages | Free, no key; commercial use allowed; 1 request / 5 s; ask for attribution | Now |
| 1. Detect | **newsapi.ai (Event Registry)** | Title, lead, body where public, event clusters, entities | 2,000 free searches, then US$90/month (5K plan); extra token US$0.015 | Now |
| 1. Detect | Publisher **RSS** feeds | Headline, summary, link | Free; check each feed's terms | Now |
| 2. Facts | **Primary sources**: IMF, OECD, World Bank, central banks (Fed, BCB, ECB), statistics offices, government gazettes, company filings | Full text and data | Free | Now |
| 3. Licensed open | **Guardian Open Platform** | Full text by API | Free for non-commercial; commercial licence by quote | Month 1–2 |
| 4. Licensed premium | FT Partner Programme; Dow Jones (WSJ) Commercial Partnerships; Factiva or LexisNexis; Economist (start via affiliate); Foreign Affairs (CCC permissions, Tribune Content Agency); Valor (Grupo Globo syndication) | Full text under licence | Quotes, likely thousands of US$ a year per source (estimate) | After 50–100 paying readers; FT first |

**Add-on aggregators usable immediately** (behind one adapter interface, switchable):

| Aggregator | Use | Price |
|---|---|---|
| GDELT | Broad detection, trends, tone | Free |
| newsapi.ai | Main structured feed, clustering | Free 2,000 searches, then US$90/month |
| Webz.io | Backup feed, long tail, pay as you go | US$5 free credit per month; search API US$0.001/call + US$0.0005/result |
| GNews | Cheap commercial backup with full content | €49.99/month (Essential) |
| Guardian API | Full text of one major title | Free dev key; commercial by quote |
| Perigon | Best clustering, later | From ~US$24k/year commercial |

GDELT caveats: no entity resolution, noisy coding, no article body, the GEO API is dead, and different modes
can disagree. Use it for detection and trend signals, never as a fact source.

## 5. AI models: costs and choices

Estimated monthly AI workload at launch (120 paid + ~4,000 free readers, weekly edition, 3 lenses, ~300 emails):
about **10M input tokens and 1.5M output tokens per month**. Workload split: triage of ~9,000 news items,
~260 story cards, ~13 editions (3 languages), ~300 email replies, a checking pass on all published text.

| Option | Price per 1M tokens (in / out), Oct 2026 | Est. monthly cost | Use |
|---|---|---|---|
| **Jev (TypeSafe AI)** | US$0.042 in / output free | ~US$0.30 | Triage, relevance scoring, routing, escalation decisions. Not a writer |
| Claude Haiku 5.5 | US$0.10 / US$0.50 (prompts ≤100K) | ~US$2 | Bulk first drafts, classification fallback |
| Claude Sonnet 5.5 | US$2 / US$10 (batch −50%) | ~US$20–35 | Final editorial writing, customer-facing email replies |
| Claude Opus 5.5 | US$4 / US$20 | ~US$70 | Monthly outlook, hard cases only |
| OpenAI gpt-6-luna | US$0.10 / US$0.50 | ~US$2 | Alternative budget writer |
| Gemini 3.1 Flash-Lite | US$0.25 / US$1.50 | ~US$5 | Alternative budget writer |
| Gemini 3.8 Flash | US$0.75 / US$3.75 promo; US$1.50 / US$7.50 from 1 Jan 2027 | ~US$13–26 | Alternative mid-tier |
| DeepSeek flash | US$0.15 / US$0.60 off-peak; double at peak | ~US$2.5 | Cheapest Chinese option |
| Qwen 3.8 Flash (intl.) | US$0.15 / US$0.47 | ~US$2.2 | Cheap Chinese option |

Sources: provider pricing pages as compiled by flatkey.ai (checked 22 Oct 2026), costoftoken.com and benchlm.ai
(25 Oct 2026), and Anthropic's published prices. Re-check before committing.

**Recommendation:** Jev for every yes/no or pick-one decision, Haiku 5.5 for drafts, Sonnet 5.5 for anything a
reader or customer sees. Total ≈ **US$15–40 a month**. At this scale the model bill is trivial; quality,
reliability and data protection decide the choice, not price.

**Rules that override price:**
- **Personal data** (emails, CRM, payments) goes only to providers with a signed data-processing agreement and an
  LGPD/GDPR-compliant international transfer basis. Do not send personal data to free tiers (Gemini's free tier
  uses data to improve products) or to providers without such a contract.
- **Chinese providers** (DeepSeek, Qwen) may be used only on public news text, never on personal data.
- Keep every model behind one gateway (`packages/ai`) so it can be swapped in a day.

**Jev, should we use it? Yes, in a limited seat.** It answers typed questions with calibrated probabilities in a few
hundred milliseconds at almost no cost, which fits: is this article relevant to the Comex lens; which lens; is this
email urgent; does it need a human. It cannot write, has no memory and a ~32K-token context. Rules: our code builds
the options and always includes a "none / unsure" exit; define the uncertain band (e.g. 0.35–0.65 goes to Sonnet or
a human); measure it against a dumb baseline before trusting it. It is new (launched 15 Sep 2026, early access):
keep it behind the gateway with a Haiku fallback.

## 6. Architecture and domains

- **Three surfaces, separate origins:**
  1. `meridiano.<tld>`: public site and editions (trademark and domain check pending).
  2. `app.meridiano.<tld>`: subscriber area (login, preferences, archive, privacy centre).
  3. `ops.estamina.net`: back office for the founder (CRM, editorial queue, finance, tax, AI operations). It is
     **not** public: it sits behind Cloudflare Access (SSO + passkeys/MFA, free up to 50 users), on a separate
     deployment with its own staff identity provider.
- Why separate: a flaw in the public site cannot reach staff sessions or admin APIs; cookies and auth realms are
  isolated; Estamina can host back offices for future businesses.
- One Postgres database (Supabase, São Paulo region), with schemas per domain, row-level security, and
  least-privilege roles per service. Prod and staging are separate projects.
- Stack: TypeScript monorepo (pnpm + Turborepo), Next.js for web and ops, a worker service for ingestion,
  editorial and agents, Postgres queue (pg-boss), Drizzle ORM, Zod everywhere.

## 7. Operating model: near-100% AI-run, human for judgement

| Area | AI does | Human (founder) does |
|---|---|---|
| Ingestion and triage | All | Reviews source list monthly |
| Edition drafting | Drafts cards, editorial, map, agenda | Approves every edition before sending |
| Email | Classifies and answers support, billing, preferences, simple sales questions | Gets escalations: partnerships, business proposals, B2B deals above R$1,200/month, press, legal threats, complaints, refunds outside policy, anything uncertain |
| LGPD requests | Verifies identity, prepares the data export or deletion | Approves before execution (15-day deadline) |
| CRM | Logs every interaction, scores leads, drafts follow-ups | Approves outbound to companies |
| Finance and tax | Reconciles payments, meters cost per user, estimates DAS, prepares the accountant's pack | Signs off monthly; the accountant files |
| Debates | Drafts invitations and briefings, tracks deadlines | Chooses questions and experts, edits |

No AI agent moves money, deletes data, publishes or sends to a list without an approval step.

## 8. Infrastructure and running costs (estimates, Oct 2026)

| Item | Monthly |
|---|---|
| Supabase Pro (São Paulo) | US$25 (+ PITR backups US$100 when revenue allows) |
| Hosting (web + ops + worker) | ~US$0–40 (estimate) |
| Cloudflare (DNS, WAF, Access ≤50 users) | US$0 (Pro US$20 optional) |
| Resend (transactional, 50k emails) | US$20; marketing plan US$40 for 5k contacts |
| newsapi.ai | US$90 |
| GDELT, RSS, primary sources | US$0 |
| AI models (section 5) | ~US$15–40 |
| Domains | ~US$2–5 (estimate) |
| **Fixed total** | **≈ US$150–320** (≈ R$830–1,760 at R$5.50) |
| Asaas fees | Pix R$1.99 (R$0.99 first 3 months); card R$0.49 + 2.99% (1.99% first 3 months); NFS-e R$0.49 each |

Not included: accountant, lawyer (copyright opinion, terms, privacy policy), expert fees (R$300–800 per article,
hypothesis), trademark registration.

## 9. Legal guardrails (summary; details in `SECURITY_PRIVACY.md`)

- Copyright: own headlines, quoted source titles, own synthesis, links; Law 9.610 arts. 10, 46 and 47; STJ REsp
  2.008.122 against commercial clipping. Legal opinion before charging.
- Design: no imitation of other publications' trade dress (see `WEBSITE_PROMPT.md`, section on copyright).
- LGPD and GDPR: privacy by design, consent for marketing, rights portal, DPAs, incident plan.
- Consumer: 7-day withdrawal, easy cancellation, no fake scarcity or countdowns.
- Not investment, legal or tax advice: shown on every edition.

## 10. Open questions

- Employer's written clearance for the side activity.
- Brand and domain: is "Meridiano" registrable at INPI (class 41, also 35/42)? Venezuela's sports daily
  *Meridiano* exists.
- Which accountant; confirm CNAE, regime and Fator R.
- Who reviews editions when the founder is away.
- When to start the first premium licence (FT Partner Programme).

## Changelog

| Date | Change | By |
|---|---|---|
| 25 Oct 2026 | First version: niche, prices, company, news-access layers incl. GDELT, AI costs, Jev, architecture, operating model | Claude, for Leo |
