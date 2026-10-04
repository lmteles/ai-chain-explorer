import type { Graph, Metric, Relation, Source } from '../lib/data/schema';
import { entityName, fmtAmount, fmtMoney, humanise, usdSortKey } from '../lib/fmt';
import { concentration, namedTotals } from '../lib/graph/concentration';
import { TIER_COLOUR, TIER_LABEL, TYPE_COLOUR } from '../lib/graph/view';
import type { NodeTab } from '../lib/urlState';
import { Sparkline } from './Sparkline';
import { ConfidenceChip, SourceChips, StalenessBadge, StatusChip, Tabs } from './ui';

export type RabbitHole = { hops: string[] | null; start: () => void; stop: () => void; step: (edgeId: string) => void; next: Relation[] };

type Props = {
  graph: Graph; sources: Map<string, Source>; id: string; tab: NodeTab;
  setTab: (t: NodeTab) => void; selectEdge: (id: string) => void; selectNode: (id: string) => void; rabbit: RabbitHole; onAsk: () => void;
};

const TABS: [NodeTab, string][] = [['overview', 'Overview'], ['money', 'Money'], ['concentration', 'Concentration'], ['claims', 'Claims']];

export function NodeDrawer({ graph, sources, id, tab, setTab, selectEdge, selectNode, rabbit, onAsk }: Props) {
  const e = graph.entities.find((x) => x.id === id);
  if (!e) return <p className="p-4 text-sm">Unknown company “{id}”.</p>;
  const name = entityName(graph.entities);
  const claims = graph.claims.filter((c) => c.entity_ids.includes(id));

  return (
    <>
      <header className="px-4 pt-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: TIER_COLOUR[e.tier] }} />
          Tier {e.tier} · {TIER_LABEL[e.tier]} · {humanise(e.type)}
        </p>
        <h2 className="text-xl font-semibold">{e.name}</h2>
        <p className="text-xs text-slate-500">
          {e.private ? 'Private company: no filings; figures are reported or claimed' : `${e.ticker ?? ''}${e.cik ? ` · CIK ${e.cik}` : ''}`}
          {e.country ? ` · ${e.country}` : ''}
        </p>
        <Rabbit graph={graph} id={id} rabbit={rabbit} name={name} />
        <button type="button" onClick={onAsk} className="mt-2 ml-2 rounded border border-teal-600 bg-teal-50 px-2 py-1 text-xs font-medium text-teal-900 hover:bg-teal-100">Ask about this</button>
      </header>
      <Tabs tabs={TABS.map(([t, l]) => [t, t === 'claims' ? `${l} (${claims.length})` : l])} value={tab} set={setTab} />
      <div className="flex-1 overflow-y-auto p-4 text-sm">
        {tab === 'overview' && <Overview graph={graph} sources={sources} id={id} />}
        {tab === 'money' && (
          <>
            <MoneyTable title="Pays" rows={graph.relations.filter((r) => r.from_id === id)} other={(r) => name(r.to_id)} onPick={selectEdge} />
            <MoneyTable title="Is paid by" rows={graph.relations.filter((r) => r.to_id === id)} other={(r) => name(r.from_id)} onPick={selectEdge} />
          </>
        )}
        {tab === 'concentration' && <Concentration graph={graph} id={id} selectNode={selectNode} />}
        {tab === 'claims' && (claims.length ? (
          <ul className="space-y-3">
            {claims.map((c) => (
              <li key={c.id} className="rounded border border-slate-200 p-3">
                <p className="italic">“{c.text}”</p>
                <p className="mt-1 text-xs text-slate-500">{c.speaker} · <SourceChips ids={c.source_ids} sources={sources} /> · [{c.id}]</p>
                <p className="mt-2 text-xs"><strong>How to verify:</strong> {c.verify}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-slate-500">No Eisman claims mention {e.name}.</p>)}
      </div>
    </>
  );
}

function Overview({ graph, sources, id }: { graph: Graph; sources: Map<string, Source>; id: string }) {
  const all = graph.metrics.filter((m) => m.entity_id === id && m.key !== 'market_cap');
  // Filed first, then the rest; superseded seed rows sink to the bottom but stay visible for provenance.
  const rank = (m: Metric) => (m.superseded_by ? 2 : m.status.startsWith('filed') ? 0 : 1);
  const metrics = [...all].sort((a, b) => rank(a) - rank(b));
  const byId = new Map(graph.metrics.map((m) => [m.id, m]));
  const historyById = new Map(graph.history.map((h) => [h.id, h]));
  const filings = graph.filings.filter((f) => f.entity_id === id).sort((a, b) => b.filed.localeCompare(a.filed));

  return (
    <>
      <Market graph={graph} sources={sources} id={id} />
      {filings.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-1 font-semibold">Latest filings</h3>
          <ul className="flex flex-wrap gap-1">
            {filings.map((f) => (
              <li key={f.accession}>
                <a href={f.url} target="_blank" rel="noopener noreferrer" title={`Accession ${f.accession}`}
                  className="inline-flex rounded border border-slate-300 px-2 py-0.5 text-xs hover:border-teal-600">
                  <strong className="mr-1">{f.form}</strong> {f.report_date ? `period ${f.report_date}` : ''} · filed {f.filed} ↗
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!metrics.length && <p className="text-slate-500">No metrics in the database for this company yet.</p>}
      <ul className="space-y-3">
        {metrics.map((m) => {
          const by = m.superseded_by ? byId.get(m.superseded_by) ?? historyById.get(m.superseded_by) : undefined;
          return (
            <li key={m.id} className={`rounded border p-3 ${m.superseded_by ? 'border-dashed border-slate-300 bg-slate-50 opacity-70' : 'border-slate-200'}`}>
              <span className="font-medium capitalize">{humanise(m.key)}</span>
              <span className="block break-all text-[11px] text-slate-400">[{m.id}]</span>
              <p className={`text-lg font-semibold ${m.superseded_by ? 'line-through decoration-slate-400' : ''}`}>
                {fmtMoney(m.value, m.unit)}
                {m.low !== null && m.high !== null && (
                  <span className="ml-2 text-sm font-normal text-slate-500">range {fmtMoney(m.low, m.unit)}–{fmtMoney(m.high, m.unit)}</span>
                )}
                <span className="ml-2 text-sm font-normal text-slate-500">{m.period}</span>
              </p>
              {by && (
                <p className="text-xs font-medium text-[#1B2A4A]">
                  Superseded by the filed figure {fmtMoney(by.value, by.unit)} for {by.period} [{by.id}]
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <StatusChip value={m.status} /><ConfidenceChip value={m.confidence} />
                <StalenessBadge asOf={m.as_of} inferred={m.as_of_inferred} />
                <SourceChips ids={m.source_ids} sources={sources} />
              </div>
              {m.note && <p className="mt-1 text-xs text-slate-600">{m.note}</p>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** "Where does the money go next?": lights up onward payments; picking one moves there and extends the trail. */
function Rabbit({ graph, id, rabbit, name }: { graph: Graph; id: string; rabbit: RabbitHole; name: (id: string) => string }) {
  if (rabbit.hops === null) {
    return (
      <button type="button" onClick={rabbit.start} className="mt-2 rounded border border-[#C9A227] bg-amber-50 px-2 py-1 text-xs font-medium hover:bg-amber-100">
        Where does the money go next? →
      </button>
    );
  }
  const taken = rabbit.hops.map((h) => graph.relations.find((r) => r.id === h)).filter((r) => r !== undefined);
  return (
    <div className="mt-2 rounded border border-[#C9A227] bg-amber-50/60 p-2 text-xs">
      <div className="flex items-center justify-between">
        <strong>Rabbit hole{taken.length ? `, hop ${taken.length}` : ''}</strong>
        <button type="button" onClick={rabbit.stop} className="underline">Stop</button>
      </div>
      {taken.length > 0 && <p className="mt-1 text-slate-600">{[taken[0]!.from_id, ...taken.map((r) => r.to_id)].map(name).join(' → ')}</p>}
      {rabbit.next.length === 0 ? <p className="mt-1">No onward payments recorded from {name(id)} (with the current filters): the trail ends here.</p> : (
        <ul className="mt-1 space-y-1">
          {rabbit.next.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => rabbit.step(r.id)} className="w-full rounded bg-white px-2 py-1 text-left hover:ring-1 hover:ring-[#C9A227]">
                <span className="mr-1 inline-block h-1 w-3 rounded align-middle" style={{ background: TYPE_COLOUR[r.type] }} />
                → <strong>{name(r.to_id)}</strong> · {humanise(r.type)} · {fmtAmount(r)}
                {taken.some((t) => t.from_id === r.to_id) && <span className="ml-1 rounded bg-amber-200 px-1">loops back</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Market({ graph, sources, id }: { graph: Graph; sources: Map<string, Source>; id: string }) {
  const e = graph.entities.find((x) => x.id === id)!;
  const cap = graph.metrics.find((m) => m.entity_id === id && m.key === 'market_cap');
  const prices = graph.history.filter((h) => h.entity_id === id && h.key === 'price').sort((a, b) => a.end.localeCompare(b.end));
  if (e.private) return <p className="mb-4 text-xs text-slate-500">Private company: no market price or market capitalisation.</p>;
  if (!cap) return (
    <p className="mb-4 text-xs text-slate-500">
      No market data for {e.ticker}. <a href="#/sources" className="underline decoration-dotted">See data sources</a> for why.
    </p>
  );
  const first = prices[0], last = prices.at(-1);
  const change = first && last ? ((last.value - first.value) / first.value) * 100 : null;
  return (
    <section className="mb-4 rounded border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span>
          <span className="block text-xs text-slate-500">Market capitalisation · {e.ticker}</span>
          <strong className="text-lg">{fmtMoney(cap.value, cap.unit)}</strong>
        </span>
        <span className="text-right">
          <Sparkline values={prices.map((p) => p.value)} width={140} height={34} label={`${e.name} share price over the past year`} />
          {change !== null && <span className="block text-xs text-slate-500">1 year {change >= 0 ? '+' : '−'}{Math.abs(change).toFixed(0)}%</span>}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <StalenessBadge asOf={cap.as_of} /><SourceChips ids={cap.source_ids} sources={sources} />
        <span className="text-[11px] text-slate-400">[{cap.id}]</span>
      </div>
    </section>
  );
}

function MoneyTable({ title, rows, other, onPick }: { title: string; rows: Relation[]; other: (r: Relation) => string; onPick: (id: string) => void }) {
  const sorted = [...rows].sort((a, b) => usdSortKey(b) - usdSortKey(a));
  return (
    <section className="mb-5">
      <h3 className="mb-1 font-semibold">{title} <span className="font-normal text-slate-500">({rows.length})</span></h3>
      {sorted.length === 0 ? <p className="text-slate-500">None recorded.</p> : (
        <ul className="divide-y divide-slate-100 rounded border border-slate-200">
          {sorted.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPick(r.id)} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50">
                <span className="mt-1.5 inline-block h-1 w-4 shrink-0 rounded" style={{ background: TYPE_COLOUR[r.type] }} />
                <span className="flex-1">
                  <span className="font-medium">{other(r)}</span> <span className="text-slate-500">{humanise(r.type)}</span>
                  <span className="block text-xs">{fmtAmount(r)}</span>
                </span>
                <ConfidenceChip value={r.confidence} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-slate-500">Sorted by stated USD amount. Bases differ: do not add these up.</p>
    </section>
  );
}

function Concentration({ graph, id, selectNode }: { graph: Graph; id: string; selectNode: (id: string) => void }) {
  const rows = concentration(graph, id);
  if (!rows.length) return <p className="text-slate-500">No revenue or backlog shares in the database for this company.</p>;
  return (
    <>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.factId}>
            <div className="flex items-baseline justify-between gap-2">
              {r.counterpartyId
                ? <button type="button" className="font-medium underline decoration-dotted" onClick={() => selectNode(r.counterpartyId!)}>{r.counterparty}</button>
                : <span className="font-medium">{r.counterparty}</span>}
              <span className="font-semibold">{r.pct}% <span className="font-normal text-slate-500">of {r.of}</span></span>
            </div>
            <div className="mt-1 h-2 rounded bg-slate-100" aria-hidden>
              <div className={`h-2 rounded ${r.proxy ? 'bg-slate-400' : 'bg-[#128C7E]'}`} style={{ width: `${r.pct}%` }} />
            </div>
            <p className="text-xs text-slate-500">{r.proxy ? 'Proxy figure (region or group), not this company alone · ' : ''}{r.confidence} confidence · [{r.factId}]</p>
          </li>
        ))}
      </ul>
      {namedTotals(rows).map((t) => (
        <p key={t.of} className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-900">
          {t.n} named counterparties together: {t.pct}% of {t.of} (same denominator, so the sum is meaningful).
        </p>
      ))}
    </>
  );
}
