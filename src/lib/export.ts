import type { Core } from 'cytoscape';
import type { Graph } from './data/schema';
import { directionSentence, entityName, fmtAmount, fmtMoney, humanise } from './fmt';
import { concentration } from './graph/concentration';
import { TYPE_COLOUR } from './graph/view';

export function download(name: string, data: Blob | string, type = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const DASH: Record<string, string> = { solid: '', dashed: '8 5', dotted: '1.5 5' };

/** Vector copy of what is on screen: visible nodes and edges, same colours, widths, dashes and fades. */
export function canvasSvg(cy: Core): string {
  const bb = cy.elements(':visible').boundingBox();
  const pad = 30, w = bb.w + pad * 2, h = bb.h + pad * 2;
  const markers = Object.entries(TYPE_COLOUR).map(([t, c]) =>
    `<marker id="a-${t}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="${c}"/></marker>`).join('');
  const edges = cy.edges(':visible').map((e) => {
    const s = e.sourceEndpoint(), t = e.targetEndpoint();
    const cp = e.controlPoints()?.[0];
    const d = cp ? `M${s.x},${s.y} Q${cp.x},${cp.y} ${t.x},${t.y}` : `M${s.x},${s.y} L${t.x},${t.y}`;
    const type = graphType(e.data('colour'));
    const op = e.hasClass('faded') ? 0.1 : e.data('opacity');
    return `<path d="${d}" fill="none" stroke="${e.data('colour')}" stroke-width="${e.data('w')}" stroke-dasharray="${DASH[e.data('lineStyle')] ?? ''}" opacity="${op}" marker-end="url(#a-${type})"><title>${esc(e.id())}</title></path>`;
  }).join('');
  const nodes = cy.nodes('.company:visible').map((n) => {
    const p = n.position(), r = n.data('size') / 2, op = n.hasClass('faded') ? 0.15 : 1;
    return `<g opacity="${op}"><circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${n.data('colour')}"/><text x="${p.x}" y="${p.y + r + 13}" font-size="11" text-anchor="middle" fill="#1B2A4A">${esc(n.data('label'))}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${bb.x1 - pad} ${bb.y1 - pad} ${w} ${h}" font-family="system-ui, sans-serif">`
    + `<defs>${markers}</defs><rect x="${bb.x1 - pad}" y="${bb.y1 - pad}" width="${w}" height="${h}" fill="#FAFBFD"/>${edges}${nodes}`
    + `<text x="${bb.x1}" y="${bb.y2 + pad - 6}" font-size="10" fill="#64748b">AI Chain Explorer · not investment advice · ${new Date().toISOString().slice(0, 10)}</text></svg>`;
}
const graphType = (colour: string) => Object.entries(TYPE_COLOUR).find(([, c]) => c === colour)?.[0] ?? 'equity';

export const canvasPng = (cy: Core) => cy.png({ output: 'blob', full: true, scale: 2, bg: '#FAFBFD' });

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** The relationship ledger: one row per edge with every provenance field and the source URLs. */
export function ledgerCsv(g: Graph): string {
  const src = new Map(g.sources.map((s) => [s.id, s]));
  const name = entityName(g.entities);
  const head = ['id', 'from', 'to', 'type', 'amount', 'unit', 'amount_basis', 'share_pct', 'capacity_gw', 'period', 'status', 'confidence', 'as_of', 'source_ids', 'source_publishers', 'source_urls', 'note'];
  const rows = g.relations.map((r) => [r.id, name(r.from_id), name(r.to_id), r.type, r.amount, r.unit, r.amount_basis, r.share_pct, r.capacity_gw, r.period, r.status, r.confidence, r.as_of,
    r.source_ids.join(' '), r.source_ids.map((s) => src.get(s)?.publisher ?? '').join(' | '), r.source_ids.map((s) => src.get(s)?.url ?? '').join(' '), r.note]);
  return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

/** A one-page brief for the current selection, as printable HTML (the browser's "Save as PDF" makes the PDF). */
export function briefHtml(g: Graph, sel: { kind: 'node' | 'edge'; id: string } | null, link: string): string {
  const name = entityName(g.entities);
  const srcName = (id: string) => g.sources.find((s) => s.id === id)?.publisher ?? id;
  const relRow = (r: Graph['relations'][number]) =>
    `<tr><td>${esc(name(r.from_id))} → ${esc(name(r.to_id))}</td><td>${esc(humanise(r.type))}</td><td>${esc(fmtAmount(r))}</td><td>${r.status.replaceAll('_', ' ')}, ${r.confidence}</td><td>${esc(r.source_ids.map(srcName).join('; '))}</td><td class="id">${r.id}</td></tr>`;
  let title = 'AI Chain Explorer: overview', body = '';
  if (sel?.kind === 'edge') {
    const r = g.relations.find((x) => x.id === sel.id);
    if (r) {
      title = `${name(r.from_id)} → ${name(r.to_id)}`;
      body = `<p class="lead">${esc(directionSentence(r, name))}</p><table>${relRow(r)}</table>${r.note ? `<p>${esc(r.note)}</p>` : ''}`
        + `<h2>Same pair</h2><table>${g.relations.filter((x) => x.id !== r.id && [x.from_id, x.to_id].sort().join() === [r.from_id, r.to_id].sort().join()).map(relRow).join('') || '<tr><td>None.</td></tr>'}</table>`;
    }
  } else if (sel?.kind === 'node') {
    const e = g.entities.find((x) => x.id === sel.id);
    if (e) {
      title = e.name;
      const ms = g.metrics.filter((m) => m.entity_id === e.id && !m.superseded_by && m.key !== 'market_cap').slice(0, 10);
      const conc = concentration(g, e.id);
      body = `<p class="lead">Tier ${e.tier} · ${esc(humanise(e.type))}${e.ticker ? ` · ${esc(e.ticker)}` : ''}${e.private ? ' · private' : ''}</p>`
        + `<h2>Key figures</h2><table>${ms.map((m) => `<tr><td>${esc(humanise(m.key))}</td><td>${esc(fmtMoney(m.value, m.unit))} ${esc(m.period)}</td><td>${m.status.replaceAll('_', ' ')}, ${m.confidence}</td><td>${esc(m.source_ids.map(srcName).join('; '))}</td><td class="id">${m.id}</td></tr>`).join('') || '<tr><td>None in the database.</td></tr>'}</table>`
        + `<h2>Pays</h2><table>${g.relations.filter((r) => r.from_id === e.id).map(relRow).join('') || '<tr><td>None.</td></tr>'}</table>`
        + `<h2>Is paid by</h2><table>${g.relations.filter((r) => r.to_id === e.id).map(relRow).join('') || '<tr><td>None.</td></tr>'}</table>`
        + (conc.length ? `<h2>Concentration</h2><table>${conc.map((c) => `<tr><td>${esc(c.counterparty)}</td><td>${c.pct}% of ${esc(c.of)}${c.proxy ? ' (proxy)' : ''}</td><td>${c.confidence}</td><td class="id">${c.factId}</td></tr>`).join('')}</table>` : '');
    }
  }
  if (!body) body = `<p class="lead">${g.entities.length} companies, ${g.relations.length} relationships. Select a company or relationship for a focused brief.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} · brief</title><style>
    @page { size: A4; margin: 14mm } body { font: 10.5px/1.4 system-ui, sans-serif; color: #1B2A4A; margin: 0 }
    h1 { font-size: 18px; margin: 0 0 2px } h2 { font-size: 12px; margin: 12px 0 4px; border-bottom: 1px solid #C9A227 }
    .lead { font-size: 12px } table { width: 100%; border-collapse: collapse } td { padding: 2px 4px; border-bottom: 1px solid #e2e8f0; vertical-align: top }
    .id { color: #94a3b8; font-size: 9px } footer { margin-top: 14px; font-size: 9px; color: #475569; border-top: 1px solid #e2e8f0; padding-top: 4px }
  </style></head><body><h1>${esc(title)}</h1><p class="id">AI Chain Explorer brief · ${new Date().toISOString().slice(0, 10)} · ${esc(link)}</p>${body}
  <footer><strong>Not investment advice.</strong> Every figure carries its status and confidence; "reported" and "claimed" figures are not filings.
  Neutrality: Anthropic is a node in this graph and the analysis assistant is built by Anthropic.</footer></body></html>`;
}

export function printBrief(html: string) {
  const w = window.open('', '_blank');
  if (!w) return false; // popup blocked
  w.document.write(html);
  w.document.close(); // written synchronously, so it is ready to print
  w.focus();
  w.print();
  return true;
}
