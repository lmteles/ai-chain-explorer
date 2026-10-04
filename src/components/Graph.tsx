import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { useEffect, useRef } from 'react';
import type { Graph as GraphData } from '../lib/data/schema';
import {
  COL_WIDTH, LANE_HEIGHT, LINE_STYLE, NODE_DEFAULT, STATUS_OPACITY, TIER_COLOUR, TIER_LABEL, TYPE_COLOUR,
  edgeWidth, isEdgeVisible, nodeSize, sizeMetrics, tierPositions,
  type Filters, type LayoutMode, type SizeBy,
} from '../lib/graph/view';

cytoscape.use(fcose);

export type GraphEvents = {
  onNode: (id: string) => void;
  onEdge: (id: string) => void;
  onFocus: (id: string | null) => void; // double-click a node; double-click empty canvas to clear
  onBackground: () => void;
  onReady?: (cy: Core | null) => void; // for export
};
type Props = GraphEvents & {
  graph: GraphData; filters: Filters; sizeBy: SizeBy; layout: LayoutMode;
  selected: { kind: 'node' | 'edge'; id: string } | null; focus: string | null;
  highlight: { nodes: string[]; edges: string[] } | null; // a loop or a rabbit-hole trail; wins over focus
};
type Pos = { x: number; y: number };

const STYLE: cytoscape.StylesheetJson = [
  { selector: '*', style: { 'z-index-compare': 'manual' } },
  {
    selector: 'node.lane',
    style: {
      shape: 'rectangle', width: 'data(w)', height: LANE_HEIGHT - 8, 'background-color': 'data(bg)',
      label: 'data(label)', 'text-halign': 'left', 'text-valign': 'center', 'text-margin-x': -8,
      color: '#5B6C8F', 'font-size': 13, 'font-weight': 600, events: 'no', 'z-index': 0,
    },
  },
  {
    selector: 'node.company',
    style: {
      width: 'data(size)', height: 'data(size)', 'background-color': 'data(colour)',
      'border-width': 'data(borderWidth)', 'border-color': '#8A94A6', 'border-style': 'dashed',
      label: 'data(label)', 'text-valign': 'bottom', 'text-margin-y': 4, 'font-size': 12,
      color: '#1B2A4A', 'text-background-color': '#FFFFFF', 'text-background-opacity': 0.8,
      'text-background-padding': '2px', 'z-index': 10,
    },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier', 'control-point-step-size': 48,
      width: 'data(w)', 'line-color': 'data(colour)', 'line-style': (e) => e.data('lineStyle'), opacity: (e: cytoscape.EdgeSingular) => e.data('opacity'),
      'target-arrow-shape': 'triangle', 'target-arrow-color': 'data(colour)', 'target-arrow-fill': (e) => e.data('arrowFill'),
      'arrow-scale': 1.2, 'z-index': 5,
    },
  },
  { selector: 'node.company.selected', style: { 'border-width': 4, 'border-color': '#C9A227', 'border-style': 'solid' } },
  { selector: 'edge.selected', style: { 'underlay-color': '#C9A227', 'underlay-opacity': 0.45, 'underlay-padding': 5, opacity: 1, 'z-index': 8 } },
  { selector: '.faded', style: { opacity: 0.1 } },
  { selector: 'node.company.faded', style: { 'text-opacity': 0.3 } },
  { selector: '.hidden', style: { display: 'none' } },
];

function elements(g: GraphData, pos: Map<string, Pos>): ElementDefinition[] {
  const widest = Math.max(...[1, 2, 3, 4, 5].map((t) => g.entities.filter((e) => e.tier === t).length));
  const lanes = ([1, 2, 3, 4, 5] as const).map((t) => ({
    data: { id: `lane-${t}`, label: `${t} ${TIER_LABEL[t]}`, w: widest * COL_WIDTH + 120, bg: t % 2 ? '#F3F5F9' : '#FAFBFD' },
    position: { x: 0, y: (t - 1) * LANE_HEIGHT },
    classes: 'lane', selectable: false, grabbable: false,
  }));
  const nodes = g.entities.map((e) => ({
    data: { id: e.id, label: e.name, colour: TIER_COLOUR[e.tier], size: NODE_DEFAULT, borderWidth: 0 },
    position: { ...pos.get(e.id)! },
    classes: 'company',
  }));
  const edges = g.relations.map((r) => ({
    data: {
      id: r.id, source: r.from_id, target: r.to_id,
      w: edgeWidth(r.amount), colour: TYPE_COLOUR[r.type], lineStyle: LINE_STYLE[r.confidence],
      opacity: STATUS_OPACITY[r.status], arrowFill: r.amount === null ? 'hollow' : 'filled',
    },
  }));
  return [...lanes, ...nodes, ...edges];
}

