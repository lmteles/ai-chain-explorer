import type { Graph } from '../data/schema';

const day = (d: string) => (d.length === 7 ? `${d}-01` : d.slice(0, 10)); // month precision reads as the 1st

/**
 * The graph as it was known on `date`: an edge appears once its first evidence is dated on or before it and while
 * any valid_from/valid_to window holds; metrics show the latest history point at that date (or their own value if
 * dated by then); events and later filings disappear. Undated rows stay, flagged by the caller: we cannot place them.
 */
export function graphAsOf(g: Graph, date: string): Graph & { undatedKept: number } {
  const at = day(date);
  const known = (d: string | null | undefined) => !d || day(d) <= at;
  const relations = g.relations.filter((r) => known(r.as_of) && (!r.valid_from || day(r.valid_from) <= at) && (!r.valid_to || day(r.valid_to) > at));
  // A filed point is known from the day its filing was published, not from the day its quarter ended.
  const published = new Map(g.sources.map((x) => [x.id, x.published]));
  const knownOn = (h: { end: string; source_ids: string[] }) => day([h.end, ...h.source_ids.map((id) => published.get(id) ?? '')].filter(Boolean).sort().at(-1)!);
  const pointKnown = (h: { end: string; source_ids: string[] }) => knownOn(h) <= at;
  const metrics = g.metrics.flatMap((m) => {
    const series = g.history.filter((h) => h.entity_id === m.entity_id && h.key === m.key && pointKnown(h)).sort((a, b) => b.end.localeCompare(a.end));
    if (m.id.startsWith('sec_') || m.id.startsWith('mkt_')) {
      // Live series: replay the point that was current then, under its own fact id.
      const h = series[0];
      return h ? [{ ...m, id: h.id, value: h.value, period: h.period, source_ids: h.source_ids, as_of: knownOn(h) }] : [];
    }
    return known(m.as_of) ? [m] : [];
  });
  const metricIds = new Set(metrics.map((m) => m.id));
  return {
    ...g,
    relations,
    // A supersession only stands if the superseding figure existed then.
    metrics: metrics.filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i).map((m) => (m.superseded_by && !metricIds.has(m.superseded_by) ? { ...m, superseded_by: undefined } : m)),
    history: g.history.filter(pointKnown),
    events: g.events.filter((e) => day(e.date) <= at && relations.some((r) => r.id === e.relation_id)),
    filings: g.filings.filter((f) => day(f.filed) <= at),
    undatedKept: relations.filter((r) => !r.as_of).length,
  };
}

/** Earliest dated fact: the left end of the slider. */
export function earliestDate(g: Graph): string {
  const ds = [...g.relations.map((r) => r.as_of), ...g.metrics.map((m) => m.as_of), ...g.history.map((h) => h.end)].filter((d): d is string => !!d).map(day).sort();
  return ds[0] ?? new Date().toISOString().slice(0, 10);
}
