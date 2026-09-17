// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { act, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { CONTEXT_PANEL_OPEN_SETTING, DOCUMENT_PANEL_OPEN_SETTING } from '../settings/layout.js';
import { SettingsStore } from '../settingsStore.js';
import { ContextPanel } from './ContextPanel.js';

/**
 * §10.3's right contextual panel as a person meets it: a named region holding its properties, a
 * chevron that collapses it, a handle that reopens it, and its own setting as the one owner.
 */

beforeAll(() => {
  activateCatalogue('en', EN);
});

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function drawn(settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS))): SettingsStore {
  render(
    <Wrapped>
      <ContextPanel assistant={<p>assistant content</p>} settings={settings}>
        <p>properties content</p>
      </ContextPanel>
    </Wrapped>,
  );
  return settings;
}

describe('ContextPanel', () => {
  it('OPEN: a region named Properties, holding its children, with a collapse chevron', () => {
    drawn();
    const region = screen.getByRole('complementary', { name: 'Properties' });
    expect(region.textContent).toContain('properties content');
    expect(screen.getByRole('button', { name: 'Collapse the properties panel' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Show the properties panel' })).toBeNull();
  });

  it('COLLAPSES to a handle, the handle REOPENS it, and its OWN setting records both', async () => {
    const settings = drawn();

    await act(async () => {
      screen.getByRole('button', { name: 'Collapse the properties panel' }).click();
      await Promise.resolve();
    });
    // GONE, content and all, with the handle in its place.
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByText('properties content')).toBeNull();
    expect(settings.get(CONTEXT_PANEL_OPEN_SETTING.id)).toBe(false);
    // AND NOT THE OTHER SIDE'S: "State is persisted per panel."
    expect(settings.get(DOCUMENT_PANEL_OPEN_SETTING.id)).toBe(true);

    await act(async () => {
      screen.getByRole('button', { name: 'Show the properties panel' }).click();
      await Promise.resolve();
    });
    expect(screen.getByText('properties content')).toBeDefined();
    expect(settings.get(CONTEXT_PANEL_OPEN_SETTING.id)).toBe(true);
  });

  it('a STORED collapse is what opens', () => {
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    settings.hydrate({ [CONTEXT_PANEL_OPEN_SETTING.id]: false });
    drawn(settings);
    expect(screen.queryByText('properties content')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show the properties panel' })).toBeDefined();
  });
});
