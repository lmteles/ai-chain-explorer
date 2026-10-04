import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateGraph, type Graph, type Relation } from '../../src/lib/data/schema';
import { exposures, periodYears } from '../../src/lib/graph/exposure';
import { PRESETS, simulate, type Scenario } from '../../src/lib/graph/simulate';

// Toy chain: Lab pays Cloud $10bn a year (Cloud revenue $100bn); Cloud pays ChipCo $20bn a year (ChipCo revenue $50bn).
// So Cloud gets 10% of its revenue from Lab, and ChipCo gets 40% of its revenue from Cloud.
const rel = (id: string, from_id: string, to_id: string, type: Relation['type'], over: Partial<Relation> = {}): Relation => ({
  id, from_id, to_id, type, amount: null, unit: 'USD_bn', amount_basis: 'annual', share_pct: null, capacity_gw: null, period: null,
  status: 'filed', confidence: 'high', source_ids: ['s'], as_of: '2026-01-01', note: '', ...over,
});
const metric = (id: string, entity_id: string, key: string, value: number) =>
  ({ id, entity_id, key, value, low: null, high: null, unit: 'USD_bn', period: '2026', status: 'filed' as const, source_ids: ['s'], confidence: 'high' as const, as_of: '2026-06-30' });
const toy = (extra: Relation[] = [], extraMetrics: ReturnType<typeof metric>[] = []): Graph => validateGraph({
  meta: { version: 't', generated: '2026-10-04', purpose: 'toy' },
  sources: [{ id: 's', publisher: 'p', title: 't', url: 'https://x', published: null, kind: 'filing', reliability: 'primary' }],
  entities: [
    { id: 'lab', name: 'Lab', type: 'lab', tier: 1, ticker: null, cik: null, private: true, country: null },
    { id: 'cloud', name: 'Cloud', type: 'cloud', tier: 2, ticker: null, cik: null, private: false, country: null },
    { id: 'chip', name: 'ChipCo', type: 'chip', tier: 3, ticker: null, cik: null, private: false, country: null },
  ],
  relations: [rel('ab', 'lab', 'cloud', 'compute_commitment', { amount: 10 }), rel('bc', 'cloud', 'chip', 'chip_purchase', { amount: 20 }), ...extra],
  metrics: [metric('rb', 'cloud', 'revenue_ttm', 100), metric('rc', 'chip', 'revenue_ttm', 50), ...extraMetrics],
  claims: [],
});
const run = (g: Graph, over: Partial<Scenario>) => simulate(g, { mode: 'demand', shocks: [], damping: 0, horizonYears: 1, overrides: {}, ...over });
const at = (r: ReturnType<typeof simulate>, e: string, d = 'revenue') => r.impacts.find((i) => i.entity === e && i.denominator === d);

describe('exposure shares', () => {
  it('derives shares from annual amounts over filed revenue, marked as estimates', () => {
    const ex = exposures(toy());
    expect(ex.find((e) => e.id === 'ab')).toMatchObject({ share: 0.1, method: 'annual amount ÷ revenue', estimate: true, factIds: ['ab', 'rb'] });
    expect(ex.find((e) => e.id === 'bc')!.share).toBe(0.4);
  });
  it('spreads a commitment over its stated period, and refuses without one', () => {
    const g = toy([rel('cm', 'lab', 'cloud', 'compute_commitment', { amount: 100, amount_basis: 'committed', period: '10y' }), rel('cx', 'lab', 'cloud', 'rental', { amount: 50, amount_basis: 'committed' })]);
    expect(exposures(g).find((e) => e.id === 'cm')).toMatchObject({ share: 0.1, method: 'commitment spread over its period ÷ revenue' });
    expect(exposures(g).find((e) => e.id === 'cx')).toMatchObject({ share: null, note: 'no period to spread the commitment over' });
    expect(periodYears(rel('t', 'a', 'b', 'wafer_purchase', { period: 'to 2033', as_of: '2026-01-01' }))).toBe(7);
  });
  it('excludes equity and debt: funding is not revenue', () => {
    expect(exposures(toy([rel('eq', 'cloud', 'lab', 'equity', { amount: 5, amount_basis: 'invested' })])).some((e) => e.id === 'eq')).toBe(false);
  });
});

