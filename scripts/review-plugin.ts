import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { NewsProposalFile } from '../src/lib/data/news.ts';
import { ProposalFile } from '../src/lib/data/proposals.ts';

const PROPOSALS_DIR = 'public/data/proposals';

export type ReviewAction = { file: string; id: string; action: 'approve' | 'reject' | 'reset'; value?: number };

/** Applies one review decision to a proposals file. Pure apart from the file read/write. */
export function applyReview(a: ReviewAction, now = new Date().toISOString(), DIR = PROPOSALS_DIR): ProposalFile | NewsProposalFile {
  if (!/^[\w.-]+\.json$/.test(a.file) || a.file === 'index.json' || !existsSync(`${DIR}/${a.file}`)) throw new Error('unknown proposals file');
  const raw = JSON.parse(readFileSync(`${DIR}/${a.file}`, 'utf8'));
  const pf = raw.origin === 'news' ? NewsProposalFile.parse(raw) : ProposalFile.parse(raw);
  const p = (pf.facts as { id: string; status: string; value?: number; reviewed_value?: number; reviewed_at?: string }[]).find((x) => x.id === a.id);
  if (!p) throw new Error(`unknown proposal ${a.id}`);
  delete p.reviewed_value;
  delete p.reviewed_at;
  if (a.action === 'reset') p.status = 'pending';
  else {
    p.status = a.action === 'approve' ? 'approved' : 'rejected';
    p.reviewed_at = now;
    if (a.action === 'approve' && a.value !== undefined && Number.isFinite(a.value) && a.value !== p.value) p.reviewed_value = a.value;
    // News edits carry their figure in `proposed.amount` / `amount`; the edited value replaces it on approval.
  }
  writeFileSync(`${DIR}/${a.file}`, JSON.stringify(pf, null, 1) + '\n');
  return pf;
}

/**
 * Dev-server only (`pnpm dev`): POST /__review writes decisions into public/data/proposals. The published static
 * site has no such endpoint; there, review happens by pull request.
 */
export function reviewPlugin(): Plugin {
  return {
    name: 'review-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__review', (req, res) => {
        const origin = req.headers.origin ?? '';
        if (req.method !== 'POST' || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          res.statusCode = 403; res.end(); return; // only the local app may write
        }
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 10_000) req.destroy(); });
        req.on('end', () => {
          res.setHeader('content-type', 'application/json');
          try { res.end(JSON.stringify(applyReview(JSON.parse(body)))); }
          catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: (e as Error).message })); }
        });
      });
    },
  };
}
