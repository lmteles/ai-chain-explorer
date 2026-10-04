import type { Headline } from '../../src/lib/data/news';
import { cachedGet, HOUR } from './http';
import { htmlToText } from './ir';
import type { NewsSource } from './news';

// Official newsroom feeds that answered on 4 Oct 2026. Others (Anthropic, Amazon, Oracle, AMD, ASML, TSMC,
// Broadcom, SoftBank) publish no working feed; GDELT covers them.
export const FEEDS: Record<string, string> = {
  openai: 'https://openai.com/news/rss.xml',
  nvidia: 'https://nvidianews.nvidia.com/releases.xml',
  microsoft: 'https://news.microsoft.com/source/feed/',
  alphabet: 'https://blog.google/rss/',
  meta: 'https://about.fb.com/feed/',
};

const tag = (block: string, name: string) => block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1];
const clean = (s: string) => htmlToText(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();

/** RSS 2.0 items and Atom entries: title, link, date. Not a general XML parser. */
export function parseFeed(xml: string): Headline[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return blocks.flatMap((b) => {
    const title = tag(b, 'title');
    const link = tag(b, 'link')?.trim() || b.match(/<link\b[^>]*href="([^"]+)"/i)?.[1];
    const date = tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date');
    const t = date ? Date.parse(clean(date)) : NaN;
    if (!title || !link || Number.isNaN(t)) return [];
    const url = clean(link);
    return [{ title: clean(title), url, domain: new URL(url).hostname, seen: new Date(t).toISOString(), source: 'rss' as const }];
  });
}

export const rss: NewsSource = {
  name: 'rss',
  enabled: () => true,
  async fetch(_pairs, days) {
    const since = new Date(Date.now() - days * 24 * HOUR).toISOString();
    const out: Headline[] = [];
    for (const url of Object.values(FEEDS)) {
      out.push(...parseFeed(await cachedGet(url, { ttlMs: 6 * HOUR, minGapMs: 500, headers: { 'User-Agent': 'ai-chain-explorer/0.1 (RSS reader)' } })).filter((h) => h.seen >= since));
    }
    return out;
  },
};
