import { AxeBuilder } from '@axe-core/playwright';
import type { AiModelListAnswer } from '@monstera/contract';
import { expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A provider key's Check in Settings › AI (the owner's item 17b, ADR-0158), through the real application: the button
 * reports, the command asks `ai.models`, and the reply is drawn into the dialog that is still open.
 *
 * The shim stands in for main and the provider at once: what `ai.models` answers is the stubbed provider's answer, and
 * the cases name the three the owner asked for, ACCEPTED, REFUSED and OFFLINE. Main's half, that `ai.models` asks the
 * provider with the stored key and reads its answer into these three, is `assistant.test.ts` and `aiModels.test.ts`,
 * each against a stubbed fetch.
 */

const BLOCKING = new Set(['serious', 'critical']);
const STORED = { 'ai.anthropic-key': 'example-key-stored' };

const ACCEPTED: AiModelListAnswer = {
  source: 'fetched',
  models: [{ id: 'claude-checked', label: 'Claude checked', capabilities: { vision: true, streaming: true } }],
};

const ANSWERS: readonly { readonly name: string; readonly listed: AiModelListAnswer; readonly says: RegExp; readonly tick: boolean }[] = [
  { name: 'ACCEPTED', listed: ACCEPTED, says: /^Key works$/u, tick: true },
  {
    name: 'REFUSED',
    listed: { source: 'fallback', problem: 'unauthorised', models: [] },
    says: /^Anthropic did not accept this key\./u,
    tick: false,
  },
  {
    name: 'OFFLINE',
    listed: { source: 'fallback', problem: 'unreachable', models: [] },
    says: /^Anthropic could not be reached\./u,
    tick: false,
  },
];

for (const look of LOOKS) {
  for (const answer of ANSWERS) {
    test(`${look.name}: a key check the provider answers ${answer.name} is said under the key, in the open dialog`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const asked: string[] = [];
      await bridgeUnder(page, look, { secrets: STORED, aiModels: answer.listed }, (channel) => {
        asked.push(channel);
      });
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
      await page.getByRole('button', { name: 'Settings' }).click();
      const dialog = page.getByRole('dialog', { name: 'Settings' });
      await dialog.getByRole('button', { name: 'AI', exact: true }).click();

      await dialog.getByRole('button', { name: 'Check' }).click();
      const line = dialog.locator('[role="status"][data-key-check]');
      await expect(line).toHaveText(answer.says);
      await expect(line.locator('svg')).toHaveCount(answer.tick ? 1 : 0);
      // ASKED OF MAIN, by the provider and no key: the one channel that reaches a provider was called for the check.
      expect(asked).toContain('ai.models');
      // THE SAME DIALOG, still on its page: a reply is drawn in place, never a close and an open.
      await expect(dialog.getByRole('button', { name: 'AI', exact: true })).toHaveAttribute('aria-current', 'page');
      if (answer.tick) {
        await expect(dialog.getByText('Listed by Anthropic this session.')).toBeVisible();
        await expect(dialog.locator('select[data-setting="ai.models"] option', { hasText: 'Claude checked' })).toHaveCount(1);
      }

      const results = await new AxeBuilder({ page }).include('.m-dialog').analyze();
      const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
      expect(blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`)).toStrictEqual([]);
    });
  }
}

test('EDITING the key takes the answer away, and a key that was never stored cannot be checked until one is typed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const [light] = LOOKS;
  await bridgeUnder(page, light, { aiModels: ACCEPTED });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'AI', exact: true }).click();
  const check = dialog.getByRole('button', { name: 'Check' });
  await expect(check).toBeDisabled();

  const field = dialog.getByLabel('Anthropic API key', { exact: true });
  await field.fill('example-key-typed');
  await expect(check).toBeEnabled();
  await check.click();
  const line = dialog.locator('[role="status"][data-key-check]');
  await expect(line).toHaveText('Key works');

  await field.fill('example-key-typed-again');
  await expect(line).toHaveText('');
});