export function Graph({ graph, filters, sizeBy, layout, selected, focus, highlight, ...events }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const tierPos = useRef<Map<string, Pos>>(new Map());
  const forcePos = useRef<Map<string, Pos> | null>(null); // computed once, reused: no jitter on toggling back
  const running = useRef<cytoscape.Layouts | null>(null);
  const evRef = useRef(events);
  evRef.current = events; // handlers bound once; always call the latest callbacks

  useEffect(() => {
    tierPos.current = tierPositions(graph.entities);
    forcePos.current = null;
    const cy = cytoscape({
      container: container.current, elements: elements(graph, tierPos.current), style: STYLE,
      layout: { name: 'preset' }, minZoom: 0.3, maxZoom: 3,
    });
    cy.fit(undefined, 40);
    cy.on('tap', 'node.company', (ev) => evRef.current.onNode(ev.target.id()));
    cy.on('tap', 'edge', (ev) => evRef.current.onEdge(ev.target.id()));
    cy.on('tap', (ev) => { if (ev.target === cy) evRef.current.onBackground(); });
    cy.on('dbltap', 'node.company', (ev) => evRef.current.onFocus(ev.target.id()));
    cy.on('dbltap', (ev) => { if (ev.target === cy) evRef.current.onFocus(null); });
    const ro = new ResizeObserver(() => cy.resize());
    ro.observe(container.current!);
    cyRef.current = cy;
    evRef.current.onReady?.(cy);
    return () => { ro.disconnect(); evRef.current.onReady?.(null); cy.destroy(); };
  }, [graph]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('selected');
    if (!selected) return;
    const el = cy.getElementById(selected.id);
    if (el.empty()) return;
    el.addClass('selected');
    // Bring it into view only if it is off-screen: no unprompted camera moves.
    const bb = el.renderedBoundingBox();
    if (bb.x1 < 0 || bb.y1 < 0 || bb.x2 > cy.width() || bb.y2 > cy.height()) cy.animate({ center: { eles: el } }, { duration: 300 });
  }, [graph, selected]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('faded');
      let keep: cytoscape.Collection | null = null;
      if (highlight) {
        keep = cy.collection();
        for (const id of [...highlight.nodes, ...highlight.edges]) keep = keep.union(cy.getElementById(id));
      } else if (focus && !cy.getElementById(focus).empty()) {
        keep = cy.getElementById(focus).closedNeighborhood();
      }
      if (keep) cy.elements().not(keep.union(cy.nodes('.lane'))).addClass('faded');
    });
  }, [graph, focus, highlight]);

  // Filters only toggle visibility; positions are never recomputed.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const byId = new Map(graph.relations.map((r) => [r.id, r]));
    cy.batch(() => cy.edges().forEach((e) => { e.toggleClass('hidden', !isEdgeVisible(byId.get(e.id())!, filters)); }));
  }, [graph, filters]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const metrics = sizeMetrics(graph, sizeBy);
    const max = Math.max(0, ...[...metrics.values()].map((m) => m.value));
    cy.batch(() => cy.nodes('.company').forEach((n) => {
      const m = metrics.get(n.id());
      n.data({ size: sizeBy === 'none' ? NODE_DEFAULT : nodeSize(m?.value, max), borderWidth: sizeBy !== 'none' && !m ? 2 : 0 });
    }));
  }, [graph, sizeBy]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const companies = cy.nodes('.company');
    // A fast toggle must not let a half-finished layout land after the new one.
    const prev = running.current;
    running.current = null;
    prev?.stop();
    companies.stop(true, true);
    cy.nodes('.lane').toggleClass('hidden', layout === 'force');
    const toPreset = (pos: Map<string, Pos>) => {
      running.current = companies.layout({ name: 'preset', positions: Object.fromEntries(pos), animate: true, animationDuration: 400, fit: true, padding: 40 });
      running.current.run();
    };

    if (layout === 'tiers') return void toPreset(tierPos.current);
    if (forcePos.current) return void toPreset(forcePos.current);
    const run = companies.union(cy.edges()).layout({
      name: 'fcose', randomize: false, quality: 'proof', animate: true, animationDuration: 600,
      nodeRepulsion: 9000, idealEdgeLength: 150, fit: true, padding: 40,
    } as cytoscape.LayoutOptions);
    running.current = run;
    run.one('layoutstop', () => {
      if (running.current === run) forcePos.current = new Map(companies.map((n) => [n.id(), { ...n.position() }])); // not if cancelled
    });
    run.run();
  }, [layout]);

  return <div ref={container} className="h-full w-full" role="img" aria-label="Money-flow graph of AI infrastructure companies" />;
}
