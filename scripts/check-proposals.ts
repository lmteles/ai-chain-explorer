import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NewsBundle, NewsProposalFile, type Cluster, type NewsProposal } from '../src/lib/data/news';
import { IrDocument, normaliseText, ProposalFile, type Proposal } from '../src/lib/data/proposals';
import { validateGraph, type Graph } from '../src/lib/data/schema';

/** Ways a number may be written in a filing: 19, 40.20, 9,326 (€m for 9.326bn), 1,272,411… */
export function numberForms(v: number): string[] {
  const out = new Set<string>();
  for (const x of [v, v * 1000]) {
    for (const d of [0, 1, 2, 3]) {
      const fixed = x.toFixed(d);
      if (Number(fixed) !== Math.round(x * 10 ** d) / 10 ** d || Math.abs(Number(fixed) - x) > 1e-9) continue;
      out.add(fixed);
      out.add(Number(fixed).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
    }
  }
  return [...out];
}

/** Returns problems; empty means the proposal is grounded in the document as far as a machine can tell. */
export function checkProposal(p: Proposal, doc: IrDocument, docText: string, g: Graph): string[] {
  const errs: string[] = [];
  const snip = normaliseText(p.snippet);
  if (!g.entities.some((e) => e.id === p.entity_id)) errs.push('unknown entity');
  if (p.kind === 'relation_share') {
    const r = g.relations.find((x) => x.id === p.relation_id);
    if (!r) errs.push(`unknown relation ${p.relation_id}`);
    else if (r.from_id !== p.entity_id && r.to_id !== p.entity_id) errs.push(`relation ${r.id} does not involve ${p.entity_id}`);
  }
  for (const v of [p.value, p.low, p.high]) {
    if (v === null) continue;
    // Ranges are written as low and high; a midpoint need not appear in the text.
    if (v === p.value && p.low !== null && p.high !== null) continue;
    if (!valueIn(v, snip)) errs.push(`value ${v} does not appear in the snippet`);
  }
  if (p.evidence === 'text') {
    if (!normaliseText(docText).includes(snip)) errs.push('snippet not found verbatim in the document text');
  } else if (!doc.pages.some((x) => x.page === p.page)) {
    errs.push(`page ${p.page} is not a slide in this document`);
  }
  return errs;
}

const valueIn = (v: number, text: string) =>
  numberForms(v).some((f) => new RegExp(`(^|[^\\d.,])${f.replace(/[.,]/g, '\\$&')}(?![\\d]|[.,]\\d)`).test(normaliseText(text)));

/** News proposals: the headline must be one we actually saw, at that URL, in that story; numbers must be in it. */
export function checkNewsProposal(p: NewsProposal, clusters: Cluster[], g: Graph): string[] {
  const errs: string[] = [];
  const c = clusters.find((x) => x.id === p.cluster_id);
  if (!c) errs.push(`unknown story ${p.cluster_id}`);
  else if (!c.headlines.some((h) => h.url === p.url && h.title === p.headline)) errs.push('headline/url not found verbatim in the story');
  const ent = (id: string) => g.entities.some((e) => e.id === id);
  if (p.kind === 'new_relation') {
    const q = p.proposed!;
    if (!ent(q.from_id) || !ent(q.to_id)) errs.push('unknown entity in proposed edge');
    if (q.from_id === q.to_id) errs.push('self-loop');
    if (q.amount !== null && !valueIn(q.amount, p.headline)) errs.push(`amount ${q.amount} does not appear in the headline`);
    if (q.amount !== null && q.amount_basis === 'undisclosed') errs.push('amount set but basis undisclosed');
  } else {
    if (!g.relations.some((r) => r.id === p.relation_id)) errs.push(`unknown relation ${p.relation_id}`);
    if (p.kind === 'amount_change' && !valueIn(p.amount!, p.headline)) errs.push(`amount ${p.amount} does not appear in the headline`);
  }
  return errs;
}

if (process.argv[1]?.endsWith('check-proposals.ts')) {
  const g = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));
  const docs = IrDocument.array().parse(JSON.parse(readFileSync('public/data/ir/documents.json', 'utf8')));
  const dir = 'public/data/proposals';
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  const seen = new Set([...g.metrics, ...g.relations].map((x) => x.id));
  let bad = 0;
  const clusters = existsSync('public/data/news/clusters.json') ? NewsBundle.parse(JSON.parse(readFileSync('public/data/news/clusters.json', 'utf8'))).clusters : [];
  for (const f of files) {
    if (f.startsWith('news-')) {
      const nf = NewsProposalFile.parse(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
      for (const p of nf.facts) {
        const errs = checkNewsProposal(p, clusters, g);
        if (seen.has(p.id)) errs.push('duplicate id');
        seen.add(p.id);
        console.log(`${errs.length ? 'FAIL' : 'ok  '} ${p.id} (news ${p.kind})${errs.length ? `: ${errs.join('; ')}` : ''}`);
        bad += errs.length ? 1 : 0;
      }
      continue;
    }
    const pf = ProposalFile.parse(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
    if (f !== `${pf.document_id}.json`) { console.error(`${f}: file must be named ${pf.document_id}.json`); bad++; continue; }
    const doc = docs.find((d) => d.id === pf.document_id);
    if (!doc) { console.error(`${f}: document ${pf.document_id} not in documents.json`); bad++; continue; }
    const txt = `.cache/ir/${doc.id}.txt`;
    if (!existsSync(txt)) { console.error(`${f}: ${txt} missing; run pnpm ingest:ir first`); bad++; continue; }
    const text = readFileSync(txt, 'utf8');
    for (const p of pf.facts) {
      const errs = checkProposal(p, doc, text, g);
      if (seen.has(p.id)) errs.push('duplicate id');
      seen.add(p.id);
      console.log(`${errs.length ? 'FAIL' : 'ok  '} ${p.id} (${p.evidence}${p.page ? ` p${p.page}` : ''})${errs.length ? `: ${errs.join('; ')}` : ''}`);
      bad += errs.length ? 1 : 0;
    }
  }
  writeFileSync(`${dir}/index.json`, JSON.stringify({ files }, null, 1) + '\n');
  console.log(bad ? `${bad} problem(s)` : `all proposals grounded; index lists ${files.length} file(s)`);
  process.exit(bad ? 1 : 0);
}
