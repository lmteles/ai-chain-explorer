import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateGraph } from '../../src/lib/data/schema';
import { directionSentence, entityName, fmtAmount, fmtMoney, staleness, usdSortKey } from '../../src/lib/fmt';
import { concentration, namedTotals } from '../../src/lib/graph/concentration';
import { ALL_FILTERS } from '../../src/lib/graph/view';
import { DEFAULT_VIEW, decodeView, encodeView, pushTrail, type ViewState } from '../../src/lib/urlState';

const g = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));
const rel = (id: string) => g.relations.find((r) => r.id === id)!;
const name = entityName(g.entities);

describe('formatting', () => {
  it('formats money by unit', () => {
    expect(fmtMoney(20.5, 'USD_bn')).toBe('$20.5bn');
    expect(fmtMoney(44, 'EUR_bn')).toBe('€44bn');
    expect(fmtMoney(70, 'pct')).toBe('70%');
    expect(fmtMoney(-5.855, 'USD_bn')).toBe('−$5.9bn');
    expect(fmtMoney(0.026, 'EUR_bn')).toBe('€0.026bn'); // small, not "€0bn"
  });
  it('spells out every basis differently', () => {
    expect(fmtAmount(rel('r_anth_amzn'))).toBe('$100bn committed · 5 GW');
    expect(fmtAmount(rel('r_amzn_anth'))).toBe('up to $25bn');
    expect(fmtAmount(rel('r_openai_oracle'))).toBe('$300bn derived from 50% of backlog');
    expect(fmtAmount(rel('r_msft_openai'))).toBe('27% ownership stake');
    expect(fmtAmount(rel('r_nvda_tsmc'))).toBe("$23.2bn a year · 19% of the payee's revenue");
    expect(fmtAmount(rel('r_openai_nvda'))).toBe('10 GW');
    expect(fmtAmount(rel('r_meta_nvda'))).toBe('undisclosed');
  });
  it('writes the direction in plain English', () => {
    expect(directionSentence(rel('r_anth_amzn'), name)).toBe('Anthropic commits to pay Amazon for compute: $100bn committed · 5 GW.');
    expect(directionSentence(rel('r_goog_anth'), name)).toBe('Alphabet invests in Anthropic: up to $40bn.');
    expect(directionSentence(rel('r_msft_openai'), name)).toMatch(/^Microsoft holds a stake in OpenAI/);
  });
  it('sorts undisclosed amounts last', () => {
    expect(usdSortKey(rel('r_meta_nvda'))).toBeLessThan(usdSortKey(rel('r_meta_amd')));
  });
});

describe('staleness', () => {
  const now = new Date('2026-10-04');
  it('grades by age', () => {
    expect(staleness('2026-09-01', now).level).toBe('fresh');
    expect(staleness('2026-06-15', now).level).toBe('amber');
    expect(staleness('2026-01-28', now)).toEqual({ level: 'red', days: 249 });
    expect(staleness(null, now)).toEqual({ level: 'undated', days: null });
  });
  it('reads month-precision dates as the 1st (older)', () => {
    expect(staleness('2026-07', now).days).toBe(staleness('2026-07-01', now).days);
  });
});

describe('concentration', () => {
  it('shows TSMC customers as shares of revenue, largest first, and totals named ones', () => {
    const rows = concentration(g, 'tsmc');
    expect(rows.filter((r) => r.counterpartyId).map((r) => [r.counterpartyId, r.pct])).toEqual([['nvidia', 19], ['apple', 17], ['broadcom', 13]]);
    expect(rows[0]).toMatchObject({ counterparty: 'HPC platform (product mix, not a customer)', pct: 61 }); // platform mix, not a customer
    expect(namedTotals(rows)).toEqual([{ of: 'revenue', pct: 49, n: 3 }]);
  });
  it('keeps the Oracle RPO edge and drops the duplicate metric', () => {
    const rows = concentration(g, 'oracle');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ factId: 'r_openai_oracle', pct: 50, of: 'RPO (backlog)' });
  });
  it('shows Nvidia receivables concentration from the metric', () => {
    expect(concentration(g, 'nvidia')).toEqual([expect.objectContaining({ factId: 'm_nvda_ar', pct: 70, counterpartyId: null })]);
  });
  it('never treats an ownership stake as revenue dependence', () => {
    expect(concentration(g, 'openai')).toEqual([]);
  });
  it('flags proxies and leaves them out of totals', () => {
    const rows = concentration(g, 'asml');
    expect(rows.find((r) => r.factId === 'r_tsmc_asml')?.proxy).toBe(true);
    expect(namedTotals(rows)).toEqual([]);
  });
});

describe('URL state', () => {
  it('keeps a default view as a bare URL', () => {
    expect(encodeView(DEFAULT_VIEW)).toBe('#/');
  });
  it('round-trips a full view', () => {
    const v: ViewState = {
      filters: { ...ALL_FILTERS, types: ['equity', 'compute_commitment'], confidence: ['high'], minUsd: 25 },
      sizeBy: 'none', layout: 'force', sel: { kind: 'node', id: 'anthropic' }, tab: 'money',
      focus: 'anthropic', trail: ['openai', 'anthropic'], loop: 'r_anth_amzn>r_amzn_anth', rabbit: ['r_anth_amzn'], asOf: '2026-03-31',
    };
    expect(decodeView(encodeView(v))).toEqual(v);
    expect(decodeView(encodeView({ ...DEFAULT_VIEW, rabbit: [] })).rabbit).toEqual([]); // on, no hops yet
    const e = { ...DEFAULT_VIEW, sel: { kind: 'edge' as const, id: 'r_goog_anth' } };
    expect(decodeView(encodeView(e))).toEqual(e);
  });
  it('drops junk from a hand-edited URL', () => {
    const v = decodeView('#/?types=equity,nonsense&min=7&layout=spiral&tab=evil');
    expect(v.filters.types).toEqual(['equity']);
    expect(v.filters.minUsd).toBe(0);
    expect(v.layout).toBe('tiers');
    expect(v.tab).toBe('overview');
  });
  it('trims the trail when revisiting', () => {
    expect(pushTrail(['a', 'b', 'c'], 'b')).toEqual(['a', 'b']);
    expect(pushTrail(['a'], 'b')).toEqual(['a', 'b']);
  });
});
