import type { Graph } from '../data/schema';

export type ConcentrationRow = {
  factId: string;
  counterparty: string;          // display label
  counterpartyId: string | null; // entity id when the counterparty is a node
  pct: number;
  of: string;                    // denominator, e.g. "revenue", "RPO (backlog)"
  proxy: boolean;
  confidence: string;
};

// Share metrics that name what they are a share of. ponytail: label table; add a row per new share metric key.
const SHARE_METRICS: Record<string, { counterparty: string; counterpartyId: string | null; of: string }> = {
  rpo_openai_share: { counterparty: 'OpenAI', counterpartyId: 'openai', of: 'RPO (backlog)' },
  receivables_top5_share: { counterparty: 'Top five customers (unnamed)', counterpartyId: null, of: 'accounts receivable' },
  hpc_share_of_revenue: { counterparty: 'HPC platform (product mix, not a customer)', counterpartyId: null, of: 'revenue' },
  china_share_of_sales: { counterparty: 'China (region)', counterpartyId: null, of: 'net system sales' },
  top10_customer_share: { counterparty: 'Ten largest customers (includes A and B)', counterpartyId: null, of: 'revenue' },
};

const OF_BY_BASIS: Partial<Record<string, string>> = {
  share_pct: 'revenue', annual: 'revenue', backlog_share: 'RPO (backlog)', proxy_share: 'net system sales',
};

/** Who this entity depends on, as a share of its own revenue or backlog. Ownership stakes are excluded. */
export function concentration(g: Graph, entityId: string): ConcentrationRow[] {
  const name = new Map(g.entities.map((e) => [e.id, e.name]));
  const rows: ConcentrationRow[] = [];
  for (const r of g.relations) {
    const of = OF_BY_BASIS[r.amount_basis];
    if (r.to_id !== entityId || r.share_pct === null || !of) continue;
    rows.push({
      factId: r.id, counterparty: name.get(r.from_id) ?? r.from_id, counterpartyId: r.from_id, pct: r.share_pct,
      of, proxy: r.amount_basis === 'proxy_share', confidence: r.confidence,
    });
  }
  // One row per share metric: the most recently dated, never a superseded one.
  const latest = new Map<string, Graph['metrics'][number]>();
  for (const m of g.metrics) {
    if (m.entity_id !== entityId || m.superseded_by || !SHARE_METRICS[m.key]) continue;
    const cur = latest.get(m.key);
    if (!cur || (m.as_of ?? '') > (cur.as_of ?? '')) latest.set(m.key, m);
  }
  for (const m of latest.values()) {
    const spec = SHARE_METRICS[m.key]!;
    // The same share often exists as both a metric and an edge (Oracle RPO / OpenAI): keep the edge.
    if (spec.counterpartyId && rows.some((x) => x.counterpartyId === spec.counterpartyId && x.of === spec.of)) continue;
    rows.push({ factId: m.id, ...spec, pct: m.value, proxy: false, confidence: m.confidence });
  }
  return rows.sort((a, b) => b.pct - a.pct);
}

/** Named-counterparty total per denominator. Proxies and unnamed groups are never added in. */
export function namedTotals(rows: ConcentrationRow[]): { of: string; pct: number; n: number }[] {
  const by = new Map<string, { pct: number; n: number }>();
  for (const r of rows) {
    if (r.proxy || !r.counterpartyId) continue;
    const t = by.get(r.of) ?? { pct: 0, n: 0 };
    by.set(r.of, { pct: t.pct + r.pct, n: t.n + 1 });
  }
  return [...by].filter(([, t]) => t.n > 1).map(([of, t]) => ({ of, ...t }));
}
