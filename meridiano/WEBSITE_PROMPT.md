# Meridiano: website and subscriber area brief

Use with Phase 5 of `BUILD_PROMPTS.md`. This brief replaces the uploaded "Website redesign for Meridiano Comex"
prototype, which works as a sketch but reads as machine-made and has issues listed in section 1.

---

## 1. What is wrong with the current prototype

| Issue | Why it matters | Fix |
|---|---|---|
| Near-black slate background, blue and amber glow pills, glassmorphism nav, gradients, rounded corners on every block | The standard "AI landing page" look; it signals a template, not a publication | A newspaper's restraint: paper ground, ink text, hairline rules, one signal colour |
| Cormorant Garamond + Inter | The most common pairing in generated sites | A text serif built for news reading plus a sober grotesk (section 3) |
| Tailwind loaded from the CDN at runtime | Slow, and incompatible with a strict Content Security Policy | Compiled CSS in the build |
| "34 of 50 places left" counter hard-coded | Fake scarcity is misleading advertising under the Consumer Defence Code (art. 37) | Show a real count from the database, or nothing |
| Simulated Pix code and a "fill test card" button | Confusing; a payment form must never collect card data on our side | Hand off to the payment provider's hosted checkout or tokenised fields |
| Everything in one HTML file with a translation dictionary in JavaScript | No SEO per language, no server rendering, no paywall | Next.js with locale routes and server-side gating |
| Language choice in localStorage only | Breaks shared links and search indexing | Locale in the URL: /pt, /es, /en |

Keep from the prototype: the trilingual idea, the lens filters (Comex, CFO, Board), the agenda table, the plans
section, the clear sample edition.

## 2. Design direction: a business broadsheet, our own

Draw on the **conventions** that the great business papers share, not on any one paper's identity:

- A **front page** that leads with the week's editorial and one dominant story, then a disciplined grid of others.
- **Hierarchy by type, not decoration:** large text-serif headlines, small caps kickers, datelines, hairline column
  rules, generous white space, almost no boxes or shadows.
- **Data as a first-class citizen:** small tables and charts set in tabular figures, sourced underneath.
- **Opinion visibly separated from reporting:** the Point and Counterpoint section has its own label, layout and
  bylines.
- **Calm colour:** a paper ground, ink text, and one signal colour reserved for data highlights and the lens tags.

These conventions are general to newspaper design and free to use. What we must not copy is listed in section 5.

## 3. Design tokens

```
Layout: 12-column grid, max width 1200px, 24px gutters, 4-column on tablet, 1-column on phone.
Hairline column rules (1px) between columns on desktop.

Colour (light theme; a dark theme mirrors these with the same roles):
  --paper     #F5F4F0   neutral warm-grey paper (deliberately NOT salmon/pink, NOT cream-yellow)
  --ink       #121417   body text and headlines
  --ink-2     #4A5560   secondary text, datelines
  --rule      #D5D8DC   hairlines
  --navy      #0E2A3B   Meridiano brand: masthead, footer, section bars
  --sea       #0B6670   links, lens tags, positive data
  --signal    #E3982B   highlight in charts and the "for you" label only (on ink or as fill, never as small text on paper)
  --alert     #A3261E   corrections and warnings only
Contrast: all text ≥ 4.5:1 on its ground (check signal and sea at small sizes).

Type (self-hosted, all under the SIL Open Font License):
  Headlines and body: Source Serif 4 (optical sizes) or Newsreader
  Labels, navigation, tables: Libre Franklin or IBM Plex Sans
  Numbers in tables and data: IBM Plex Mono or tabular figures of the sans
  Scale: 48/36/28/22/18/16/14/12 px; body 18px/1.6 on article pages; max 68 characters per line.

Components: masthead with date and edition number; section kicker; story card (kicker, headline, standfirst,
"for the world / for you", sources line, lens tags); lead story; data box; map of the week (solid = cited,
dashed = inference); agenda table; point and counterpoint pair with bylines and conflict declarations; plan cards;
newsletter sign-up; footer with legal links and "not investment advice".
Icons: a small set of line icons drawn for us or from an open-licence set (e.g. Lucide, ISC licence). No emoji.
Images: our own charts and maps; licensed photography only, credited; no stock imagery that looks like newsroom
photography of real events.
```

