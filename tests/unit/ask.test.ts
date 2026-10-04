import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ask, MAX_ROUNDS, MODEL } from '../../src/lib/llm/ask';
import { cacheKey, dataVersion } from '../../src/lib/llm/limits';
import { SYSTEM_PROMPT } from '../../src/lib/llm/prompts';
import { runTool, TOOL_DEFS } from '../../src/lib/llm/tools';
import { validateAnswer } from '../../src/lib/llm/validate';
import { validateGraph } from '../../src/lib/data/schema';

const g = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));
const fx = (n: string) => readFileSync(`tests/fixtures/ask/${n}`, 'utf8');
// What the tools return for the questions behind the recorded answers. No model is called in these tests.
const retrieved = [runTool(g, 'get_relation', { id: 'r_goog_anth' }).result, runTool(g, 'list_relations', { entity_id: 'anthropic' }).result];

describe('tools', () => {
  it('declares exactly the seven read-only tools', () => {
    expect(TOOL_DEFS.map((t) => t.name)).toEqual(['get_entity', 'get_relation', 'list_relations', 'get_metric', 'find_paths', 'compute_exposure', 'get_claims']);
  });
  it('returns rows with fact ids, and says "not in the database" for unknowns', () => {
    expect(runTool(g, 'get_relation', { id: 'r_goog_anth' }).result).toMatchObject({ fact_id: 'r_goog_anth', amount: 40, amount_basis: 'up_to' });
    expect(runTool(g, 'get_entity', { id: 'xai' }).result).toEqual({ not_in_database: 'entity xai' });
    expect(runTool(g, 'get_metric', { entity_id: 'openai', key: 'capex_quarter' }).result).toEqual({ not_in_database: 'metric capex_quarter for openai' });
  });
  it('rejects bad input and unknown tools instead of guessing', () => {
    expect(runTool(g, 'find_paths', { from: 'openai', to: 'tsmc', depth: 9 }).ok).toBe(false);
    expect(runTool(g, 'delete_everything', {}).ok).toBe(false);
  });
  it('filters, finds paths and groups exposure by basis without summing', () => {
    const big = runTool(g, 'list_relations', { min_usd_bn: 100 }).result as { relations: { fact_id: string }[] };
    expect(big.relations.map((r) => r.fact_id)).toEqual(expect.arrayContaining(['r_openai_oracle', 'r_anth_goog', 'r_anth_amzn']));
    const paths = runTool(g, 'find_paths', { from: 'anthropic', to: 'anthropic', depth: 2 }).result as { count: number };
    expect(paths.count).toBeGreaterThanOrEqual(3);
    const exp = runTool(g, 'compute_exposure', { entity_id: 'tsmc' }).result as { inbound_by_basis: Record<string, unknown>; note: string };
    expect(Object.keys(exp.inbound_by_basis)).toEqual(expect.arrayContaining(['annual', 'share_pct']));
    expect(exp.note).toMatch(/do not add across/);
  });
});

describe('validator (recorded answers)', () => {
  it('passes a grounded answer', () => {
    expect(validateAnswer(fx('grounded.md'), retrieved)).toEqual([]);
  });
  it('fails an answer with a number that is not in the retrieved tool results', () => {
    const issues = validateAnswer(fx('invented.md'), retrieved);
    expect(issues).toContainEqual(expect.objectContaining({ kind: 'unsupported_number', detail: expect.stringContaining('45') }));
    expect(issues.filter((i) => i.kind === 'unsupported_number').map((i) => i.detail.split(' ')[0])).toEqual(['45', '13']);
    expect(issues).toContainEqual({ kind: 'unknown_fact_id', detail: 'r_made_up' });
    expect(issues).toContainEqual(expect.objectContaining({ kind: 'missing_section' }));
  });
  it('flags a real number that has no citation', () => {
    expect(validateAnswer('Alphabet invests up to $40bn in Anthropic.\n\nWhat would change this view: a filing.', retrieved))
      .toEqual([expect.objectContaining({ kind: 'uncited_number' })]);
  });
  it('accepts the same figure at another scale or rounded', () => {
    const debt = [{ fact_id: 'macro_federal_debt', value: 40260.64 }, { fact_id: 'x', ratio: 0.25 }];
    expect(validateAnswer('Debt is $40.3tn [macro_federal_debt], a 25% round trip [x].\n\nWhat would change this view: …', debt)).toEqual([]);
  });
});

