import { mkdirSync, writeFileSync } from 'node:fs';
import { IrDocument } from '../src/lib/data/proposals';
import { fetchDocument, SPECS } from './adapters/ir';
import { loadEnv, recordRun } from './runs';

// Downloads the latest TSMC and ASML results packs and TSMC's 20-F, pins their hashes in a manifest and keeps the
// plain text locally for snippet checks. Extraction is done on request in a Claude Code session (no API spend),
// which writes public/data/proposals/<document>.json for human review. Nothing here writes facts.
loadEnv();
const ua = process.env.SEC_USER_AGENT ?? '';
if (!/\S+\s+\S+@\S+/.test(ua)) { console.error('SEC_USER_AGENT must be "Name email@domain".'); process.exit(1); }

const started_at = new Date().toISOString();
const docs: IrDocument[] = [];
const errors: string[] = [];
mkdirSync('.cache/ir', { recursive: true });
mkdirSync('public/data/ir', { recursive: true });
for (const spec of SPECS) {
  try {
    const { doc, text } = await fetchDocument(spec, ua);
    docs.push(IrDocument.parse(doc));
    writeFileSync(`.cache/ir/${doc.id}.txt`, text);
    console.log(`${doc.id}: ${doc.files.length} file(s), ${doc.pages.length} slide(s), ${text.length} chars`);
  } catch (e) { errors.push((e as Error).message); }
}
if (docs.length) writeFileSync('public/data/ir/documents.json', JSON.stringify(docs, null, 1) + '\n');
recordRun({ adapter: 'ir', started_at, finished_at: new Date().toISOString(), status: !docs.length ? 'failed' : errors.length ? 'partial' : 'ok',
  rows: docs.length, errors, notes: docs.map((d) => `${d.id}: ${d.files.map((f) => `${f.name} sha256 ${f.sha256.slice(0, 12)}…`).join(', ')}`) });
errors.forEach((e) => console.error(`ERROR ${e}`));
process.exit(docs.length ? 0 : 1);