## 4. Pages

| Route | Content | Access |
|---|---|---|
| `/{locale}` | Front page: this week's editorial, lead story, 3 free cards, map, agenda, debate teaser, sign-up | Public |
| `/{locale}/edicao/{date}` | Full edition | Paid (free version shows 3 cards) |
| `/{locale}/edicao/{date}/{slug}` | Story card page with sources | Paid or free per card |
| `/{locale}/debate/{slug}` | Point and Counterpoint | Teaser public, full paid |
| `/{locale}/arquivo` | Archive by week and lens | Paid |
| `/{locale}/planos` | Plans and FAQ | Public |
| `/{locale}/metodo` | Method, sources policy, corrections policy, AI use disclosure | Public |
| `/{locale}/correcoes` | Corrections log | Public |
| `/{locale}/privacidade`, `/termos`, `/cookies` | Legal | Public |
| `app.` subdomain | Sign-in, preferences, plan and invoices, privacy centre | Member |

Locale routes: `pt` (default), `es`, `en`; hreflang tags; translated slugs optional.

## 5. Copyright and trade-dress guardrails (mandatory)

We take inspiration from general editorial conventions only. We must **not** use or imitate:

- Any other publication's **name, masthead, logo or logo shape** (for example the Economist's red rectangle, the
  FT's or WSJ's mastheads, the Guardian's logo).
- The **Financial Times' salmon-pink paper colour**, which is a protected brand asset, or any near match.
- **Proprietary typefaces** of those publications (e.g. Financier, Guardian Egyptian/Guardian Headline, Escrow,
  Exchange, Retina, Econ Sans, Milo). Use open-licence fonts only and keep their licences in the repo.
- **Signature illustration styles** strongly associated with one paper (e.g. stippled "hedcut" portraits).
- **Their layouts copied** element by element, their section names styled as theirs, their icons, or their
  photography and charts.
- Any **headline text or article text** beyond the quoted source title we already allow.

Process: before launch, compare our front page side by side with each of the four papers' home pages; if a reader
could mistake ours for theirs, change it. Record the review in `docs/DESIGN_REVIEW.md`.

## 6. Technical architecture

- Next.js (App Router) with server components; server-side paywall checks; ISR for editions.
- Styling: CSS Modules or compiled Tailwind with the tokens above as CSS variables; no runtime CDN scripts.
- Content from Postgres via the server only; the browser never holds the database service key.
- Images through Next/Image with an allowlist of hosts; charts rendered as SVG from data.
- Analytics: cookieless and self-hosted by default; marketing pixels only after consent.
- Performance budget: LCP < 2.0 s on 4G, CLS < 0.05, total JS on the front page < 120 KB compressed.
- Accessibility: WCAG 2.2 AA, keyboard-first, visible focus, reduced-motion respected, alt text from data.
- Security headers: strict CSP with nonces, HSTS, frame-ancestors none, Referrer-Policy, Permissions-Policy.
- SEO: Article structured data for our own stories (we are the author of the synthesis); canonical URLs; no
  indexing of paid full text beyond what we show publicly.

## 7. How it connects to the back office

- Public site and subscriber area read published content and the member's own data only.
- All admin functions live in `ops.estamina.net`, a separate deployment behind Cloudflare Access with staff SSO
  and passkeys. There is no admin login on the public domain, and no admin API reachable from it.
- Both read the same Postgres through different roles with row-level security; the ops app writes through audited
  server actions only.
- Why this is safer: separate origins isolate cookies and scripts; an XSS or session bug on the public site cannot
  act as staff; Cloudflare Access blocks the ops site before any of our code runs.
