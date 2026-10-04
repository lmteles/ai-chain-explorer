import type { Graph, Relation } from '../data/schema';

export type MoneyPath = {
  edges: string[];
  nodes: string[];          // start … end
  closesLoop: boolean;      // ends back at the start node
  bottleneck: number | null; // smallest disclosed USD hop when every hop is disclosed on one money basis
  bottleneckNote: string;
};

export type FollowOptions = { depth: number; highOnly?: boolean; types?: Relation['type'][] };

/**
 * Every simple downstream path from `start` (payer → payee), 1 to 4 hops. A path may end back at the start, which
 * closes a loop; it never passes through it. Dollars are not conserved along a chain, so a path carries a
 * "bottleneck" (the most that could have passed end to end) rather than a sum.
 */
export function followMoney(g: Graph, start: string, { depth, highOnly = false, types }: FollowOptions): MoneyPath[] {
  const d = Math.max(1, Math.min(4, Math.floor(depth)));
  const ok = (r: Relation) => (!highOnly || r.confidence === 'high') && (!types || types.includes(r.type));
  const outOf = new Map<string, Relation[]>();
  for (const r of g.relations.filter(ok)) outOf.set(r.from_id, [...(outOf.get(r.from_id) ?? []), r]);
  const paths: MoneyPath[] = [];
  const walk = (node: string, hops: Relation[], seen: Set<string>) => {
    for (const r of outOf.get(node) ?? []) {
      const next = [...hops, r];
      if (r.to_id === start) { paths.push(toPath(next, true)); continue; }
      if (seen.has(r.to_id)) continue;
      paths.push(toPath(next, false));
      if (next.length < d) { seen.add(r.to_id); walk(r.to_id, next, seen); seen.delete(r.to_id); }
    }
  };
  walk(start, [], new Set([start]));
  return paths;
}

function toPath(hops: Relation[], closesLoop: boolean): MoneyPath {
  const bases = new Set(hops.map((r) => r.amount_basis));
  const disclosed = hops.every((r) => r.amount !== null && r.unit === 'USD_bn');
  const oneMoneyBasis = bases.size === 1 && ['committed', 'invested', 'annual', 'up_to'].includes(hops[0]!.amount_basis);
  const bottleneck = disclosed && oneMoneyBasis ? Math.min(...hops.map((r) => r.amount!)) : null;
  const bottleneckNote = bottleneck !== null ? (hops.length === 1 ? 'single hop' : 'at most this much can have passed end to end')
    : !disclosed ? 'a hop is undisclosed or not in USD' : 'hops are on different bases';
  return { edges: hops.map((r) => r.id), nodes: [hops[0]!.from_id, ...hops.map((r) => r.to_id)], closesLoop, bottleneck, bottleneckNote };
}

export type SankeyNode = { key: string; entity: string; layer: number };
export type SankeyLink = { source: string; target: string; value: number; relation: Relation };

/**
 * Sankey input with one column per hop, so the diagram is always acyclic even when money loops back: a company
 * reached at hop 1 and again at hop 3 appears twice. Link width is the edge's own disclosed USD amount, drawn once
 * per column pair. Undisclosed or non-USD edges are returned separately, never drawn with an invented width.
 */
export function sankeyData(g: Graph, paths: MoneyPath[], basis: string | 'all'): { nodes: SankeyNode[]; links: SankeyLink[]; undisclosed: Relation[] } {
  const rel = new Map(g.relations.map((r) => [r.id, r]));
  const nodes = new Map<string, SankeyNode>();
  const links = new Map<string, SankeyLink>();
  const undisclosed = new Map<string, Relation>();
  for (const p of paths) {
    p.edges.forEach((id, i) => {
      const r = rel.get(id)!;
      if (basis !== 'all' && r.amount_basis !== basis) return;
      if (r.amount === null || r.unit !== 'USD_bn' || r.amount <= 0) { undisclosed.set(r.id, r); return; }
      const s = `${r.from_id}@${i}`, t = `${r.to_id}@${i + 1}`;
      nodes.set(s, { key: s, entity: r.from_id, layer: i });
      nodes.set(t, { key: t, entity: r.to_id, layer: i + 1 });
      links.set(`${s}>${t}>${r.id}`, { source: s, target: t, value: r.amount, relation: r });
    });
  }
  return { nodes: [...nodes.values()], links: [...links.values()], undisclosed: [...undisclosed.values()] };
}

/** Outgoing payments from a node, largest disclosed USD first: the menu for "where does the money go next?". */
export function nextHops(g: Graph, from: string, visible: (r: Relation) => boolean = () => true): Relation[] {
  const key = (r: Relation) => (r.amount !== null && r.unit === 'USD_bn' ? r.amount : -1);
  return g.relations.filter((r) => r.from_id === from && visible(r)).sort((a, b) => key(b) - key(a));
}
