import type { Source } from '../lib/data/schema';
import { humanise, staleness } from '../lib/fmt';

const chip = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap';

const STALE_CLASS = {
  undated: 'bg-slate-100 text-slate-600', fresh: 'bg-emerald-50 text-emerald-800',
  amber: 'bg-amber-100 text-amber-900', red: 'bg-red-100 text-red-800',
};

export function StalenessBadge({ asOf, inferred }: { asOf: string | null; inferred?: boolean }) {
  const s = staleness(asOf);
  const text = s.level === 'undated' ? 'undated' : `${asOf}${inferred ? ' (source date)' : ''} · ${s.days}d`;
  const why = s.level === 'undated' ? 'No date in the source: treat as possibly stale'
    : s.level === 'red' ? 'Older than 180 days' : s.level === 'amber' ? 'Older than 90 days' : 'Within 90 days';
  return <span className={`${chip} ${STALE_CLASS[s.level]}`} title={why}>{text}</span>;
}

const CONF_CLASS: Record<string, string> = {
  high: 'bg-teal-100 text-teal-900', medium: 'bg-amber-50 text-amber-900', low: 'bg-red-50 text-red-800',
};

export const ConfidenceChip = ({ value }: { value: string }) => (
  <span className={`${chip} ${CONF_CLASS[value]}`} title="Confidence">{value} confidence</span>
);

export const StatusChip = ({ value }: { value: string }) => (
  <span className={`${chip} ${value.startsWith('filed') ? 'bg-[#1B2A4A] text-white' : 'bg-slate-100 text-slate-700'}`} title="Status">
    {humanise(value)}
  </span>
);

const RELIABILITY_DOT: Record<Source['reliability'], string> = {
  primary: 'bg-teal-600', secondary: 'bg-sky-500', claim_by_named_person: 'bg-amber-500', weak: 'bg-red-500', unverified: 'bg-slate-400',
};

export function SourceChips({ ids, sources }: { ids: string[]; sources: Map<string, Source> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {ids.map((id) => {
        const s = sources.get(id);
        if (!s) return null;
        const body = (
          <>
            <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${RELIABILITY_DOT[s.reliability]}`} />
            {s.publisher}
          </>
        );
        const title = `${s.title} (${humanise(s.reliability)})`;
        return s.url ? (
          <a key={id} href={s.url} target="_blank" rel="noopener noreferrer" title={title}
            className={`${chip} border border-slate-300 bg-white text-[#1B2A4A] hover:border-teal-600`}>{body} ↗</a>
        ) : (
          <span key={id} title={title} className={`${chip} border border-dashed border-slate-300 text-slate-500`}>{body}</span>
        );
      })}
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, set }: { tabs: [T, string][]; value: T; set: (t: T) => void }) {
  return (
    <div role="tablist" className="flex border-b border-slate-200 text-sm">
      {tabs.map(([t, label]) => (
        <button key={t} role="tab" type="button" aria-selected={value === t} onClick={() => set(t)}
          className={`px-3 py-2 ${value === t ? 'border-b-2 border-[#C9A227] font-semibold text-[#1B2A4A]' : 'text-slate-500 hover:text-[#1B2A4A]'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
