import type { Core } from 'cytoscape';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { AskScope } from './components/AskPanel';
import { Breadcrumb } from './components/Breadcrumb';
import { EdgeDrawer } from './components/EdgeDrawer';
import { Filters } from './components/Filters';
import { FlowsPage } from './components/FlowsPage';
import { Graph } from './components/Graph';
import { Legend } from './components/Legend';
import { LoopsPanel } from './components/LoopsPanel';
import { MacroStrip } from './components/MacroStrip';
import { NodeDrawer } from './components/NodeDrawer';
import { ReviewPage } from './components/ReviewPage';
import { SimulatorPage } from './components/SimulatorPage';
import { SourcesPage } from './components/SourcesPage';
import { latestRuns, pendingCount, useGraphData } from './lib/data/useGraphData';
import { briefHtml, canvasPng, canvasSvg, download, ledgerCsv, printBrief } from './lib/export';
import { earliestDate, graphAsOf } from './lib/graph/asof';
import { findCycles } from './lib/graph/cycles';
import { nextHops } from './lib/graph/paths';
import { isEdgeVisible } from './lib/graph/view';
import { decodeView, encodeView, pushTrail, type ViewState } from './lib/urlState';

// The Ask panel pulls in the Anthropic SDK: load it only when someone asks.
const AskPanel = lazy(() => import('./components/AskPanel').then((m) => ({ default: m.AskPanel })));

type Page = 'graph' | 'sources' | 'review' | 'flows' | 'simulate';
const pageOf = (hash: string): Page =>
  hash.startsWith('#/sources') ? 'sources' : hash.startsWith('#/review') ? 'review' : hash.startsWith('#/flows') ? 'flows' : hash.startsWith('#/simulate') ? 'simulate' : 'graph';

