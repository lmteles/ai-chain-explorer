import type { MacroBundle, Run } from '../lib/data/live';
import { fmtMoney } from '../lib/fmt';
import { Sparkline } from './Sparkline';
import { StalenessBadge } from './ui';

const EISMAN_LINE = 5;
const ALERT_AT = 4.9;

export function MacroStrip({ macro, runs }: { macro?: MacroBundle; runs: Run[] }) {
  const item = (id: string) => macro?.items.find((i) => i.id === id);
  const y = item('macro_dgs10'), debt = item('macro_federal_debt'), interest = item('macro_interest_public');
  const failing = runs.filter((r) => r.status === 'failed' || r.status === 'partial');
  const alert = y !== undefined && y.value > ALERT_AT;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-white px-4 py-1 text-xs">
      {y ? (
        <span className={`flex items-center gap-2 rounded px-2 py-0.5 ${alert ? 'bg-red-50 text-red-900 ring-1 ring-red-200' : ''}`}
          title={`[${y.id}] ${y.note}`}>
          <strong>US 10-year {y.value.toFixed(2)}%</strong>
          <Sparkline values={y.history.map((p) => p.value)} refLine={EISMAN_LINE} colour={alert ? '#B42318' : '#1B2A4A'}
            label={`10-year yield over the past year against Eisman's ${EISMAN_LINE}% line`} />
          <span className="text-xs">{alert ? (y.value >= EISMAN_LINE ? `above Eisman's ${EISMAN_LINE}% line` : `near Eisman's ${EISMAN_LINE}% line`) : `Eisman's line: ${EISMAN_LINE}%`}</span>
          <StalenessBadge asOf={y.as_of} />
        </span>
      ) : <span className="text-slate-500">10-year yield unavailable</span>}
      {debt && (
        <span title={`[${debt.id}] ${debt.note}`}>Federal debt <strong>{fmtMoney(debt.value, debt.unit)}</strong> <span className="text-xs text-slate-500">as of {debt.as_of}</span></span>
      )}
      {interest && (
        <span title={`[${interest.id}] ${interest.note}`}>Interest on public debt <strong>{fmtMoney(interest.value, interest.unit)}</strong> <span className="text-xs text-slate-500">{interest.period}</span></span>
      )}
      <a href="#/sources" className={`ml-auto text-xs underline decoration-dotted ${failing.length ? 'font-semibold text-red-700' : 'text-slate-500'}`}>
        {failing.length ? `${failing.length} data source${failing.length > 1 ? 's' : ''} failing` : 'Data sources'}
      </a>
    </div>
  );
}
