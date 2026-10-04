import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateGraph } from '../../src/lib/data/schema';
import { briefHtml, ledgerCsv } from '../../src/lib/export';

const g = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));

describe('ledger CSV', () => {
  const csv = ledgerCsv(g);
  const lines = csv.trim().split('\n');
  it('has a header and one row per relationship, with source URLs', () => {
    expect(lines[0]).toBe('id,from,to,type,amount,unit,amount_basis,share_pct,capacity_gw,period,status,confidence,as_of,source_ids,source_publishers,source_urls,note');
    expect(lines).toHaveLength(g.relations.length + 1);
    expect(csv).toContain('r_goog_anth,Alphabet,Anthropic,equity,40,USD_bn,up_to');
    expect(csv).toContain('https://www.engadget.com/ai/google-plans-to-invest-even-more-money-into-anthropic');
  });
  it('quotes cells with commas and doubles inner quotes', () => {
    const row = lines.find((l) => l.startsWith('r_meta_goog,'))!;
    expect(row).toContain('"Multi-year TPU rental (""billions""); outright purchase under discussion."');
  });
});

describe('brief', () => {
  it('builds a printable page for a company with figures, money tables and the disclaimers', () => {
    const html = briefHtml(g, { kind: 'node', id: 'tsmc' }, 'http://x/#/?n=tsmc');
    expect(html).toContain('<h1>TSMC</h1>');
    expect(html).toContain('@page { size: A4');
    expect(html).toMatch(/Is paid by[\s\S]*Nvidia → TSMC/);
    expect(html).toContain('Not investment advice.');
    expect(html).toContain('Anthropic is a node in this graph');
  });
  it('builds an edge brief with the plain-English direction, and escapes text', () => {
    const html = briefHtml(g, { kind: 'edge', id: 'r_goog_apple' }, 'x');
    expect(html).toContain('Alphabet pays Apple under a licence');
    expect(html).toContain('&quot;tens of billions&quot;');
    expect(html).not.toContain('"tens of billions"');
  });
});
