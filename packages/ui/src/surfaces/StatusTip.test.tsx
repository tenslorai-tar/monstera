// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN, TIP_HELP } from '../messages/en.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { SettingsStore } from '../settingsStore.js';
import type { Tip } from '../tips/tips.js';
import { StatusTip, TIP_INTERVAL_MS } from './StatusTip.js';

/**
 * The status bar's tip fades back in after EVERY advance, the same tip included (ADR-0159).
 *
 * Found on CI's Ubuntu leg at fbcda1b0: a round that began again with the tip on show chose that same tip, React kept
 * the state it already held, and the effect that fades the line in never ran, so the tip stayed faded out for a whole
 * interval. One tip is the case where every advance chooses the same one, whatever the round's rule, so it holds the
 * component on its own; `tips.test.ts` holds the rule that a new round avoids the tip on show.
 */

const ONLY: Tip = { id: 'only', words: TIP_HELP, values: { helpKey: 'F1' } };

beforeEach(() => {
  activateCatalogue('en', EN);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The tip line, shown with `tips`, and its span. */
function shown(tips: readonly Tip[]): HTMLElement {
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  const { container } = render(
    <I18nProvider i18n={i18n}>
      <StatusTip settings={settings} tips={tips} />
    </I18nProvider>,
  );
  const span = container.querySelector<HTMLElement>('.m-status-tip');
  if (span === null) throw new Error('the tip line is drawn');
  return span;
}

describe('StatusTip', () => {
  it('CONTROL: the first tip fades in, so the reading below can see a tip shown', () => {
    const span = shown([ONLY]);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(span.dataset['shown']).toBe('true');
    expect(span.dataset['tip']).toBe('only');
  });

  it('an advance that chooses the SAME tip fades it back in rather than leaving it faded out', () => {
    const span = shown([ONLY]);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    act(() => {
      vi.advanceTimersByTime(TIP_INTERVAL_MS);
    });
    // THE FADE OUT HAPPENED, so the shown state below is the fade back in and not a line that never faded.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(span.dataset['tip']).toBe('only');
    expect(span.dataset['shown']).toBe('true');
  });
});
