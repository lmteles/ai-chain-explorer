import Anthropic from '@anthropic-ai/sdk';
import type { Graph } from '../data/schema';
import { SYSTEM_PROMPT } from './prompts';
import { runTool, TOOL_DEFS } from './tools';
import { validateAnswer, type Issue } from './validate';

// Spend rules (Leo, 4 Oct 2026): Sonnet only, only when asked, small caps. No fallbacks to other models.
export const MODEL = 'claude-sonnet-5-5';
export const MAX_TOKENS = 2000;     // per call: a hard ceiling on output
export const MAX_ROUNDS = 6;        // tool round-trips per answer
export const PRICE = { input: 2 / 1e6, output: 10 / 1e6 }; // USD per token, Sonnet 5.5

export type AskResult = {
  answer: string;
  issues: Issue[];
  toolResults: unknown[];
  usage: { input_tokens: number; output_tokens: number; usd: number; rounds: number };
  stopped?: 'refusal' | 'max_rounds' | 'max_tokens';
};

type Streamer = Pick<Anthropic['messages'], 'stream'>;

export type AskOptions = {
  question: string;
  scope: string;               // e.g. "The user is looking at relation r_goog_anth (alphabet → anthropic)."
  graph: Graph;
  apiKey?: string;
  messagesApi?: Streamer;      // injected in tests: no network, no spend
  onText?: (delta: string) => void;
  onRound?: (round: number) => void;
  signal?: AbortSignal;
};

/**
 * One grounded answer. A manual tool loop, streamed: each round streams text, then runs any tool calls against the
 * in-browser database and sends the results back. Stops on refusal, on truncation, or after MAX_ROUNDS.
 */
export async function ask({ question, scope, graph, apiKey, messagesApi, onText, onRound, signal }: AskOptions): Promise<AskResult> {
  const api: Streamer = messagesApi ?? new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 }).messages;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `${scope}\n\nQuestion: ${question}` }];
  const toolResults: unknown[] = [];
  const usage = { input_tokens: 0, output_tokens: 0, usd: 0, rounds: 0 };
  const finish = (msg: Anthropic.Message | null, stopped?: AskResult['stopped']): AskResult => {
    const answer = msg ? msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('') : '';
    usage.usd = usage.input_tokens * PRICE.input + usage.output_tokens * PRICE.output;
    return { answer, issues: stopped === 'refusal' ? [] : validateAnswer(answer, toolResults), toolResults, usage, stopped };
  };

  let last: Anthropic.Message | null = null;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    onRound?.(round);
    const stream = api.stream({
      model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, tools: TOOL_DEFS, messages,
      output_config: { effort: 'low' }, // chat-style questions: lowest effort, fewest tokens
    }, { signal });
    if (onText) stream.on('text', onText);
    const msg = await stream.finalMessage();
    last = msg;
    usage.rounds = round;
    usage.input_tokens += msg.usage.input_tokens;
    usage.output_tokens += msg.usage.output_tokens;

    if (msg.stop_reason === 'refusal') return finish(msg, 'refusal');
    const calls = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!calls.length) return finish(msg);
    if (msg.stop_reason === 'max_tokens') return finish(msg, 'max_tokens'); // never run a truncated tool call

    messages.push({ role: 'assistant', content: msg.content }); // full content: thinking blocks must go back unchanged
    messages.push({
      role: 'user',
      content: calls.map((c) => {
        const { ok, result } = runTool(graph, c.name, c.input);
        if (ok) toolResults.push(result);
        return { type: 'tool_result' as const, tool_use_id: c.id, content: JSON.stringify(result), ...(ok ? {} : { is_error: true }) };
      }),
    });
  }
  return finish(last, 'max_rounds');
}
