// @ts-check
/**
 * The AI key walk (cloud-31's B2): a key removed in Settings stops reading as stored in the dialog it was removed in, and
 * stays removed when Settings is opened again, in the running app on Windows with a real mouse and keyboard.
 *
 *   node scripts/research/aiKeyWalk.mjs [--app-root <checkout>]
 *
 * THE KEY IS THE WALK'S OWN TEST VALUE, typed into the walk's own fresh profile, and nothing sends it anywhere: the
 * steps never press a key check and never ask for a model list. No real key is read, typed or shown.
 */
import { expect } from '@playwright/test';

import { appRootOption, startWalk } from './liveWalk.mjs';

/** Not a key: a value of this walk's own, which no provider would take. */
const TEST_KEY = 'monstera-walk-test-value-not-a-key';
const STORED = 'A key is stored. Type a new one to replace it.';
const REMOVED = 'The stored key was removed. Type a new one to add another.';

const walk = await startWalk('ai-key', appRootOption(process.argv));
const { page, step, finish } = walk;

const dialog = () => page.getByRole('dialog');
/** How long each opening of Settings took to show, in milliseconds. @type {number[]} */
const openings = [];

/** Settings opened from the rail's own button, at its AI page, with Anthropic chosen as the provider. */
async function openAi() {
  const pressed = Date.now();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  // A BOUND ON A HANG, and the time recorded: the first opening, straight after the launch, was not on screen 5 s after
  // the press on 2026-11-02, where a later opening in the same run was.
  await expect(dialog()).toBeVisible({ timeout: 30_000 });
  openings.push(Date.now() - pressed);
  await dialog().getByRole('tab', { name: 'AI', exact: true }).or(dialog().getByRole('button', { name: 'AI', exact: true })).first().click();
  const provider = dialog().getByLabel('AI provider', { exact: true });
  await expect(provider).toBeVisible();
  return provider;
}

/** Closes Settings as a hand does, by Escape. */
async function closeSettings() {
  await page.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
}

/** The provider list's own options, by their names, so a "key stored" mark is read where the person reads it. */
const providerOptions = (/** @type {import('@playwright/test').Locator} */ provider) => provider.locator('option').allInnerTexts();

await step('a test value typed as the Anthropic key reads as stored when Settings is opened again', async () => {
  const provider = await openAi();
  await provider.selectOption({ label: 'Anthropic' });
  const field = dialog().getByLabel('Anthropic API key', { exact: true });
  await field.click();
  await page.keyboard.type(TEST_KEY);
  await closeSettings();
  await openAi();
  await expect(dialog().getByText(STORED)).toHaveCount(1);
  const options = await providerOptions(dialog().getByLabel('AI provider', { exact: true }));
  expect(options.some((option) => /key stored/u.test(option)), JSON.stringify(options)).toBe(true);
  return { options };
});

await step('Remove, in the same dialog: the row stops reading as stored at once, and the provider stops being marked', async () => {
  await dialog().getByRole('button', { name: 'Remove the stored key' }).click();
  await page.getByRole('button', { name: 'Remove it' }).click();
  await expect(dialog().getByText(REMOVED)).toBeVisible();
  await expect(dialog().getByText(STORED)).toHaveCount(0);
  const options = await providerOptions(dialog().getByLabel('AI provider', { exact: true }));
  expect(options.some((option) => /key stored/u.test(option)), JSON.stringify(options)).toBe(false);
  return { options };
});

await step('Settings opened again: still no key stored, with no restart', async () => {
  await closeSettings();
  await openAi();
  await expect(dialog().getByText(STORED)).toHaveCount(0);
  const options = await providerOptions(dialog().getByLabel('AI provider', { exact: true }));
  expect(options.some((option) => /key stored/u.test(option)), JSON.stringify(options)).toBe(false);
  await closeSettings();
  return { options, openings };
});

await finish();
