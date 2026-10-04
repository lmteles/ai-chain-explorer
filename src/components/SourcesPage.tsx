import type { Run } from '../lib/data/live';
import { latestRuns } from '../lib/data/useGraphData';

const STATUS: Record<Run['status'], string> = {
  ok: 'bg-teal-100 text-teal-900', partial: 'bg-amber-100 text-amber-900', failed: 'bg-red-100 text-red-800', skipped: 'bg-slate-100 text-slate-600',
};

// Adapters that exist only as licensed stubs; they never scrape.
const LICENSED = [
  { adapter: 'bloomberg', note: 'Bloomberg Data License / BLPAPI. Disabled unless ENABLE_BLOOMBERG and a licence are supplied.' },
  { adapter: 'ft', note: 'Financial Times licensed feed. Disabled unless ENABLE_FT and a licence are supplied.' },
];

export function SourcesPage({ runs, warnings, backHref }: { runs: Run[]; warnings: string[]; backHref: string }) {
  const latest = latestRuns(runs);
  const lastOk = (a: string) => runs.filter((r) => r.adapter === a && r.status === 'ok').map((r) => r.finished_at).sort().at(-1);
  return (
    <div className="mx-auto max-w-5xl overflow-y-auto p-6 text-sm">
      <a href={backHref} className="text-xs underline decoration-dotted">← Back to the graph</a>
      <h2 className="mt-2 text-xl font-semibold">Data sources</h2>
      <p className="text-slate-600">Each adapter runs on a schedule. A failed run keeps the last stored values; the graph never waits on it.</p>
      {warnings.length > 0 && (
        <p role="status" className="mt-3 rounded bg-amber-50 p-2 text-amber-900">Not loaded in this browser: {warnings.join('; ')}</p>
      )}
      <table className="mt-4 w-full border-collapse text-left">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="py-1">Adapter</th><th>Last run</th><th>Status</th><th>Last success</th><th className="text-right">Rows</th><th className="pl-4">Detail</th></tr>
        </thead>
        <tbody>
          {latest.map((r) => (
            <tr key={r.adapter} className="border-t border-slate-200 align-top">
              <td className="py-2 font-medium">{r.adapter}</td>
              <td>{r.finished_at.slice(0, 16).replace('T', ' ')} UTC</td>
              <td><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[r.status]}`}>{r.status}</span></td>
              <td>{lastOk(r.adapter)?.slice(0, 16).replace('T', ' ') ?? 'never'}</td>
              <td className="text-right">{r.rows}</td>
              <td className="pl-4">
                {r.errors.map((e) => <p key={e} className="text-red-700">{e}</p>)}
                <details><summary className="cursor-pointer text-slate-500">{r.notes.length} note(s)</summary>
                  <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                </details>
              </td>
            </tr>
          ))}
          {LICENSED.filter((l) => !latest.some((r) => r.adapter === l.adapter)).map((l) => (
            <tr key={l.adapter} className="border-t border-slate-200">
              <td className="py-2 font-medium">{l.adapter}</td><td colSpan={4}><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">not licensed</span></td>
              <td className="pl-4 text-slate-600">{l.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {latest.length === 0 && <p className="mt-3 text-slate-500">No runs recorded yet.</p>}
    </div>
  );
}
