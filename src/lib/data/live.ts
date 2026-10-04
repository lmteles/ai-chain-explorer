import { z } from 'zod';
import { RelationUpdate } from './proposals.ts';
import { AmountBasis, Filing, HistoryPoint, Metric, Relation, RelationEvent, Source, type Graph } from './schema.ts';

export const AmountUpdate = z.object({
  relation_id: z.string(), amount: z.number(), amount_basis: AmountBasis, source_id: z.string(), as_of: z.string(), fact_id: z.string(),
});

export type { Filing, HistoryPoint } from './schema.ts';

/** What an adapter writes to public/data/live/<adapter>.json. */
export const LiveBundle = z.object({
  adapter: z.string(),
  fetched_at: z.string(),
  metrics: z.array(Metric),
  sources: z.array(Source),
  history: z.array(HistoryPoint),
  filings: z.array(Filing),
  relation_updates: z.array(RelationUpdate).default([]),
  relations: z.array(Relation).default([]),          // new edges from approved news
  amount_updates: z.array(AmountUpdate).default([]), // revised amounts from approved news
  events: z.array(RelationEvent).default([]),
});
export type LiveBundle = z.infer<typeof LiveBundle>;

/**
 * Calendar quarter of a fiscal period, judged by its midpoint (end − 45 days) so 52/53-week years land right:
 * Nvidia's quarter to 26 Jul is Q2, Apple's to 27 Sep is Q3, Microsoft's to 30 Jun is Q2.
 */
export function quarterLabel(end: string): string {
  const mid = new Date(Date.parse(end) - 45 * 86_400_000);
  return `Q${Math.floor(mid.getUTCMonth() / 3) + 1} ${mid.getUTCFullYear()}`;
}

/**
 * Adds live facts to the seed. A seed metric is superseded when a filed figure exists for the same entity, key
 * and period (or when the seed only says "latest"). The seed row stays visible, marked, for provenance.
 */
export function mergeLive(seed: Graph, bundles: LiveBundle[]): Graph {
  const metrics = bundles.flatMap((b) => b.metrics);
  const history = bundles.flatMap((b) => b.history);
  const filed = [...metrics, ...history];
  const seedMetrics = seed.metrics.map((m) => {
    const same = (f: { entity_id: string; key: string }) => f.entity_id === m.entity_id && f.key === m.key;
    const hit = m.period === 'latest' ? metrics.find(same) : filed.find((f) => same(f) && f.period === m.period);
    return hit ? { ...m, superseded_by: hit.id } : m;
  });
  const sources = new Map([...seed.sources, ...bundles.flatMap((b) => b.sources)].map((s) => [s.id, s]));
  // Reviewed share figures upgrade an existing edge; the original sources stay listed beside the filing.
  const updates = new Map(bundles.flatMap((b) => b.relation_updates).map((u) => [u.relation_id, u]));
  const amounts = new Map(bundles.flatMap((b) => b.amount_updates).map((u) => [u.relation_id, u]));
  const added = bundles.flatMap((b) => b.relations).filter((r) => !seed.relations.some((x) => x.id === r.id));
  const relations = [...seed.relations, ...added].map((r0) => {
    const a = amounts.get(r0.id);
    const r = a ? {
      ...r0, amount: a.amount, amount_basis: a.amount_basis, as_of: a.as_of, as_of_inferred: false,
      source_ids: [a.source_id, ...r0.source_ids.filter((s) => s !== a.source_id)],
      note: `Amount revised from ${r0.amount ?? 'undisclosed'} (${r0.amount_basis}) by approved news [${a.fact_id}]. ${r0.note}`.trim(),
    } : r0;
    const u = updates.get(r.id);
    if (!u) return r;
    return {
      ...r, share_pct: u.share_pct, status: u.status, confidence: 'high' as const, as_of: u.as_of, as_of_inferred: false,
      source_ids: [u.source_id, ...r.source_ids.filter((s) => s !== u.source_id)],
      note: `${u.note} [${u.fact_id}] Previously: ${r.status}, ${r.confidence} confidence${r.note ? `; ${r.note}` : ''}.`,
    };
  });
  return {
    ...seed,
    relations,
    sources: [...sources.values()],
    metrics: [...seedMetrics, ...metrics],
    history: [...seed.history, ...history],
    filings: [...seed.filings, ...bundles.flatMap((b) => b.filings)],
    events: [...seed.events, ...bundles.flatMap((b) => b.events)],
  };
}

/** A macro series point-in-time value plus a short history for the sparkline. Ids are fact ids. */
export const MacroItem = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number(),
  unit: z.enum(['pct', 'USD_bn']),
  as_of: z.string(),
  period: z.string().nullable(),
  source_ids: z.array(z.string()).min(1),
  history: z.array(z.object({ date: z.string(), value: z.number() })),
  note: z.string(),
});
export type MacroItem = z.infer<typeof MacroItem>;

export const MacroBundle = z.object({
  adapter: z.literal('macro'),
  fetched_at: z.string(),
  items: z.array(MacroItem),
  sources: z.array(Source),
});
export type MacroBundle = z.infer<typeof MacroBundle>;

export const Run = z.object({
  adapter: z.string(), started_at: z.string(), finished_at: z.string(),
  status: z.enum(['ok', 'partial', 'failed', 'skipped']), rows: z.number(), errors: z.array(z.string()), notes: z.array(z.string()),
});
export type Run = z.infer<typeof Run>;

/** Thin a daily series to roughly weekly points for sparklines; always keeps the last point. */
export function thin<T>(points: T[], every = 5): T[] {
  return points.filter((_, i) => (points.length - 1 - i) % every === 0);
}
