// Per-browser spend guard and answer cache. Browser storage can be missing (private mode) or throw;
// every access is wrapped and the feature still works without it (no cache, caps counted in memory).

const memory = new Map<string, string>();
const get = (s: Storage | undefined, k: string) => { try { return s?.getItem(k) ?? memory.get(k) ?? null; } catch { return memory.get(k) ?? null; } };
const set = (s: Storage | undefined, k: string, v: string) => { memory.set(k, v); try { s?.setItem(k, v); } catch { /* memory only */ } };
const local = () => (typeof localStorage === 'undefined' ? undefined : localStorage);
const session = () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);

export const DEFAULT_CAPS = { answersPerDay: 10, outputTokensPerDay: 30_000 };

const today = () => new Date().toISOString().slice(0, 10);
type Spend = { day: string; answers: number; output_tokens: number; usd: number };

export function spendToday(): Spend {
  const s = JSON.parse(get(local(), 'ask.spend') ?? 'null') as Spend | null;
  return s && s.day === today() ? s : { day: today(), answers: 0, output_tokens: 0, usd: 0 };
}
export function recordSpend(output_tokens: number, usd: number): Spend {
  const s = spendToday();
  const next = { ...s, answers: s.answers + 1, output_tokens: s.output_tokens + output_tokens, usd: s.usd + usd };
  set(local(), 'ask.spend', JSON.stringify(next));
  return next;
}
export function caps(): typeof DEFAULT_CAPS {
  return { ...DEFAULT_CAPS, ...JSON.parse(get(local(), 'ask.caps') ?? '{}') };
}
export const saveCaps = (c: typeof DEFAULT_CAPS) => set(local(), 'ask.caps', JSON.stringify(c));
export function overCap(s = spendToday(), c = caps()): string | null {
  if (s.answers >= c.answersPerDay) return `daily cap reached: ${s.answers} of ${c.answersPerDay} answers`;
  if (s.output_tokens >= c.outputTokensPerDay) return `daily cap reached: ${s.output_tokens.toLocaleString()} of ${c.outputTokensPerDay.toLocaleString()} output tokens`;
  return null;
}

// The key lives in sessionStorage only: gone when the tab closes, never written to disk by us or sent anywhere but the API.
export const getKey = () => get(session(), 'ask.key') ?? '';
export const setKey = (k: string) => set(session(), 'ask.key', k);

/** llm_cache: keyed by question, scope and a fingerprint of the data, so new data means a fresh answer. */
export function dataVersion(g: { relations: { id: string; amount: number | null; status: string; share_pct: number | null }[]; metrics: { id: string; value: number; superseded_by?: string }[]; events: { id: string }[] }): string {
  const text = JSON.stringify([g.relations.map((r) => [r.id, r.amount, r.status, r.share_pct]), g.metrics.map((m) => [m.id, m.value, m.superseded_by ?? '']), g.events.map((e) => e.id)]);
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
export const cacheKey = (question: string, scope: string, version: string) => `ask.cache.${version}.${question.trim().toLowerCase()}|${scope}`;
export const readCache = <T,>(k: string): T | null => JSON.parse(get(local(), k) ?? 'null') as T | null;
export const writeCache = (k: string, v: unknown) => set(local(), k, JSON.stringify(v));
