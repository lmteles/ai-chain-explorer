import type { Graph } from '../data/schema';
import { baseFor, exposures, type Base, type Denominator, type Exposure } from './exposure';

export type Shock =
  | { kind: 'node'; id: string; pct: number }                                         // a payer cuts all its payments
  | { kind: 'edge'; id: string; pct: number }                                         // one relationship is cut
  | { kind: 'direct'; entity: string; share: number; pct: number; label: string };    // a stated slice of revenue is cut

export type Scenario = {
  mode: 'demand' | 'supply';
  shocks: Shock[];
  damping: number;          // 0 = first order only; otherwise the share of a revenue loss passed on as a spending cut
  horizonYears: number;
  overrides: Record<string, number | null>; // exposure id → share (0–1); null removes it
  dependence?: Record<string, number>;      // supply mode: how much of a buyer's output depends on the shocked supplier
};

export type Impact = {
  entity: string;
  denominator: Denominator;
  fraction: number;          // share of the base lost
  amount: number | null;     // per year, in the base's unit
  overHorizon: number | null;
  base: Base | null;
  path: string[];            // fact ids on the path that carries most of this loss
  pathNodes: string[];
  estimate: boolean;         // any estimated share on any contributing path
};

export type SimResult = { impacts: Impact[]; used: Exposure[]; notComputable: Exposure[] };

const MAX_WAVES = 4;

/**
 * First-order illustration, not a forecast. Demand mode: a cut by payer i removes shock_i × share_{j←i} of payee j's
 * revenue (or backlog), i.e. delta_j = Σ shock_i × share_{j←i} × base_j. With damping d > 0, each payee that lost a
 * fraction f of revenue then cuts its own spending by d × f, passed only to lower tiers (so it cannot loop), for up
 * to four waves. Supply mode: a supplier that cannot deliver cuts each buyer's output by shock × dependence.
 */
export function simulate(g: Graph, s: Scenario): SimResult {
  const tier = new Map(g.entities.map((e) => [e.id, e.tier]));
  const all = exposures(g).map((e) => (e.id in s.overrides
    ? { ...e, share: s.overrides[e.id]!, method: e.share === null ? 'not computable' : e.method, estimate: true, note: `${e.note ? `${e.note}; ` : ''}share set by user` } as Exposure
    : e));
  const usable = all.filter((e) => e.share !== null && e.share > 0);
  type Acc = { fraction: number; best: number; path: string[]; pathNodes: string[]; estimate: boolean };
  const acc = new Map<string, Acc>(); // key: entity|denominator
  const used = new Map<string, Exposure>();
  const touched = new Set<string>();

  const add = (entity: string, d: Denominator, f: number, path: string[], pathNodes: string[], estimate: boolean) => {
    const k = `${entity}|${d}`;
    const a = acc.get(k) ?? { fraction: 0, best: -1, path: [], pathNodes: [], estimate: false };
    a.fraction = Math.min(1, a.fraction + f);
    a.estimate ||= estimate;
    if (f > a.best) Object.assign(a, { best: f, path, pathNodes });
    acc.set(k, a);
  };

  type Src = { payer: string; fraction: number; path: string[]; pathNodes: string[]; estimate: boolean; depth: number };
  let wave: Src[] = [];
  // A hit on payee j through exposure e; with damping, j passes d × its loss on as a spending cut.
  const hit = (e: Exposure, f: number, from: Pick<Src, 'path' | 'pathNodes' | 'estimate' | 'depth'>, next: Src[]) => {
    if (f <= 1e-9) return;
    used.set(e.id, e);
    const path = [...from.path, e.id], pathNodes = [...(from.pathNodes.length ? from.pathNodes : [e.payer]), e.payee];
    const estimate = from.estimate || e.estimate;
    add(e.payee, e.denominator, f, path, pathNodes, estimate);
    if (s.damping > 0 && e.denominator === 'revenue') next.push({ payer: e.payee, fraction: f * s.damping, path, pathNodes, estimate, depth: from.depth + 1 });
  };

  if (s.mode === 'supply') {
    for (const sh of s.shocks) {
      if (sh.kind !== 'node') continue;
      const supplies = g.relations.filter((x) => x.to_id === sh.id && ['wafer_purchase', 'tool_purchase', 'chip_purchase'].includes(x.type));
      supplies.forEach((r) => touched.add(r.id));
      // One hit per buyer however many supply edges it has. The dependence figure is always an assumption:
      // the data says who buys, not who could buy elsewhere.
      for (const buyer of new Set(supplies.map((r) => r.from_id))) {
        const via = supplies.filter((r) => r.from_id === buyer).map((r) => r.id);
        add(buyer, 'revenue', (sh.pct / 100) * (s.dependence?.[buyer] ?? 1), via, [sh.id, buyer], true);
      }
    }
  } else {
    for (const sh of s.shocks) {
      if (sh.kind === 'node') {
        wave.push({ payer: sh.id, fraction: sh.pct / 100, path: [], pathNodes: [sh.id], estimate: false, depth: 0 });
        for (const e of all) if (e.payer === sh.id) touched.add(e.id);
      } else if (sh.kind === 'edge') {
        touched.add(sh.id);
        const e = usable.find((x) => x.id === sh.id);
        if (e) hit(e, (sh.pct / 100) * e.share!, { path: [], pathNodes: [], estimate: false, depth: 0 }, wave);
      } else {
        const f = (sh.pct / 100) * sh.share;
        add(sh.entity, 'revenue', f, [], [sh.label, sh.entity], true);
        if (s.damping > 0) wave.push({ payer: sh.entity, fraction: f * s.damping, path: [], pathNodes: [sh.label, sh.entity], estimate: true, depth: 1 });
      }
    }
    for (let w = 0; w <= MAX_WAVES && wave.length; w++) {
      const next: Src[] = [];
      for (const src of wave) {
        for (const e of all.filter((x) => x.payer === src.payer)) {
          touched.add(e.id);
          if (!e.share) continue;
          // Second-order cuts only flow down the tiers, so a loop cannot feed itself.
          if (src.depth > 0 && (tier.get(e.payee) ?? 0) <= (tier.get(src.payer) ?? 0)) continue;
          hit(e, src.fraction * e.share, src, next);
        }
      }
      wave = next;
    }
  }

  const impacts: Impact[] = [...acc].map(([k, a]) => {
    const [entity, denominator] = k.split('|') as [string, Denominator];
    const base = baseFor(g, entity, denominator);
    const amount = base ? a.fraction * base.value : null;
    return {
      entity, denominator, fraction: a.fraction, amount, base, path: a.path, pathNodes: a.pathNodes, estimate: a.estimate,
      // A backlog is a stock, not a yearly flow: the horizon does not multiply it.
      overHorizon: amount === null ? null : denominator === 'backlog' ? amount : amount * s.horizonYears,
    };
  });
  impacts.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1) || b.fraction - a.fraction);
  return { impacts, used: [...used.values()], notComputable: all.filter((e) => touched.has(e.id) && (e.share === null || e.share === 0)) };
}

