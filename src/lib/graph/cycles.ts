import type { Graph, Relation } from '../data/schema';

export const LOOP_TYPES: Relation['type'][] = ['equity', 'compute_commitment', 'chip_purchase'];
const MAX_LEN = 6;

export type RoundTrip = {
  ratio: number | null;      // equity returning ÷ dollars going out
  returning: number | null;  // USD bn, equity legs
  outgoing: number | null;   // USD bn, commitment and purchase legs
  reasons: string[];         // why it is not computable, or caveats when it is
};

export type Cycle = { id: string; nodes: string[]; edges: string[]; roundTrip: RoundTrip };

// Money amounts that can sit on either side of the ratio. "up to" is a ceiling, so it is allowed but flagged.
const MONEY_BASES = new Set(['committed', 'up_to', 'invested']);

/**
 * Round-trip ratio for a loop: USD that comes back as equity, divided by USD committed or spent going round.
 * Computable only when every leg is a disclosed USD amount on a money basis; otherwise says why not.
 */
export function roundTrip(edges: Relation[]): RoundTrip {
  const reasons: string[] = [];
  for (const r of edges) {
    if (r.amount === null) reasons.push(`${r.id}: amount undisclosed${r.capacity_gw !== null ? ` (only ${r.capacity_gw} GW stated)` : r.share_pct !== null ? ` (only ${r.share_pct}% stated)` : ''}`);
    else if (r.unit !== 'USD_bn') reasons.push(`${r.id}: not in USD`);
    else if (!MONEY_BASES.has(r.amount_basis)) reasons.push(`${r.id}: basis "${r.amount_basis}" is not a money amount`);
  }
  const back = edges.filter((r) => r.type === 'equity');
  const out = edges.filter((r) => r.type !== 'equity');
  if (!back.length) reasons.push('no equity leg: nothing returns as investment');
  if (!out.length) reasons.push('no commitment or purchase leg');
  if (reasons.length) return { ratio: null, returning: null, outgoing: null, reasons };
  const sum = (rs: Relation[]) => rs.reduce((s, r) => s + r.amount!, 0);
  const returning = sum(back), outgoing = sum(out);
  const caveats = [
    ...(edges.some((r) => r.amount_basis === 'up_to') ? ['includes "up to" amounts: ceilings, not sums paid'] : []),
    ...(edges.some((r) => r.confidence === 'low') ? ['includes a low-confidence leg'] : []),
    ...(new Set(edges.map((r) => r.period ?? 'unstated')).size > 1 ? ['legs cover different periods'] : []),
  ];
  return { ratio: returning / outgoing, returning, outgoing, reasons: caveats };
}

/**
 * Every directed simple cycle over the money-loop edge types, up to six legs. Parallel edges give distinct cycles.
 * ponytail: plain DFS from each start node; fine for tens of nodes, use Johnson's algorithm past a few hundred.
 */
export function findCycles(g: Graph, types = LOOP_TYPES): Cycle[] {
  const edges = g.relations.filter((r) => types.includes(r.type));
  const order = new Map(g.entities.map((e, i) => [e.id, i]));
  const outOf = new Map<string, Relation[]>();
  for (const r of edges) outOf.set(r.from_id, [...(outOf.get(r.from_id) ?? []), r]);
  const cycles: Cycle[] = [];
  for (const start of g.entities.map((e) => e.id)) {
    // Only cycles whose lowest-ordered node is the start: each cycle is found exactly once.
    const walk = (node: string, path: Relation[], seen: Set<string>) => {
      for (const r of outOf.get(node) ?? []) {
        if (r.to_id === start) {
          const loop = [...path, r];
          cycles.push({ id: loop.map((x) => x.id).join('>'), nodes: loop.map((x) => x.from_id), edges: loop.map((x) => x.id), roundTrip: roundTrip(loop) });
        } else if (!seen.has(r.to_id) && order.get(r.to_id)! > order.get(start)! && path.length + 1 < MAX_LEN) {
          seen.add(r.to_id);
          walk(r.to_id, [...path, r], seen);
          seen.delete(r.to_id);
        }
      }
    };
    walk(start, [], new Set([start]));
  }
  // Shortest and computable first: the two-leg loops are the story.
  return cycles.sort((a, b) => a.edges.length - b.edges.length || Number(b.roundTrip.ratio !== null) - Number(a.roundTrip.ratio !== null) || a.id.localeCompare(b.id));
}
