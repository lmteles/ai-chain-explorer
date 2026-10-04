import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateGraph, type Graph } from '../../src/lib/data/schema';

const raw = JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8'));
const g: Graph = validateGraph(raw);
const rel = (id: string) => g.relations.find((r) => r.id === id)!;
const clone = (): any => structuredClone(raw);

describe('seed graph', () => {
  it('has the expected counts', () => {
    expect([g.entities.length, g.relations.length, g.metrics.length, g.sources.length, g.claims.length])
      .toEqual([16, 34, 17, 16, 5]);
  });

  it('gives every relation and metric a status and confidence', () => {
    for (const f of [...g.relations, ...g.metrics]) {
      expect(f.status, f.id).toBeTruthy();
      expect(f.confidence, f.id).toBeTruthy();
    }
  });

  it('never marks a stated amount as undisclosed', () => {
    for (const r of g.relations) if (r.amount !== null) expect(r.amount_basis, r.id).not.toBe('undisclosed');
  });

  it('follows the direction rule (payer to payee)', () => {
    const dir = (id: string) => [rel(id).from_id, rel(id).to_id];
    expect(dir('r_amzn_anth')).toEqual(['amazon', 'anthropic']);       // equity: investor to investee
    expect(dir('r_anth_amzn')).toEqual(['anthropic', 'amazon']);       // commitment: lab to cloud
    expect(dir('r_nvda_tsmc')).toEqual(['nvidia', 'tsmc']);            // wafers: buyer to fab
    expect(dir('r_tsmc_asml')).toEqual(['tsmc', 'asml']);              // tools: fab to toolmaker
    expect(dir('r_goog_apple')).toEqual(['alphabet', 'apple']);        // licence: payer to licensor
  });

  it('labels ownership stakes and proxies with their own basis', () => {
    expect(rel('r_msft_openai').amount_basis).toBe('ownership_pct');
    expect(rel('r_tsmc_asml').amount_basis).toBe('proxy_share');
  });
});

describe('validateGraph rejects bad data', () => {
  const broken = (mutate: (d: any) => void, msg: RegExp) => {
    const d = clone();
    mutate(d);
    expect(() => validateGraph(d)).toThrow(msg);
  };

  it('a relation to a missing entity', () => broken((d) => { d.relations[0].to_id = 'nobody'; }, /unknown to_id nobody/));
  it('a missing source', () => broken((d) => { d.metrics[0].source_ids = ['s_ghost']; }, /unknown source s_ghost/));
  it('an amount with undisclosed basis', () => broken((d) => {
    const r = d.relations.find((x: any) => x.id === 'r_oracle_nvda'); r.amount = 5;
  }, /basis undisclosed/));
  it('confidence above the source', () => broken((d) => {
    d.relations.find((x: any) => x.id === 'r_openai_msft').confidence = 'high';
  }, /exceeds what its sources support/));
  it('duplicate fact ids', () => broken((d) => { d.metrics[1].id = d.metrics[0].id; }, /duplicate id/));
  it('a missing status (schema)', () => broken((d) => { delete d.relations[0].status; }, /status/));
});

describe('links are web links only', () => {
  it('rejects javascript: and data: URLs from untrusted feeds', async () => {
    const { webUrl } = await import('../../src/lib/data/schema');
    expect(webUrl.safeParse('https://www.sec.gov/x').success).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x', 'https://a b']) expect(webUrl.safeParse(bad).success, bad).toBe(false);
  });
});
