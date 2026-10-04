import Anthropic from '@anthropic-ai/sdk';
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Graph } from '../lib/data/schema';
import { ask, MAX_ROUNDS, MAX_TOKENS, MODEL, type AskResult } from '../lib/llm/ask';
import { cacheKey, caps, dataVersion, getKey, overCap, readCache, recordSpend, saveCaps, setKey, spendToday, writeCache } from '../lib/llm/limits';
import { DISCLOSURE } from '../lib/llm/prompts';

export type AskScope = { kind: 'node' | 'edge'; id: string };
type Cached = Pick<AskResult, 'answer' | 'issues' | 'usage' | 'stopped'> & { at: string };

const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 4 : 3)}`;

function defaultQuestion(g: Graph, s: AskScope): string {
  const name = (id: string) => g.entities.find((e) => e.id === id)?.name ?? id;
  if (s.kind === 'node') return `What does the database show about ${name(s.id)}'s money relationships and concentration risk?`;
  const r = g.relations.find((x) => x.id === s.id);
  return r ? `Explain the ${name(r.from_id)} → ${name(r.to_id)} ${r.type.replaceAll('_', ' ')} and what it means for both sides.` : 'Explain this relationship.';
}

function scopeLine(g: Graph, s: AskScope): string {
  if (s.kind === 'node') return `The user is looking at entity "${s.id}".`;
  const r = g.relations.find((x) => x.id === s.id);
  return `The user is looking at relation "${s.id}"${r ? ` (${r.from_id} → ${r.to_id}, ${r.type})` : ''}.`;
}

/** Light markdown (headings, bullets, paragraphs) with [fact_id] rendered as chips that open the row. */
function Rendered({ text, open, known }: { text: string; open: (id: string) => void; known: (id: string) => boolean }) {
  const inline = (line: string): ReactNode[] => line.split(/(\[[A-Za-z0-9_.>:-]+\])/g).map((part, i) => {
    const m = part.match(/^\[([A-Za-z0-9_.>:-]+)\]$/);
    if (!m) return <Fragment key={i}>{part.replace(/\*\*(.+?)\*\*/g, '$1')}</Fragment>;
    const id = m[1]!;
    return known(id)
      ? <button key={i} type="button" onClick={() => open(id)} className="mx-0.5 rounded-full border border-teal-600 bg-teal-50 px-1.5 text-[11px] text-teal-900 hover:bg-teal-100">{id}</button>
      : <span key={i} className="mx-0.5 rounded-full border border-red-400 bg-red-50 px-1.5 text-[11px] text-red-800" title="Not a fact id in the database">{id}</span>;
  });
  return (
    <div className="space-y-2">
      {text.split(/\n{2,}/).filter((b) => b.trim()).map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim());
        if (/^#{1,4} /.test(lines[0]!)) return <h4 key={i} className="mt-3 font-semibold text-[#1B2A4A]">{inline(lines[0]!.replace(/^#+ /, ''))}{lines.length > 1 && <span className="block font-normal">{inline(lines.slice(1).join(' '))}</span>}</h4>;
        if (lines.every((l) => /^\s*[-*] /.test(l))) return <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*] /, ''))}</li>)}</ul>;
        return <p key={i}>{inline(block.replace(/\n/g, ' '))}</p>;
      })}
    </div>
  );
}