export function App() {
  const { graph: liveGraph, macro, runs, review, error, warnings, reload } = useGraphData();
  const [page, setPage] = useState<Page>(() => pageOf(location.hash));
  const [view, setView] = useState<ViewState>(() => decodeView(location.hash));
  const [askScope, setAskScope] = useState<AskScope | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [copied, setCopied] = useState(false);
  const [showFilters, setShowFilters] = useState(() => innerWidth >= 1280); // narrow screens: give the graph the room
  const patch = (p: Partial<ViewState> | ((v: ViewState) => Partial<ViewState>)) =>
    setView((v) => ({ ...v, ...(typeof p === 'function' ? p(v) : p) }));

  // The URL mirrors the view, so any state can be shared or reloaded.
  useEffect(() => { if (page === 'graph') history.replaceState(null, '', encodeView(view)); }, [view, page]);
  useEffect(() => {
    const onHash = () => {
      setPage(pageOf(location.hash));
      if (pageOf(location.hash) === 'graph') setView(decodeView(location.hash));
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') patch({ sel: null, focus: null, loop: null, rabbit: null }); };
    addEventListener('hashchange', onHash);
    addEventListener('keydown', onKey);
    return () => { removeEventListener('hashchange', onHash); removeEventListener('keydown', onKey); };
  }, []);

  // Time travel: everything on the graph page reads the graph as known on the chosen date.
  const graph = useMemo(() => (liveGraph && view.asOf ? graphAsOf(liveGraph, view.asOf) : liveGraph), [liveGraph, view.asOf]);
  const sources = useMemo(() => new Map(graph?.sources.map((s) => [s.id, s])), [graph]);
  // An active neighbourhood focus follows the user down the rabbit hole.
  // Jumping to another company restarts any rabbit-hole trail from there.
  const selectNode = (id: string) =>
    patch((v) => ({ sel: { kind: 'node', id }, trail: pushTrail(v.trail, id), focus: v.focus ? id : null, rabbit: v.rabbit ? [] : null }));
  const selectEdge = (id: string) => patch({ sel: { kind: 'edge', id } });
  const { filters, sizeBy, layout, sel } = view;

  const cycles = useMemo(() => (graph ? findCycles(graph) : []), [graph]);
  const visible = (r: Parameters<typeof isEdgeVisible>[0]) => isEdgeVisible(r, filters);
  // Rabbit hole: the trail so far plus every onward payment from where we stand. A loop: just that cycle.
  const highlight = useMemo(() => {
    if (!graph) return null;
    const c = view.loop ? cycles.find((x) => x.id === view.loop) : undefined;
    if (c) return { nodes: c.nodes, edges: c.edges };
    if (view.rabbit && sel?.kind === 'node') {
      const taken = view.rabbit.map((id) => graph.relations.find((r) => r.id === id)).filter((r) => r !== undefined);
      const next = nextHops(graph, sel.id, visible);
      return { nodes: [sel.id, ...taken.flatMap((r) => [r.from_id, r.to_id]), ...next.map((r) => r.to_id)], edges: [...taken.map((r) => r.id), ...next.map((r) => r.id)] };
    }
    return null;
  }, [graph, cycles, view.loop, view.rabbit, sel, filters]);
  // A fact-id chip in an answer opens the row it cites.
  const openFact = (id: string) => {
    if (!graph) return;
    const rel = graph.relations.find((r) => r.id === id) ?? graph.relations.find((r) => r.id === graph.events.find((e) => e.id === id)?.relation_id);
    const metric = graph.metrics.find((m) => m.id === id) ?? graph.history.find((h) => h.id === id);
    const claim = graph.claims.find((c) => c.id === id);
    const source = graph.sources.find((x) => x.id === id);
    if (rel) selectEdge(rel.id);
    else if (graph.entities.some((e) => e.id === id)) selectNode(id);
    else if (metric) { selectNode(metric.entity_id); patch({ tab: 'overview' }); }
    else if (claim?.entity_ids[0]) { selectNode(claim.entity_ids[0]); patch({ tab: 'claims' }); }
    else if (source?.url) { window.open(source.url, '_blank', 'noopener,noreferrer'); return; }
    setAskScope(null);
  };
  const rabbit = {
    hops: view.rabbit,
    start: () => patch({ rabbit: [], focus: null, loop: null }),
    stop: () => patch({ rabbit: null }),
    step: (edgeId: string) => {
      const r = graph!.relations.find((x) => x.id === edgeId)!;
      patch((v) => ({ rabbit: [...(v.rabbit ?? []), edgeId], sel: { kind: 'node', id: r.to_id }, trail: pushTrail(v.trail, r.to_id) }));
    },
    next: sel?.kind === 'node' && graph ? nextHops(graph, sel.id, visible) : [],
  };

  return (
    <div className="flex h-screen flex-col bg-[#FAFBFD] text-[#1B2A4A]">
      <header className="flex flex-wrap items-baseline gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <button type="button" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters} aria-controls="filters"
          className="rounded border border-slate-300 px-2 py-0.5 text-sm hover:bg-slate-100">{showFilters ? '◂' : '▸'} Filters</button>
        <h1 className="text-lg font-semibold">AI Chain Explorer</h1>
        <span className="text-sm text-slate-500">Who pays whom in the AI build-out, and on whose word</span>
        <a href="#/flows" className="ml-auto text-sm underline decoration-dotted">Follow the money</a>
        <a href="#/simulate" className="text-sm underline decoration-dotted">Simulator</a>
        {review && (
          <a href="#/review" className="text-sm underline decoration-dotted">
            Review queue ({pendingCount(review)})
          </a>
        )}
        {graph && (
          <label className="text-sm">
            Go to company{' '}
            <select className="rounded border border-slate-300 px-1 py-0.5" value={sel?.kind === 'node' ? sel.id : ''}
              onChange={(e) => e.target.value && selectNode(e.target.value)}>
              <option value="">Choose…</option>
              {[...graph.entities].sort((a, b) => a.name.localeCompare(b.name)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
        )}
      </header>
      <MacroStrip macro={macro} runs={latestRuns(runs)} />
      {page !== 'graph' ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          {page === 'sources' ? <SourcesPage runs={runs} warnings={warnings} backHref={encodeView(view)} />
            : page === 'flows' ? (graph ? <FlowsPage graph={graph} backHref={encodeView(view)} /> : <p className="p-6 text-sm">Loading…</p>)
            : page === 'simulate' ? (graph ? <SimulatorPage graph={graph} macro={macro} backHref={encodeView(view)} /> : <p className="p-6 text-sm">Loading…</p>)
            : <ReviewPage review={review} reload={reload} backHref={encodeView(view)} />}
        </main>
      ) : (
      <div className="flex min-h-0 flex-1">
        {graph && showFilters && (
          <Filters filters={filters} setFilters={(f) => patch({ filters: f })} sizeBy={sizeBy} setSizeBy={(s) => patch({ sizeBy: s })}
            layout={layout} setLayout={(l) => patch({ layout: l })}>
            <fieldset className="border-t border-slate-200 pt-3 text-sm">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">As known on</legend>
              <input type="date" aria-label="Show the graph as known on this date" min={earliestDate(liveGraph!)} max={new Date().toISOString().slice(0, 10)}
                value={view.asOf ?? new Date().toISOString().slice(0, 10)} onChange={(e) => patch({ asOf: e.target.value || null })}
                className="rounded border border-slate-300 px-1" />
              {view.asOf && <button type="button" className="ml-2 text-xs underline" onClick={() => patch({ asOf: null })}>Today</button>}
              <p className="mt-1 text-xs text-slate-500">Hides what was not yet known; filed series replay the quarter current then.</p>
            </fieldset>
            <Legend graph={graph} sizeBy={sizeBy} />
          </Filters>
        )}
        <main className="relative min-w-0 flex-1">
          {error && <p role="alert" className="m-6 whitespace-pre-wrap rounded bg-red-50 p-4 text-sm text-red-800">{error}</p>}
          {!graph && !error && <p className="m-6 text-sm text-slate-500">Loading…</p>}
          {warnings.length > 0 && (
            <p role="status" className="absolute bottom-8 left-3 z-10 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
              Showing seed data only for: {warnings.join('; ')}
            </p>
          )}
          {graph && (
            <>
              <Breadcrumb trail={view.trail} entities={graph.entities} current={sel?.kind === 'node' ? sel.id : null}
                go={selectNode} clear={() => patch({ trail: [] })} />
              {view.asOf && (
                <p role="status" className="absolute bottom-8 right-3 z-10 rounded bg-[#1B2A4A] px-2 py-1 text-xs text-white">
                  As known on {view.asOf}: {graph.relations.length} edges. {'undatedKept' in graph ? `${(graph as { undatedKept: number }).undatedKept} undated edges kept: they cannot be placed in time.` : ''}
                </p>
              )}
              <LoopsPanel cycles={cycles} entities={graph.entities} selected={view.loop} select={(loop) => patch({ loop, focus: null, rabbit: null })} />
              <Graph graph={graph} filters={filters} sizeBy={sizeBy} layout={layout} selected={sel} focus={view.focus} highlight={highlight}
                onReady={(cy) => { cyRef.current = cy; }}
                onNode={selectNode} onEdge={selectEdge} onFocus={(focus) => patch({ focus })} onBackground={() => patch({ sel: null })} />
              <div role="toolbar" aria-label="Export and share" className="absolute bottom-2 left-3 z-10 flex flex-wrap gap-1 text-xs">
                {[
                  ['PNG', async () => { if (cyRef.current) download(`ai-chain-${view.asOf ?? 'today'}.png`, await canvasPng(cyRef.current)); }],
                  ['SVG', () => { if (cyRef.current) download(`ai-chain-${view.asOf ?? 'today'}.svg`, canvasSvg(cyRef.current), 'image/svg+xml'); }],
                  ['Ledger CSV', () => download(`ai-chain-ledger-${view.asOf ?? 'today'}.csv`, ledgerCsv(graph), 'text/csv')],
                  ['Brief (PDF)', () => { if (!printBrief(briefHtml(graph, sel, location.href))) alert('Allow pop-ups to print the brief.'); }],
                  [copied ? 'Link copied' : 'Copy link', () => navigator.clipboard.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })],
                ].map(([label, fn]) => (
                  <button key={label as string} type="button" onClick={fn as () => void}
                    className="rounded border border-slate-300 bg-white/95 px-2 py-0.5 shadow-sm hover:bg-slate-100">{label as string}</button>
                ))}
              </div>
              <p className="pointer-events-none absolute bottom-2 right-3 text-xs text-slate-400">
                Click to inspect · double-click a company to isolate its neighbours · Esc to clear
              </p>
            </>
          )}
        </main>
        {graph && sel && (
          <aside className="flex w-[26rem] shrink-0 flex-col border-l border-slate-200 bg-white" aria-label="Details">
            <button type="button" onClick={() => patch({ sel: null })} aria-label="Close details"
              className="self-end px-3 pt-2 text-xl leading-none text-slate-400 hover:text-slate-700">×</button>
            {sel.kind === 'node'
              ? <NodeDrawer graph={graph} sources={sources} id={sel.id} tab={view.tab} setTab={(tab) => patch({ tab })}
                  selectEdge={selectEdge} selectNode={selectNode} rabbit={rabbit} onAsk={() => setAskScope({ kind: 'node', id: sel.id })} />
              : <EdgeDrawer graph={graph} sources={sources} id={sel.id} selectEdge={selectEdge} selectNode={selectNode} onAsk={() => setAskScope({ kind: 'edge', id: sel.id })} />}
          </aside>
        )}
      </div>
      )}
      {graph && askScope && (
        <Suspense fallback={<div className="fixed inset-0 z-30 grid place-items-center bg-slate-900/30 text-sm text-white">Loading…</div>}>
          <AskPanel key={`${askScope.kind}:${askScope.id}`} graph={graph} scope={askScope} onOpenFact={openFact} onClose={() => setAskScope(null)} />
        </Suspense>
      )}
      <footer className="flex flex-wrap gap-x-6 border-t border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-600">
        <span><strong>Not investment advice.</strong> Figures carry their source, status and confidence; many are unverified.</span>
        <span><strong>Neutrality notice:</strong> Anthropic is a node in this graph and the assistant is built by Anthropic; OpenAI and Anthropic are treated symmetrically.</span>
      </footer>
    </div>
  );
}
