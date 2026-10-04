import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Graph, Relation } from '../data/schema';
import { concentration } from '../graph/concentration';
import { followMoney } from '../graph/paths';

// Read-only tools over the in-browser database. Every row carries its fact id so the model can cite it.
// Nothing here fetches from the web: the assistant can only state what the database holds.

const Id = z.string().min(1).max(80);
const INPUTS = {
  get_entity: z.object({ id: Id }),
  get_relation: z.object({ id: Id }),
  list_relations: z.object({ entity_id: Id.optional(), type: z.string().optional(), min_usd_bn: z.number().optional() }),
  get_metric: z.object({ entity_id: Id, key: z.string().optional() }),
  find_paths: z.object({ from: Id, to: Id, depth: z.number().int().min(1).max(4) }),
  compute_exposure: z.object({ entity_id: Id }),
  get_claims: z.object({ entity_id: Id }),
} as const;
export type ToolName = keyof typeof INPUTS;

const schema = (properties: Record<string, unknown>, required: string[]) =>
  ({ type: 'object' as const, properties, required, additionalProperties: false });

export const TOOL_DEFS: Anthropic.Tool[] = [
  { name: 'get_entity', description: 'One company: name, tier, type, ticker, whether private.', input_schema: schema({ id: { type: 'string' } }, ['id']) },
  { name: 'get_relation', description: 'One money relationship by relation id, with amount, basis, status, confidence, sources and any dated events.', input_schema: schema({ id: { type: 'string' } }, ['id']) },
  {
    name: 'list_relations',
    description: 'Relationships, optionally filtered to those involving one entity, of one type, or with a disclosed USD amount at or above a floor. Direction is payer to payee.',
    input_schema: schema({ entity_id: { type: 'string' }, type: { type: 'string' }, min_usd_bn: { type: 'number' } }, []),
  },
  { name: 'get_metric', description: "An entity's metrics (all, or one key such as capex_quarter, revenue_ttm, rpo, capex_guidance, market_cap). Superseded figures are marked.", input_schema: schema({ entity_id: { type: 'string' }, key: { type: 'string' } }, ['entity_id']) },
  { name: 'find_paths', description: 'Downstream money paths from one entity to another, up to depth 4. Paths are never summed; each carries a bottleneck only when all hops are disclosed on one basis.', input_schema: schema({ from: { type: 'string' }, to: { type: 'string' }, depth: { type: 'integer', minimum: 1, maximum: 4 } }, ['from', 'to', 'depth']) },
  { name: 'compute_exposure', description: "Who an entity depends on, as shares of its own revenue or backlog, plus its inbound and outbound relationships grouped by amount basis (never summed across bases).", input_schema: schema({ entity_id: { type: 'string' } }, ['entity_id']) },
  { name: 'get_claims', description: 'Claims by named people (e.g. Steve Eisman) that mention an entity, with how to verify each.', input_schema: schema({ entity_id: { type: 'string' } }, ['entity_id']) },
].map((t) => ({ ...t, eager_input_streaming: true })); // inputs are validated with Zod in runTool

const relRow = (g: Graph, r: Relation) => ({
  fact_id: r.id, from: r.from_id, to: r.to_id, type: r.type, amount: r.amount, unit: r.unit, amount_basis: r.amount_basis,
  share_pct: r.share_pct, capacity_gw: r.capacity_gw, period: r.period, status: r.status, confidence: r.confidence, as_of: r.as_of,
  sources: r.source_ids.map((s) => { const x = g.sources.find((y) => y.id === s); return { source_id: s, publisher: x?.publisher, reliability: x?.reliability }; }),
  note: r.note,
});

