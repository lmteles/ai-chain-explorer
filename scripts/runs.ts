import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { Run } from '../src/lib/data/live';
import { redact } from './adapters/http';

const FILE = 'public/data/runs.json';
const KEEP_PER_ADAPTER = 30; // hourly macro runs must not crowd out the daily ones

/** adapter_runs: append-only log the /sources page and the CI failure check read. */
export function recordRun(run: Run): void {
  const runs: Run[] = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
  const clean = { ...run, errors: run.errors.map(redact), notes: run.notes.map(redact) }; // runs.json is published
  const all = [...runs, clean];
  const kept = all.filter((r) => all.filter((x) => x.adapter === r.adapter && x.started_at > r.started_at).length < KEEP_PER_ADAPTER);
  writeFileSync(FILE, JSON.stringify(kept, null, 2) + '\n');
}

export function loadEnv(): void {
  try { process.loadEnvFile('.env.local'); } catch { /* CI passes env directly */ }
}

/** Adapters whose last two runs both failed: these open an issue in CI. */
export function failingTwice(runs: Run[]): { adapter: string; errors: string[] }[] {
  const by = new Map<string, Run[]>();
  for (const r of runs) by.set(r.adapter, [...(by.get(r.adapter) ?? []), r]);
  return [...by].flatMap(([adapter, rs]) => {
    const last = rs.sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 2);
    return last.length === 2 && last.every((r) => r.status === 'failed') ? [{ adapter, errors: last[0]!.errors }] : [];
  });
}
