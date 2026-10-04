import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFredCsv } from '../../scripts/adapters/fred';
import { redact } from '../../scripts/adapters/http';
import { fetchQuotes, getProvider, type QuotesProvider } from '../../scripts/adapters/quotes';
import { parseDebt, parseInterest } from '../../scripts/adapters/treasury';
import { thin } from '../../src/lib/data/live';
import { validateGraph } from '../../src/lib/data/schema';
import { fmtMoney } from '../../src/lib/fmt';

// Recorded 4 Oct 2026 from fred.stlouisfed.org and api.fiscaldata.treasury.gov, trimmed.
const fx = (n: string) => readFileSync(`tests/fixtures/macro/${n}`, 'utf8');
const seed = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));

describe('FRED CSV', () => {
  it('parses the recorded DGS10 download', () => {
    const pts = parseFredCsv(fx('dgs10.csv'), 'DGS10');
    expect(pts.at(-1)).toEqual({ date: '2026-10-01', value: 5.24 });
  });
  it('drops holiday gaps and rejects the wrong series', () => {
    expect(parseFredCsv('observation_date,DGS10\n2026-01-01,.\n2026-01-02,4.1\n2026-01-03,', 'DGS10')).toEqual([{ date: '2026-01-02', value: 4.1 }]);
    expect(() => parseFredCsv('observation_date,DGS2\n2026-01-02,4.1', 'DGS10')).toThrow(/unexpected header/);
  });
});

describe('Treasury Fiscal Data', () => {
  it('reads total debt in billions at the latest date', () => {
    expect(parseDebt(JSON.parse(fx('debt.json')))).toMatchObject({ value: 40260.64, as_of: '2026-10-01', unit: 'USD_bn' });
  });
  it('sums fiscal-year-to-date interest for the latest month only, split by category', () => {
    const [pub, total] = parseInterest(JSON.parse(fx('interest.json')));
    expect(pub).toMatchObject({ id: 'macro_interest_public', value: 981.81, as_of: '2026-08-31', period: 'FY2026 to 2026-08-31' });
    expect(total).toMatchObject({ id: 'macro_interest_total', value: 1267.81 });
    expect(total!.value).toBeGreaterThan(pub!.value);
  });
});

describe('quotes provider', () => {
  const fake: QuotesProvider = {
    source: { id: 'fake', publisher: 'Fake', title: 't', url: 'https://x', published: null, kind: 'data', reliability: 'secondary' },
    covers: (t) => !t.endsWith('.T') && !t.endsWith('.KS'),
    quote: async (t) => {
      if (t === 'AMD') throw new Error('HTTP 429');
      if (t === 'ORCL') throw new Error('https://x?apikey=REDACTED: HTTP 402'); return { price: 100, marketCapUsd: 3.2e12, date: '2026-10-02' }; },
    history: async () => Array.from({ length: 11 }, (_, i) => ({ date: `2026-09-${String(i + 10).padStart(2, '0')}`, close: 90 + i })),
  };
  it('writes market cap, a thinned price series, and per-ticker failures without stopping', async () => {
    const { bundle, errors, notes } = await fetchQuotes(fake, seed.entities);
    expect(bundle.metrics.find((m) => m.entity_id === 'nvidia')).toMatchObject({ key: 'market_cap', value: 3200, unit: 'USD_bn' });
    expect(bundle.metrics.some((m) => m.entity_id === 'openai')).toBe(false); // private
    expect(notes).toEqual(expect.arrayContaining([expect.stringMatching(/softbank: 9984\.T not covered/)]));
    expect(errors).toEqual([expect.stringMatching(/^amd: HTTP 429/)]);
    expect(notes).toEqual(expect.arrayContaining(['oracle: ORCL not covered on the current Fake plan']));
    expect(bundle.history.filter((h) => h.entity_id === 'nvidia').map((h) => h.value)).toEqual([90, 95, 100]);
  });
  it('rejects an unimplemented provider by name', () => {
    expect(() => getProvider('polygon', 'k')).toThrow(/not implemented/);
  });
});

describe('helpers', () => {
  it('redacts keys from URLs before they reach logs', () => {
    expect(redact('GET https://x/stable/quote?symbol=A&apikey=SECRET123: HTTP 401')).toBe('GET https://x/stable/quote?symbol=A&apikey=REDACTED: HTTP 401');
  });
  it('thins a series but keeps the last point', () => {
    expect(thin([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([1, 4, 7]);
  });
  it('formats trillions', () => {
    expect(fmtMoney(40260.64, 'USD_bn')).toBe('$40.3tn');
  });
});

describe('CI failure gate', () => {
  it('flags only adapters whose last two runs both failed', async () => {
    const { failingTwice } = await import('../../scripts/runs');
    const run = (adapter: string, started_at: string, status: 'ok' | 'failed' | 'skipped') => ({ adapter, started_at, finished_at: started_at, status, rows: 0, errors: status === 'failed' ? ['boom'] : [], notes: [] });
    expect(failingTwice([
      run('gdelt', '1', 'failed'), run('gdelt', '2', 'failed'),
      run('fred', '1', 'failed'), run('fred', '2', 'ok'),
      run('sec', '1', 'ok'), run('sec', '2', 'failed'),
      run('quotes', '1', 'skipped'), run('quotes', '2', 'skipped'),
    ])).toEqual([{ adapter: 'gdelt', errors: ['boom'] }]);
  });
});
