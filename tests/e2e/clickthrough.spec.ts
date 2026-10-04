import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const ANSWER = readFileSync('tests/fixtures/ask/grounded.md', 'utf8');

/** A scripted Messages API stream in the wire format: round 1 calls two tools, round 2 answers. */
function sse(round: number): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const start = ev('message_start', { message: { id: `msg_${round}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } });
  if (round === 1) {
    const tool = (i: number, id: string, name: string, input: object) =>
      ev('content_block_start', { index: i, content_block: { type: 'tool_use', id, name, input: {} } })
      + ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } })
      + ev('content_block_stop', { index: i });
    return start + tool(0, 'toolu_1', 'get_relation', { id: 'r_goog_anth' }) + tool(1, 'toolu_2', 'list_relations', { entity_id: 'anthropic' })
      + ev('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 40 } }) + ev('message_stop', {});
  }
  return start + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: ANSWER } }) + ev('content_block_stop', { index: 0 })
    + ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 300 } }) + ev('message_stop', {});
}

async function clickNode(page: Page, id: string) {
  const at = await page.evaluate((nodeId) => {
    const el = document.querySelector('[aria-label^="Money-flow graph"]') as HTMLElement & { _cyreg: { cy: { $id: (i: string) => { renderedPosition: () => { x: number; y: number } } } } };
    const r = el.getBoundingClientRect(), p = el._cyreg.cy.$id(nodeId).renderedPosition();
    return { x: r.left + p.x, y: r.top + p.y };
  }, id);
  await page.mouse.click(at.x, at.y);
}

test('Anthropic → Google equity edge → Ask: fact chips render and the neutrality notice is visible', async ({ page }) => {
  const calls: string[] = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    const body = route.request().postDataJSON() as { model: string; messages: unknown[] };
    calls.push(body.model);
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(body.messages.length > 1 ? 2 : 1) });
  });

  await page.goto('/');
  await expect(page.getByText('Not investment advice.')).toBeVisible();
  await page.waitForFunction(() => !!(document.querySelector('[aria-label^="Money-flow graph"]') as unknown as { _cyreg?: unknown })?._cyreg);
  await page.waitForTimeout(800); // initial layout animation

  await clickNode(page, 'anthropic');
  const drawer = page.getByRole('complementary', { name: 'Details' });
  await expect(drawer.getByRole('heading', { name: 'Anthropic' })).toBeVisible();

  await drawer.getByRole('tab', { name: 'Money' }).click();
  await drawer.getByRole('button', { name: /Alphabet equity/ }).click();
  await expect(drawer.getByRole('heading', { name: 'Alphabet → Anthropic' })).toBeVisible();
  await expect(drawer.getByText('high confidence')).toBeVisible();
  await expect(page).toHaveURL(/e=r_goog_anth/);

  await drawer.getByRole('button', { name: 'Ask about this' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ask about this' });
  await expect(dialog.getByText('Neutrality notice.')).toBeVisible();
  await dialog.getByPlaceholder('sk-ant-…').fill('sk-ant-e2e-placeholder-intercepted');
  await dialog.getByRole('button', { name: 'Ask', exact: true }).click();

  await expect(dialog.getByRole('button', { name: 'r_goog_anth' }).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'r_anth_goog' }).first()).toBeVisible();
  await expect(dialog.getByText('Every number matches a retrieved fact and is cited.')).toBeVisible();
  expect(calls).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5']); // two rounds, Sonnet only, both intercepted

  await dialog.getByRole('button', { name: 'r_anth_goog' }).first().click(); // a chip opens the row it cites
  await expect(page).toHaveURL(/e=r_anth_goog/);
});
