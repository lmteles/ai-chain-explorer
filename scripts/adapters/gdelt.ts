import { z } from 'zod';
import type { Headline } from '../../src/lib/data/news';
import { cachedGet, HOUR } from './http';
import { ALIASES, DEAL_TERMS, type NewsSource } from './news';

// GDELT DOC 2.0: free, headlines only. Its stated limit is one request every 5 seconds; in practice it answers
// 429 below that after any burst, so we leave 10 s and retry once after 30 s.
const GAP_MS = 10_000;
const RETRY_MS = 30_000;
const Articles = z.object({ articles: z.array(z.object({ url: z.string(), title: z.string(), seendate: z.string(), domain: z.string() })).optional() });

/**
 * One query for all tracked companies instead of one per pair: GDELT throttles bursts hard, and pairing is done
 * afterwards from the headline itself (entitiesIn), which is stricter than GDELT's full-text match anyway.
 */
export const allQuery = () =>
  `(${Object.values(ALIASES).map((n) => (n[0]!.includes(' ') ? `"${n[0]}"` : n[0])).join(' OR ')}) (${DEAL_TERMS.join(' OR ')})`;

export const gdeltUrl = (query: string, days: number) =>
  `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&format=json&maxrecords=250&sort=DateDesc&timespan=${days}d`;

/** GDELT answers errors and rate limits with plain text, not JSON. */
export function parseGdelt(body: string): Headline[] {
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { throw new Error(`GDELT: ${body.slice(0, 120)}`); }
  return (Articles.parse(raw).articles ?? []).map((a) => ({
    title: a.title, url: a.url, domain: a.domain, source: 'gdelt' as const,
    seen: a.seendate.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z'),
  }));
}

export const gdelt: NewsSource = {
  name: 'gdelt',
  enabled: () => true,
  async fetch(_pairs, days) {
    const get = () => cachedGet(gdeltUrl(allQuery(), days), { ttlMs: 12 * HOUR, minGapMs: GAP_MS });
    // ponytail: one retry after a fixed back-off; a queue with exponential back-off if GDELT keeps refusing.
    const body = await get().catch(async (e: Error) => {
      if (!/HTTP 429|fetch failed/.test(e.message)) throw e; // GDELT throttles with 429s and dropped connections
      await new Promise((r) => setTimeout(r, RETRY_MS));
      return get();
    });
    return parseGdelt(body);
  },
};
