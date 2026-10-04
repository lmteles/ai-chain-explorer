// Checks an answer against what the tools actually returned. A model can be told not to invent numbers;
// this makes it visible when it does.

const CITE = /\[([A-Za-z0-9_.>:-]+)\]/g;

/** Every number found anywhere in the tool results, including inside strings (notes, periods, headlines). */
export function numbersIn(value: unknown, out = new Set<number>()): Set<number> {
  if (typeof value === 'number' && Number.isFinite(value)) out.add(round(value));
  else if (typeof value === 'string') for (const m of value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(round(Number(m[0].replace(/,/g, ''))));
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

/** Fact ids present in the tool results: anything under a `fact_id`/`fact_ids`/`source_id` key. */
export function factIdsIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => factIdsIn(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'fact_id' || k === 'source_id' || k === 'id') && typeof v === 'string') out.add(v);
      else if (k === 'fact_ids' && Array.isArray(v)) v.forEach((x) => typeof x === 'string' && out.add(x));
      else factIdsIn(v, out);
    }
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

// The same figure may be written at another scale: $40,260bn as $40.3tn, a 0.25 ratio as 25%.
const variants = (n: number) => [n, n * 1000, n / 1000, n * 100, n / 100].map(round);
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.005); // rounding to one decimal

export type Issue = { kind: 'unsupported_number' | 'uncited_number' | 'unknown_fact_id' | 'missing_section'; detail: string };

/**
 * Problems with an answer, empty if it is grounded:
 * - a number that matches nothing the tools returned (at any of the scales above, allowing one-decimal rounding);
 * - a number with no [fact id] later in the same sentence;
 * - a cited fact id that the tools never returned;
 * - no "What would change this view" section.
 * Small integers (1–12) are let through as structure (list numbering, "two loops", "three hops").
 */
export function validateAnswer(answer: string, toolResults: unknown[]): Issue[] {
  const known = numbersIn(toolResults);
  const ids = factIdsIn(toolResults);
  const issues: Issue[] = [];
  for (const [, id] of answer.matchAll(CITE)) if (!ids.has(id!)) issues.push({ kind: 'unknown_fact_id', detail: id! });

  const sentences = answer.replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '').split(/(?<=[.!?])\s+|\n+/);
  for (const s of sentences) {
    const bare = s.replace(CITE, ' ');
    const cited = CITE.test(s);
    CITE.lastIndex = 0;
    for (const m of bare.matchAll(/(?<![A-Za-z_])\d[\d,]*(?:\.\d+)?/g)) {
      const n = Number(m[0].replace(/,/g, ''));
      if (Number.isInteger(n) && n >= 1 && n <= 12) continue;
      if (!variants(n).some((v) => [...known].some((k) => near(v, k)))) issues.push({ kind: 'unsupported_number', detail: `${m[0]} in "${s.trim().slice(0, 90)}"` });
      else if (!cited) issues.push({ kind: 'uncited_number', detail: `${m[0]} in "${s.trim().slice(0, 90)}"` });
    }
  }
  if (!/what would change this view/i.test(answer)) issues.push({ kind: 'missing_section', detail: 'What would change this view' });
  return issues;
}
