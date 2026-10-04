import { z } from 'zod';

// Dates are ISO; month precision ("2026-07") is allowed when the source gives no day.
const isoDate = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'expected YYYY-MM or YYYY-MM-DD');

export const Status = z.enum(['filed', 'filed_inferred_name', 'reported', 'claimed_by_eisman', 'background_unverified']);
export const Confidence = z.enum(['high', 'medium', 'low']);
export const Reliability = z.enum(['primary', 'secondary', 'claim_by_named_person', 'weak', 'unverified']);
export const AmountBasis = z.enum([
  'committed', 'up_to', 'invested', 'annual', 'backlog_share', 'share_pct',
  'ownership_pct', 'proxy_share', 'capacity', 'undisclosed',
]);
export const RelationType = z.enum([
  'compute_commitment', 'equity', 'chip_purchase', 'wafer_purchase', 'tool_purchase', 'licence', 'rental', 'debt',
]);

export const Source = z.object({
  id: z.string(),
  publisher: z.string(),
  title: z.string(),
  url: z.string(),
  published: isoDate.nullable(),
  kind: z.enum(['filing', 'ir', 'press', 'transcript', 'analyst', 'blog', 'background', 'data']),
  reliability: Reliability,
  retrieved_at: isoDate.optional(),
});

export const Entity = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['lab', 'cloud', 'chip', 'chip_buyer', 'fab', 'tools', 'investor']),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  ticker: z.string().nullable(),
  cik: z.string().regex(/^\d{10}$/).nullable(),
  private: z.boolean(),
  country: z.string().nullable(),
});

export const Relation = z.object({
  id: z.string(),
  from_id: z.string(),
  to_id: z.string(),
  type: RelationType,
  amount: z.number().nullable(),
  unit: z.enum(['USD_bn', 'EUR_bn']),
  amount_basis: AmountBasis,
  share_pct: z.number().min(0).max(100).nullable(),
  capacity_gw: z.number().nullable(),
  period: z.string().nullable(),
  status: Status,
  confidence: Confidence,
  source_ids: z.array(z.string()).min(1),
  as_of: isoDate.nullable(),
  as_of_inferred: z.boolean().optional(),
  note: z.string(),
  valid_from: isoDate.optional(),
  valid_to: isoDate.optional(),
});

export const Metric = z.object({
  id: z.string(),
  entity_id: z.string(),
  key: z.string(),
  value: z.number(),
  low: z.number().nullable(),
  high: z.number().nullable(),
  unit: z.string(),
  period: z.string(),
  status: Status,
  source_ids: z.array(z.string()).min(1),
  confidence: Confidence,
  as_of: isoDate.nullable(),
  as_of_inferred: z.boolean().optional(),
  note: z.string().optional(),
  superseded_by: z.string().optional(), // id of the filed figure that replaces this one
});

/** One point of a quarterly series (metric_history). The latest point is also a Metric with the same id. */
export const HistoryPoint = z.object({
  id: z.string(),
  entity_id: z.string(),
  key: z.string(),
  period: z.string(),
  end: isoDate,
  value: z.number(),
  unit: z.string(),
  source_ids: z.array(z.string()).min(1),
  derived: z.boolean(),
});

export const Filing = z.object({
  entity_id: z.string(),
  form: z.string(),
  filed: isoDate,
  report_date: isoDate.nullable(),
  url: z.string().url(),
  accession: z.string(),
});

export const Claim = z.object({
  id: z.string(),
  speaker: z.string(),
  text: z.string(),
  entity_ids: z.array(z.string()),
  source_ids: z.array(z.string()).min(1),
  verify: z.string(),
});

/** A dated event on an edge, from an approved news proposal. */
export const RelationEvent = z.object({
  id: z.string(),
  relation_id: z.string(),
  date: isoDate,
  type: z.enum(['announced', 'revised', 'closed']),
  headline: z.string(),
  url: z.string().url(),
  publisher: z.string(),
});
export type RelationEvent = z.infer<typeof RelationEvent>;

