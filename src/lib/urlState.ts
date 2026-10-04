import {
  ALL_FILTERS, CONFIDENCES, MIN_USD_STOPS, RELATION_TYPES, STATUSES,
  type Filters, type LayoutMode, type SizeBy,
} from './graph/view';

export type Selection = { kind: 'node' | 'edge'; id: string } | null;
export type NodeTab = 'overview' | 'money' | 'concentration' | 'claims';

export type ViewState = {
  filters: Filters;
  sizeBy: SizeBy;
  layout: LayoutMode;
  sel: Selection;
  tab: NodeTab;
  focus: string | null; // double-clicked node: neighbourhood highlighted
  trail: string[];      // breadcrumb of visited node ids
  loop: string | null;  // highlighted cycle id
  rabbit: string[] | null; // rabbit-hole mode: edges taken so far (null = off)
  asOf: string | null;      // time travel: show the graph as known on this date
};

export const DEFAULT_VIEW: ViewState = {
  filters: ALL_FILTERS, sizeBy: 'capex', layout: 'tiers', sel: null, tab: 'overview', focus: null, trail: [], loop: null, rabbit: null, asOf: null,
};

const TABS: NodeTab[] = ['overview', 'money', 'concentration', 'claims'];
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
// Unknown values in a hand-edited URL are dropped, never trusted.
const list = <T extends string>(v: string | null, allowed: readonly T[], fallback: T[]): T[] =>
  v === null ? fallback : v.split(',').filter((x): x is T => (allowed as readonly string[]).includes(x));
const oneOf = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback;

/** Only non-default values are written, so a plain view has a plain URL. */
export function encodeView(s: ViewState): string {
  const p = new URLSearchParams();
  if (s.sel) p.set(s.sel.kind === 'node' ? 'n' : 'e', s.sel.id);
  if (s.sel?.kind === 'node' && s.tab !== 'overview') p.set('tab', s.tab);
  if (s.focus) p.set('focus', s.focus);
  if (s.trail.length) p.set('trail', s.trail.join(','));
  if (s.loop) p.set('loop', s.loop);
  if (s.rabbit) p.set('rabbit', s.rabbit.join(','));
  if (s.asOf) p.set('asof', s.asOf);
  if (!same(s.filters.types, RELATION_TYPES)) p.set('types', s.filters.types.join(','));
  if (!same(s.filters.confidence, CONFIDENCES)) p.set('conf', s.filters.confidence.join(','));
  if (!same(s.filters.status, STATUSES)) p.set('status', s.filters.status.join(','));
  if (s.filters.minUsd) p.set('min', String(s.filters.minUsd));
  if (s.sizeBy !== DEFAULT_VIEW.sizeBy) p.set('size', s.sizeBy);
  if (s.layout !== DEFAULT_VIEW.layout) p.set('layout', s.layout);
  const q = p.toString().replaceAll('%2C', ',');
  return q ? `#/?${q}` : '#/';
}

export function decodeView(hash: string): ViewState {
  const p = new URLSearchParams(hash.replace(/^#\/?\??/, ''));
  const n = p.get('n'), e = p.get('e');
  const min = Number(p.get('min') ?? 0);
  return {
    filters: {
      types: list(p.get('types'), RELATION_TYPES, RELATION_TYPES),
      confidence: list(p.get('conf'), CONFIDENCES, CONFIDENCES),
      status: list(p.get('status'), STATUSES, STATUSES),
      minUsd: MIN_USD_STOPS.includes(min) ? min : 0,
    },
    sizeBy: oneOf(p.get('size'), ['capex', 'revenue', 'none'] as const, DEFAULT_VIEW.sizeBy),
    layout: oneOf(p.get('layout'), ['tiers', 'force'] as const, DEFAULT_VIEW.layout),
    sel: n ? { kind: 'node', id: n } : e ? { kind: 'edge', id: e } : null,
    tab: oneOf(p.get('tab'), TABS, 'overview'),
    focus: p.get('focus'),
    trail: p.get('trail')?.split(',').filter(Boolean) ?? [],
    loop: p.get('loop'),
    rabbit: p.has('rabbit') ? p.get('rabbit')!.split(',').filter(Boolean) : null,
    asOf: /^\d{4}-\d{2}-\d{2}$/.test(p.get('asof') ?? '') ? p.get('asof') : null,
  };
}

/** Visiting a node already on the trail cuts the trail back to it; otherwise it is appended. */
export function pushTrail(trail: string[], id: string): string[] {
  const i = trail.indexOf(id);
  return i >= 0 ? trail.slice(0, i + 1) : [...trail, id];
}
