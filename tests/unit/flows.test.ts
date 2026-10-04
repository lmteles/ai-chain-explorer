import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateGraph, type Graph, type Relation } from '../../src/lib/data/schema';
import { findCycles, roundTrip } from '../../src/lib/graph/cycles';
import { followMoney, nextHops, sankeyData } from '../../src/lib/graph/paths';

const seed = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));
const rel = (over: Partial<Relation> & Pick<Relation, 'id' | 'from_id' | 'to_id' | 'type'>): Relation => ({
  amount: null, unit: 'USD_bn', amount_basis: 'committed', share_pct: null, capacity_gw: null, period: null,
  status: 'reported', confidence: 'high', source_ids: ['s'], as_of: null, note: '', ...over,
});

describe('loop finder on the seed', () => {
  const cycles = findCycles(seed);
  const pair = (a: string, b: string) => cycles.filter((c) => c.edges.length === 2 && c.nodes.includes(a) && c.nodes.includes(b));

  it('finds the four Anthropic round trips', () => {
    for (const cloud of ['amazon', 'alphabet', 'microsoft', 'nvidia']) expect(pair('anthropic', cloud), cloud).toHaveLength(1);
  });
  it('computes the ratio where both legs are disclosed money', () => {
    expect(pair('anthropic', 'amazon')[0]!.roundTrip).toMatchObject({ ratio: 0.25, returning: 25, outgoing: 100 });
    expect(pair('anthropic', 'microsoft')[0]!.roundTrip.ratio).toBeCloseTo(5 / 30);
    expect(pair('anthropic', 'alphabet')[0]!.roundTrip.reasons).toContain('includes a low-confidence leg'); // the $200bn rests on a weak source
  });
  it('says "not computable" and why when a leg is undisclosed', () => {
    const nv = pair('anthropic', 'nvidia')[0]!.roundTrip;
    expect(nv.ratio).toBeNull();
    expect(nv.reasons).toEqual(['r_anth_nvda: amount undisclosed (only 1 GW stated)']);
  });
  it('finds longer loops too, each once', () => {
    expect(cycles.some((c) => c.edges.join() === 'r_openai_oracle,r_oracle_nvda,r_nvda_openai')).toBe(true);
    expect(new Set(cycles.map((c) => c.id)).size).toBe(cycles.length);
    expect(cycles.every((c) => c.edges.length <= 6)).toBe(true);
  });
  it('ignores edge types outside equity, commitments and chip purchases', () => {
    expect(cycles.some((c) => c.edges.some((e) => ['r_apple_goog', 'r_goog_apple', 'r_meta_goog'].includes(e)))).toBe(false);
  });
});

describe('round-trip ratio on a hand-built example', () => {
  // Lab commits 120 to Cloud; Cloud buys 50 of chips from ChipCo; ChipCo invests 18 in Lab. Ratio = 18 / (120 + 50).
  const lab = rel({ id: 'a', from_id: 'lab', to_id: 'cloud', type: 'compute_commitment', amount: 120 });
  const chips = rel({ id: 'b', from_id: 'cloud', to_id: 'chip', type: 'chip_purchase', amount: 50, amount_basis: 'invested' });
  const back = rel({ id: 'c', from_id: 'chip', to_id: 'lab', type: 'equity', amount: 18, amount_basis: 'invested' });
  it('divides equity returning by dollars going out', () => {
    expect(roundTrip([lab, chips, back])).toEqual({ ratio: 18 / 170, returning: 18, outgoing: 170, reasons: [] });
  });
  it('flags ceilings and refuses incompatible bases', () => {
    expect(roundTrip([lab, { ...back, amount_basis: 'up_to' }]).reasons).toEqual(['includes "up to" amounts: ceilings, not sums paid']);
    expect(roundTrip([{ ...lab, amount_basis: 'annual' }, back]).ratio).toBeNull();
    expect(roundTrip([{ ...lab, amount_basis: 'backlog_share' }, back]).reasons[0]).toMatch(/not a money amount/);
    expect(roundTrip([lab, { ...back, unit: 'EUR_bn' }]).reasons[0]).toMatch(/not in USD/);
  });
});

