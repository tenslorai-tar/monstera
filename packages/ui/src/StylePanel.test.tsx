// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import { ANNOTATION_COLOUR_SETTING, ANNOTATION_OPACITY_SETTING } from './settings/editing.js';
import { SettingsStore } from './settingsStore.js';
import { StylePanel } from './StylePanel.js';

/**
 * The style controls.
 *
 * They write settings and nothing else, so every case asserts what the STORE
 * holds afterwards — which is also what the tools read. A case asserting the
 * input's own value would be asserting that React renders a controlled input.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function mounted(): SettingsStore {
  const store = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  render(
    <Wrapped>
      <StylePanel settings={store} />
    </Wrapped>,
  );
  return store;
}

describe('StylePanel', () => {
  it('starts on `auto`, which is what a fresh install means', () => {
    const store = mounted();
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).toBe('auto');
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true);
  });

  it('leaving `auto` stores a COLOUR, and it is not black', () => {
    // A colour input with no value answers black, and a person who has just
    // said *I want to choose* has not chosen black. The value it starts from is
    // the shape tools' own red, converted rather than retyped.
    const store = mounted();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).not.toBe('auto');
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).not.toBe('#000000');
  });

  it('and going back to `auto` does not remember it', () => {
    // The honest reading of a tri-state: remembering the old colour would make
    // the checkbox a *use it or not* toggle over a preference nothing on screen
    // shows.
    const store = mounted();
    const auto = screen.getByRole('checkbox');
    fireEvent.click(auto);
    fireEvent.click(auto);
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).toBe('auto');
  });

  it('the colour input cannot be operated while `auto` is on', () => {
    // A colour input cannot show *no colour*, so the arrangement that does not
    // lie is one that cannot be used while no choice is being made.
    mounted();
    const input = screen.getByLabelText('Choose a colour');
    expect(input).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByLabelText('Choose a colour')).toHaveProperty('disabled', false);
  });

  it('writes the opacity a person set', () => {
    const store = mounted();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.5' } });
    expect(store.get(ANNOTATION_OPACITY_SETTING.id)).toBe(0.5);
  });

  it('offers no value the payload would refuse', () => {
    // The wired-tools rule arriving at a number instead of a button: a slider
    // whose floor was 0 would let a person ask for a fully transparent mark,
    // which the schema refuses — and the failure would land on apply, over
    // their document, for a control that looked like it worked.
    mounted();
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('min')).toBe('0.1');
    expect(slider.getAttribute('max')).toBe('1');
  });
});
