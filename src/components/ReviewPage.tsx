import { useState } from 'react';
import type { Proposal } from '../lib/data/proposals';
import type { NewsProposal } from '../lib/data/news';
import { pendingCount, type Review } from '../lib/data/useGraphData';
import { entityName, fmtMoney, humanise } from '../lib/fmt';

const STATUS = { pending: 'bg-amber-100 text-amber-900', approved: 'bg-teal-100 text-teal-900', rejected: 'bg-slate-200 text-slate-600 line-through' };
const canWrite = import.meta.env.DEV; // the review endpoint exists only on the local dev server

const show = (v: number | null | undefined, unit: string) => (v === null || v === undefined ? '—' : unit === 'units' ? `${v} units` : fmtMoney(v, unit));

export function ReviewPage({ review, reload, backHref }: { review?: Review; reload: () => void; backHref: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  if (!review) return <p className="p-6 text-sm">Loading…</p>;
  const { docs, files, base } = review;
  const name = entityName(base.entities);
  const pending = pendingCount(review);

  // What the database holds today without any reviewed facts: the diff a reviewer needs.
  const current = (p: Proposal) => {
    if (p.kind === 'relation_share') {
      const r = base.relations.find((x) => x.id === p.relation_id);
      return r ? { text: `${r.share_pct ?? '—'}% · ${humanise(r.status)} · ${r.confidence}`, value: r.share_pct } : { text: 'missing edge', value: null };
    }
    const m = base.metrics.filter((x) => x.entity_id === p.entity_id && x.key === p.key && !x.superseded_by).sort((a, b) => (b.as_of ?? '').localeCompare(a.as_of ?? ''))[0];
    return m ? { text: `${show(m.value, m.unit)} · ${m.period} · ${humanise(m.status)} [${m.id}]`, value: m.value } : { text: 'nothing yet', value: null };
  };

  const act = async (file: string, id: string, action: 'approve' | 'reject' | 'reset', value?: number) => {
    setBusy(id); setError(null);
    try {
      const r = await fetch('/__review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file, id, action, value }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      reload();
    } catch (e) { setError(`${id}: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };

  return (
    <div className="mx-auto max-w-6xl p-6 text-sm">
      <a href={backHref} className="text-xs underline decoration-dotted">← Back to the graph</a>
      <h2 className="mt-2 text-xl font-semibold">Review queue <span className="text-base font-normal text-slate-500">({pending} pending)</span></h2>
      <p className="max-w-3xl text-slate-600">
        Figures extracted from investor documents. Nothing here is a fact until approved. Text snippets were checked
        verbatim against the document; slide figures were read from an image, so open the slide before approving.
      </p>
      {!canWrite && (
        <p className="mt-2 rounded bg-slate-100 p-2 text-slate-700">Read-only here. Review runs locally (<code>pnpm dev</code>) or by pull request.</p>
      )}
      {error && <p role="alert" className="mt-2 rounded bg-red-50 p-2 text-red-800">{error}</p>}
      {files.length === 0 && <p className="mt-4 text-slate-500">No proposals.</p>}

      {files.map((f) => {
        const doc = docs.find((d) => d.id === f.document_id);
        return (
          <section key={f.document_id} className="mt-6">
            <h3 className="font-semibold">{doc?.title ?? f.document_id}</h3>
            <p className="text-xs text-slate-500">
              {doc && <><a className="underline decoration-dotted" href={doc.index_url} target="_blank" rel="noopener noreferrer">{doc.form} filed {doc.filed} ↗</a>
                {' · '}{doc.files.map((x) => `${x.name} sha256 ${x.sha256.slice(0, 12)}…`).join(' · ')} · </>}
              extracted by {f.extracted_by}
            </p>
            <ul className="mt-2 space-y-2">
              {f.facts.map((p) => {
                const cur = current(p);
                const slide = doc?.pages.find((x) => x.page === p.page);
                const target = p.kind === 'metric' ? `${name(p.entity_id)} · ${humanise(p.key!)}`
                  : (() => { const r = base.relations.find((x) => x.id === p.relation_id); return r ? `${name(r.from_id)} → ${name(r.to_id)} share [${r.id}]` : p.relation_id; })();
                const editing = edit[p.id] !== undefined;
                return (
                  <li key={p.id} className="rounded border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[p.status]}`}>{p.status}</span>
                      <strong>{target}</strong>
                      <span className="text-xs text-slate-400">[{p.id}]</span>
                    </div>
                    <div className="mt-1 grid gap-x-6 sm:grid-cols-2">
                      <p>Proposed: <strong>{show(p.reviewed_value ?? p.value, p.unit)}</strong>
                        {p.low !== null && p.high !== null && <> (range {show(p.low, p.unit)}–{show(p.high, p.unit)})</>} · {p.period}
                        {p.counterparty_label && <> · filed as “{p.counterparty_label}”</>}
                        {p.reviewed_value !== undefined && <span className="text-amber-800"> (edited from {p.value})</span>}
                      </p>
                      <p className="text-slate-600">Current: {cur.text}
                        {cur.value !== null && cur.value !== p.value && <span className="ml-1 font-semibold text-amber-800">Δ {(p.value - (cur.value as number)).toLocaleString('en-GB', { maximumFractionDigits: 3 })}</span>}
                      </p>
                    </div>
                    <blockquote className="mt-2 border-l-4 border-[#C9A227] bg-amber-50/40 px-3 py-1 italic">“{p.snippet}”</blockquote>
                    <p className="mt-1 text-xs text-slate-600">
                      {p.locator}{' · '}
                      {p.evidence === 'text' ? <span className="text-teal-800">snippet found verbatim in the document</span>
                        : slide ? <a className="font-semibold text-amber-800 underline" href={slide.url} target="_blank" rel="noopener noreferrer">read from slide {p.page}: check it ↗</a>
                        : <span>slide {p.page}</span>}
                    </p>
                    {p.note && <p className="mt-1 text-xs text-slate-600">{p.note}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {editing && (
                        <label className="text-xs">Value <input type="number" step="any" autoFocus value={edit[p.id]} className="w-28 rounded border border-slate-300 px-1"
                          onChange={(e) => setEdit({ ...edit, [p.id]: e.target.value })} /></label>
                      )}
                      <button type="button" disabled={!canWrite || busy === p.id}
                        onClick={() => { const v = editing ? Number(edit[p.id]) : undefined; act(`${f.document_id}.json`, p.id, 'approve', v); setEdit(({ [p.id]: _, ...rest }) => rest); }}
                        className="rounded bg-[#1B2A4A] px-3 py-1 text-white disabled:opacity-40">{editing ? 'Approve edited value' : 'Approve'}</button>
                      <button type="button" disabled={!canWrite || busy === p.id} onClick={() => act(`${f.document_id}.json`, p.id, 'reject')}
                        className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40">Reject</button>
                      <button type="button" disabled={!canWrite || busy === p.id}
                        onClick={() => setEdit(editing ? (({ [p.id]: _, ...rest }) => rest)(edit) : { ...edit, [p.id]: String(p.reviewed_value ?? p.value) })}
                        className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40">{editing ? 'Cancel edit' : 'Edit'}</button>
                      {p.status !== 'pending' && (
                        <button type="button" disabled={!canWrite || busy === p.id} onClick={() => act(`${f.document_id}.json`, p.id, 'reset')}
                          className="text-xs text-slate-500 underline disabled:opacity-40">Undo</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <NewsSection review={review} name={name} busy={busy} edit={edit} setEdit={setEdit} act={act} />
    </div>
  );
}

type NewsProps = {
  review: Review; name: (id: string) => string; busy: string | null;
  edit: Record<string, string>; setEdit: (e: Record<string, string>) => void;
  act: (file: string, id: string, action: 'approve' | 'reject' | 'reset', value?: number) => void;
};

function describe(p: NewsProposal, review: Review, name: (id: string) => string): string {
  const rel = (id?: string) => { const r = review.base.relations.find((x) => x.id === id); return r ? `${name(r.from_id)} → ${name(r.to_id)} (${humanise(r.type)}) [${r.id}]` : id ?? '?'; };
  if (p.kind === 'new_relation') {
    const q = p.proposed!;
    const amt = q.amount === null ? 'amount undisclosed' : `${show(p.reviewed_value ?? q.amount, q.unit)} ${humanise(q.amount_basis)}`;
    return `New edge: ${name(q.from_id)} → ${name(q.to_id)} · ${humanise(q.type)} · ${amt}`;
  }
  if (p.kind === 'amount_change') {
    const r = review.base.relations.find((x) => x.id === p.relation_id);
    return `Revise amount on ${rel(p.relation_id)}: ${r?.amount === null || r === undefined ? 'undisclosed' : show(r.amount, r.unit)} → ${show(p.reviewed_value ?? p.amount, r?.unit ?? 'USD_bn')} ${humanise(p.amount_basis!)}`;
  }
  return `Event (${p.event_type}) on ${rel(p.relation_id)}`;
}

function NewsSection({ review, name, busy, edit, setEdit, act }: NewsProps) {
  const untriaged = review.clusters.filter((c) => !c.triage);
  return (
    <section className="mt-8">
      <h3 className="text-lg font-semibold">From the news</h3>
      <p className="text-slate-600">
        Edits proposed from headlines. Evidence is the headline exactly as published. Approved news can add an edge or revise an
        amount, but only ever as "reported": a headline is a lead, not a filing.
      </p>
      {untriaged.length > 0 && (
        <details className="mt-2 rounded bg-slate-50 p-2">
          <summary className="cursor-pointer">{untriaged.length} stor{untriaged.length === 1 ? 'y' : 'ies'} awaiting triage (ask Claude to triage the news)</summary>
          <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
            {untriaged.slice(0, 25).map((c) => <li key={c.id}>[{c.entity_ids.join(', ')}] {c.headlines[0]!.title} ×{c.headlines.length}</li>)}
          </ul>
        </details>
      )}
      {review.newsFiles.length === 0 && <p className="mt-2 text-slate-500">No news proposals.</p>}
      {review.newsFiles.map(({ name: file, file: nf }) => (
        <ul key={file} className="mt-3 space-y-2">
          {nf.facts.map((p) => {
            const story = review.clusters.find((c) => c.id === p.cluster_id);
            const amount = p.kind === 'new_relation' ? p.proposed!.amount : p.kind === 'amount_change' ? p.amount! : null;
            const editing = edit[p.id] !== undefined;
            return (
              <li key={p.id} className="rounded border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[p.status]}`}>{p.status}</span>
                  <strong>{describe(p, review, name)}</strong>
                  <span className="text-xs text-slate-400">[{p.id}]</span>
                </div>
                <blockquote className="mt-2 border-l-4 border-[#128C7E] bg-teal-50/40 px-3 py-1 italic">
                  “{p.headline}” <a href={p.url} target="_blank" rel="noopener noreferrer" className="not-italic underline">{p.publisher}, {p.date.slice(0, 10)} ↗</a>
                </blockquote>
                {story && story.headlines.length > 1 && <p className="mt-1 text-xs text-slate-500">{story.headlines.length} headlines in this story; check another outlet before approving.</p>}
                {p.note && <p className="mt-1 text-xs text-slate-600">{p.note}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {editing && (
                    <label className="text-xs">Amount <input type="number" step="any" autoFocus value={edit[p.id]} className="w-28 rounded border border-slate-300 px-1"
                      onChange={(e) => setEdit({ ...edit, [p.id]: e.target.value })} /></label>
                  )}
                  <button type="button" disabled={!canWrite || busy === p.id} onClick={() => act(file, p.id, 'approve', editing ? Number(edit[p.id]) : undefined)}
                    className="rounded bg-[#1B2A4A] px-3 py-1 text-white disabled:opacity-40">{editing ? 'Approve edited amount' : 'Approve'}</button>
                  <button type="button" disabled={!canWrite || busy === p.id} onClick={() => act(file, p.id, 'reject')}
                    className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40">Reject</button>
                  {amount !== null && (
                    <button type="button" disabled={!canWrite || busy === p.id}
                      onClick={() => setEdit(editing ? (({ [p.id]: _, ...rest }) => rest)(edit) : { ...edit, [p.id]: String(p.reviewed_value ?? amount) })}
                      className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40">{editing ? 'Cancel edit' : 'Edit'}</button>
                  )}
                  {p.status !== 'pending' && (
                    <button type="button" disabled={!canWrite || busy === p.id} onClick={() => act(file, p.id, 'reset')}
                      className="text-xs text-slate-500 underline disabled:opacity-40">Undo</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ))}
    </section>
  );
}