export function AskPanel({ graph, scope, onOpenFact, onClose }: { graph: Graph; scope: AskScope; onOpenFact: (id: string) => void; onClose: () => void }) {
  const [question, setQuestion] = useState(() => defaultQuestion(graph, scope));
  const [key, setKeyState] = useState(getKey);
  const [streamed, setStreamed] = useState('');
  const [result, setResult] = useState<(Cached & { cached: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limits, setLimits] = useState(caps);
  const abort = useRef<AbortController | null>(null);
  const version = useMemo(() => dataVersion(graph), [graph]);
  const scopeText = scopeLine(graph, scope);
  const ck = cacheKey(question, scopeText, version);
  const spend = spendToday();
  const blocked = overCap(spend, limits);
  const known = useMemo(() => {
    const ids = new Set([...graph.entities, ...graph.relations, ...graph.metrics, ...graph.claims, ...graph.sources, ...graph.events, ...graph.history].map((x) => x.id));
    return (id: string) => ids.has(id);
  }, [graph]);

  const run = async (force = false) => {
    setError(null);
    const hit = !force && readCache<Cached>(ck);
    if (hit) { setStreamed(''); setResult({ ...hit, cached: true }); return; }
    if (blocked) { setError(blocked); return; }
    if (!key.startsWith('sk-ant-')) { setError('Paste an Anthropic API key (it starts with sk-ant-).'); return; }
    setKey(key);
    setBusy(true); setResult(null); setStreamed('');
    abort.current = new AbortController();
    try {
      const r = await ask({
        question, scope: scopeText, graph, apiKey: key, signal: abort.current.signal,
        onText: (t) => setStreamed((s) => s + t), onRound: (n) => { if (n > 1) setStreamed(''); },
      });
      recordSpend(r.usage.output_tokens, r.usage.usd);
      const done: Cached = { answer: r.answer, issues: r.issues, usage: r.usage, stopped: r.stopped, at: new Date().toISOString() };
      if (!r.stopped) writeCache(ck, done);
      setResult({ ...done, cached: false });
    } catch (e) {
      setError(
        e instanceof Anthropic.AuthenticationError ? 'The API key was rejected.'
          : e instanceof Anthropic.RateLimitError ? 'Rate limited by the API; try again in a minute.'
          : e instanceof Anthropic.APIUserAbortError ? 'Stopped.'
          : e instanceof Anthropic.APIError ? `API error ${e.status ?? ''}: ${e.message}`
          : (e as Error).message,
      );
    } finally { setBusy(false); }
  };

  const text = result?.answer ?? streamed;
  return (
    <div role="dialog" aria-modal="true" aria-label="Ask about this" className="fixed inset-0 z-30 flex items-start justify-center bg-slate-900/30 p-4"
      onKeyDown={(e) => { if (e.key === 'Escape') { abort.current?.abort(); onClose(); } }}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <h2 className="font-semibold">Ask about this <span className="text-xs font-normal text-slate-500">({MODEL}, grounded in this database only)</span></h2>
          <button type="button" onClick={() => { abort.current?.abort(); onClose(); }} aria-label="Close" className="text-xl text-slate-400 hover:text-slate-700">×</button>
        </header>
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900"><strong>Neutrality notice.</strong> {DISCLOSURE}</p>

        <div className="space-y-3 overflow-y-auto px-4 py-3 text-sm">
          <label className="block">Question
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} className="mt-1 w-full rounded border border-slate-300 p-2" />
          </label>
          <details className="rounded bg-slate-50 p-2 text-xs" open={!key}>
            <summary className="cursor-pointer">API key and spending limits</summary>
            <label className="mt-2 block">Anthropic API key (kept in this tab's session storage only; never saved to the project)
              <input type="password" autoComplete="off" value={key} onChange={(e) => setKeyState(e.target.value.trim())} className="mt-1 w-full rounded border border-slate-300 p-1 font-mono" placeholder="sk-ant-…" />
            </label>
            <div className="mt-2 flex flex-wrap gap-4">
              <label>Answers per day <input type="number" min={0} value={limits.answersPerDay} className="w-16 rounded border border-slate-300 px-1"
                onChange={(e) => { const c = { ...limits, answersPerDay: Number(e.target.value) }; setLimits(c); saveCaps(c); }} /></label>
              <label>Output tokens per day <input type="number" min={0} step={1000} value={limits.outputTokensPerDay} className="w-24 rounded border border-slate-300 px-1"
                onChange={(e) => { const c = { ...limits, outputTokensPerDay: Number(e.target.value) }; setLimits(c); saveCaps(c); }} /></label>
            </div>
            <p className="mt-2 text-slate-600">
              Today: {spend.answers} answer(s), {spend.output_tokens.toLocaleString()} output tokens, about {usd(spend.usd)}. Each answer: at most {MAX_ROUNDS} rounds of {MAX_TOKENS.toLocaleString()} output tokens, low effort, Sonnet only. Repeat questions are answered from the cache at no cost.
            </p>
          </details>
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy || !question.trim()} onClick={() => run()} className="rounded bg-[#1B2A4A] px-3 py-1.5 text-white disabled:opacity-40">{busy ? 'Answering…' : 'Ask'}</button>
            {busy && <button type="button" onClick={() => abort.current?.abort()} className="rounded border border-slate-300 px-3 py-1.5">Stop</button>}
            {blocked && !busy && <span className="text-xs text-red-700">{blocked}</span>}
          </div>
          {error && <p role="alert" className="rounded bg-red-50 p-2 text-red-800">{error}</p>}

          {text && (
            <section aria-live="polite" className="rounded border border-slate-200 p-3">
              <Rendered text={text} open={onOpenFact} known={known} />
            </section>
          )}
          {result && (
            <div className="space-y-1 text-xs">
              {result.stopped === 'refusal' && <p className="rounded bg-slate-100 p-2">The model declined to answer this question.</p>}
              {result.stopped === 'max_rounds' && <p className="rounded bg-amber-50 p-2 text-amber-900">Stopped after {MAX_ROUNDS} tool rounds; the answer may be incomplete.</p>}
              {result.stopped === 'max_tokens' && <p className="rounded bg-amber-50 p-2 text-amber-900">Stopped at the output cap; the answer may be incomplete.</p>}
              {result.issues.length === 0
                ? <p className="text-teal-800">✓ Every number matches a retrieved fact and is cited.</p>
                : (
                  <div className="rounded bg-red-50 p-2 text-red-800">
                    <strong>Grounding check failed ({result.issues.length}).</strong> Treat the flagged figures as unsupported:
                    <ul className="mt-1 list-disc pl-5">{result.issues.map((i, k) => <li key={k}>{i.kind.replaceAll('_', ' ')}: {i.detail}</li>)}</ul>
                  </div>
                )}
              <p className="text-slate-500">
                {result.cached ? <>From the cache ({result.at.slice(0, 16).replace('T', ' ')} UTC), no cost. <button type="button" className="underline" onClick={() => run(true)}>Ask again</button></>
                  : <>{result.usage.rounds} round(s), {result.usage.input_tokens.toLocaleString()} in / {result.usage.output_tokens.toLocaleString()} out tokens, about {usd(result.usage.usd)}.</>}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
