# Meridiano: security, LGPD and GDPR review

Review date: 25 Oct 2026. Scope: the platform design in `MEMO.md`, `BUILD_PROMPTS.md` and `WEBSITE_PROMPT.md`,
and the uploaded prototype site (`meridiano-comex/`). There is no production code yet, so this is a **design
review plus a prototype code review**. Phase 11 repeats it against the real code and must close every item.

Severity: Critical / High / Medium / Low. Status: Open until fixed in code and verified.

---

## 1. Findings in the uploaded prototype (fix before any reuse)

| # | Severity | Finding | Where | Fix |
|---|---|---|---|---|
| P1 | High | **DOM XSS**: the lead-magnet handler writes the visitor's e-mail into the page with `innerHTML` (`Enviado para ${email}`). The input's `type="email"` check runs only in the browser and can be bypassed | `app.js` ~line 222 | Never interpolate input into `innerHTML`; set `textContent` or use framework escaping |
| P2 | High | **Card number, expiry and CVC fields on our own page** (`ccNumber`, `ccExp`, `ccCvc`). Even if not submitted, this pulls the site into PCI DSS scope and invites skimming | `index.html` ~lines 559–571 | Remove; use the payment provider's hosted checkout or tokenised fields |
| P3 | Medium | **Fake scarcity**: "vagas restantes" for founding members is hard-coded | `index.html` line 131 | Remove, or compute from the database (CDC art. 37, misleading advertising) |
| P4 | Medium | **Tailwind from a public CDN at runtime**: third-party script with full page access and no integrity pin; prevents a strict CSP | `index.html` | Compile CSS at build time; no runtime third-party scripts |
| P5 | Medium | Several other `innerHTML` writes render translation and data strings; safe today only because the data is static | `app.js` lines 305–557 | Move to a framework with auto-escaping; ban `innerHTML` by lint rule |
| P6 | Low | Simulated Pix "copy and paste" code and a "fill test card" button could mislead users | `index.html`, `app.js` | Remove simulations from anything public |
| P7 | Low | No privacy notice, consent banner or lawful-basis text next to the e-mail capture form | `index.html` | Add notice, purpose, link to the privacy policy, and double opt-in |

## 2. Threat model (STRIDE by trust boundary)

| Boundary | Main threats | Required controls (phase) |
|---|---|---|
| Browser → public site / app | XSS, CSRF, session theft, credential stuffing, scraping of paid content | Framework escaping, strict CSP with nonces, httpOnly + Secure + SameSite cookies, CSRF tokens on mutations, rate limits backed by a shared store, Turnstile on sign-up, server-side paywall (P5) |
| Staff → ops.estamina.net | Account takeover, privilege escalation, insider misuse | Cloudflare Access with SSO + passkeys, app verifies the Access JWT, roles with least privilege, audit log, no public sign-up (P7) |
| Worker → news sources | SSRF, malicious payloads, oversized responses, ToS breach | Host allowlist per adapter, private-IP blocking incl. redirects and DNS rebinding, size and time limits, robots.txt and terms respected (P2) |
| News text / emails → LLM | Prompt injection, data exfiltration through model output | Models reading untrusted text get no tools; actions done by code on validated, typed outputs; output schema validation; injection test suite (P3, P8) |
| Payment provider → webhook | Forged or replayed events | Verify Asaas auth token, idempotency, replay window, reconciliation job (P6) |
| Services → database | SQL injection, over-broad access, data leakage across members | Parameterised queries (Drizzle), RLS on every table, separate roles per service, encrypted PII columns, CI check that no table lacks RLS (P1) |
| Repo / CI → production | Secret leakage, supply-chain attack, malicious dependency | gitleaks, CodeQL, pinned action SHAs, frozen lockfile, install-script policy, audit + signature checks, SBOM (P0, P11) |
| Email (outbound) | Spoofing of our domain, deliverability abuse | SPF, DKIM, DMARC to reject, separate sending subdomain (P4) |
| Backups / exports | Data exposure, failure to delete | Encrypted backups, PITR, restore drills, deletion propagated to exports and caches, backup retention aligned with policy (P10) |

## 3. Database protection (the "protect the DB" checklist)

- [ ] Supabase project in São Paulo; staging and production separate; no production data in staging.
- [ ] Row-level security on **every** table; CI fails if any table has RLS off.
- [ ] One database role per service with the minimum grants; the service-role key exists only in the worker's
      secret store, never in a browser, a client bundle, a log or an LLM prompt.
- [ ] Personal data columns encrypted at application level (envelope encryption; keys in a secret manager,
      rotated yearly); keyed hashes for lookups.
- [ ] Network restrictions on direct database connections (allowlist the worker and ops egress IPs); SSL enforced.
- [ ] Append-only audit log (no UPDATE/DELETE grants) for admin, finance and privacy actions.
- [ ] Daily backups plus point-in-time recovery; quarterly restore drill to staging, documented.
- [ ] Alerts on unusual query volume, failed logins, new admin roles, and RLS policy changes.
- [ ] Migrations reviewed; no `SECURITY DEFINER` functions without a review note; `search_path` pinned in functions.

## 4. LGPD (Brazil) compliance map

