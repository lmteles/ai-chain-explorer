import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateGraph } from '../../src/lib/data/schema';
import {
  ALL_FILTERS, LANE_HEIGHT, UNDISCLOSED_WIDTH, edgeWidth, isEdgeVisible, nodeSize, NODE_MAX, NODE_MIN, sizeMetrics, tierPositions,
} from '../../src/lib/graph/view';

const g = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));
const rel = (id: string) => g.relations.find((r) => r.id === id)!;

describe('edge width', () => {
  it('draws undisclosed thinner than any disclosed amount', () => {
    expect(edgeWidth(null)).toBe(UNDISCLOSED_WIDTH);
    expect(edgeWidth(0.1)).toBeGreaterThan(UNDISCLOSED_WIDTH);
  });
  it('grows with amount, but logarithmically', () => {
    expect(edgeWidth(300)).toBeGreaterThan(edgeWidth(30));
    expect(edgeWidth(300) / edgeWidth(5)).toBeLessThan(3);
  });
});

describe('edge filters', () => {
  it('shows everything by default', () => {
    expect(g.relations.every((r) => isEdgeVisible(r, ALL_FILTERS))).toBe(true);
  });
  it('hides by type, confidence and status', () => {
    expect(isEdgeVisible(rel('r_amzn_anth'), { ...ALL_FILTERS, types: ['compute_commitment'] })).toBe(false);
    expect(isEdgeVisible(rel('r_openai_msft'), { ...ALL_FILTERS, confidence: ['high'] })).toBe(false);
    expect(isEdgeVisible(rel('r_openai_oracle'), { ...ALL_FILTERS, status: ['reported'] })).toBe(false);
  });
  it('applies the USD floor to disclosed amounts only', () => {
    const f = { ...ALL_FILTERS, minUsd: 50 };
    expect(isEdgeVisible(rel('r_anth_msft'), f)).toBe(false); // $30bn
    expect(isEdgeVisible(rel('r_anth_amzn'), f)).toBe(true); // $100bn
    expect(isEdgeVisible(rel('r_meta_nvda'), f)).toBe(true); // undisclosed
  });
});

describe('node sizing', () => {
  it('uses one annual USD key per mode', () => {
    const capex = sizeMetrics(g, 'capex');
    expect(capex.get('amazon')?.value).toBe(220);
    expect(capex.has('asml')).toBe(false); // EUR sales guidance is not capex
    expect(sizeMetrics(g, 'revenue').has('openai')).toBe(false); // quarterly revenue is not annual
  });
  it('scales by area between the bounds', () => {
    expect(nodeSize(undefined, 100)).toBe(NODE_MIN);
    expect(nodeSize(100, 100)).toBe(NODE_MAX);
    expect(nodeSize(25, 100)).toBe(NODE_MIN + (NODE_MAX - NODE_MIN) / 2);
  });
});

describe('tier layout', () => {
  it('puts every entity in its tier lane, with no overlaps', () => {
    const pos = tierPositions(g.entities);
    expect(pos.size).toBe(16);
    for (const e of g.entities) expect(pos.get(e.id)!.y).toBe((e.tier - 1) * LANE_HEIGHT);
    expect(new Set([...pos.values()].map((p) => `${p.x},${p.y}`)).size).toBe(16);
  });
  it('is deterministic', () => {
    expect([...tierPositions(g.entities)]).toEqual([...tierPositions(g.entities)]);
  });
});