export const Graph = z.object({
  meta: z.object({ version: z.string(), generated: isoDate, purpose: z.string() }).passthrough(),
  sources: z.array(Source),
  entities: z.array(Entity),
  relations: z.array(Relation),
  metrics: z.array(Metric),
  claims: z.array(Claim),
  history: z.array(HistoryPoint).default([]),
  filings: z.array(Filing).default([]),
  events: z.array(RelationEvent).default([]),
});

export type Source = z.infer<typeof Source>;
export type Entity = z.infer<typeof Entity>;
export type Relation = z.infer<typeof Relation>;
export type Metric = z.infer<typeof Metric>;
export type Claim = z.infer<typeof Claim>;
export type Graph = z.infer<typeof Graph>;
export type HistoryPoint = z.infer<typeof HistoryPoint>;
export type Filing = z.infer<typeof Filing>;
export type Confidence = z.infer<typeof Confidence>;
export type Reliability = z.infer<typeof Reliability>;

const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
// Highest confidence a fact may claim given its best source.
const RELIABILITY_CAP: Record<Reliability, number> = {
  primary: 2, secondary: 2, claim_by_named_person: 1, weak: 0, unverified: 0,
};

/** Parses with Zod, then checks cross-references and house rules. Throws listing every problem. */
export function validateGraph(raw: unknown): Graph {
  const g = Graph.parse(raw);
  const errors: string[] = [];
  const entities = new Set(g.entities.map((e) => e.id));
  const sources = new Map(g.sources.map((s) => [s.id, s]));

  // Fact ids are cited by the Ask assistant, so they must be unique across every collection.
  const seen = new Set<string>();
  for (const { id } of [...g.sources, ...g.entities, ...g.relations, ...g.metrics, ...g.claims]) {
    if (seen.has(id)) errors.push(`duplicate id ${id}`);
    seen.add(id);
  }

  const checkSources = (id: string, ids: string[], confidence?: Confidence) => {
    const found = ids.map((s) => sources.get(s));
    ids.forEach((s, i) => { if (!found[i]) errors.push(`${id}: unknown source ${s}`); });
    if (!confidence) return;
    const cap = Math.max(...found.map((s) => (s ? RELIABILITY_CAP[s.reliability] : 0)));
    if (CONF_RANK[confidence] > cap) errors.push(`${id}: confidence ${confidence} exceeds what its sources support`);
  };

  for (const r of g.relations) {
    if (!entities.has(r.from_id)) errors.push(`${r.id}: unknown from_id ${r.from_id}`);
    if (!entities.has(r.to_id)) errors.push(`${r.id}: unknown to_id ${r.to_id}`);
    if (r.from_id === r.to_id) errors.push(`${r.id}: self-loop`);
    if (r.amount !== null && r.amount_basis === 'undisclosed') errors.push(`${r.id}: amount set but basis undisclosed`);
    checkSources(r.id, r.source_ids, r.confidence);
  }
  for (const m of g.metrics) {
    if (!entities.has(m.entity_id)) errors.push(`${m.id}: unknown entity ${m.entity_id}`);
    if (m.low !== null && m.high !== null && !(m.low <= m.value && m.value <= m.high)) errors.push(`${m.id}: value outside low/high`);
    checkSources(m.id, m.source_ids, m.confidence);
  }
  for (const h of g.history) {
    if (!entities.has(h.entity_id)) errors.push(`${h.id}: unknown entity ${h.entity_id}`);
    checkSources(h.id, h.source_ids);
  }
  const relIds = new Set(g.relations.map((r) => r.id));
  for (const ev of g.events) if (!relIds.has(ev.relation_id)) errors.push(`event ${ev.id}: unknown relation ${ev.relation_id}`);
  for (const f of g.filings) if (!entities.has(f.entity_id)) errors.push(`filing ${f.accession}: unknown entity ${f.entity_id}`);
  for (const c of g.claims) {
    c.entity_ids.forEach((e) => { if (!entities.has(e)) errors.push(`${c.id}: unknown entity ${e}`); });
    checkSources(c.id, c.source_ids);
  }

  if (errors.length) throw new Error(`Seed graph invalid (${errors.length}):\n  ${errors.join('\n  ')}`);
  return g;
}