describe('the loop (scripted stream, no network)', () => {
  type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
  const script = (turns: { content: Block[]; stop_reason: string }[]) => {
    const calls: unknown[] = [];
    const api = {
      stream(params: unknown) {
        calls.push(structuredClone(params));
        const turn = turns.shift()!;
        const handlers: ((t: string) => void)[] = [];
        return {
          on(_e: string, cb: (t: string) => void) { handlers.push(cb); return this; },
          async finalMessage() {
            for (const b of turn.content) if (b.type === 'text') handlers.forEach((h) => h(b.text));
            return { ...turn, usage: { input_tokens: 1000, output_tokens: 200 } };
          },
        };
      },
    };
    return { api: api as never, calls };
  };

  it('runs tools against the database, streams the answer, validates it and prices it', async () => {
    const { api, calls } = script([
      { content: [{ type: 'tool_use', id: 't1', name: 'get_relation', input: { id: 'r_goog_anth' } }, { type: 'tool_use', id: 't2', name: 'list_relations', input: { entity_id: 'anthropic' } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: fx('grounded.md') }], stop_reason: 'end_turn' },
    ]);
    let streamed = '';
    const r = await ask({ question: 'Explain Alphabet and Anthropic', scope: 'Looking at r_goog_anth.', graph: g, messagesApi: api, onText: (t) => { streamed += t; } });
    expect(r.issues).toEqual([]);
    expect(streamed).toBe(fx('grounded.md'));
    expect(r.usage).toMatchObject({ rounds: 2, input_tokens: 2000, output_tokens: 400 });
    expect(r.usage.usd).toBeCloseTo(2000 * 2e-6 + 400 * 1e-5);
    const second = calls[1] as { model: string; max_tokens: number; messages: { role: string; content: unknown }[] };
    expect(second).toMatchObject({ model: MODEL, max_tokens: 2000 });
    const results = second.messages[2]!.content as { tool_use_id: string; content: string }[];
    expect(results.map((x) => x.tool_use_id)).toEqual(['t1', 't2']); // all results in one user turn
    expect(JSON.parse(results[0]!.content)).toMatchObject({ fact_id: 'r_goog_anth' });
  });
  it('stops at the round cap and on refusal, without running tools from a refused turn', async () => {
    const loop = Array.from({ length: MAX_ROUNDS }, (_, i) => ({ content: [{ type: 'tool_use' as const, id: `t${i}`, name: 'get_entity', input: { id: 'nvidia' } }], stop_reason: 'tool_use' }));
    expect((await ask({ question: 'q', scope: 's', graph: g, messagesApi: script(loop).api })).stopped).toBe('max_rounds');
    const refused = await ask({ question: 'q', scope: 's', graph: g, messagesApi: script([{ content: [], stop_reason: 'refusal' }]).api });
    expect(refused).toMatchObject({ stopped: 'refusal', toolResults: [] });
  });
});

describe('prompt, cache and caps', () => {
  it('states the grounding, structure and neutrality rules', () => {
    for (const rule of [/followed by the fact id/, /not in the database/, /"Filed", "Reported", "Claimed" and "Unverified"/, /OpenAI and Anthropic symmetrically/, /built by Anthropic/, /What would change this view/, /cannot browse/])
      expect(SYSTEM_PROMPT).toMatch(rule);
  });
  it('keys the cache on the data, so new data means a fresh answer', () => {
    const v1 = dataVersion(g);
    const v2 = dataVersion({ ...g, relations: g.relations.map((r) => (r.id === 'r_goog_anth' ? { ...r, amount: 41 } : r)) });
    expect(v1).not.toBe(v2);
    expect(cacheKey(' Why? ', 'node:x', v1)).toBe(cacheKey('why?', 'node:x', v1));
  });
});
