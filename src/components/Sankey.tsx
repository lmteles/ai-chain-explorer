import { sankey, sankeyLinkHorizontal, type SankeyGraph } from 'd3-sankey';
import type { Entity } from '../lib/data/schema';
import { fmtAmount, fmtMoney, humanise } from '../lib/fmt';
import type { SankeyLink, SankeyNode } from '../lib/graph/paths';
import { TIER_COLOUR, TYPE_COLOUR } from '../lib/graph/view';

type N = SankeyNode & { name: string };
type L = { source: string; target: string; value: number; link: SankeyLink };

const W = 960, H = 480;

export function Sankey({ nodes, links, entities }: { nodes: SankeyNode[]; links: SankeyLink[]; entities: Entity[] }) {
  if (!links.length) return <p className="text-slate-500">No disclosed USD amounts to draw for this selection.</p>;
  const ent = new Map(entities.map((e) => [e.id, e]));
  const layout = sankey<N, L>().nodeId((n) => n.key).nodeWidth(14).nodePadding(14).extent([[1, 8], [W - 160, H - 8]]);
  const g: SankeyGraph<N, L> = layout({
    nodes: nodes.map((n) => ({ ...n, name: ent.get(n.entity)?.name ?? n.entity })),
    links: links.map((l) => ({ source: l.source, target: l.target, value: l.value, link: l })),
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Sankey diagram of money flowing downstream, one column per hop">
      <g fill="none">
        {g.links.map((l, i) => (
          <path key={i} d={sankeyLinkHorizontal()(l) ?? ''} stroke={TYPE_COLOUR[l.link.relation.type]} strokeOpacity={0.45} strokeWidth={Math.max(1, l.width ?? 1)}>
            <title>{`${l.link.relation.id}: ${humanise(l.link.relation.type)}, ${fmtAmount(l.link.relation)} (${l.link.relation.confidence} confidence)`}</title>
          </path>
        ))}
      </g>
      {g.nodes.map((n) => (
        <g key={n.key}>
          <rect x={n.x0} y={n.y0} width={(n.x1 ?? 0) - (n.x0 ?? 0)} height={Math.max(1, (n.y1 ?? 0) - (n.y0 ?? 0))} fill={TIER_COLOUR[ent.get(n.entity)?.tier ?? 1]}>
            <title>{`${n.name}, hop ${n.layer}`}</title>
          </rect>
          <text x={(n.x1 ?? 0) + 6} y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2} dy="0.35em" fontSize={12} fill="#1B2A4A">
            {n.name}{n.layer > 0 && <tspan fill="#64748b"> {fmtMoney(n.value ?? 0, 'USD_bn')} in</tspan>}
          </text>
        </g>
      ))}
    </svg>
  );
}
