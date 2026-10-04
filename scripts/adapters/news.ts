import { createHash } from 'node:crypto';
import type { Cluster, Headline } from '../../src/lib/data/news';
import { normaliseText } from '../../src/lib/data/proposals';
import type { Relation } from '../../src/lib/data/schema';

/** A news source. Licensed sources stay disabled stubs: they never scrape. */
export interface NewsSource {
  readonly name: string;
  enabled(): boolean;
  fetch(pairs: [string, string][], timespanDays: number): Promise<Headline[]>;
}

export class LicenceRequiredError extends Error {}

// How each entity is named in headlines. Case-sensitive on purpose: "Meta" the company, not "meta-analysis".
export const ALIASES: Record<string, string[]> = {
  openai: ['OpenAI'], anthropic: ['Anthropic'], softbank: ['SoftBank'], oracle: ['Oracle'],
  microsoft: ['Microsoft', 'Azure'], amazon: ['Amazon', 'AWS'], alphabet: ['Alphabet', 'Google'], meta: ['Meta', 'Facebook'],
  nvidia: ['Nvidia', 'NVIDIA'], broadcom: ['Broadcom'], amd: ['AMD'], apple: ['Apple'], tesla: ['Tesla'],
  tsmc: ['TSMC', 'Taiwan Semiconductor'], samsung: ['Samsung'], asml: ['ASML'],
};

export const DEAL_TERMS = ['invest', 'commitment', 'gigawatt', 'capacity', 'agreement'];
const DEAL = /\b(invest\w*|stakes?|commit\w*|gigawatts?|GW|capacity|agreements?|deals?|contracts?|lend\w*|loans?|financ\w*|partner\w*|orders?|buy\w*|acquir\w*|billion|bn)\b|\$\s?\d/i;

export function entitiesIn(title: string): string[] {
  return Object.entries(ALIASES).filter(([, names]) => names.some((n) => new RegExp(`\\b${n}\\b`).test(title))).map(([id]) => id);
}

/** A headline is kept only if it names a tracked company and uses deal language. */
export const isDealHeadline = (title: string) => entitiesIn(title).length > 0 && DEAL.test(title);

/** Unordered pairs of entities that already have an edge between them. */
export function connectedPairs(relations: Relation[]): [string, string][] {
  const seen = new Map<string, [string, string]>();
  for (const r of relations) {
    const [a, b] = [r.from_id, r.to_id].sort() as [string, string];
    seen.set(`${a}|${b}`, [a, b]);
  }
  return [...seen.values()];
}

const STOP = new Set('the a an and or of to in on for with by at from as is are was be its it that this after over says said will new up us'.split(' '));
export const tokens = (t: string) =>
  new Set(normaliseText(t).toLowerCase().split(/[^a-z0-9$]+/).filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOP.has(w)));
const jaccard = (a: Set<string>, b: Set<string>) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
};

export const SAME_STORY = 0.35;
export const KEEP_DAYS = 45;

/**
 * Adds headlines to stories. A headline joins a cluster that shares a company and reads alike (Jaccard on title
 * words); otherwise it starts a new one. URLs already seen are skipped; stale clusters are dropped.
 */
export function clusterHeadlines(existing: Cluster[], incoming: Headline[], now = new Date()): Cluster[] {
  const clusters = existing.map((c) => ({ ...c, headlines: [...c.headlines], entity_ids: [...c.entity_ids] }));
  const seenUrls = new Set(clusters.flatMap((c) => c.headlines.map((h) => h.url)));
  for (const h of [...incoming].sort((a, b) => a.seen.localeCompare(b.seen))) {
    if (seenUrls.has(h.url) || !isDealHeadline(h.title)) continue;
    seenUrls.add(h.url);
    const ents = entitiesIn(h.title), tk = tokens(h.title);
    const home = clusters.find((c) => c.entity_ids.some((e) => ents.includes(e)) && c.headlines.some((x) => jaccard(tokens(x.title), tk) >= SAME_STORY));
    if (home) {
      home.headlines.push(h);
      home.entity_ids = [...new Set([...home.entity_ids, ...ents])];
      if (h.seen > home.last_seen) home.last_seen = h.seen;
      if (home.triage) delete home.triage; // new coverage reopens a triaged story
    } else {
      clusters.push({ id: `c_${createHash('sha1').update(h.url).digest('hex').slice(0, 10)}`, entity_ids: ents, first_seen: h.seen, last_seen: h.seen, headlines: [h] });
    }
  }
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
  return clusters.filter((c) => c.last_seen >= cutoff).sort((a, b) => b.last_seen.localeCompare(a.last_seen));
}
