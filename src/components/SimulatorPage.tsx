import { useEffect, useMemo, useState } from 'react';
import type { MacroBundle } from '../lib/data/live';
import type { Graph } from '../lib/data/schema';
import { entityName, fmtMoney, humanise } from '../lib/fmt';
import { exposures } from '../lib/graph/exposure';
import { PRESETS, simulate, type Scenario, type Shock } from '../lib/graph/simulate';

const pct = (f: number, d = 1) => `${(f * 100).toFixed(d)}%`;
const clone = (s: Scenario): Scenario => structuredClone(s);

export function SimulatorPage({ graph, macro, backHref }: { graph: Graph; macro?: MacroBundle; backHref: string }) {
  const initial = new URLSearchParams(location.hash.replace(/^#\/simulate\??/, '')).get('preset') ?? PRESETS[0]!.id;
  const [presetId, setPresetId] = useState(PRESETS.some((p) => p.id === initial) ? initial : PRESETS[0]!.id);
  const [s, setS] = useState<Scenario>(() => clone(PRESETS.find((p) => p.id === presetId)!.scenario));
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { history.replaceState(null, '', `#/simulate?preset=${presetId}`); }, [presetId]);
  const name = entityName(graph.entities);
  const preset = PRESETS.find((p) => p.id === presetId)!;
  const result = useMemo(() => simulate(graph, s), [graph, s]);
  const all = useMemo(() => exposures(graph), [graph]);
  const y10 = macro?.items.find((i) => i.id === 'macro_dgs10');

  const load = (id: string) => { setPresetId(id); setS(clone(PRESETS.find((p) => p.id === id)!.scenario)); };
  const setShock = (i: number, sh: Shock) => setS({ ...s, shocks: s.shocks.map((x, k) => (k === i ? sh : x)) });
  const shareOf = (id: string): number | null => (id in s.overrides ? s.overrides[id] ?? null : all.find((e) => e.id === id)?.share ?? null);
  const setShare = (id: string, v: string) => setS({ ...s, overrides: { ...s.overrides, [id]: v === '' ? null : Math.max(0, Math.min(100, Number(v))) / 100 } });
  const rows = showAll ? all : [...result.used, ...result.notComputable];
  const top = result.impacts.filter((i) => i.amount !== null).slice(0, 10);
  const maxAmt = Math.max(1e-9, ...top.map((i) => i.amount!));

  return (
    <div className="mx-auto max-w-6xl p-6 text-sm">
      <a href={backHref} className="text-xs underline decoration-dotted">← Back to the graph</a>
      <h2 className="mt-2 text-xl font-semibold">Contagion simulator</h2>
      <p role="note" className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 font-medium text-amber-900">
        First-order illustration, not a forecast. Every share and assumption below is shown and editable; estimates are marked.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => load(p.id)} aria-pressed={p.id === presetId}
            className={`rounded border px-3 py-1 ${p.id === presetId ? 'border-[#1B2A4A] bg-[#1B2A4A] text-white' : 'border-slate-300 bg-white hover:bg-slate-50'}`}>{p.title}</button>
        ))}
      </div>
      <p className="mt-2 text-slate-700">{preset.why}</p>
      {presetId === 'yield-5' && y10 && (
        <p className="mt-1 text-xs">Condition today: the 10-year yield is <strong>{y10.value.toFixed(2)}%</strong> ({y10.as_of}) [{y10.id}], {y10.value > 5 ? 'above' : 'below'} 5%.</p>
      )}

      <section className="mt-4 grid gap-4 rounded border border-slate-200 bg-white p-3 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="font-semibold">Shocks <span className="font-normal text-slate-500">({s.mode === 'supply' ? 'supply: runs upstream to buyers' : 'demand: runs downstream to payees'})</span></h3>
          {s.shocks.map((sh, i) => (
            <div key={i} className="rounded bg-slate-50 p-2">
              <div className="flex flex-wrap items-center gap-2">
                {sh.kind === 'node' && (
                  <select value={sh.id} onChange={(e) => setShock(i, { ...sh, id: e.target.value })} className="rounded border border-slate-300 px-1">
                    {graph.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                )}
                {sh.kind === 'edge' && (
                  <select value={sh.id} onChange={(e) => setShock(i, { ...sh, id: e.target.value })} className="max-w-xs rounded border border-slate-300 px-1">
                    {all.map((e) => <option key={e.id} value={e.id}>{name(e.payer)} → {name(e.payee)} [{e.id}]</option>)}
                  </select>
                )}
                {sh.kind === 'direct' && (
                  <>
                    <span>{sh.label}: share of {name(sh.entity)} revenue</span>
                    <input type="number" min={0} max={100} step={0.5} value={+(sh.share * 100).toFixed(2)} className="w-16 rounded border border-slate-300 px-1"
                      onChange={(e) => setShock(i, { ...sh, share: Number(e.target.value) / 100 })} />%
                  </>
                )}
                <label className="flex items-center gap-1">cut by
                  <input type="range" min={0} max={100} step={5} value={sh.pct} onChange={(e) => setShock(i, { ...sh, pct: Number(e.target.value) })} />
                  <strong className="w-10">{sh.pct}%</strong>
                </label>
                <button type="button" className="text-xs text-slate-500 underline" onClick={() => setS({ ...s, shocks: s.shocks.filter((_, k) => k !== i) })}>remove</button>
              </div>
            </div>
          ))}
          {s.mode === 'demand' && (
            <div className="flex gap-2 text-xs">
              <button type="button" className="underline" onClick={() => setS({ ...s, shocks: [...s.shocks, { kind: 'node', id: 'openai', pct: 20 }] })}>+ company cuts spending</button>
              <button type="button" className="underline" onClick={() => setS({ ...s, shocks: [...s.shocks, { kind: 'edge', id: all[0]!.id, pct: 50 }] })}>+ one relationship cut</button>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold">Assumptions</h3>
          <label className="flex items-center gap-2">Second-order damping
            <input type="range" min={0} max={0.9} step={0.1} value={s.damping} onChange={(e) => setS({ ...s, damping: Number(e.target.value) })} />
            <strong>{s.damping.toFixed(1)}</strong>
          </label>
          <p className="text-xs text-slate-500">0 = direct effects only. Otherwise each company passes this fraction of its revenue loss on as a spending cut to lower tiers.</p>
          <label className="flex items-center gap-2">Horizon
            <select value={s.horizonYears} onChange={(e) => setS({ ...s, horizonYears: Number(e.target.value) })} className="rounded border border-slate-300 px-1">
              {[1, 3, 5].map((y) => <option key={y} value={y}>{y} year{y > 1 ? 's' : ''}</option>)}
            </select>
          </label>
          <p className="text-xs text-slate-500">Yearly losses are multiplied by the horizon with no growth or recovery; a backlog is a stock and is not.</p>
          {s.mode === 'supply' && (
            <div className="text-xs">
              <p>Share of each buyer's output that depends on the shocked supplier (no second source = 100%):</p>
              {Object.entries(s.dependence ?? {}).map(([id, v]) => (
                <label key={id} className="mr-3 inline-flex items-center gap-1">{name(id)}
                  <input type="number" min={0} max={100} value={Math.round(v * 100)} className="w-14 rounded border border-slate-300 px-1"
                    onChange={(e) => setS({ ...s, dependence: { ...s.dependence, [id]: Number(e.target.value) / 100 } })} />%
                </label>
              ))}
            </div>
          )}
        </div>
      </section>

      <h3 className="mt-6 font-semibold">Who moves most</h3>
      {result.impacts.length === 0 ? <p className="text-slate-500">No computable impact. Enter shares for the edges listed under assumptions to include them.</p> : (
        <>
          <svg viewBox={`0 0 760 ${top.length * 26 + 6}`} className="mt-2 w-full max-w-3xl" role="img" aria-label="Bar chart of the largest losses per year">
            {top.map((i, k) => (
              <g key={`${i.entity}${i.denominator}`} transform={`translate(0 ${k * 26 + 3})`}>
                <text x={150} y={15} textAnchor="end" fontSize={12} fill="#1B2A4A">{name(i.entity)}{i.denominator === 'backlog' ? ' (backlog)' : ''}</text>
                <rect x={158} y={3} height={16} width={Math.max(2, (i.amount! / maxAmt) * 440)} fill={i.denominator === 'backlog' ? '#C9A227' : '#128C7E'} opacity={i.estimate ? 0.6 : 1} />
                <text x={164 + Math.max(2, (i.amount! / maxAmt) * 440)} y={15} fontSize={11} fill="#475569">{fmtMoney(i.amount!, i.base!.unit)} · {pct(i.fraction)}</text>
              </g>
            ))}
          </svg>
          <p className="text-xs text-slate-500">Per year (backlog: one-off). Faded bars rest on at least one estimated share. Backlog and revenue are different measures and are never added.</p>
          <table className="mt-3 w-full text-left text-xs">
            <thead className="uppercase tracking-wide text-slate-500"><tr><th className="py-1">Company</th><th>Share lost</th><th>Amount</th><th>Over {s.horizonYears}y</th><th>Of</th><th>Main path</th></tr></thead>
            <tbody>
              {result.impacts.map((i) => (
                <tr key={`${i.entity}${i.denominator}`} className="border-t border-slate-100 align-top">
                  <td className="py-1 font-medium">{name(i.entity)}{i.estimate && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-900">estimate</span>}</td>
                  <td>{pct(i.fraction, 2)}</td>
                  <td>{i.amount !== null ? <>{fmtMoney(i.amount, i.base!.unit)}{i.denominator === 'backlog' && <span className="text-slate-500"> once (stock)</span>}</> : <span className="text-slate-400">no base</span>}</td>
                  <td>{i.overHorizon !== null ? fmtMoney(i.overHorizon, i.base!.unit) : '—'}</td>
                  <td>{i.base ? <>{i.denominator}: {fmtMoney(i.base.value, i.base.unit)} ({i.base.label}) [{i.base.factId}]</> : `no ${i.denominator} figure in the database`}</td>
                  <td>{i.pathNodes.map((n) => graph.entities.some((e) => e.id === n) ? name(n) : n).join(' → ')} {i.path.length > 0 && <span className="text-slate-400">[{i.path.join(', ')}]</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="mt-6 flex items-baseline justify-between">
        <h3 className="font-semibold">Exposure shares {showAll ? '(all revenue-type edges)' : '(edges this scenario touches)'}</h3>
        <button type="button" className="text-xs underline" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show only touched' : 'Show all'}</button>
      </div>
      <p className="text-xs text-slate-500">Share = how much of the payee's revenue (or backlog) comes from the payer. Type a share to override it, or to include an edge the data cannot compute.</p>
      <table className="mt-2 w-full text-left text-xs">
        <thead className="uppercase tracking-wide text-slate-500"><tr><th className="py-1">Payer → payee</th><th>Share</th><th>How</th><th>Basis</th></tr></thead>
        <tbody>
          {rows.map((e) => {
            const v = shareOf(e.id);
            return (
              <tr key={e.id} className="border-t border-slate-100 align-top">
                <td className="py-1">{name(e.payer)} → {name(e.payee)} <span className="text-slate-400">[{e.id}]</span></td>
                <td>
                  <input type="number" min={0} max={100} step={0.1} aria-label={`Share for ${e.id}`} placeholder="n/a"
                    value={v === null ? '' : +(v * 100).toFixed(2)} onChange={(ev) => setShare(e.id, ev.target.value)}
                    className={`w-16 rounded border px-1 ${e.id in s.overrides ? 'border-[#C9A227] bg-amber-50' : 'border-slate-300'}`} />%
                </td>
                <td>{e.id in s.overrides ? 'set by you' : humanise(e.method)}{e.estimate && !(e.id in s.overrides) && e.share !== null && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-900">estimate</span>}</td>
                <td className="text-slate-500">{e.denominator}{e.note ? `: ${e.note}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
