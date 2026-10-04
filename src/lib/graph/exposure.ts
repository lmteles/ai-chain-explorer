import type { Graph, Metric, Relation } from '../data/schema';

export type Denominator = 'revenue' | 'backlog';

/** How much of payee j's revenue (or backlog) comes from payer i, and how we know. */
export type Exposure = {
  id: string;               // relation id
  payer: string;
  payee: string;
  share: number | null;     // fraction 0–1; null = not computable from the data
  denominator: Denominator;
  method: 'stated share' | 'proxy share' | 'annual amount ÷ revenue' | 'commitment spread over its period ÷ revenue' | 'not computable';
  estimate: boolean;        // anything other than a share stated by a source
  factIds: string[];
  note: string;
};

export type Base = { value: number; unit: string; factId: string; label: string };

// Revenue-type flows only. Equity and debt fund the payee; they are not its revenue.
export const REVENUE_TYPES: Relation['type'][] = ['compute_commitment', 'chip_purchase', 'wafer_purchase', 'tool_purchase', 'licence', 'rental'];
const REVENUE_KEYS = ['revenue_ttm', 'revenue', 'net_sales_guidance'];

const live = (ms: Metric[]) => ms.filter((m) => !m.superseded_by).sort((a, b) => (b.as_of ?? '').localeCompare(a.as_of ?? ''));

/** The denominator for an entity: filed trailing revenue first, then annual revenue, then sales guidance; RPO for backlog. */
export function baseFor(g: Graph, entity: string, d: Denominator): Base | null {
  const mine = g.metrics.filter((m) => m.entity_id === entity);
  if (d === 'backlog') {
    const m = live(mine.filter((x) => x.key === 'rpo'))[0];
    return m ? { value: m.value, unit: m.unit, factId: m.id, label: `RPO ${m.period}` } : null;
  }
  for (const k of REVENUE_KEYS) {
    const m = live(mine.filter((x) => x.key === k))[0];
    if (m) return { value: m.value, unit: m.unit, factId: m.id, label: `${k === 'revenue_ttm' ? 'revenue' : k.replaceAll('_', ' ')} ${m.period}` };
  }
  return null;
}

/** Years a commitment runs: "10y" → 10; "to 2033" → years from its as-of date. Unknown → null. */
export function periodYears(r: Relation, now = new Date()): number | null {
  const y = r.period?.match(/^(\d+(?:\.\d+)?)\s*y/i);
  if (y) return Number(y[1]);
  const to = r.period?.match(/to (\d{4})/i);
  if (to) {
    const from = r.as_of ? new Date(r.as_of.length === 7 ? `${r.as_of}-01` : r.as_of) : now;
    const years = Number(to[1]) - from.getUTCFullYear();
    return years > 0 ? years : null;
  }
  return null;
}

export function exposures(g: Graph, now = new Date()): Exposure[] {
  return g.relations.filter((r) => REVENUE_TYPES.includes(r.type)).map((r) => {
    const common = { id: r.id, payer: r.from_id, payee: r.to_id, factIds: [r.id] };
    if (r.share_pct !== null && ['share_pct', 'annual', 'backlog_share', 'proxy_share'].includes(r.amount_basis)) {
      const proxy = r.amount_basis === 'proxy_share';
      return { ...common, share: r.share_pct / 100, denominator: r.amount_basis === 'backlog_share' ? 'backlog' : 'revenue',
        method: proxy ? 'proxy share' : 'stated share', estimate: proxy, note: proxy ? 'A region or group stands in for the company.' : '' } as Exposure;
    }
    const base = baseFor(g, r.to_id, 'revenue');
    const sameUnit = base && r.amount !== null && base.unit === r.unit;
    if (sameUnit && r.amount_basis === 'annual') {
      return { ...common, share: Math.min(1, r.amount! / base!.value), denominator: 'revenue', method: 'annual amount ÷ revenue', estimate: true,
        factIds: [r.id, base!.factId], note: `${r.amount} ÷ ${base!.label} ${base!.value}` };
    }
    const years = periodYears(r, now);
    if (sameUnit && years && ['committed', 'up_to'].includes(r.amount_basis)) {
      return { ...common, share: Math.min(1, r.amount! / years / base!.value), denominator: 'revenue', method: 'commitment spread over its period ÷ revenue',
        estimate: true, factIds: [r.id, base!.factId], note: `${r.amount} over ${years} years ÷ ${base!.label} ${base!.value}; assumes even spending` };
    }
    const why = r.amount === null ? 'amount undisclosed' : !base ? `no revenue figure for ${r.to_id}` : base.unit !== r.unit ? 'currencies differ'
      : !years ? 'no period to spread the commitment over' : `basis "${r.amount_basis}" cannot be turned into a share`;
    return { ...common, share: null, denominator: 'revenue', method: 'not computable', estimate: true, note: why };
  });
}
