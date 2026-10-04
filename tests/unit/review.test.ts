import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { checkProposal, numberForms } from '../../scripts/check-proposals';
import { htmlToText } from '../../scripts/adapters/ir';
import { applyReview } from '../../scripts/review-plugin';
import { LiveBundle, mergeLive } from '../../src/lib/data/live';
import { approvedBundle, normaliseText, Proposal, ProposalFile, type IrDocument } from '../../src/lib/data/proposals';
import { validateGraph } from '../../src/lib/data/schema';
import { concentration } from '../../src/lib/graph/concentration';

const seed = validateGraph(JSON.parse(readFileSync('public/data/seed/seed_graph.json', 'utf8')));
const doc: IrDocument = {
  id: 'tsmc-20f-2025-12-31', entity_id: 'tsmc', title: 'TSMC 20-F', form: '20-F', filed: '2026-04-16', accession: 'x',
  index_url: 'https://www.sec.gov/x', files: [{ name: 'tsm.htm', url: 'https://www.sec.gov/x/tsm.htm', sha256: 'a'.repeat(64) }],
  pages: [{ page: 6, url: 'https://www.sec.gov/x/p006.jpg' }],
};
// Text as EDGAR renders it: stray spaces before commas, words split by inline tags.
const docText = htmlToText('<p>Our largest customer in 2023 , 2024 and 2025 accounted for 25% , 22% and 19% of our net revenue in the respective year.</p><p>AS</span><span>ML now expects</p>');
const proposal = (over: Partial<Proposal> = {}): Proposal => Proposal.parse({
  id: 'p1', kind: 'relation_share', entity_id: 'tsmc', relation_id: 'r_nvda_tsmc', counterparty_label: 'Customer A',
  value: 19, unit: 'pct', period: '2025', evidence: 'text', page: null, locator: 'Item 3.D',
  snippet: 'Our largest customer in 2023, 2024 and 2025 accounted for 25%, 22% and 19% of our net revenue in the respective year.',
  note: '', status: 'pending', ...over,
});

describe('grounding checks', () => {
  it('accepts a verbatim snippet despite EDGAR spacing, and joins words split by inline tags', () => {
    expect(checkProposal(proposal(), doc, docText, seed)).toEqual([]);
    expect(normaliseText(docText)).toContain('ASML now expects');
  });
  it('rejects a snippet that is not in the document', () => {
    expect(checkProposal(proposal({ snippet: 'Our largest customer in 2025 accounted for 19% of revenue' }), doc, docText, seed))
      .toContain('snippet not found verbatim in the document text');
  });
  it('rejects a value that the snippet does not contain (transcription slip)', () => {
    expect(checkProposal(proposal({ value: 18 }), doc, docText, seed)).toContain('value 18 does not appear in the snippet');
    expect(checkProposal(proposal({ value: 2 }), doc, docText, seed)).toContain('value 2 does not appear in the snippet'); // not "22%"
  });
  it('knows millions and billions are the same number', () => {
    expect(numberForms(9.326)).toContain('9,326');
    expect(numberForms(40.2)).toContain('40.20');
  });
  it('requires image evidence to point at a real slide', () => {
    const img = proposal({ kind: 'metric', key: 'hpc_share_of_revenue', relation_id: undefined, value: 66, evidence: 'image', page: 9, snippet: 'Revenue by Platform: HPC 66%' });
    expect(checkProposal(img, doc, docText, seed)).toEqual(['page 9 is not a slide in this document']);
  });
  it('rejects an edge the entity is not part of', () => {
    expect(checkProposal(proposal({ relation_id: 'r_anth_amzn' }), doc, docText, seed)).toContain('relation r_anth_amzn does not involve tsmc');
  });
});

