import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { IrDocument } from '../../src/lib/data/proposals';
import { cachedGet, HOUR } from './http';
import { Submissions, filingUrl } from './sec';

// TSMC's investor site sits behind a bot challenge, which we do not get around. Both companies furnish the same
// results packs to SEC EDGAR (6-K) and TSMC files its 20-F there, so EDGAR is the official, polite source.

export type DocSpec = {
  id: string;                          // stable prefix; the period is added from the filing
  entity_id: string;
  cik: string;
  form: '6-K' | '20-F';
  title: string;
  /** For 6-K packs: a file in the filing that marks it as the quarterly results pack. */
  marker?: RegExp;
  /** Text exhibits to read (all .htm matching). */
  include: RegExp;
  /** Slide images: page number from the 3-digit suffix. */
  slides?: RegExp;
};

export const SPECS: DocSpec[] = [
  { id: 'tsmc-results', entity_id: 'tsmc', cik: '0001046179', form: '6-K', title: 'TSMC quarterly results (earnings release and presentation)',
    marker: /presentation.*\.htm$/i, include: /^a\dq\d\d.*\.htm$/i, slides: /presentation\w*?(\d{3})\.jpg$/i },
  { id: 'tsmc-20f', entity_id: 'tsmc', cik: '0001046179', form: '20-F', title: 'TSMC annual report on Form 20-F', include: /^tsm-\d{8}\.htm$/i },
  { id: 'asml-results', entity_id: 'asml', cik: '0000937966', form: '6-K', title: 'ASML quarterly results (press release and investor presentation)',
    marker: /pressrelease.*\.htm$/i, include: /^(pressrelease|presentationinvestor)\w*\.htm$/i, slides: /presentationinvestor\w*?(\d{3})\.jpg$/i },
];

const Index = z.object({ directory: z.object({ item: z.array(z.object({ name: z.string() })) }) });
const MAX_6K_SCAN = 15;

/** Strips markup for snippet checking. Good enough for EDGAR exhibits; not a general HTML parser. */
export function htmlToText(html: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', euro: '€', bull: '•' };
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(span|a|b|i|u|em|strong|font|sup|sub)\b[^>]*>/gi, '') // inline tags can split a word: "AS</span><span>ML"
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m)
    .replace(/[ \s]+/g, ' ');
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const day = 24 * HOUR;

export type Fetched = { doc: IrDocument; text: string };

export async function fetchDocument(spec: DocSpec, ua: string): Promise<Fetched> {
  const opts = { ttlMs: 7 * day, minGapMs: 150, headers: { 'User-Agent': ua } };
  const subs = Submissions.parse(JSON.parse(await cachedGet(`https://data.sec.gov/submissions/CIK${spec.cik}.json`, { ...opts, ttlMs: day })));
  const r = subs.filings.recent;
  const candidates = r.form.map((f, i) => ({ f, i })).filter((x) => x.f === spec.form).slice(0, spec.form === '6-K' ? MAX_6K_SCAN : 1);
  for (const { i } of candidates) {
    const accession = r.accessionNumber[i]!;
    const base = filingUrl(spec.cik, accession, '');
    const names = Index.parse(JSON.parse(await cachedGet(`${base}index.json`, opts))).directory.item.map((x) => x.name);
    if (spec.marker && !names.some((n) => spec.marker!.test(n))) continue;
    const files = names.filter((n) => spec.include.test(n));
    if (!files.length) continue;
    const bodies = await Promise.all(files.map((n) => cachedGet(base + n, opts)));
    const pages = spec.slides
      ? names.flatMap((n) => { const m = spec.slides!.exec(n); return m ? [{ page: Number(m[1]), url: base + n }] : []; }).sort((a, b) => a.page - b.page)
      : [];
    const period = r.reportDate[i] || r.filingDate[i]!;
    return {
      doc: {
        id: `${spec.id}-${period}`, entity_id: spec.entity_id, title: `${spec.title}, period to ${period}`, form: spec.form,
        filed: r.filingDate[i]!, accession, index_url: filingUrl(spec.cik, accession),
        files: files.map((n, k) => ({ name: n, url: base + n, sha256: sha256(bodies[k]!) })), pages,
      },
      text: bodies.map(htmlToText).join('\n'),
    };
  }
  throw new Error(`${spec.id}: no ${spec.form} matching the spec in the latest ${candidates.length} filings`);
}
