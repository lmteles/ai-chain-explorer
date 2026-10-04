import { z } from 'zod';
import type { LiveBundle } from './live.ts';
import { AmountBasis, RelationType, webUrl, type Relation, type Source } from './schema.ts';

export const Headline = z.object({
  title: z.string(),                    // verbatim as the source gave it: this is the evidence
  url: webUrl,
  domain: z.string(),
  seen: z.string(),                     // ISO date-time
  source: z.enum(['gdelt', 'rss']),
});
export type Headline = z.infer<typeof Headline>;

export const Cluster = z.object({
  id: z.string(),
  entity_ids: z.array(z.string()).min(1),
  first_seen: z.string(),
  last_seen: z.string(),
  headlines: z.array(Headline).min(1),
  triage: z.object({ result: z.enum(['no_change', 'proposed']), note: z.string(), at: z.string() }).optional(),
});
export type Cluster = z.infer<typeof Cluster>;

export const NewsBundle = z.object({ adapter: z.literal('news'), updated_at: z.string(), clusters: z.array(Cluster) });
export type NewsBundle = z.infer<typeof NewsBundle>;

export { RelationEvent } from './schema.ts';

const ProposedRelation = z.object({
  from_id: z.string(), to_id: z.string(), type: RelationType,
  amount: z.number().nullable(), unit: z.enum(['USD_bn', 'EUR_bn']), amount_basis: AmountBasis,
  share_pct: z.number().nullable().default(null), capacity_gw: z.number().nullable().default(null), period: z.string().nullable().default(null),
});

/** A structured edit proposed from a news cluster. Evidence is the exact headline; never more than "reported". */
export const NewsProposal = z.object({
  id: z.string(),
  kind: z.enum(['new_relation', 'amount_change', 'event']),
  cluster_id: z.string(),
  headline: z.string(),
  url: webUrl,
  publisher: z.string(),
  date: z.string(),
  relation_id: z.string().optional(),            // amount_change, event
  event_type: z.enum(['announced', 'revised', 'closed']),
  proposed: ProposedRelation.optional(),          // new_relation
  amount: z.number().optional(),                  // amount_change
  amount_basis: AmountBasis.optional(),           // amount_change
  note: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  reviewed_value: z.number().optional(),
  reviewed_at: z.string().optional(),
}).refine((p) => (p.kind === 'new_relation' ? !!p.proposed : !!p.relation_id), { message: 'new_relation needs proposed; others need relation_id' })
  .refine((p) => p.kind !== 'amount_change' || (p.amount !== undefined && !!p.amount_basis), { message: 'amount_change needs amount and amount_basis' });
export type NewsProposal = z.infer<typeof NewsProposal>;

export const NewsProposalFile = z.object({
  origin: z.literal('news'),
  created_at: z.string(),
  extracted_by: z.string(),
  facts: z.array(NewsProposal),
});
export type NewsProposalFile = z.infer<typeof NewsProposalFile>;

export const newsSource = (p: NewsProposal): Source => ({
  id: `news_${p.cluster_id}`, publisher: p.publisher, title: p.headline, url: p.url,
  published: p.date.slice(0, 10), kind: 'press', reliability: 'secondary',
});

/**
 * Approved news edits. A new edge is 'reported' at medium confidence (one headline is a lead, not a filing);
 * an amount change rewrites the amount and records a 'revised' event; every approval leaves an event on the edge.
 */
export function approvedNewsBundle(files: NewsProposalFile[], relations: Relation[]): LiveBundle {
  const bundle: LiveBundle = { adapter: 'news', fetched_at: '', metrics: [], sources: [], history: [], filings: [], relation_updates: [], relations: [], amount_updates: [], events: [] };
  const known = new Set(relations.map((r) => r.id));
  for (const p of files.flatMap((f) => f.facts).filter((x) => x.status === 'approved')) {
    const src = newsSource(p);
    if (!bundle.sources.some((s) => s.id === src.id)) bundle.sources.push(src);
    const date = p.date.slice(0, 10);
    let relation_id = p.relation_id!;
    if (p.kind === 'new_relation') {
      const q = p.proposed!;
      relation_id = `news_${q.from_id}_${q.to_id}_${q.type}`;
      if (known.has(relation_id)) continue;
      known.add(relation_id);
      bundle.relations.push({
        id: relation_id, from_id: q.from_id, to_id: q.to_id, type: q.type,
        amount: p.reviewed_value ?? q.amount, unit: q.unit, amount_basis: q.amount_basis, share_pct: q.share_pct,
        capacity_gw: q.capacity_gw, period: q.period, status: 'reported', confidence: 'medium', source_ids: [src.id],
        as_of: date, note: `From news, approved in review: "${p.headline}" (${p.publisher}). ${p.note}`.trim(),
      });
    } else if (p.kind === 'amount_change') {
      bundle.amount_updates.push({ relation_id, amount: p.reviewed_value ?? p.amount!, amount_basis: p.amount_basis!, source_id: src.id, as_of: date, fact_id: p.id });
    }
    bundle.events.push({ id: p.id, relation_id, date, type: p.event_type, headline: p.headline, url: p.url, publisher: p.publisher });
  }
  return bundle;
}
