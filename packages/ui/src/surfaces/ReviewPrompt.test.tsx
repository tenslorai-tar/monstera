// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { type MessageKey, ok } from '@monstera/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN, REVIEW_STORE_NOT_OPENED } from '../messages/en.js';
import { SettingsRegistry } from '../registries/settings.js';
import { REVIEW_PROMPTS_SETTING } from '../settings/advanced.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { SettingsStore } from '../settingsStore.js';
import type { ToastKind } from '../primitives/Toast.js';
import { ReviewPrompt } from './ReviewPrompt.js';

/**
 * E3's prompt, the page half. `engagement.test.ts` holds the schedule and what each answer records; this
 * file asserts that the page draws only what main said was due, and that each of the four buttons sends
 * exactly its own answer — the calls, because a banner that disappears on every button looks the same
 * whether or not it told main anything.
 */

interface Drawn {
  readonly sent: { id: string; params: unknown }[];
  readonly said: { kind: ToastKind; message: MessageKey }[];
  readonly settings: SettingsStore;
}

async function drawn(due: boolean, opened = true): Promise<Drawn> {
  activateCatalogue('en', EN);
  const sent: { id: string; params: unknown }[] = [];
  const said: { kind: ToastKind; message: MessageKey }[] = [];
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  const client: ContractClient = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'app.reviewPrompt') return Promise.resolve(ok({ due }));
    if (id === 'app.review') return Promise.resolve(ok({ opened }));
    throw new Error(`this case does not answer ${id}`);
  });
  render(
    <I18nProvider i18n={i18n}>
      <ReviewPrompt
        client={client}
        settings={settings}
        toast={(kind, message) => {
          said.push({ kind, message });
        }}
      />
    </I18nProvider>,
  );
  // The question is asked in an effect and answered in a microtask.
  await act(async () => {
    await Promise.resolve();
  });
  return { sent, said, settings };
}

async function press(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
  });
}

describe('ReviewPrompt', () => {
  it('asks main once, and draws NOTHING when main says no prompt is due', async () => {
    const { sent } = await drawn(false);

    expect(sent).toStrictEqual([{ id: 'app.reviewPrompt', params: {} }]);
    // CONTROL beside it: the same question answered `due` draws the region, so this absence is the answer
    // being honoured rather than a banner that never draws.
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('draws a named, non-modal region with E3’s four answers when main says one is due', async () => {
    await drawn(true);

    const region = screen.getByRole('region', { name: /A rating in the Microsoft Store/u });
    expect(region.getAttribute('aria-modal')).toBeNull();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toStrictEqual([
      'Rate now',
      'Already reviewed',
      'Later',
      'Don’t ask again',
    ]);
    // IT TAKES NO FOCUS: E3's *never interrupts editing*, and focus moving to it would be exactly that.
    expect(region.contains(document.activeElement)).toBe(false);
  });

  it('each answer sends ITS OWN action and takes the banner away', async () => {
    for (const [name, action] of [
      ['Rate now', 'rate'],
      ['Already reviewed', 'reviewed'],
      ['Later', 'later'],
    ] as const) {
      const { sent, settings } = await drawn(true);
      await press(name);

      expect(sent.slice(1), name).toStrictEqual([{ id: 'app.review', params: { action } }]);
      expect(screen.queryByRole('region'), name).toBeNull();
      // None of these three is the opt-out, whose one writer is the settings store.
      expect(settings.get(REVIEW_PROMPTS_SETTING.id), name).toBe(true);
      cleanup();
    }
  });

  it('*Don’t ask again* turns off the Settings toggle and tells main nothing — the toggle IS the opt-out', async () => {
    const { sent, settings } = await drawn(true);
    expect(settings.get(REVIEW_PROMPTS_SETTING.id)).toBe(true);

    await press('Don’t ask again');

    expect(settings.get(REVIEW_PROMPTS_SETTING.id)).toBe(false);
    // ASSERT THE CALL NOT MADE: a version that also sent `later` would restart a clock main no longer reads,
    // and one that sent `reviewed` would record a rating nobody gave.
    expect(sent).toStrictEqual([{ id: 'app.reviewPrompt', params: {} }]);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('*Rate now* that opened nothing SAYS so, and the other answers never do', async () => {
    const failed = await drawn(true, false);
    await press('Rate now');
    expect(failed.said).toStrictEqual([{ kind: 'problem', message: REVIEW_STORE_NOT_OPENED }]);
    cleanup();

    const opened = await drawn(true, true);
    await press('Rate now');
    expect(opened.said).toStrictEqual([]);
    cleanup();

    // THE OTHER THREE, each against main answering `opened: false` — the answer that made *Rate now* speak —
    // so an answer that toasted on that answer, or unconditionally, reads here.
    for (const name of ['Already reviewed', 'Later', 'Don’t ask again']) {
      const other = await drawn(true, false);
      await press(name);
      expect(other.said, name).toStrictEqual([]);
      cleanup();
    }
  });
});
