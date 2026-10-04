import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { bloomberg } from '../../scripts/adapters/bloomberg';
import { ft } from '../../scripts/adapters/ft';
import { allQuery, parseGdelt } from '../../scripts/adapters/gdelt';
import { clusterHeadlines, connectedPairs, entitiesIn, isDealHeadline, LicenceRequiredError } from '../../scripts/adapters/news';
import { parseFeed } from '../../scripts/adapters/rss';
import { checkNewsProposal } from '../../scripts/check-proposals';
import { LiveBundle, mergeLive } from '../../src/lib/data/live';
import { approvedNewsBundle, NewsProposal, type Cluster, type Headline, type NewsProposalFile } from '../../src/lib/data/news';
import { validateGraph } from '../../src/lib/data/schema';

const seed = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));
const h = (title: string, url: string, seen = '2026-10-02T05:45:00Z'): Headline => ({ title, url, domain: new URL(url).hostname, seen, source: 'gdelt' });
const LOAN = 'Broadcom to lend Anthropic up to $42 billion to lease its chips , filing says';

describe('GDELT and RSS parsing', () => {
  it('reads GDELT articles and turns its throttling text into an error', () => {
    const got = parseGdelt(JSON.stringify({ articles: [{ url: 'https://x.com/a', title: LOAN, seendate: '20261002T054500Z', domain: 'x.com' }] }));
    expect(got[0]).toMatchObject({ title: LOAN, seen: '2026-10-02T05:45:00Z', source: 'gdelt' });
    expect(() => parseGdelt('Please limit requests to one every 5 seconds')).toThrow(/GDELT: Please limit/);
    expect(parseGdelt('{}')).toEqual([]);
  });
  it('asks GDELT once for every company with the deal terms', () => {
    expect(allQuery()).toMatch(/^\(OpenAI OR Anthropic OR .*"Taiwan Semiconductor"|^\(OpenAI OR Anthropic OR .* OR ASML\) \(invest OR commitment OR gigawatt OR capacity OR agreement\)$/);
    expect(allQuery()).toContain('(invest OR commitment OR gigawatt OR capacity OR agreement)');
  });
  it('reads RSS items and Atom entries, CDATA and entities included', () => {
    const rss = '<rss><channel><item><title><![CDATA[Nvidia &amp; OpenAI sign 10 GW deal]]></title><link>https://n.com/1</link><pubDate>Thu, 01 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>';
    const atom = '<feed><entry><title>Google invests</title><link href="https://g.com/2"/><updated>2026-10-01T09:00:00Z</updated></entry></feed>';
    expect(parseFeed(rss)).toEqual([{ title: 'Nvidia & OpenAI sign 10 GW deal', url: 'https://n.com/1', domain: 'n.com', seen: '2026-10-01T12:00:00.000Z', source: 'rss' }]);
    expect(parseFeed(atom)[0]).toMatchObject({ title: 'Google invests', url: 'https://g.com/2' });
  });
});

describe('tagging and clustering', () => {
  it('names companies case-sensitively and keeps only deal headlines', () => {
    expect(entitiesIn(LOAN)).toEqual(['anthropic', 'broadcom']);
    expect(entitiesIn('A meta-analysis of chips')).toEqual([]);
    expect(isDealHeadline(LOAN)).toBe(true);
    expect(isDealHeadline('Anthropic hires a new head of policy')).toBe(false);
  });
  it('groups the same story from different outlets and keeps different stories apart', () => {
    const cs = clusterHeadlines([], [
      h(LOAN, 'https://a.com/1'),
      h('Broadcom will lend Anthropic up to $42 billion to lease chips, filing shows', 'https://b.com/2', '2026-10-02T09:00:00Z'),
      h('SoftBank closes $30b investment in OpenAI', 'https://c.com/3'),
      h('Anthropic hires a new head of policy', 'https://d.com/4'),
    ], new Date('2026-10-04'));
    expect(cs).toHaveLength(2);
    const loan = cs.find((c) => c.entity_ids.includes('broadcom'))!;
    expect(loan.headlines).toHaveLength(2);
    expect(loan.last_seen).toBe('2026-10-02T09:00:00Z');
  });
  it('skips URLs it has seen, reopens a triaged story on new coverage, drops stale stories', () => {
    const old: Cluster = { id: 'c1', entity_ids: ['anthropic', 'broadcom'], first_seen: '2026-10-02T05:45:00Z', last_seen: '2026-10-02T05:45:00Z',
      headlines: [h(LOAN, 'https://a.com/1')], triage: { result: 'no_change', note: '', at: 'x' } };
    const stale: Cluster = { ...old, id: 'c0', headlines: [h('Oracle signs deal', 'https://o.com/0', '2026-07-01T00:00:00Z')], last_seen: '2026-07-01T00:00:00Z', triage: undefined };
    const cs = clusterHeadlines([old, stale], [h(LOAN, 'https://a.com/1'), h('Broadcom to lend Anthropic up to $42 billion to lease its chips', 'https://e.com/5', '2026-10-03T00:00:00Z')], new Date('2026-10-04'));
    expect(cs.map((c) => c.id)).toEqual(['c1']);
    expect(cs[0]!.headlines).toHaveLength(2);
    expect(cs[0]!.triage).toBeUndefined();
  });
  it('queries each connected pair once', () => {
    const pairs = connectedPairs(seed.relations);
    expect(pairs).toContainEqual(['amazon', 'anthropic']);
    expect(new Set(pairs.map((p) => p.join('|'))).size).toBe(pairs.length);
  });
});

describe('licensed stubs', () => {
  afterEach(() => { delete process.env.ENABLE_BLOOMBERG; });
  it('are disabled by default and refuse with "licence required" even when enabled', async () => {
    expect(bloomberg.enabled()).toBe(false);
    expect(ft.enabled()).toBe(false);
    process.env.ENABLE_BLOOMBERG = 'true';
    expect(bloomberg.enabled()).toBe(true);
    await expect(bloomberg.fetch([], 1)).rejects.toBeInstanceOf(LicenceRequiredError);
    await expect(bloomberg.fetch([], 1)).rejects.toThrow(/licence required/);
    await expect(ft.fetch([], 1)).rejects.toThrow(/licence required/);
  });
});

describe('news proposals', () => {
  const story: Cluster = { id: 'c_loan', entity_ids: ['anthropic', 'broadcom'], first_seen: 'x', last_seen: 'x', headlines: [h(LOAN, 'https://a.com/1')] };
  const loan = (over: Partial<NewsProposal> = {}) => NewsProposal.parse({
    id: 'n1', kind: 'new_relation', cluster_id: 'c_loan', headline: LOAN, url: 'https://a.com/1', publisher: 'a.com', date: '2026-10-02T05:45:00Z',
    event_type: 'announced', note: '', status: 'pending',
    proposed: { from_id: 'broadcom', to_id: 'anthropic', type: 'debt', amount: 42, unit: 'USD_bn', amount_basis: 'up_to' }, ...over,
  });
  it('accepts a grounded proposal and rejects altered headlines or numbers', () => {
    expect(checkNewsProposal(loan(), [story], seed)).toEqual([]);
    expect(checkNewsProposal(loan({ headline: 'Broadcom lends Anthropic $42 billion' }), [story], seed)).toContain('headline/url not found verbatim in the story');
    expect(checkNewsProposal(loan({ proposed: { from_id: 'broadcom', to_id: 'anthropic', type: 'debt', amount: 4.2, unit: 'USD_bn', amount_basis: 'up_to', share_pct: null, capacity_gw: null, period: null } }), [story], seed))
      .toContain('amount 4.2 does not appear in the headline');
  });
  it('adds an approved new edge as reported, medium confidence, with an announced event', () => {
    const file: NewsProposalFile = { origin: 'news', created_at: 'x', extracted_by: 't', facts: [loan({ status: 'approved' })] };
    const g = validateGraph(mergeLive(seed, [LiveBundle.parse(approvedNewsBundle([file], seed.relations))]));
    const r = g.relations.find((x) => x.id === 'news_broadcom_anthropic_debt')!;
    expect(r).toMatchObject({ from_id: 'broadcom', to_id: 'anthropic', amount: 42, amount_basis: 'up_to', status: 'reported', confidence: 'medium', as_of: '2026-10-02' });
    expect(g.events).toEqual([expect.objectContaining({ relation_id: r.id, type: 'announced', headline: LOAN })]);
    expect(g.relations).toHaveLength(seed.relations.length + 1);
  });
  it('revises an amount and records a revised event', () => {
    const file: NewsProposalFile = { origin: 'news', created_at: 'x', extracted_by: 't', facts: [NewsProposal.parse({
      id: 'n2', kind: 'amount_change', cluster_id: 'c', headline: 'SoftBank closes $30b investment in OpenAI', url: 'https://c.com/3', publisher: 'c.com',
      date: '2026-10-01T00:00:00Z', relation_id: 'r_sb_openai', amount: 30, amount_basis: 'invested', event_type: 'closed', note: '', status: 'approved' })] };
    const g = validateGraph(mergeLive(seed, [LiveBundle.parse(approvedNewsBundle([file], seed.relations))]));
    const r = g.relations.find((x) => x.id === 'r_sb_openai')!;
    expect(r).toMatchObject({ amount: 30, amount_basis: 'invested', as_of: '2026-10-01' });
    expect(r.source_ids[0]).toBe('news_c');
    expect(g.events[0]).toMatchObject({ type: 'closed', relation_id: 'r_sb_openai' });
  });
  it('ignores pending news', () => {
    const file: NewsProposalFile = { origin: 'news', created_at: 'x', extracted_by: 't', facts: [loan()] };
    expect(approvedNewsBundle([file], seed.relations).relations).toEqual([]);
  });
});