describe('propagation, hand-computed', () => {
  it('first order: a 50% cut by Lab costs Cloud 5% of revenue, $5bn; ChipCo untouched', () => {
    const r = run(toy(), { shocks: [{ kind: 'node', id: 'lab', pct: 50 }] });
    expect(at(r, 'cloud')).toMatchObject({ fraction: 0.05, amount: 5, path: ['ab'], pathNodes: ['lab', 'cloud'] });
    expect(at(r, 'chip')).toBeUndefined();
  });
  it('second order with damping 0.5: Cloud cuts 2.5%, ChipCo loses 1% of revenue ($0.5bn) along Lab → Cloud → ChipCo', () => {
    const r = run(toy(), { shocks: [{ kind: 'node', id: 'lab', pct: 50 }], damping: 0.5 });
    expect(at(r, 'chip')!.fraction).toBeCloseTo(0.01);
    expect(at(r, 'chip')!.amount).toBeCloseTo(0.5);
    expect(at(r, 'chip')!.pathNodes).toEqual(['lab', 'cloud', 'chip']);
    expect(r.impacts.map((i) => i.entity)).toEqual(['cloud', 'chip']); // ranked by dollars
  });
  it('edge, direct and override shocks', () => {
    expect(at(run(toy(), { shocks: [{ kind: 'edge', id: 'bc', pct: 100 }] }), 'chip')!.amount).toBe(20);
    expect(at(run(toy(), { shocks: [{ kind: 'direct', entity: 'chip', share: 0.2, pct: 50, label: 'a customer' }] }), 'chip')).toMatchObject({ fraction: 0.1, amount: 5, estimate: true });
    expect(at(run(toy(), { shocks: [{ kind: 'node', id: 'lab', pct: 50 }], overrides: { ab: 0.2 } }), 'cloud')!.amount).toBe(10);
  });
  it('scales yearly flows by the horizon but not a backlog, which is a stock', () => {
    const g = toy([rel('bk', 'lab', 'cloud', 'compute_commitment', { amount: 300, amount_basis: 'backlog_share', share_pct: 50 })], [metric('rpo', 'cloud', 'rpo', 600)]);
    const r = run(g, { shocks: [{ kind: 'node', id: 'lab', pct: 50 }], horizonYears: 3 });
    expect(at(r, 'cloud', 'backlog')).toMatchObject({ fraction: 0.25, amount: 150, overHorizon: 150 });
    expect(at(r, 'cloud')).toMatchObject({ amount: 5, overHorizon: 15 });
  });
  it('lists edges it could not use instead of guessing them', () => {
    const r = run(toy([rel('ac', 'lab', 'chip', 'chip_purchase')]), { shocks: [{ kind: 'node', id: 'lab', pct: 50 }] });
    expect(r.notComputable.map((e) => e.id)).toEqual(['ac']);
  });
  it('supply mode runs upstream: a supplier shortfall cuts buyers by shock × dependence', () => {
    const g = toy([rel('wf', 'cloud', 'chip', 'wafer_purchase', { amount: 5 })]);
    const r = simulate(g, { mode: 'supply', shocks: [{ kind: 'node', id: 'chip', pct: 20 }], damping: 0, horizonYears: 1, overrides: {}, dependence: { cloud: 0.5 } });
    expect(at(r, 'cloud')).toMatchObject({ fraction: 0.1, amount: 10, estimate: true });
  });
});

describe('presets on the seed', () => {
  const seed = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));
  const preset = (id: string) => simulate(seed, PRESETS.find((p) => p.id === id)!.scenario);
  it('has the five presets', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['openai-underfunds', 'anthropic-stalls', 'nvidia-customer', 'tsmc-capacity', 'yield-5']);
  });
  it('OpenAI under-funding hits Oracle backlog: 30% × 50% of a $600bn RPO = $90bn', () => {
    const r = preset('openai-underfunds');
    expect(at(r, 'oracle', 'backlog')).toMatchObject({ fraction: 0.15, amount: 90 });
    expect(r.notComputable.map((e) => e.id)).toContain('r_openai_msft'); // $250bn with no period: not turned into a share
  });
  it('a 30% cut by one top-five customer is 4.2% of Nvidia revenue, passed on to TSMC at half strength', () => {
    const r = preset('nvidia-customer');
    expect(at(r, 'nvidia')!.fraction).toBeCloseTo(0.042);
    expect(at(r, 'tsmc')!.fraction).toBeCloseTo(0.042 * 0.5 * 0.19);
  });
  it('a TSMC shortfall reaches its fabless customers, not its own suppliers', () => {
    const r = preset('tsmc-capacity');
    expect(r.impacts.map((i) => i.entity)).toEqual(expect.arrayContaining(['nvidia', 'apple', 'amd', 'broadcom']));
    expect(r.impacts.some((i) => i.entity === 'asml')).toBe(false);
  });
});