describe('follow the money', () => {
  it('goes downstream only, within the depth, and marks loops back to the start', () => {
    const one = followMoney(seed, 'anthropic', { depth: 1 });
    expect(one.map((p) => p.edges[0])).toEqual(expect.arrayContaining(['r_anth_amzn', 'r_anth_goog', 'r_anth_msft', 'r_anth_nvda']));
    expect(one.every((p) => p.edges.length === 1)).toBe(true);
    const two = followMoney(seed, 'anthropic', { depth: 2 });
    expect(two.find((p) => p.edges.join() === 'r_anth_amzn,r_amzn_anth')).toMatchObject({ closesLoop: true });
    expect(two.every((p) => p.edges.length <= 2)).toBe(true);
    expect(two.every((p) => !p.nodes.slice(1, -1).includes('anthropic'))).toBe(true);
  });
  it('carries a bottleneck only when every hop is disclosed on one basis', () => {
    const p = followMoney(seed, 'anthropic', { depth: 2 }).find((x) => x.edges.join() === 'r_anth_amzn,r_amzn_anth')!;
    expect(p.bottleneck).toBeNull(); // committed then up_to: different bases
    const g: Graph = { ...seed, relations: [rel({ id: 'x', from_id: 'openai', to_id: 'oracle', type: 'compute_commitment', amount: 300 }), rel({ id: 'y', from_id: 'oracle', to_id: 'nvidia', type: 'chip_purchase', amount: 40 })] };
    expect(followMoney(g, 'openai', { depth: 2 }).find((x) => x.edges.length === 2)!.bottleneck).toBe(40);
  });
  it('honours the high-confidence toggle and caps depth at 4', () => {
    expect(followMoney(seed, 'anthropic', { depth: 2, highOnly: true }).some((p) => p.edges.includes('r_anth_goog'))).toBe(false);
    expect(Math.max(...followMoney(seed, 'openai', { depth: 9 }).map((p) => p.edges.length))).toBeLessThanOrEqual(4);
  });
  it('lays the Sankey out one column per hop, so it stays acyclic, and never invents widths', () => {
    const { nodes, links, undisclosed } = sankeyData(seed, followMoney(seed, 'anthropic', { depth: 3 }), 'all');
    const layer = new Map(nodes.map((n) => [n.key, n.layer]));
    expect(links.every((l) => layer.get(l.target)! === layer.get(l.source)! + 1)).toBe(true);
    expect(nodes.some((n) => n.key === 'anthropic@2')).toBe(true); // money back to Anthropic at hop 2
    expect(links.every((l) => l.relation.amount === l.value)).toBe(true);
    expect(undisclosed.map((r) => r.id)).toContain('r_anth_nvda');
  });
  it('lists next hops largest first, undisclosed last', () => {
    expect(nextHops(seed, 'anthropic').map((r) => r.id)).toEqual(['r_anth_goog', 'r_anth_amzn', 'r_anth_msft', 'r_anth_nvda']);
  });
});

describe('time travel', () => {
  it('hides what was not yet known and replays the filed quarter current at the date', async () => {
    const { graphAsOf } = await import('../../src/lib/graph/asof');
    const { LiveBundle, mergeLive } = await import('../../src/lib/data/live');
    const sec = LiveBundle.parse(JSON.parse(readFileSync('public/data/live/sec.json', 'utf8')));
    const g = validateGraph(mergeLive(seed, [sec]));
    const then = graphAsOf(g, '2026-03-31');
    // Dated after 31 March: the ASML regional proxy (TrendForce, July) is not yet known.
    expect(then.relations.some((r) => r.id === 'r_tsmc_asml')).toBe(false);
    expect(g.relations.some((r) => r.id === 'r_tsmc_asml')).toBe(true);
    // Undated rows cannot be placed, so they stay and are counted.
    expect(then.relations.some((r) => r.id === 'r_anth_amzn')).toBe(true);
    expect(then.undatedKept).toBeGreaterThan(0);
    // Alphabet capex: Q1 2026 ended on 31 March but was filed on 30 April, so on 31 March the latest known is Q4 2025.
    const capex = (d: string) => graphAsOf(g, d).metrics.filter((m) => m.entity_id === 'alphabet' && m.key === 'capex_quarter' && m.status === 'filed').map((m) => m.period);
    expect(capex('2026-03-31')).toEqual(['Q4 2025']);
    expect(capex('2026-04-30')).toEqual(['Q1 2026']);
    // The seed Q2 figure is no longer superseded: its filed replacement did not exist yet.
    expect(then.metrics.find((m) => m.id === 'm_goog_q2capex')?.superseded_by).toBeUndefined();
    expect(() => validateGraph(then)).not.toThrow();
  });
});