/** Runs one tool. Unknown ids come back as an explicit "not in the database", never as an error the model could paper over. */
export function runTool(g: Graph, name: string, rawInput: unknown): { ok: boolean; result: unknown } {
  if (!(name in INPUTS)) return { ok: false, result: { error: `unknown tool ${name}` } };
  const parsed = INPUTS[name as ToolName].safeParse(rawInput);
  if (!parsed.success) return { ok: false, result: { error: 'invalid input', issues: parsed.error.issues.map((i) => i.message) } };
  // Zod has validated the shape above; each case reads its own fields.
  const input = parsed.data as { [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const missing = (what: string) => ({ ok: true, result: { not_in_database: what } });
  const entity = (id: string) => g.entities.find((e) => e.id === id);

  switch (name as ToolName) {
    case 'get_entity': {
      const e = entity(input.id);
      return e ? { ok: true, result: { ...e, fact_id: e.id } } : missing(`entity ${input.id}`);
    }
    case 'get_relation': {
      const r = g.relations.find((x) => x.id === input.id);
      if (!r) return missing(`relation ${input.id}`);
      return { ok: true, result: { ...relRow(g, r), events: g.events.filter((e) => e.relation_id === r.id).map((e) => ({ fact_id: e.id, date: e.date, type: e.type, headline: e.headline })) } };
    }
    case 'list_relations': {
      const { entity_id, type, min_usd_bn } = input as { entity_id?: string; type?: string; min_usd_bn?: number };
      const rows = g.relations.filter((r) => (!entity_id || r.from_id === entity_id || r.to_id === entity_id) && (!type || r.type === type)
        && (min_usd_bn === undefined || (r.amount !== null && r.unit === 'USD_bn' && r.amount >= min_usd_bn)));
      return { ok: true, result: { count: rows.length, relations: rows.map((r) => relRow(g, r)) } };
    }
    case 'get_metric': {
      const { entity_id, key } = input as { entity_id: string; key?: string };
      if (!entity(entity_id)) return missing(`entity ${entity_id}`);
      const rows = g.metrics.filter((m) => m.entity_id === entity_id && (!key || m.key === key));
      if (!rows.length) return missing(`metric ${key ?? '(any)'} for ${entity_id}`);
      return { ok: true, result: rows.map((m) => ({ fact_id: m.id, key: m.key, value: m.value, low: m.low, high: m.high, unit: m.unit, period: m.period, status: m.status, confidence: m.confidence, as_of: m.as_of, superseded_by: m.superseded_by ?? null, note: m.note })) };
    }
    case 'find_paths': {
      const { from, to, depth } = input as { from: string; to: string; depth: number };
      if (!entity(from) || !entity(to)) return missing(`entity ${!entity(from) ? from : to}`);
      const paths = followMoney(g, from, { depth }).filter((p) => p.nodes.at(-1) === to).slice(0, 25);
      return { ok: true, result: { count: paths.length, paths: paths.map((p) => ({ nodes: p.nodes, fact_ids: p.edges, closes_loop: p.closesLoop, bottleneck_usd_bn: p.bottleneck, bottleneck_note: p.bottleneckNote })) } };
    }
    case 'compute_exposure': {
      const id = input.entity_id as string;
      if (!entity(id)) return missing(`entity ${id}`);
      const group = (rs: Relation[]) => {
        const by: Record<string, { fact_ids: string[]; disclosed_usd_bn: number[] }> = {};
        for (const r of rs) {
          const b = (by[r.amount_basis] ??= { fact_ids: [], disclosed_usd_bn: [] });
          b.fact_ids.push(r.id);
          if (r.amount !== null && r.unit === 'USD_bn') b.disclosed_usd_bn.push(r.amount);
        }
        return by;
      };
      return { ok: true, result: {
        concentration: concentration(g, id).map((c) => ({ fact_id: c.factId, counterparty: c.counterparty, pct: c.pct, of: c.of, proxy: c.proxy, confidence: c.confidence })),
        inbound_by_basis: group(g.relations.filter((r) => r.to_id === id)),
        outbound_by_basis: group(g.relations.filter((r) => r.from_id === id)),
        note: 'Bases are different measures; do not add across them.',
      } };
    }
    case 'get_claims': {
      const rows = g.claims.filter((c) => c.entity_ids.includes(input.entity_id));
      return { ok: true, result: rows.length ? rows.map((c) => ({ fact_id: c.id, speaker: c.speaker, text: c.text, verify: c.verify })) : { not_in_database: `claims about ${input.entity_id}` } };
    }
  }
}
