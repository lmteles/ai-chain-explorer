import type { Source } from '../../src/lib/data/schema';
import { thin, type MacroItem } from '../../src/lib/data/live';
import { cachedGet, HOUR } from './http';

// FRED's public CSV download: same data as the keyed API, no key needed. FRED_API_KEY is not required.
export const fredCsvUrl = (series: string, from: string) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}&cosd=${from}`;

export const FRED_SOURCE: Source = {
  id: 'fred_dgs10', publisher: 'FRED, St. Louis Fed', title: 'DGS10: Market yield on 10-year US Treasury securities (daily)',
  url: 'https://fred.stlouisfed.org/series/DGS10', published: null, kind: 'data', reliability: 'primary',
};

/** Header must be date,SERIES; holidays come through as "." or blank and are dropped. */
export function parseFredCsv(csv: string, series: string): { date: string; value: number }[] {
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  if (!header || header.split(',')[1]?.trim() !== series) throw new Error(`FRED CSV: unexpected header "${header}"`);
  return rows.flatMap((r) => {
    const [date, v] = r.split(',');
    const value = Number(v);
    return date && v && v.trim() !== '.' && Number.isFinite(value) ? [{ date, value }] : [];
  });
}

export async function fetchDgs10(now = new Date()): Promise<MacroItem> {
  const from = new Date(now.getTime() - 366 * 24 * HOUR).toISOString().slice(0, 10);
  const points = parseFredCsv(await cachedGet(fredCsvUrl('DGS10', from), { ttlMs: 6 * HOUR }), 'DGS10');
  const last = points.at(-1);
  if (!last) throw new Error('FRED DGS10: no observations');
  return {
    id: 'macro_dgs10', label: 'US 10-year Treasury yield', value: last.value, unit: 'pct', as_of: last.date, period: null,
    source_ids: [FRED_SOURCE.id], history: thin(points), note: 'Daily close. Eisman: near 5% a market correction becomes likely.',
  };
}
