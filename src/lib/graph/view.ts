import type { Confidence, Entity, Graph, Metric, Relation } from '../data/schema';

export type RelationType = Relation['type'];
export type Status = Relation['status'];
export type SizeBy = 'capex' | 'revenue' | 'none';
export type LayoutMode = 'tiers' | 'force';

export type Filters = {
  types: RelationType[];
  confidence: Confidence[];
  status: Status[];
  minUsd: number;
};

export const RELATION_TYPES: RelationType[] = [
  'compute_commitment', 'equity', 'chip_purchase', 'wafer_purchase', 'tool_purchase', 'licence', 'rental', 'debt',
];
export const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];
export const STATUSES: Status[] = ['filed', 'filed_inferred_name', 'reported', 'claimed_by_eisman', 'background_unverified'];
export const MIN_USD_STOPS = [0, 5, 10, 25, 50, 100, 200];

export const ALL_FILTERS: Filters = { types: RELATION_TYPES, confidence: CONFIDENCES, status: STATUSES, minUsd: 0 };

export const TIER_LABEL: Record<Entity['tier'], string> = { 1: 'Demand', 2: 'Cloud', 3: 'Chips', 4: 'Fab', 5: 'Tools' };

// Navy, teal and gold carry the main story (cloud, chips, labs); the rest are muted neutrals.
export const TIER_COLOUR: Record<Entity['tier'], string> = {
  1: '#C9A227', 2: '#1B2A4A', 3: '#128C7E', 4: '#5B6C8F', 5: '#8A5A44',
};

export const TYPE_COLOUR: Record<RelationType, string> = {
  compute_commitment: '#2A6FB0',
  equity: '#D4A017',
  chip_purchase: '#128C7E',
  wafer_purchase: '#5E8C31',
  tool_purchase: '#7A5195',
  licence: '#C05746',
  rental: '#E08E45',
  debt: '#555555',
};

export const LINE_STYLE: Record<Confidence, 'solid' | 'dashed' | 'dotted'> = { high: 'solid', medium: 'dashed', low: 'dotted' };

export const STATUS_OPACITY: Record<Status, number> = {
  filed: 1, filed_inferred_name: 1, reported: 0.85, claimed_by_eisman: 0.55, background_unverified: 0.55,
};

export const UNDISCLOSED_WIDTH = 1;

/** Log-scaled width; null amounts are undisclosed, drawn thin with a hollow arrowhead (never as zero). */
export function edgeWidth(amount: number | null): number {
  return amount === null ? UNDISCLOSED_WIDTH : 2 + 2.5 * Math.log10(1 + amount);
}

export function isEdgeVisible(r: Relation, f: Filters): boolean {
  if (!f.types.includes(r.type) || !f.confidence.includes(r.confidence) || !f.status.includes(r.status)) return false;
  // Undisclosed or non-USD amounts are unknown on this scale, not small: the USD slider never hides them.
  return r.amount === null || r.unit !== 'USD_bn' || r.amount >= f.minUsd;
}

// Keys in order of preference. All are twelve-month figures: annual and quarterly are never mixed.
const SIZE_KEYS: Record<Exclude<SizeBy, 'none'>, string[]> = { capex: ['capex_guidance'], revenue: ['revenue_ttm', 'revenue'] };

/** The metric used to size each entity: USD only, never a superseded figure. */
export function sizeMetrics(g: Graph, sizeBy: SizeBy): Map<string, Metric> {
  const out = new Map<string, Metric>();
  if (sizeBy === 'none') return out;
  const keys = SIZE_KEYS[sizeBy];
  for (const m of g.metrics) {
    if (m.unit !== 'USD_bn' || m.superseded_by || !keys.includes(m.key)) continue;
    const cur = out.get(m.entity_id);
    if (!cur || keys.indexOf(m.key) < keys.indexOf(cur.key)) out.set(m.entity_id, m);
  }
  return out;
}

export const NODE_DEFAULT = 44;
export const NODE_MIN = 30;
export const NODE_MAX = 80;

/** Area-proportional diameter (sqrt scale) against the largest value shown. */
export function nodeSize(value: number | undefined, max: number): number {
  if (value === undefined || max <= 0) return NODE_MIN;
  return NODE_MIN + (NODE_MAX - NODE_MIN) * Math.sqrt(Math.max(value, 0) / max);
}

export const LANE_HEIGHT = 160;
export const COL_WIDTH = 190;

// Hand-tuned order within each lane so same-tier edges (SoftBank→OpenAI, Tesla→Nvidia) join neighbours instead of
// cutting through other nodes. Unlisted entities follow in seed order.
// ponytail: fixed list for 16 nodes; replace with a barycentre pass if the graph grows past ~30.
export const LANE_ORDER = ['softbank', 'openai', 'anthropic', 'tesla', 'nvidia', 'broadcom', 'apple', 'amd', 'samsung', 'tsmc'];

export function tierPositions(entities: Entity[]): Map<string, { x: number; y: number }> {
  const rank = (e: Entity) => { const i = LANE_ORDER.indexOf(e.id); return i < 0 ? LANE_ORDER.length : i; };
  const byTier = new Map<number, Entity[]>();
  for (const e of entities) byTier.set(e.tier, [...(byTier.get(e.tier) ?? []), e]);
  const pos = new Map<string, { x: number; y: number }>();
  for (const [tier, row] of byTier) {
    row.sort((a, b) => rank(a) - rank(b)); // stable: ties keep seed order
    row.forEach((e, i) => pos.set(e.id, { x: (i - (row.length - 1) / 2) * COL_WIDTH, y: (tier - 1) * LANE_HEIGHT }));
  }
  return pos;
}
