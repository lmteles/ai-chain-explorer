import { z } from 'zod';
import type { Source } from '../../src/lib/data/schema';
import { thin, type MacroItem } from '../../src/lib/data/live';
import { cachedGet, HOUR } from './http';

const API = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od';

export const TREASURY_SOURCES: Source[] = [
  { id: 'treasury_debt', publisher: 'US Treasury Fiscal Data', title: 'Debt to the Penny', url: 'https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/', published: null, kind: 'data', reliability: 'primary' },
  { id: 'treasury_interest', publisher: 'US Treasury Fiscal Data', title: 'Interest Expense on the Public Debt Outstanding', url: 'https://fiscaldata.treasury.gov/datasets/interest-expense-debt-outstanding/', published: null, kind: 'data', reliability: 'primary' },
];

const Debt = z.object({ data: z.array(z.object({ record_date: z.string(), tot_pub_debt_out_amt: z.string() })) });
const Interest = z.object({
  data: z.array(z.object({ record_date: z.string(), expense_catg_desc: z.string(), fytd_expense_amt: z.string(), record_fiscal_year: z.string() })),
});

const bn = (s: string) => Math.round(Number(s) / 1e7) / 100;

export function parseDebt(raw: unknown): MacroItem {
  const rows = Debt.parse(raw).data.sort((a, b) => a.record_date.localeCompare(b.record_date));
  const last = rows.at(-1);
  if (!last) throw new Error('Debt to the Penny: no rows');
  return {
    id: 'macro_federal_debt', label: 'US federal debt outstanding', value: bn(last.tot_pub_debt_out_amt), unit: 'USD_bn',
    as_of: last.record_date, period: null, source_ids: ['treasury_debt'],
    history: thin(rows.map((r) => ({ date: r.record_date, value: bn(r.tot_pub_debt_out_amt) }))),
    note: 'Total public debt outstanding (held by the public plus intragovernmental holdings).',
  };
}

/** Fiscal-year-to-date interest expense at the latest month, split into public issues and the total. */
export function parseInterest(raw: unknown): MacroItem[] {
  const rows = Interest.parse(raw).data;
  const latest = rows.reduce((d, r) => (r.record_date > d ? r.record_date : d), '');
  const month = rows.filter((r) => r.record_date === latest);
  if (!month.length) throw new Error('Interest expense: no rows');
  const fy = month[0]!.record_fiscal_year;
  const sum = (rs: typeof month) => Math.round(rs.reduce((s, r) => s + Number(r.fytd_expense_amt), 0) / 1e7) / 100;
  const base = { unit: 'USD_bn' as const, as_of: latest, period: `FY${fy} to ${latest}`, source_ids: ['treasury_interest'], history: [] };
  return [
    { ...base, id: 'macro_interest_public', label: 'Interest on debt held by the public, fiscal year to date',
      value: sum(month.filter((r) => r.expense_catg_desc === 'INTEREST EXPENSE ON PUBLIC ISSUES')),
      note: 'Category "Interest expense on public issues". US fiscal years start on 1 October.' },
    { ...base, id: 'macro_interest_total', label: 'Total interest expense, fiscal year to date', value: sum(month),
      note: 'Public issues plus interest credited to government accounts (intragovernmental).' },
  ];
}

export async function fetchTreasury(): Promise<MacroItem[]> {
  const opts = { ttlMs: 24 * HOUR, minGapMs: 300 };
  const debt = JSON.parse(await cachedGet(`${API}/debt_to_penny?sort=-record_date&page%5Bsize%5D=260&fields=record_date,tot_pub_debt_out_amt`, opts));
  // ~40 rows a month; 120 covers the latest month even if a new one is partially loaded.
  const interest = JSON.parse(await cachedGet(`${API}/interest_expense?sort=-record_date&page%5Bsize%5D=120&fields=record_date,expense_catg_desc,fytd_expense_amt,record_fiscal_year`, opts));
  return [parseDebt(debt), ...parseInterest(interest)];
}