| Requirement | How we meet it | Phase |
|---|---|---|
| Legal basis for each processing (art. 7) | Contract performance for subscribers; consent for marketing e-mails and non-essential cookies; legitimate interest for B2B prospecting, with a documented balancing test (LIA) and easy opt-out | P5, P11 |
| Transparency (arts. 6 and 9) | Plain-language privacy notice in PT/ES/EN; notice at every collection point; AI use disclosed | P5 |
| Data subject rights (art. 18): confirmation, access, correction, anonymisation, portability, deletion, information on sharing, consent withdrawal | Self-service privacy centre plus e-mail route; identity verification; deadline tracking (15 days for full access reports); deletion propagated to backups by expiry, caches and analytics | P5, P8 |
| Automated decisions (art. 20) | Lens personalisation and email triage are automated; users can request review by a human; logic explained in the notice | P8, P11 |
| Data protection officer, "encarregado" (art. 41) | Named and published, with a contact e-mail (small-business flexibilities under ANPD Resolution 2/2022 may apply; keep a channel anyway) | P11 |
| Records of processing (art. 37) | ROPA maintained in `docs/privacy/ROPA.md` | P11 |
| Impact report, RIPD (art. 38) | For profiling (lenses) and the AI email agent | P11 |
| Security (art. 46) | Sections 2 and 3 above | All |
| Incident notification (art. 48) | To ANPD and affected people; ANPD Resolution 15/2024 sets 3 working days; runbook and templates ready | P10, P11 |
| International transfer (art. 33) | US processors (hosting, email, AI) under ANPD standard contractual clauses (Resolution 19/2024) or equivalent safeguards; list of processors and countries published | P11 |
| Retention and disposal (art. 16) | Retention schedule: account data while active + 5 years for tax records; marketing data until consent is withdrawn; email support threads 2 years; logs 90 days without PII | P1, P10 |
| Children's data (art. 14) | Service for professionals only; terms require 18+ | P5 |

## 5. GDPR (EU readers and Spanish-speaking expansion)

| Requirement | How we meet it |
|---|---|
| Lawful basis (art. 6) | As for LGPD; marketing by consent; ePrivacy cookie consent with reject-all as easy as accept-all |
| Information (arts. 13–14) | Same notice, EU-specific sections |
| Rights (arts. 15–22) | Same privacy centre; one-month deadline |
| Processors (art. 28) | DPAs with every processor (Supabase, Resend, Asaas, Cloudflare, AI providers, hosting) |
| Transfers (Ch. V) | EU SCCs or adequacy (EU–US Data Privacy Framework where the vendor is certified) |
| Representative (art. 27) | Needed if we systematically target EU residents without an EU establishment; decide before EU marketing |
| Breach (arts. 33–34) | 72 hours to the authority; same runbook |
| DPIA (art. 35) | Same RIPD, extended |

## 6. AI-specific controls (OWASP Top 10 for LLM Applications, 2025)

- LLM01 prompt injection: untrusted news and emails never reach a model that has tools; actions are performed by
  code on typed outputs; injection test set in CI.
- LLM02 sensitive information disclosure: only the minimum account fields go into an email-reply prompt; no
  secrets, no other customers' data, no full system prompts in the context.
- LLM05 output handling: every model output validated against a schema and escaped before rendering; never into
  SQL, shell or `innerHTML`.
- LLM06 excessive agency: no agent moves money, deletes data, publishes or mass-sends without approval.
- LLM10 unbounded consumption: per-call token caps, per-day budget caps, alerts at 50/80/100%.
- Vendor rule: personal data only to providers with a DPA and transfer basis; DeepSeek/Qwen and free tiers only
  for public news text.

## 7. Copyright and content-rights controls

- `rights_class` on every stored item; article bodies stored only when licensed.
- Overlap check: no 8+ consecutive words copied from any source in published text.
- Takedown channel and 24-hour response.
- Legal opinion before charging (Law 9.610 arts. 10, 46, 47; STJ REsp 2.008.122).
- Design guardrails in `WEBSITE_PROMPT.md` section 5.

## 8. External red-team brief (for Claude Fable 5.1, Manus or human testers)

- Written authorisation from the company; scope = staging URLs and the repository; out of scope = production,
  real customer data, denial-of-service, social engineering of real people, third-party services' infrastructure.
- Test accounts provided; rate of testing agreed; findings reported within 48 hours with reproduction steps.
- Focus areas: auth and session handling, RLS bypass and IDOR, paywall bypass, webhook forgery, SSRF in ingestion,
  prompt injection against the email agent, ops access bypass, secrets exposure, dependency risks.

## 9. Sign-off checklist before launch

- [ ] All prototype findings (P1–P7) closed or the prototype discarded.
- [ ] No open critical/high findings from Phase 11 or the red team.
- [ ] Privacy notice, terms, cookie policy and AI-use disclosure published in PT/ES/EN, reviewed by a lawyer.
- [ ] DPAs signed; processor list published.
- [ ] Data-subject-rights flows tested end to end, including deletion from backups by expiry.
- [ ] Incident runbook tested in a tabletop exercise.
- [ ] Restore drill passed.

Limits of this review: it covers design and the prototype only. It does not replace a lawyer's opinion on LGPD,
GDPR, consumer and copyright law, or a penetration test of the finished system.