describe('approval turns proposals into facts', () => {
  const file = (status: Proposal['status'], extra: Partial<Proposal> = {}): ProposalFile =>
    ({ document_id: doc.id, extracted_at: 'x', extracted_by: 'test', facts: [proposal({ status, ...extra })] });
  const merged = (f: ProposalFile) => validateGraph(mergeLive(seed, [LiveBundle.parse(approvedBundle([f], [doc], seed.relations))]));

  it('ignores pending and rejected proposals', () => {
    expect(merged(file('pending')).relations.find((r) => r.id === 'r_nvda_tsmc')!.status).toBe('reported');
    expect(merged(file('rejected')).relations.find((r) => r.id === 'r_nvda_tsmc')!.status).toBe('reported');
  });
  it('upgrades the TSMC–Nvidia edge to filed, flagged as an inferred name, citing the filing first', () => {
    const r = merged(file('approved')).relations.find((x) => x.id === 'r_nvda_tsmc')!;
    expect(r).toMatchObject({ status: 'filed_inferred_name', share_pct: 19, confidence: 'high', as_of: '2026-04-16' });
    expect(r.source_ids[0]).toBe('ir_tsmc-20f-2025-12-31');
    expect(r.note).toMatch(/Filed as "Customer A".*inference/);
    expect(r.note).toMatch(/Previously: reported, high confidence/);
  });
  it('uses the edited value and says so', () => {
    const m = merged(file('approved', { kind: 'metric', key: 'capex_guidance', relation_id: undefined, value: 54, low: 52, high: 56, unit: 'USD_bn', period: '2026', reviewed_value: 55 }))
      .metrics.find((x) => x.id === 'p1')!;
    expect(m).toMatchObject({ value: 55, status: 'filed', period: '2026' });
    expect(m.note).toMatch(/edited in review from 54/);
  });
  it('supersedes the seed figure for the same key and period', () => {
    const g = merged(file('approved', { kind: 'metric', key: 'capex_guidance', relation_id: undefined, value: 54, low: 52, high: 56, unit: 'USD_bn', period: '2026' }));
    expect(g.metrics.find((x) => x.id === 'm_tsmc_capex')!.superseded_by).toBe('p1');
  });
  it('shows only the latest share metric per key in concentration', () => {
    const g = merged(file('approved', { kind: 'metric', key: 'hpc_share_of_revenue', relation_id: undefined, value: 66, period: 'Q2 2026', evidence: 'image', page: 6 }));
    const hpc = concentration(g, 'tsmc').filter((r) => r.counterparty.startsWith('HPC'));
    expect(hpc).toHaveLength(1);
    expect(hpc[0]).toMatchObject({ pct: 66, factId: 'p1' });
  });
});

describe('review writer', () => {
  const dir = mkdtempSync(`${tmpdir()}/review-`);
  const write = () => writeFileSync(`${dir}/${doc.id}.json`, JSON.stringify({ document_id: doc.id, extracted_at: 'x', extracted_by: 't', facts: [proposal()] }));
  it('approves, edits, rejects and resets', () => {
    write();
    expect(applyReview({ file: `${doc.id}.json`, id: 'p1', action: 'approve', value: 20 }, 'T', dir).facts[0]).toMatchObject({ status: 'approved', reviewed_value: 20, reviewed_at: 'T' });
    expect(applyReview({ file: `${doc.id}.json`, id: 'p1', action: 'reject' }, 'T', dir).facts[0]).toMatchObject({ status: 'rejected' });
    const reset = applyReview({ file: `${doc.id}.json`, id: 'p1', action: 'reset' }, 'T', dir).facts[0]!;
    expect(reset.status).toBe('pending');
    expect(reset.reviewed_value).toBeUndefined();
  });
  it('refuses path tricks and the index file', () => {
    expect(() => applyReview({ file: '../seed/seed_graph.json', id: 'p1', action: 'approve' }, 'T', dir)).toThrow(/unknown proposals file/);
    expect(() => applyReview({ file: 'index.json', id: 'p1', action: 'approve' }, 'T', dir)).toThrow(/unknown proposals file/);
  });
});
