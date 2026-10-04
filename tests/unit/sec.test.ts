import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CompanyFacts, discreteQuarters, extractCompany, latestFilings, pickTag, type Fact } from '../../scripts/adapters/sec';
import { LiveBundle, mergeLive, quarterLabel } from '../../src/lib/data/live';
import { validateGraph } from '../../src/lib/data/schema';

// Recorded from data.sec.gov on 4 Oct 2026, trimmed to the tags we read (facts ending 2024 onwards).
const fixture = (n: string) => JSON.parse(readFileSync(`tests/fixtures/sec/${n}.json`, 'utf8'));
const msft = CompanyFacts.parse(fixture('msft-companyfacts'));
const googl = CompanyFacts.parse(fixture('googl-companyfacts'));
const seed = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));
const entity = (id: string) => seed.entities.find((e) => e.id === id)!;
const NOW = new Date('2026-10-04');

const fact = (start: string, end: string, val: number, filed = '2026-01-01', accn = `a-${end}`): Fact =>
  ({ start, end, val, accn, form: '10-Q', filed });

describe('year-to-date to discrete quarters', () => {
  it('subtracts consecutive YTD figures from the same fiscal-year start', () => {
    const q = discreteQuarters([
      fact('2025-07-01', '2025-09-30', 10), fact('2025-07-01', '2025-12-31', 25),
      fact('2025-07-01', '2026-03-31', 45), fact('2025-07-01', '2026-06-30', 70),
    ]);
    expect(q.map((x) => [x.end, x.val, x.derived])).toEqual([
      ['2026-06-30', 25, true], ['2026-03-31', 20, true], ['2025-12-31', 15, true], ['2025-09-30', 10, false],
    ]);
    expect(q[0]!.start).toBe('2026-04-01');
    expect(q[0]!.accns).toEqual(['a-2026-06-30', 'a-2026-03-31']); // both filings cited
  });
  it('prefers a reported 3-month figure over a derived one', () => {
    const q = discreteQuarters([fact('2026-01-01', '2026-06-30', 100), fact('2026-01-01', '2026-03-31', 40), fact('2026-04-01', '2026-06-30', 61)]);
    expect(q[0]).toMatchObject({ val: 61, derived: false });
  });
  it('uses the latest filing when a period is restated', () => {
    const q = discreteQuarters([fact('2026-01-01', '2026-03-31', 40, '2026-04-30'), fact('2026-01-01', '2026-03-31', 42, '2027-04-30')]);
    expect(q[0]!.val).toBe(42);
  });
  it('does not subtract across a gap', () => {
    expect(discreteQuarters([fact('2026-01-01', '2026-03-31', 40), fact('2026-01-01', '2026-09-30', 100)]).map((x) => x.end)).toEqual(['2026-03-31']);
  });
});

describe('quarter labels', () => {
  it('labels by period midpoint, so 52/53-week years land right', () => {
    expect(quarterLabel('2026-06-30')).toBe('Q2 2026'); // Microsoft fiscal Q4
    expect(quarterLabel('2026-07-26')).toBe('Q2 2026'); // Nvidia
    expect(quarterLabel('2026-09-27')).toBe('Q3 2026'); // Apple
    expect(quarterLabel('2026-03-31')).toBe('Q1 2026');
  });
});

describe('Microsoft fixture (June fiscal year)', () => {
  const x = extractCompany(entity('microsoft'), msft, NOW);
  const h = (key: string, period: string) => x.history.find((p) => p.key === key && p.period === period)!;
  it('derives fiscal Q4 capex from the 10-K annual minus the 9-month YTD', () => {
    // FY26 YTD capex: 9M to 31 Mar 2026 = 80.146bn (10-Q), 12M to 30 Jun 2026 = 115.948bn (10-K)
    expect(h('capex_quarter', 'Q2 2026')).toMatchObject({ value: 35.802, derived: true, end: '2026-06-30' });
  });
  it('keeps fiscal Q1 as reported (3 months from the 1 July start)', () => {
    expect(h('capex_quarter', 'Q3 2025')).toMatchObject({ value: 19.394, derived: false });
  });
  it('emits 8 quarters per series, newest first', () => {
    const s = x.history.filter((p) => p.key === 'capex_quarter');
    expect(s).toHaveLength(8);
    expect(s[0]!.end > s[7]!.end).toBe(true);
  });
  it('logs the matched capex tag', () => {
    expect(x.notes[0]).toContain('capex=PaymentsToAcquirePropertyPlantAndEquipment');
  });
});

describe('Alphabet fixture', () => {
  const x = extractCompany(entity('alphabet'), googl, NOW);
  const m = (key: string) => x.metrics.find((p) => p.key === key)!;
  it('reports Q2 2026 capex and free cash flow as filed, with the accession as source', () => {
    // 6M capex 80.598 − 3M 35.674 = 44.924; 6M OCF 84.859 − 3M 45.790 = 39.069; FCF = 39.069 − 44.924 = −5.855
    expect(m('capex_quarter')).toMatchObject({ period: 'Q2 2026', value: 44.924, status: 'filed', confidence: 'high' });
    expect(m('free_cash_flow_quarter')).toMatchObject({ period: 'Q2 2026', value: -5.855, status: 'filed' });
    const src = x.sources.find((s) => s.id === m('capex_quarter').source_ids[0])!;
    expect(src.url).toMatch(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1652044\/\d{18}\//);
    expect(src).toMatchObject({ kind: 'filing', reliability: 'primary' });
  });
  it('takes the reported 3-month revenue rather than deriving it', () => {
    expect(m('revenue_quarter')).toMatchObject({ value: 119.796, period: 'Q2 2026' });
  });
  it('supersedes the seed figures for the same quarter', () => {
    const bundle = LiveBundle.parse({ adapter: 'sec', fetched_at: 'x', metrics: x.metrics, sources: x.sources, history: x.history, filings: [] });
    const merged = validateGraph(mergeLive(seed, [bundle]));
    const old = merged.metrics.find((p) => p.id === 'm_goog_q2capex')!;
    expect(old.superseded_by).toBe(m('capex_quarter').id);
    expect(merged.metrics.find((p) => p.id === 'm_goog_q2fcf')!.superseded_by).toBe(m('free_cash_flow_quarter').id);
    expect(merged.metrics.find((p) => p.id === 'm_amzn_capex')!.superseded_by).toBeUndefined(); // guidance is not a filing
  });
});

describe('tag choice and filings', () => {
  it('falls back to the second capex tag when the first is absent', () => {
    const cf = CompanyFacts.parse({ cik: 1, entityName: 'X', facts: { 'us-gaap': { PaymentsToAcquireProductiveAssets: { units: { USD: [fact('2026-01-01', '2026-03-31', 1)] } } } } });
    expect(pickTag(cf, ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'], NOW)).toBe('PaymentsToAcquireProductiveAssets');
  });
  it('lists the latest 10-K, 10-Q and 8-K with document links', () => {
    const f = latestFilings(entity('alphabet'), fixture('googl-submissions'));
    expect(f.map((x) => x.form)).toEqual(expect.arrayContaining(['10-K', '10-Q', '8-K']));
    for (const x of f) expect(x.url).toMatch(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1652044\//);
  });
});
