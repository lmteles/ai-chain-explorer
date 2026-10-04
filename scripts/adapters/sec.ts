import { z } from 'zod';
import type { Entity, Metric, Source } from '../../src/lib/data/schema';
import { cachedGet, HOUR } from './http';
import { quarterLabel, type Filing, type HistoryPoint } from '../../src/lib/data/live';

// ---------- transport: User-Agent, 24h disk cache, < 8 req/s ----------

export async function secGet(url: string, userAgent: string): Promise<unknown> {
  // 150 ms gap ≈ 6.7 req/s, under SEC's 10/s and our 8/s ceiling
  return JSON.parse(await cachedGet(url, { ttlMs: 24 * HOUR, minGapMs: 150, headers: { 'User-Agent': userAgent, Accept: 'application/json' } }));
}

export const cik10 = (cik: string) => cik.padStart(10, '0');
export const companyFactsUrl = (cik: string) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10(cik)}.json`;
export const submissionsUrl = (cik: string) => `https://data.sec.gov/submissions/CIK${cik10(cik)}.json`;
export const filingUrl = (cik: string, accn: string, doc = `${accn}-index.htm`) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replaceAll('-', '')}/${doc}`;

// ---------- payload schemas (only the fields we read) ----------

export const Fact = z.object({
  start: z.string().optional(), end: z.string(), val: z.number(), accn: z.string(),
  fy: z.number().nullable().optional(), fp: z.string().nullable().optional(), form: z.string(), filed: z.string(),
  frame: z.string().optional(),
});
export type Fact = z.infer<typeof Fact>;

export const CompanyFacts = z.object({
  cik: z.union([z.number(), z.string()]),
  entityName: z.string(),
  facts: z.record(z.string(), z.record(z.string(), z.object({ units: z.record(z.string(), z.array(Fact)) }))),
});
export type CompanyFacts = z.infer<typeof CompanyFacts>;

export const Submissions = z.object({
  filings: z.object({
    recent: z.object({
      accessionNumber: z.array(z.string()), form: z.array(z.string()), filingDate: z.array(z.string()),
      reportDate: z.array(z.string()), primaryDocument: z.array(z.string()),
    }),
  }),
});

// ---------- pure extraction ----------

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const isQuarterLong = (d: number) => d >= 80 && d <= 100;

/** One fact per period: a later filing restates an earlier one. */
export function latestPerPeriod(facts: Fact[]): Fact[] {
  const by = new Map<string, Fact>();
  for (const f of facts) {
    const k = `${f.start ?? ''}|${f.end}`;
    const prev = by.get(k);
    if (!prev || f.filed > prev.filed) by.set(k, f);
  }
  return [...by.values()];
}

export type Quarter = { end: string; start: string; val: number; accns: string[]; filed: string; derived: boolean };

/**
 * Discrete quarters from duration facts. Cash-flow statements report year-to-date figures (3, 6, 9, 12 months
 * from the same fiscal-year start), so a quarter is YTD(n) − YTD(n−1). Directly reported 3-month facts win.
 */
export function discreteQuarters(raw: Fact[]): Quarter[] {
  const facts = latestPerPeriod(raw.filter((f) => f.start));
  const out = new Map<string, Quarter>();
  for (const f of facts) {
    if (isQuarterLong(days(f.start!, f.end))) out.set(f.end, { end: f.end, start: f.start!, val: f.val, accns: [f.accn], filed: f.filed, derived: false });
  }
  const byStart = new Map<string, Fact[]>();
  for (const f of facts) byStart.set(f.start!, [...(byStart.get(f.start!) ?? []), f]);
  for (const series of byStart.values()) {
    series.sort((a, b) => a.end.localeCompare(b.end));
    for (let i = 1; i < series.length; i++) {
      const cur = series[i]!, prev = series[i - 1]!;
      if (out.has(cur.end) || !isQuarterLong(days(prev.end, cur.end))) continue; // needs consecutive YTD points
      out.set(cur.end, {
        end: cur.end, start: new Date(Date.parse(prev.end) + DAY).toISOString().slice(0, 10),
        val: cur.val - prev.val, accns: [cur.accn, prev.accn], filed: cur.filed, derived: true,
      });
    }
  }
  return [...out.values()].sort((a, b) => b.end.localeCompare(a.end));
}

/** Point-in-time (balance sheet) facts, latest restatement per date, newest first. */
export function instants(raw: Fact[]): Fact[] {
  return latestPerPeriod(raw.filter((f) => !f.start)).sort((a, b) => b.end.localeCompare(a.end));
}

const usd = (cf: CompanyFacts, tag: string) => cf.facts['us-gaap']?.[tag]?.units.USD ?? [];

/** First candidate tag with a fact ending in the last 18 months; else the first with any facts. */
export function pickTag(cf: CompanyFacts, candidates: string[], now = new Date()): string | null {
  const recent = (t: string) => usd(cf, t).some((f) => now.getTime() - Date.parse(f.end) < 550 * DAY);
  return candidates.find(recent) ?? candidates.find((t) => usd(cf, t).length > 0) ?? null;
}

export const TAGS = {
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities'],
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'],
  rpo: ['RevenueRemainingPerformanceObligation'],
};

export type Extracted = {
  metrics: Metric[]; history: HistoryPoint[]; sources: Source[]; notes: string[];
};

const QUARTERS = 8;
/** Stable fact id: the same quarter keeps the same id across runs, so citations stay valid. */
export const factId = (entity: string, key: string, end: string) =>
  `sec_${entity}_${key}_${quarterLabel(end).replace(' ', '').toLowerCase()}`;
const bn = (v: number) => Math.round((v / 1e9) * 1000) / 1000;

export function extractCompany(e: Entity, cf: CompanyFacts, now = new Date()): Extracted {
  const cik = e.cik!;
  const metrics: Metric[] = [], history: HistoryPoint[] = [], notes: string[] = [];
  const sources = new Map<string, Source>();
  const facts = new Map(Object.values(cf.facts['us-gaap'] ?? {}).flatMap((t) => Object.values(t.units).flat()).map((f) => [f.accn, f]));
  const src = (accn: string) => {
    const id = `sec_${accn}`;
    const f = facts.get(accn);
    if (!sources.has(id)) sources.set(id, {
      id, publisher: `SEC ${f?.form ?? 'filing'} ${f?.filed ?? ''}`.trim(), title: `${e.name} ${f?.form ?? 'filing'}, SEC EDGAR accession ${accn}`,
      url: filingUrl(cik, accn), published: f?.filed ?? null, kind: 'filing', reliability: 'primary',
    });
    return id;
  };
  const emitSeries = (key: string, qs: Quarter[], note: (q: Quarter) => string) => {
    qs.slice(0, QUARTERS).forEach((q, i) => {
      const source_ids = q.accns.map(src);
      const id = factId(e.id, key, q.end);
      history.push({ id, entity_id: e.id, key, period: quarterLabel(q.end), end: q.end, value: bn(q.val), unit: 'USD_bn', source_ids, derived: q.derived });
      if (i === 0) metrics.push({
        id, entity_id: e.id, key,
        value: bn(q.val), low: null, high: null, unit: 'USD_bn', period: quarterLabel(q.end), status: 'filed',
        source_ids, confidence: 'high', as_of: q.filed, note: note(q),
      });
    });
  };
  const span = (q: Quarter) => `3 months ${q.start} to ${q.end}`;
  const how = (q: Quarter) => (q.derived ? 'derived: year-to-date minus prior year-to-date (cash-flow facts are cumulative)' : 'as reported');

  if (!cf.facts['us-gaap']) {
    notes.push(`${e.id}: no us-gaap facts (IFRS filer); figures come from investor materials in M5`);
    return { metrics, history, sources: [], notes };
  }

  const capexTag = pickTag(cf, TAGS.capex, now);
  const ocfTag = pickTag(cf, TAGS.ocf, now);
  const revTag = pickTag(cf, TAGS.revenue, now);
  notes.push(`${e.id}: capex=${capexTag ?? 'none'} ocf=${ocfTag ?? 'none'} revenue=${revTag ?? 'none'}`);

  const capex = capexTag ? discreteQuarters(usd(cf, capexTag)) : [];
  const ocf = ocfTag ? discreteQuarters(usd(cf, ocfTag)) : [];
  emitSeries('capex_quarter', capex, (q) => `Cash capex (${capexTag}), ${span(q)}; ${how(q)}. Excludes finance-lease additions.`);
  emitSeries('operating_cash_flow_quarter', ocf, (q) => `${span(q)}; ${how(q)}.`);

  const capexBy = new Map(capex.map((q) => [q.end, q]));
  const fcf: Quarter[] = ocf.flatMap((o) => {
    const c = capexBy.get(o.end);
    return c ? [{ ...o, val: o.val - c.val, accns: [...new Set([...o.accns, ...c.accns])], derived: true }] : [];
  });
  emitSeries('free_cash_flow_quarter', fcf, (q) => `Operating cash flow minus cash capex, ${span(q)}.`);

  if (revTag) {
    const rev = discreteQuarters(usd(cf, revTag));
    emitSeries('revenue_quarter', rev, (q) => `${revTag}, ${span(q)}; ${how(q)}.`);
    const last4 = rev.slice(0, 4);
    const contiguous = last4.length === 4 && last4.every((q, i) => i === 0 || isQuarterLong(days(q.end, last4[i - 1]!.end)));
    if (contiguous) {
      const accns = [...new Set(last4.flatMap((q) => q.accns))];
      metrics.push({
        id: factId(e.id, 'revenue_ttm', last4[0]!.end), entity_id: e.id, key: 'revenue_ttm',
        value: bn(last4.reduce((s, q) => s + q.val, 0)), low: null, high: null, unit: 'USD_bn',
        period: `TTM to ${last4[0]!.end}`, status: 'filed', source_ids: accns.map(src), confidence: 'high',
        as_of: last4[0]!.filed, note: 'Sum of the last four discrete quarters (same basis, same currency).',
      });
    }
  }

  const rpoTag = pickTag(cf, TAGS.rpo, now);
  if (rpoTag && e.id === 'oracle') {
    instants(usd(cf, rpoTag)).slice(0, QUARTERS).forEach((f, i) => {
      const source_ids = [src(f.accn)];
      const id = factId(e.id, 'rpo', f.end);
      history.push({ id, entity_id: e.id, key: 'rpo', period: quarterLabel(f.end), end: f.end, value: bn(f.val), unit: 'USD_bn', source_ids, derived: false });
      if (i === 0) metrics.push({
        id, entity_id: e.id, key: 'rpo', value: bn(f.val), low: null, high: null, unit: 'USD_bn',
        period: quarterLabel(f.end), status: 'filed', source_ids, confidence: 'high', as_of: f.filed,
        note: `Remaining performance obligations at ${f.end} (${rpoTag}).`,
      });
    });
  }

  // companyfacts omits dimensional facts, so the customer behind each percentage cannot be named here.
  const conc = cf.facts['us-gaap']?.['ConcentrationRiskPercentage1']?.units.pure ?? [];
  const latestConc = instants(conc.map((f) => ({ ...f, start: undefined }))).filter((f, _, a) => f.end === a[0]?.end);
  latestConc.forEach((f, i) => metrics.push({
    id: `sec_${e.id}_concentration_${f.end}_${i + 1}`, entity_id: e.id, key: 'concentration_risk_pct',
    value: Math.round(f.val * 1000) / 10, low: null, high: null, unit: 'pct', period: f.end, status: 'filed',
    source_ids: [src(f.accn)], confidence: 'high', as_of: f.filed,
    note: 'Customer, benchmark (revenue or receivables) and member are not exposed by the companyfacts API; read the filing note.',
  }));
  if (latestConc.length) notes.push(`${e.id}: ${latestConc.length} concentration fact(s), unnamed`);

  return { metrics, history, sources: [...sources.values()], notes };
}

const FORMS = ['10-K', '10-Q', '8-K', '20-F', '6-K'];

/** Latest filing of each form type. */
export function latestFilings(e: Entity, raw: unknown): Filing[] {
  const r = Submissions.parse(raw).filings.recent;
  const out: Filing[] = [];
  for (const form of FORMS) {
    const i = r.form.findIndex((f) => f === form); // recent[] is newest first
    if (i < 0) continue;
    out.push({
      entity_id: e.id, form, filed: r.filingDate[i]!, report_date: r.reportDate[i] || null,
      url: filingUrl(e.cik!, r.accessionNumber[i]!, r.primaryDocument[i] || undefined), accession: r.accessionNumber[i]!,
    });
  }
  return out;
}
