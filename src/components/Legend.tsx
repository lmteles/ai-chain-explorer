import { useState } from 'react';
import type { Graph } from '../lib/data/schema';
import { NODE_MAX, NODE_MIN, TIER_COLOUR, TIER_LABEL, sizeMetrics, type SizeBy } from '../lib/graph/view';

const fmt = (v: number) => `$${v.toLocaleString('en-GB', { maximumFractionDigits: 1 })}bn`;

export function Legend({ graph, sizeBy }: { graph: Graph; sizeBy: SizeBy }) {
  const [open, setOpen] = useState(true);
  const metrics = [...sizeMetrics(graph, sizeBy).values()];
  const max = Math.max(0, ...metrics.map((m) => m.value));

  return (
    <section aria-label="Legend" className="border-t border-slate-200 pt-3 text-xs">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Legend {open ? '−' : '+'}</button>
      {open && (
        <div className="space-y-2">
          <p className="font-medium text-[#1B2A4A]">Arrows point from payer to payee (investor → investee, buyer → seller).</p>
          <p className="rounded bg-amber-50 p-1.5 text-amber-900">
            Amounts have different bases (committed, up to, invested, annual, share). Never sum them across bases.
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {([1, 2, 3, 4, 5] as const).map((t) => (
              <span key={t} className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: TIER_COLOUR[t] }} />{TIER_LABEL[t]}
              </span>
            ))}
          </div>
          <svg width="230" height="58" aria-label="Line styles" className="text-slate-700">
            <g stroke="currentColor" strokeWidth="2">
              <line x1="0" y1="6" x2="40" y2="6" /><line x1="0" y1="20" x2="40" y2="20" strokeDasharray="6 4" />
              <line x1="0" y1="34" x2="40" y2="34" strokeDasharray="1 4" strokeLinecap="round" />
              <line x1="0" y1="50" x2="40" y2="50" strokeWidth="1" />
              <path d="M40 46 L48 50 L40 54 Z" fill="white" strokeWidth="1" />
            </g>
            <g fontSize="11" fill="currentColor">
              <text x="56" y="10">high confidence</text><text x="56" y="24">medium</text>
              <text x="56" y="38">low or unverified</text><text x="56" y="54">undisclosed amount (hollow arrow)</text>
            </g>
          </svg>
          <p>Width: log of amount. Faded: claimed or unverified; solid colour: filed or reported.</p>
          {sizeBy !== 'none' && (
            <p>
              Node area ∝ {sizeBy === 'capex' ? '2026 capex guidance' : 'twelve-month revenue (filed TTM, else fiscal year)'}: {NODE_MIN}px = none, {NODE_MAX}px = {fmt(max)}.
              {' '}{metrics.length} of {graph.entities.length} have data; the rest are small with a dashed ring.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
