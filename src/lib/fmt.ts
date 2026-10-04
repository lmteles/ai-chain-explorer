import type { Entity, Relation } from './data/schema';

// One decimal normally; two significant figures below 0.1, so a small loss never reads as zero.
const num = (v: number) => (v !== 0 && Math.abs(v) < 0.1
  ? v.toLocaleString('en-GB', { maximumSignificantDigits: 2 })
  : v.toLocaleString('en-GB', { maximumFractionDigits: 1 }));

/** The one money formatter. Values are stored in billions with an explicit unit. */
export function fmtMoney(value: number, unit: string): string {
  const sign = value < 0 ? '−' : '';
  if (unit === 'USD_bn') return Math.abs(value) >= 1000 ? `${sign}$${num(Math.abs(value) / 1000)}tn` : `${sign}$${num(Math.abs(value))}bn`;
  if (unit === 'EUR_bn') return `${sign}€${num(Math.abs(value))}bn`;
  if (unit === 'pct') return `${num(value)}%`;
  return `${num(value)} ${unit}`;
}

export const humanise = (s: string) => s.replaceAll('_', ' ');

/** Amount with its basis spelled out, so no two bases ever read alike. */
export function fmtAmount(r: Relation): string {
  const money = r.amount === null ? null : fmtMoney(r.amount, r.unit);
  const gw = r.capacity_gw === null ? null : `${num(r.capacity_gw)} GW`;
  const pct = r.share_pct === null ? null : `${num(r.share_pct)}%`;
  const parts: string[] = [];
  switch (r.amount_basis) {
    case 'committed': parts.push(`${money ?? 'undisclosed'} committed`); break;
    case 'up_to': parts.push(`up to ${money ?? 'undisclosed'}`); break;
    case 'invested': parts.push(`${money ?? 'undisclosed'} invested`); break;
    case 'annual': parts.push(money ? `${money} a year` : 'undisclosed annual amount'); break;
    case 'backlog_share': parts.push(`${money ?? 'undisclosed'} derived from ${pct ?? '?'} of backlog`); break;
    case 'share_pct': parts.push(pct ? `${pct} of the payee's revenue` : 'share undisclosed'); break;
    case 'ownership_pct': parts.push(pct ? `${pct} ownership stake` : 'stake undisclosed'); break;
    case 'proxy_share': parts.push(pct ? `${pct} (proxy figure)` : 'proxy undisclosed'); break;
    case 'capacity': parts.push(gw ?? 'capacity undisclosed'); break;
    case 'undisclosed': parts.push('undisclosed'); break;
  }
  if (gw && r.amount_basis !== 'capacity') parts.push(gw);
  if (pct && r.amount_basis === 'annual') parts.push(`${pct} of the payee's revenue`);
  return parts.join(' · ');
}

const VERB: Record<Relation['type'], string> = {
  compute_commitment: 'commits to pay {to} for compute',
  equity: 'invests in {to}',
  chip_purchase: 'buys chips from {to}',
  wafer_purchase: 'buys wafers from {to}',
  tool_purchase: 'buys tools from {to}',
  licence: 'pays {to} under a licence',
  rental: 'rents capacity from {to}',
  debt: 'lends to {to}',
};

/** "Anthropic commits to pay Amazon for compute: $100bn committed · 5 GW." */
export function directionSentence(r: Relation, name: (id: string) => string): string {
  const verb = r.amount_basis === 'ownership_pct' ? 'holds a stake in {to}' : VERB[r.type];
  return `${name(r.from_id)} ${verb.replace('{to}', name(r.to_id))}: ${fmtAmount(r)}.`;
}

/** USD value for sorting; anything not a plain USD amount sorts last. */
export const usdSortKey = (r: Relation) => (r.amount !== null && r.unit === 'USD_bn' ? r.amount : -1);

export type Staleness = { level: 'undated' | 'fresh' | 'amber' | 'red'; days: number | null };

/** Month-precision dates count from the 1st: the conservative (older) reading. */
export function staleness(asOf: string | null, now: Date = new Date()): Staleness {
  if (!asOf) return { level: 'undated', days: null };
  const d = new Date(asOf.length === 7 ? `${asOf}-01` : asOf);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  return { level: days > 180 ? 'red' : days > 90 ? 'amber' : 'fresh', days };
}

export const entityName = (entities: Entity[]) => {
  const m = new Map(entities.map((e) => [e.id, e.name]));
  return (id: string) => m.get(id) ?? id;
};
