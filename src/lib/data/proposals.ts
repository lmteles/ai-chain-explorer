import { z } from 'zod';
import type { LiveBundle } from './live.ts';
import { webUrl, type Metric, type Relation, type Source } from './schema.ts';

/** A downloaded investor document (an EDGAR filing with one or more files). Hashes pin exactly what was read. */
export const IrDocument = z.object({
  id: z.string(),
  entity_id: z.string(),
  title: z.string(),
  form: z.string(),
  filed: z.string(),
  accession: z.string(),
  index_url: webUrl,
  files: z.array(z.object({ name: z.string(), url: webUrl, sha256: z.string().length(64) })).min(1),
  pages: z.array(z.object({ page: z.number().int().positive(), url: webUrl })), // slide images, if any
});
export type IrDocument = z.infer<typeof IrDocument>;

export const Proposal = z.object({
  id: z.string(),
  kind: z.enum(['metric', 'relation_share']),
  entity_id: z.string(),
  key: z.string().optional(),          // metric
  relation_id: z.string().optional(),  // relation_share
  counterparty_label: z.string().optional(), // as the document names it, e.g. "Customer A"
  value: z.number(),
  low: z.number().nullable().default(null),
  high: z.number().nullable().default(null),
  unit: z.string(),
  period: z.string(),
  evidence: z.enum(['text', 'image']), // text snippets are machine-checked; image ones need eyes on the slide
  page: z.number().int().positive().nullable(),
  locator: z.string(),
  snippet: z.string().min(10),
  note: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  reviewed_value: z.number().optional(),
  reviewed_at: z.string().optional(),
}).refine((p) => (p.kind === 'metric' ? !!p.key : !!p.relation_id), { message: 'metric needs key; relation_share needs relation_id' })
  .refine((p) => p.evidence === 'text' || p.page !== null, { message: 'image evidence needs a page' });
export type Proposal = z.infer<typeof Proposal>;

export const ProposalFile = z.object({
  document_id: z.string(),
  extracted_at: z.string(),
  extracted_by: z.string(),
  facts: z.array(Proposal),
});
export type ProposalFile = z.infer<typeof ProposalFile>;

export const RelationUpdate = z.object({
  relation_id: z.string(),
  share_pct: z.number(),
  status: z.enum(['filed', 'filed_inferred_name']),
  source_id: z.string(),
  as_of: z.string(),
  note: z.string(),
  fact_id: z.string(),
});
export type RelationUpdate = z.infer<typeof RelationUpdate>;

/** Whitespace and spacing before punctuation vary between HTML renderings; nothing else is forgiven. */
export const normaliseText = (s: string) =>
  s.replace(/[ \s]+/g, ' ').replace(/ ([,.;:%)])/g, '$1').replace(/([($]) /g, '$1').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').trim();

export const docSource = (d: IrDocument): Source => ({
  id: `ir_${d.id}`, publisher: `${d.entity_id.toUpperCase()} ${d.form} (SEC EDGAR)`, title: d.title, url: d.index_url,
  published: d.filed, kind: d.form === '6-K' ? 'ir' : 'filing', reliability: 'primary',
});

/**
 * Approved proposals become facts: metrics with status 'filed', and share upgrades on existing edges.
 * A name the document withholds ("Customer A") makes the edge 'filed_inferred_name', never plain 'filed'.
 */
export function approvedBundle(files: ProposalFile[], docs: IrDocument[], relations: Relation[]): LiveBundle {
  const byDoc = new Map(docs.map((d) => [d.id, d]));
  const relIds = new Set(relations.map((r) => r.id));
  const bundle: LiveBundle = { adapter: 'review', fetched_at: '', metrics: [], sources: [], history: [], filings: [], relation_updates: [], relations: [], amount_updates: [], events: [] };
  for (const f of files) {
    const doc = byDoc.get(f.document_id);
    if (!doc) continue;
    const approved = f.facts.filter((p) => p.status === 'approved');
    if (!approved.length) continue;
    const src = docSource(doc);
    bundle.sources.push(src);
    for (const p of approved) {
      const value = p.reviewed_value ?? p.value;
      const where = `${p.locator}${p.page ? `, page ${p.page}` : ''}: "${p.snippet}"`;
      if (p.kind === 'metric') {
        const m: Metric = {
          id: p.id, entity_id: p.entity_id, key: p.key!, value, low: p.low, high: p.high, unit: p.unit, period: p.period,
          status: 'filed', source_ids: [src.id], confidence: 'high', as_of: doc.filed,
          note: `${p.note} ${where}${p.reviewed_value !== undefined ? ` (edited in review from ${p.value})` : ''}`.trim(),
        };
        bundle.metrics.push(m);
      } else if (relIds.has(p.relation_id!)) {
        bundle.relation_updates.push({
          relation_id: p.relation_id!, share_pct: value, status: p.counterparty_label ? 'filed_inferred_name' : 'filed',
          source_id: src.id, as_of: doc.filed, fact_id: p.id,
          note: `${p.counterparty_label ? `Filed as "${p.counterparty_label}" (${value}%); the name is our inference. ` : ''}${p.note} ${where}`.trim(),
        });
      }
    }
  }
  return bundle;
}
