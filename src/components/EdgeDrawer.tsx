import { Fragment, useState } from 'react';
import type { Graph, Source } from '../lib/data/schema';
import { directionSentence, entityName, fmtAmount, humanise } from '../lib/fmt';
import { TYPE_COLOUR } from '../lib/graph/view';
import { ConfidenceChip, SourceChips, StalenessBadge, StatusChip, Tabs } from './ui';

type Props = { graph: Graph; sources: Map<string, Source>; id: string; selectEdge: (id: string) => void; selectNode: (id: string) => void; onAsk: () => void };

export function EdgeDrawer({ graph, sources, id, selectEdge, selectNode, onAsk }: Props) {
  const r = graph.relations.find((x) => x.id === id);
  const [tab, setTab] = useState<'details' | 'events'>('details');
  if (!r) return <p className="p-4 text-sm">Unknown relation “{id}”.</p>;
  const events = graph.events.filter((e) => e.relation_id === id).sort((a, b) => a.date.localeCompare(b.date));
  const name = entityName(graph.entities);
  const related = graph.relations.filter((x) => x.id !== r.id &&
    ((x.from_id === r.from_id && x.to_id === r.to_id) || (x.from_id === r.to_id && x.to_id === r.from_id)));
  const rows: [string, React.ReactNode][] = [
    ['Amount', fmtAmount(r)],
    ['Basis', humanise(r.amount_basis)],
    ['Period', r.period ?? 'not stated'],
    ['As of', <StalenessBadge asOf={r.as_of} inferred={r.as_of_inferred} />],
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 text-sm">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        <span className="mr-1 inline-block h-1 w-4 rounded align-middle" style={{ background: TYPE_COLOUR[r.type] }} />
        {humanise(r.type)} · [{r.id}]
      </p>
      <h2 className="mt-1 text-lg font-semibold">
        <button type="button" className="underline decoration-dotted" onClick={() => selectNode(r.from_id)}>{name(r.from_id)}</button>
        {' → '}
        <button type="button" className="underline decoration-dotted" onClick={() => selectNode(r.to_id)}>{name(r.to_id)}</button>
      </h2>
      <p className="mt-2">{directionSentence(r, name)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1"><StatusChip value={r.status} /><ConfidenceChip value={r.confidence} /><button type="button" onClick={onAsk} className="ml-1 rounded border border-teal-600 bg-teal-50 px-2 py-1 text-xs font-medium text-teal-900 hover:bg-teal-100">Ask about this</button></div>
      <div className="mt-3"><Tabs tabs={[['details', 'Details'], ['events', `Events (${events.length})`]]} value={tab} set={setTab} /></div>
      {tab === 'events' && (events.length === 0
        ? <p className="mt-3 text-slate-500">No approved news events for this relationship yet.</p>
        : (
          <ol className="relative mt-3 space-y-3 border-l-2 border-slate-200 pl-4">
            {events.map((e) => (
              <li key={e.id}>
                <span className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full ${e.type === 'announced' ? 'bg-[#128C7E]' : e.type === 'revised' ? 'bg-[#C9A227]' : 'bg-[#1B2A4A]'}`} />
                <p className="text-xs text-slate-500">{e.date} · <strong className="uppercase">{e.type}</strong> · [{e.id}]</p>
                <p>“{e.headline}”</p>
                <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-xs underline decoration-dotted">{e.publisher} ↗</a>
              </li>
            ))}
          </ol>
        ))}
      {tab === 'details' && (<>

      <dl className="mt-4 grid grid-cols-[6rem_1fr] gap-y-1">
        {rows.map(([k, v]) => <Fragment key={k}><dt className="text-slate-500">{k}</dt><dd>{v}</dd></Fragment>)}
      </dl>

      <h3 className="mt-4 font-semibold">Evidence</h3>
      <ul className="mt-1 space-y-2">
        {r.source_ids.map((sid) => {
          const s = sources.get(sid);
          return s && (
            <li key={sid} className="rounded border border-slate-200 p-2">
              <SourceChips ids={[sid]} sources={sources} />
              <p className="mt-1">{s.title}</p>
              <p className="text-xs text-slate-500">{humanise(s.kind)} · {humanise(s.reliability)} · {s.published ?? 'date not stated'}</p>
            </li>
          );
        })}
      </ul>

      {r.note && (<><h3 className="mt-4 font-semibold">Notes</h3><p className="mt-1">{r.note}</p></>)}

      <h3 className="mt-4 font-semibold">Related edges (same pair)</h3>
      {related.length === 0 ? <p className="text-slate-500">None: money flows one way only between these two.</p> : (
        <ul className="mt-1 space-y-1">
          {related.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => selectEdge(x.id)} className="w-full rounded border border-slate-200 px-2 py-1 text-left hover:bg-slate-50">
                <span className="font-medium">{name(x.from_id)} → {name(x.to_id)}</span> · {humanise(x.type)}
                <span className="block text-xs">{fmtAmount(x)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      </>)}
    </div>
  );
}
