import { useCallback, useEffect, useState } from 'react';
import { LiveBundle, MacroBundle, mergeLive, Run } from './live';
import { approvedNewsBundle, NewsBundle, NewsProposalFile, type Cluster } from './news';
import { approvedBundle, IrDocument, ProposalFile } from './proposals';
import { Graph, validateGraph, type Graph as G } from './schema';
import { z } from 'zod';

const base = import.meta.env.BASE_URL;
const LIVE = ['sec', 'quotes'];

// Dev servers answer a missing file with index.html, Pages with a 404: both read as "not found".
const getJson = (path: string) =>
  fetch(`${base}${path}`, { cache: 'no-store' }).then((r) =>
    r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : Promise.reject(new Error(r.ok ? 'not found' : `HTTP ${r.status}`)));

export type Review = { docs: IrDocument[]; files: ProposalFile[]; newsFiles: { name: string; file: NewsProposalFile }[]; clusters: Cluster[]; base: G };
export type AppData = {
  graph?: G; macro?: MacroBundle; runs: Run[]; review?: Review; error?: string; warnings: string[]; reload: () => void;
};

/**
 * Seed is required; everything live is optional. A missing or broken file degrades to what remains,
 * and is named in `warnings` rather than blocking the page.
 */
export function useGraphData(): AppData {
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const [state, setState] = useState<Omit<AppData, 'reload'>>({ warnings: [], runs: [] });
  useEffect(() => {
    (async () => {
      const warnings: string[] = [];
      const optional = async <T,>(path: string, parse: (x: unknown) => T): Promise<T | null> => {
        try { return parse(await getJson(path)); }
        catch (e) { warnings.push(`${path.replace('data/', '')}: ${(e as Error).message.split('\n')[0]}`); return null; }
      };
      const seed = Graph.parse(await getJson('data/seed/seed_graph.json'));
      const [bundles, macro, runs] = await Promise.all([
        Promise.all(LIVE.map((n) => optional(`data/live/${n}.json`, (x) => LiveBundle.parse(x)))),
        optional('data/live/macro.json', (x) => MacroBundle.parse(x)),
        optional('data/runs.json', (x) => z.array(Run).parse(x)),
      ]);
      const live = bundles.filter((b): b is LiveBundle => b !== null);
      // Reviewed facts: only approved proposals become facts; the base graph (without them) feeds the review diff.
      const docs = (await optional('data/ir/documents.json', (x) => IrDocument.array().parse(x))) ?? [];
      const index = await optional('data/proposals/index.json', (x) => z.object({ files: z.array(z.string()) }).parse(x));
      const names = index?.files ?? [];
      const files = (await Promise.all(names.filter((f) => !f.startsWith('news-')).map((f) => optional(`data/proposals/${f}`, (x) => ProposalFile.parse(x)))))
        .filter((f): f is ProposalFile => f !== null);
      const newsFiles = (await Promise.all(names.filter((f) => f.startsWith('news-')).map(async (name) => {
        const file = await optional(`data/proposals/${name}`, (x) => NewsProposalFile.parse(x));
        return file && { name, file };
      }))).filter((f): f is { name: string; file: NewsProposalFile } => f !== null);
      const clusters = (await optional('data/news/clusters.json', (x) => NewsBundle.parse(x)))?.clusters ?? [];
      const baseGraph = validateGraph(mergeLive(seed, live));
      const reviewed = approvedBundle(files, docs, seed.relations);
      const newsReviewed = approvedNewsBundle(newsFiles.map((n) => n.file), seed.relations);
      // A deliberately skipped adapter (e.g. no API key) is not a warning.
      const skipped = latestRuns(runs ?? []).filter((r) => r.status === 'skipped').map((r) => `live/${r.adapter}.json`);
      setState({
        graph: validateGraph(mergeLive(seed, [...live, reviewed, newsReviewed])), macro: macro ?? undefined, runs: runs ?? [],
        review: { docs, files, newsFiles, clusters, base: baseGraph },
        warnings: warnings.filter((w) => !skipped.some((f) => w.startsWith(f))),
      });
    })().catch((e: Error) => setState({ error: e.message, warnings: [], runs: [] }));
  }, [version]);
  return { ...state, reload };
}

/** Latest run per adapter, newest first. */
export function latestRuns(runs: Run[]): Run[] {
  const by = new Map<string, Run>();
  for (const r of runs) if (!by.has(r.adapter) || r.started_at > by.get(r.adapter)!.started_at) by.set(r.adapter, r);
  return [...by.values()].sort((a, b) => a.adapter.localeCompare(b.adapter));
}

export const pendingCount = (r?: Review) =>
  r ? [...r.files.flatMap((f) => f.facts), ...r.newsFiles.flatMap((n) => n.file.facts)].filter((p) => p.status === 'pending').length : 0;
