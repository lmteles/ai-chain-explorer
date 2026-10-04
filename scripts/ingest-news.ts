import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NewsBundle, type Cluster, type Headline } from '../src/lib/data/news';
import { validateGraph } from '../src/lib/data/schema';
import { bloomberg } from './adapters/bloomberg';
import { ft } from './adapters/ft';
import { gdelt } from './adapters/gdelt';
import { clusterHeadlines, connectedPairs, LicenceRequiredError, type NewsSource } from './adapters/news';
import { rss } from './adapters/rss';
import { loadEnv, recordRun } from './runs';

// Discovery only: headlines are clustered into stories for triage. Turning a story into a proposed edit happens
// on request in a Claude Code session (no API spend) and always goes through the review queue.
loadEnv();
const OUT = 'public/data/news/clusters.json';
const days = Number(process.env.NEWS_TIMESPAN_DAYS ?? 1);
const seed = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));
const pairs = connectedPairs(seed.relations);
const now = () => new Date().toISOString();
const headlines: Headline[] = [];
let failed = 0;

for (const src of [gdelt, rss, bloomberg, ft] as NewsSource[]) {
  const started_at = now();
  if (!src.enabled()) {
    recordRun({ adapter: src.name, started_at, finished_at: now(), status: 'skipped', rows: 0, errors: [], notes: ['not licensed: disabled stub, no scraping'] });
    continue;
  }
  const errors: string[] = [];
  let got: Headline[] = [];
  try {
    got = await src.fetch(pairs, days);
  } catch (e) { errors.push(`${e instanceof LicenceRequiredError ? '' : '…'}${(e as Error).message.slice(-160)}`); got = []; }
  headlines.push(...got);
  const status = got.length === 0 && errors.length ? 'failed' : errors.length ? 'partial' : 'ok';
  if (status === 'failed') failed++;
  recordRun({ adapter: src.name, started_at, finished_at: now(), status, rows: got.length, errors, notes: [`${got.length} headline(s) over ${days} day(s)`] });
}

const previous: Cluster[] = existsSync(OUT) ? NewsBundle.parse(JSON.parse(readFileSync(OUT, 'utf8'))).clusters : [];
const clusters = clusterHeadlines(previous, headlines);
mkdirSync('public/data/news', { recursive: true });
writeFileSync(OUT, JSON.stringify(NewsBundle.parse({ adapter: 'news', updated_at: now(), clusters }), null, 1) + '\n');
const open = clusters.filter((c) => !c.triage);
console.log(`${headlines.length} headlines → ${clusters.length} stories (${open.length} untriaged)`);
for (const c of open.slice(0, 40)) console.log(`${c.id} [${c.entity_ids.join(',')}] ×${c.headlines.length}  ${c.headlines[0]!.title}`);
process.exit(failed ? 1 : 0);
