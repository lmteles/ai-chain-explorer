import { useState } from 'react';
import type { Entity } from '../lib/data/schema';
import type { Cycle } from '../lib/graph/cycles';

type Props = { cycles: Cycle[]; entities: Entity[]; selected: string | null; select: (id: string | null) => void };

/** Loops where money comes back as equity. Selecting one isolates it on the canvas. */
export function LoopsPanel({ cycles, entities, selected, select }: Props) {
  const [open, setOpen] = useState(!!selected);
  const name = (id: string) => entities.find((e) => e.id === id)?.name ?? id;
  const computable = cycles.filter((c) => c.roundTrip.ratio !== null).length;
  return (
    <section aria-label="Money loops" className="absolute right-3 top-3 z-10 w-80 max-w-[60%] rounded-lg border border-slate-200 bg-white/95 text-xs shadow-sm">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-2 font-semibold">
        <span>Loops: {cycles.length} found, {computable} with a ratio</span><span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="max-h-[50vh] overflow-y-auto border-t border-slate-200 px-3 py-2">
          <p className="mb-2 text-slate-600">Round trip = equity coming back ÷ dollars committed or spent going round. Equity, compute commitments and chip purchases only.</p>
          {selected && <button type="button" onClick={() => select(null)} className="mb-2 underline">Clear highlight</button>}
          <ul className="space-y-1">
            {cycles.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => select(c.id)} aria-pressed={selected === c.id}
                  className={`w-full rounded px-2 py-1 text-left hover:bg-slate-100 ${selected === c.id ? 'bg-amber-50 ring-1 ring-[#C9A227]' : ''}`}>
                  <span className="font-medium">{[...c.nodes, c.nodes[0]!].map(name).join(' → ')}</span>
                  <span className="block">
                    {c.roundTrip.ratio !== null
                      ? <><strong>{(c.roundTrip.ratio * 100).toFixed(0)}% round trip</strong> (${c.roundTrip.returning}bn back of ${c.roundTrip.outgoing}bn)</>
                      : <span className="text-slate-500">not computable</span>}
                  </span>
                  {c.roundTrip.reasons.length > 0 && <span className="block text-[11px] text-slate-500">{c.roundTrip.reasons.join('; ')}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