export type Preset = { id: string; title: string; why: string; scenario: Scenario };

export const PRESETS: Preset[] = [
  {
    id: 'openai-underfunds', title: 'OpenAI under-funds its commitments',
    why: 'OpenAI pays 30% less than it committed. Oracle is the headline exposure: about half its RPO is OpenAI (Eisman, and the seed edge).',
    scenario: { mode: 'demand', shocks: [{ kind: 'node', id: 'openai', pct: 30 }], damping: 0, horizonYears: 1, overrides: {} },
  },
  {
    id: 'anthropic-stalls', title: 'Anthropic growth stalls',
    why: 'Anthropic spends 30% less than committed on compute. Symmetrical with the OpenAI preset.',
    scenario: { mode: 'demand', shocks: [{ kind: 'node', id: 'anthropic', pct: 30 }], damping: 0, horizonYears: 1, overrides: {} },
  },
  {
    id: 'nvidia-customer', title: 'Nvidia customer concentration event',
    why: 'One of the five customers behind 70% of Nvidia receivables cuts orders by 30%. The 14% slice assumes the five are equal (70% ÷ 5) and uses receivables as a stand-in for revenue: edit it.',
    scenario: { mode: 'demand', shocks: [{ kind: 'direct', entity: 'nvidia', share: 0.14, pct: 30, label: 'one top-five customer' }], damping: 0.5, horizonYears: 1, overrides: {} },
  },
  {
    id: 'tsmc-capacity', title: 'TSMC capacity shock',
    why: 'TSMC can deliver 20% less. Buyers lose output in proportion to how much of it depends on TSMC (100% by default: no second source). A supply shock, so it runs upstream, not down.',
    scenario: { mode: 'supply', shocks: [{ kind: 'node', id: 'tsmc', pct: 20 }], damping: 0, horizonYears: 1, overrides: {}, dependence: { nvidia: 1, apple: 1, amd: 1, broadcom: 1, tesla: 0.5 } },
  },
  {
    id: 'yield-5', title: '10-year yield above 5%',
    why: "Eisman's trigger. The data holds no model of rates, so this is an explicit assumption: the debt-funded builder (Oracle, BBB-) cuts its chip purchases by 20%.",
    scenario: { mode: 'demand', shocks: [{ kind: 'node', id: 'oracle', pct: 20 }], damping: 0.5, horizonYears: 1, overrides: {} },
  },
];
