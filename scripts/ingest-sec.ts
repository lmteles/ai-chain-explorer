import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { LiveBundle, mergeLive } from '../src/lib/data/live';
import { validateGraph } from '../src/lib/data/schema';
import { companyFactsUrl, CompanyFacts, extractCompany, latestFilings, secGet, submissionsUrl } from './adapters/sec';
import { loadEnv, recordRun } from './runs';

loadEnv();
const ua = process.env.SEC_USER_AGENT ?? '';
if (!/\S+\s+\S+@\S+/.test(ua)) {
  console.error('SEC_USER_AGENT must be "Name email@domain" (SEC fair-access rule). Set it in .env.local.');
  process.exit(1);
}

const OUT = 'public/data/live/sec.json';
const started_at = new Date().toISOString();
const seed = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));
const bundle: LiveBundle = { adapter: 'sec', fetched_at: started_at, metrics: [], sources: [], history: [], filings: [], relation_updates: [], relations: [], amount_updates: [], events: [] };
const errors: string[] = [], notes: string[] = [];
const targets = seed.entities.filter((e) => e.cik);

for (const e of targets) {
  try {
    const x = extractCompany(e, CompanyFacts.parse(await secGet(companyFactsUrl(e.cik!), ua)));
    bundle.metrics.push(...x.metrics);
    bundle.history.push(...x.history);
    bundle.sources.push(...x.sources.filter((s) => !bundle.sources.some((b) => b.id === s.id)));
    notes.push(...x.notes);
  } catch (err) { errors.push(`${e.id} companyfacts: ${(err as Error).message.slice(0, 300)}`); }
  try {
    bundle.filings.push(...latestFilings(e, await secGet(submissionsUrl(e.cik!), ua)));
  } catch (err) { errors.push(`${e.id} submissions: ${(err as Error).message.slice(0, 300)}`); }
}

const failedAll = errors.length >= targets.length * 2;
if (!failedAll) {
  validateGraph(mergeLive(seed, [LiveBundle.parse(bundle)])); // fail loudly before writing anything inconsistent
  mkdirSync('public/data/live', { recursive: true });
  writeFileSync(OUT, JSON.stringify(bundle, null, 1) + '\n');
}
const rows = bundle.metrics.length + bundle.history.length + bundle.filings.length;
recordRun({
  adapter: 'sec', started_at, finished_at: new Date().toISOString(),
  status: failedAll ? 'failed' : errors.length ? 'partial' : 'ok', rows, errors, notes,
});
notes.forEach((n) => console.log(n));
errors.forEach((x) => console.error(`ERROR ${x}`));
console.log(`${failedAll ? 'FAILED: kept previous data' : `wrote ${OUT}`}: ${bundle.metrics.length} metrics, ${bundle.history.length} history points, ${bundle.filings.length} filings`);
process.exit(failedAll ? 1 : 0);
