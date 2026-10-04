import { z } from 'zod';
import { thin, type LiveBundle } from '../../src/lib/data/live';
import type { Entity, Source } from '../../src/lib/data/schema';
import { cachedGet, HOUR } from './http';

export type Quote = { price: number; marketCapUsd: number | null; date: string };
export type Bar = { date: string; close: number };

/** Swap providers with QUOTES_PROVIDER. Each one says which tickers it covers rather than guessing. */
export interface QuotesProvider {
  readonly source: Source;
  covers(ticker: string): boolean;
  quote(ticker: string): Promise<Quote>;
  history(ticker: string): Promise<Bar[]>; // oldest first, about one year
}

const FmpQuote = z.array(z.object({ symbol: z.string(), price: z.number(), marketCap: z.number().nullable().optional(), timestamp: z.number().optional() })).min(1);
const FmpBars = z.array(z.object({ date: z.string(), price: z.number() }));

export class FmpProvider implements QuotesProvider {
  readonly source: Source = {
    id: 'fmp_quotes', publisher: 'Financial Modeling Prep', title: 'End-of-day quotes and market capitalisation',
    url: 'https://site.financialmodelingprep.com/developer/docs', published: null, kind: 'data', reliability: 'secondary',
  };
  constructor(private key: string) {}
  // Free tier: US listings and ADRs only. Tokyo and Seoul tickers are reported as not covered.
  covers = (ticker: string) => /^[A-Z.]{1,6}$/.test(ticker) && !/\.(T|KS)$/.test(ticker);
  private get = (path: string) =>
    cachedGet(`https://financialmodelingprep.com/stable/${path}&apikey=${this.key}`, { ttlMs: 12 * HOUR, minGapMs: 250 }).then(JSON.parse);
  async quote(ticker: string): Promise<Quote> {
    const q = FmpQuote.parse(await this.get(`quote?symbol=${ticker}`))[0]!;
    const date = q.timestamp ? new Date(q.timestamp * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    return { price: q.price, marketCapUsd: q.marketCap ?? null, date };
  }
  async history(ticker: string): Promise<Bar[]> {
    const yearAgo = new Date(Date.now() - 366 * 24 * HOUR).toISOString().slice(0, 10);
    return FmpBars.parse(await this.get(`historical-price-eod/light?symbol=${ticker}`))
      .filter((b) => b.date >= yearAgo).map((b) => ({ date: b.date, close: b.price })).sort((a, b) => a.date.localeCompare(b.date));
  }
}

export function getProvider(name: string, key: string): QuotesProvider {
  if (name === 'fmp') return new FmpProvider(key);
  // ponytail: only FMP is implemented; add a class per provider when one is actually licensed.
  throw new Error(`QUOTES_PROVIDER "${name}" is not implemented (supported: fmp)`);
}

/** Market cap as a metric, and a thinned weekly price series for the sparkline. */
export async function fetchQuotes(p: QuotesProvider, entities: Entity[]): Promise<{ bundle: LiveBundle; errors: string[]; notes: string[] }> {
  const bundle: LiveBundle = { adapter: 'quotes', fetched_at: new Date().toISOString(), metrics: [], sources: [p.source], history: [], filings: [], relation_updates: [], relations: [], amount_updates: [], events: [] };
  const errors: string[] = [], notes: string[] = [];
  for (const e of entities.filter((x) => x.ticker && !x.private)) {
    if (!p.covers(e.ticker!)) { notes.push(`${e.id}: ${e.ticker} not covered by ${p.source.publisher}`); continue; }
    try {
      const [q, bars] = [await p.quote(e.ticker!), await p.history(e.ticker!)];
      if (q.marketCapUsd !== null) bundle.metrics.push({
        id: `mkt_${e.id}_market_cap`, entity_id: e.id, key: 'market_cap', value: Math.round(q.marketCapUsd / 1e7) / 100,
        low: null, high: null, unit: 'USD_bn', period: q.date, status: 'reported', source_ids: [p.source.id],
        confidence: 'high', as_of: q.date, note: `${e.ticker} at $${q.price}. For ADRs, the market cap of the underlying company in USD.`,
      });
      for (const b of thin(bars)) bundle.history.push({
        id: `mkt_${e.id}_price_${b.date}`, entity_id: e.id, key: 'price', period: b.date, end: b.date, value: b.close,
        unit: 'USD', source_ids: [p.source.id], derived: false,
      });
    } catch (err) {
      const msg = (err as Error).message;
      // 402 = the ticker is outside the current plan: a coverage limit, not a failure.
      if (msg.includes('HTTP 402')) notes.push(`${e.id}: ${e.ticker} not covered on the current ${p.source.publisher} plan`);
      else errors.push(`${e.id}: ${msg.slice(0, 200)}`);
    }
  }
  return { bundle, errors, notes };
}
