import { useEffect, useMemo, useState } from 'react';
import type { Graph } from '../lib/data/schema';
import { entityName, fmtAmount, fmtMoney, humanise } from '../lib/fmt';
import { followMoney, sankeyData } from '../lib/graph/paths';
import { Sankey } from './Sankey';

type FlowState = { n: string; d: number; high: boolean; basis: string };

const read = (hash: string): FlowState => {
  const p = new URLSearchParams(hash.replace(/^#\/flows\??/, ''));
  return { n: p.get('n') ?? 'anthropic', d: Math.min(4, Math.max(1, Number(p.get('d') ?? 2) || 2)), high: p.get('high') === '1', basis: p.get('basis') ?? 'all' };
};

export function FlowsPage({ graph, backHref }: { graph: Graph; backHref: string }) {
  const [s, set] = useState<FlowState>(() => read(location.hash));
  useEffect(() => {
    history.replaceState(null, '', `#/flows?n=${s.n}&d=${s.d}${s.high ? '&high=1' : ''}${s.basis !== 'all' ? `&basis=${s.basis}` : ''}`);
  }, [s]);
  const name = entityName(graph.entities);
  const paths = useMemo(() => followMoney(graph, s.n, { depth: s.d, highOnly: s.high }), [graph, s.n, s.d, s.high]);
  const bases = useMemo(() => [...new Set(paths.flatMap((p) => p.edges).map((id) => graph.relations.find((r) => r.id === id)!.amount_basis))].sort(), [paths, graph]);
  const { nodes, links, undisclosed } = useMemo(() => sankeyData(graph, paths, s.basis), [graph, paths, s.basis]);
  const shownBases = new Set(links.map((l) => l.relation.amount_basis));
  const rel = (id: string) => graph.relations.find((r) => r.id === id)!;
  const ranked = [...paths].sort((a, b) => (b.bottleneck ?? -1) - (a.bottleneck ?? -1) || a.edges.length - b.edges.length);

  return (
    <div className="mx-auto max-w-6xl p-6 text-sm">
      <a href={backHref} className="text-xs underline decoration-dotted">← Back to the graph</a>
      <h2 className="mt-2 text-xl font-semibold">Follow the money</h2>
      <p className="max-w-3xl text-slate-600">Downstream payments from one company, hop by hop. Each column is a hop; a company reached twice appears twice, so loops show as money returning to the start.</p>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label>From <select className="ml-1 rounded border border-slate-300 px-1" value={s.n} onChange={(e) => set({ ...s, n: e.target.value })}>
          {[...graph.entities].sort((a, b) => a.name.localeCompare(b.name)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select></label>
        <label>Hops <select className="ml-1 rounded border border-slate-300 px-1" value={s.d} onChange={(e) => set({ ...s, d: Number(e.target.value) })}>
          {[1, 2, 3, 4].map((d) => <option key={d}>{d}</option>)}
        </select></label>
        <label>Basis <select className="ml-1 rounded border border-slate-300 px-1" value={s.basis} onChange={(e) => set({ ...s, basis: e.target.value })}>
          <option value="all">all (not additive)</option>
          {bases.map((b) => <option key={b} value={b}>{humanise(b)}</option>)}
        </select></label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={s.high} onChange={(e) => set({ ...s, high: e.target.checked })} /> High confidence only</label>
      </div>
      {shownBases.size > 1 && (
        <p className="mt-3 rounded bg-amber-50 p-2 text-amber-900">
          Mixed bases on screen ({[...shownBases].map(humanise).join(', ')}). Each link is one edge's own amount, but node totals add different
          bases together: read link by link, or pick one basis above.
        </p>
      )}
      <div className="mt-3 rounded border border-slate-200 bg-white p-2"><Sankey nodes={nodes} links={links} entities={graph.entities} /></div>
      {undisclosed.length > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          Not drawn ({undisclosed.length}, amount undisclosed or not USD): {undisclosed.map((r) => `${name(r.from_id)} → ${name(r.to_id)} (${fmtAmount(r)})`).join('; ')}.
        </p>
      )}

      <h3 className="mt-6 font-semibold">Paths ({paths.length})</h3>
      <p className="text-xs text-slate-500">Dollars are not conserved along a chain, so paths are never summed. "Bottleneck" is the smallest hop when every hop is disclosed on one basis: the most that could have passed end to end.</p>
      <table className="mt-2 w-full text-left text-xs">
        <thead className="uppercase tracking-wide text-slate-500"><tr><th className="py-1">Path</th><th>Hops</th><th className="text-right">Bottleneck</th></tr></thead>
        <tbody>
          {ranked.slice(0, 60).map((p) => (
            <tr key={p.edges.join()} className="border-t border-slate-100 align-top">
              <td className="py-1 pr-2 font-medium">{p.nodes.map(name).join(' → ')}{p.closesLoop && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-900">loop</span>}</td>
              <td className="pr-2">{p.edges.map((id) => `${humanise(rel(id).type)}: ${fmtAmount(rel(id))}`).join(' │ ')}</td>
              <td className="text-right">{p.bottleneck !== null ? fmtMoney(p.bottleneck, 'USD_bn') : <span className="text-slate-400" title={p.bottleneckNote}>n/a</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {paths.length > 60 && <p className="mt-1 text-xs text-slate-500">Showing 60 of {paths.length}. Fewer hops narrows it.</p>}
    </div>
  );
}
