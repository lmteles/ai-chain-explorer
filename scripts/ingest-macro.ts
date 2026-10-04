import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { LiveBundle, MacroBundle, mergeLive, type MacroItem } from '../src/lib/data/live';
import { validateGraph } from '../src/lib/data/schema';
import { FRED_SOURCE, fetchDgs10 } from './adapters/fred';
import { fetchQuotes, getProvider } from './adapters/quotes';
import { TREASURY_SOURCES, fetchTreasury } from './adapters/treasury';
import { loadEnv, recordRun } from './runs';

loadEnv();
mkdirSync('public/data/live', { recursive: true });
const seed = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));
const now = () => new Date().toISOString();
let failed = 0;

// --- macro: FRED + Treasury. Each source can fail alone; a failed one keeps its last stored items. ---
const MACRO = 'public/data/live/macro.json';
const previous: MacroItem[] = (() => { try { return MacroBundle.parse(JSON.parse(readFileSync(MACRO, 'utf8'))).items; } catch { return []; } })();
const items: MacroItem[] = [];
for (const [adapter, run, ids] of [
  ['fred', async () => [await fetchDgs10()], ['macro_dgs10']],
  ['treasury', fetchTreasury, ['macro_federal_debt', 'macro_interest_public', 'macro_interest_total']],
] as const) {
  const started_at = now();
  try {
    const got = await run();
    items.push(...got);
    recordRun({ adapter, started_at, finished_at: now(), status: 'ok', rows: got.length, errors: [], notes: got.map((i) => `${i.id} = ${i.value} (${i.as_of})`) });
  } catch (err) {
    failed++;
    const kept = previous.filter((i) => (ids as readonly string[]).includes(i.id));
    items.push(...kept);
    recordRun({ adapter, started_at, finished_at: now(), status: 'failed', rows: 0, errors: [(err as Error).message], notes: [`kept ${kept.length} stored item(s)`] });
  }
}
if (items.length) {
  writeFileSync(MACRO, JSON.stringify(MacroBundle.parse({ adapter: 'macro', fetched_at: now(), items, sources: [FRED_SOURCE, ...TREASURY_SOURCES] }), null, 1) + '\n');
}

// --- quotes: skipped (not failed) without a key, so the app simply shows "no market data". ---
const started_at = now();
const key = process.env.QUOTES_API_KEY ?? '';
if (!key) {
  recordRun({ adapter: 'quotes', started_at, finished_at: now(), status: 'skipped', rows: 0, errors: [], notes: ['QUOTES_API_KEY not set'] });
} else {
  try {
    const { bundle, errors, notes } = await fetchQuotes(getProvider(process.env.QUOTES_PROVIDER ?? 'fmp', key), seed.entities);
    const ok = bundle.metrics.length > 0;
    if (ok) {
      validateGraph(mergeLive(seed, [LiveBundle.parse(bundle)]));
      writeFileSync('public/data/live/quotes.json', JSON.stringify(bundle, null, 1) + '\n');
    } else failed++;
    recordRun({ adapter: 'quotes', started_at, finished_at: now(), status: !ok ? 'failed' : errors.length ? 'partial' : 'ok', rows: bundle.metrics.length + bundle.history.length, errors, notes });
  } catch (err) {
    failed++;
    recordRun({ adapter: 'quotes', started_at, finished_at: now(), status: 'failed', rows: 0, errors: [(err as Error).message], notes: [] });
  }
}

console.log(items.map((i) => `${i.id}: ${i.value} ${i.unit} (${i.as_of})`).join('\n'));
console.log(failed ? `${failed} adapter(s) failed; see public/data/runs.json` : 'macro ok');
process.exit(failed ? 1 : 0);
