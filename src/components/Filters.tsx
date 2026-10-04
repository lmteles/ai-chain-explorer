import {
  CONFIDENCES, MIN_USD_STOPS, RELATION_TYPES, STATUSES, TYPE_COLOUR,
  type Filters as F, type LayoutMode, type SizeBy,
} from '../lib/graph/view';

type Props = {
  children?: React.ReactNode;
  filters: F; setFilters: (f: F) => void;
  sizeBy: SizeBy; setSizeBy: (s: SizeBy) => void;
  layout: LayoutMode; setLayout: (l: LayoutMode) => void;
};

const label = (s: string) => s.replaceAll('_', ' ');
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function CheckGroup<T extends string>({ title, all, on, set, swatch }: {
  title: string; all: T[]; on: T[]; set: (v: T[]) => void; swatch?: Record<T, string>;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</legend>
      {all.map((v) => (
        <label key={v} className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="accent-teal-700" checked={on.includes(v)} onChange={() => set(toggle(on, v))} />
          {swatch && <span className="inline-block h-1 w-4 rounded" style={{ background: swatch[v] }} />}
          {label(v)}
        </label>
      ))}
    </fieldset>
  );
}

function Segmented<T extends string>({ title, options, value, set }: { title: string; options: [T, string][]; value: T; set: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</legend>
      <div className="flex overflow-hidden rounded border border-slate-300 text-sm">
        {options.map(([v, text]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => set(v)}
            className={`flex-1 px-2 py-1 ${value === v ? 'bg-[#1B2A4A] text-white' : 'bg-white hover:bg-slate-100'}`}>
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Filters({ children, filters, setFilters, sizeBy, setSizeBy, layout, setLayout }: Props) {
  const stop = MIN_USD_STOPS.indexOf(filters.minUsd);
  return (
    <aside id="filters" className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r border-slate-200 bg-white p-4" aria-label="Filters">
      <Segmented title="Layout" value={layout} set={setLayout} options={[['tiers', 'Tiers'], ['force', 'Force']]} />
      <Segmented title="Node size" value={sizeBy} set={setSizeBy}
        options={[['capex', 'Capex'], ['revenue', 'Revenue'], ['none', 'None']]} />
      <CheckGroup title="Relation type" all={RELATION_TYPES} on={filters.types} swatch={TYPE_COLOUR}
        set={(types) => setFilters({ ...filters, types })} />
      <fieldset>
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Minimum amount</legend>
        <input type="range" min={0} max={MIN_USD_STOPS.length - 1} step={1} value={stop} className="w-full accent-[#C9A227]"
          aria-valuetext={`$${filters.minUsd}bn`}
          onChange={(e) => setFilters({ ...filters, minUsd: MIN_USD_STOPS[Number(e.target.value)]! })} />
        <p className="text-sm">≥ ${filters.minUsd}bn</p>
        <p className="text-xs text-slate-500">Undisclosed and non-USD amounts are never hidden by this slider.</p>
      </fieldset>
      <CheckGroup title="Confidence" all={CONFIDENCES} on={filters.confidence} set={(confidence) => setFilters({ ...filters, confidence })} />
      <CheckGroup title="Status" all={STATUSES} on={filters.status} set={(status) => setFilters({ ...filters, status })} />
      {children}
    </aside>
  );
}
