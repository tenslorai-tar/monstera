// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { act, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import {
  CONTEXT_PANEL_OPEN_SETTING,
  CONTEXT_PANEL_TAB_SETTING,
  DOCUMENT_PANEL_OPEN_SETTING,
} from '../settings/layout.js';
import { PanelPresence } from '../panelPresence.js';
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

/** The presence the last panel `drawn` was built with, for a case that tells it how wide the row is. */
let lastPresence: PanelPresence | undefined;

function drawn(settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS))): SettingsStore {
  const presence = new PanelPresence(settings);
  lastPresence = presence;
  render(
    <Wrapped>
      <ContextPanel
        assistant={<p>assistant content</p>}
        spelling={<p>spelling content</p>}
        settings={settings}
        presence={presence}
      >
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

  it('the ASSISTANT tab is shut by the panel’s own chevron, and the handle returns to it', async () => {
    // THE ASSISTANT'S DISMISSAL ROUTE, as §10.3 gives it: "collapsing the panel shuts both and reopening returns to the
    // tab that was open". It is docked, not transient, so Escape and a press outside are deliberately NOT routes here —
    // a panel that shut whenever a person clicked the page would lose the conversation they are reading beside it.
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    settings.hydrate({ [CONTEXT_PANEL_TAB_SETTING.id]: 'assistant' });
    drawn(settings);
    expect(screen.getByText('assistant content')).toBeDefined();
    // CONTROL: the other tab's content is not what is showing, so the reopen below is not passing on Properties.
    expect(screen.queryByText('properties content')).toBeNull();

    await act(async () => {
      screen.getByRole('button', { name: 'Collapse the properties panel' }).click();
      await Promise.resolve();
    });
    expect(screen.queryByText('assistant content')).toBeNull();

    await act(async () => {
      screen.getByRole('button', { name: 'Show the properties panel' }).click();
      await Promise.resolve();
    });
    expect(screen.getByText('assistant content')).toBeDefined();
  });

  it('THREE TABS, each showing its own content and only its own, and a click moves the one setting (ADR-0156, ADR-0189)', async () => {
    const settings = drawn();
    // THREE, and not four: the accessibility tools are in the document panel while in use (ADR-0189), so the
    // Assistant keeps its word. CONTROL: a fourth tab appearing again is a different list here.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toStrictEqual([
      'Properties',
      'Assistant',
      'Spelling',
    ]);
    await act(async () => {
      screen.getByRole('tab', { name: 'Spelling' }).click();
      await Promise.resolve();
    });
    expect(settings.get(CONTEXT_PANEL_TAB_SETTING.id)).toBe('spelling');
    expect(screen.getByText('spelling content')).toBeDefined();
    // CONTROL: neither of the other two is drawn beside it, so the content above is the tab's and not a list of all.
    expect(screen.queryByText('properties content')).toBeNull();
    expect(screen.queryByText('assistant content')).toBeNull();
  });

  it('REFUSES a stored accessibility tab, which the build before ADR-0189 could have saved, and shows Properties', () => {
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    settings.hydrate({ [CONTEXT_PANEL_TAB_SETTING.id]: 'accessibility' });
    drawn(settings);
    expect(settings.get(CONTEXT_PANEL_TAB_SETTING.id)).toBe('properties');
    expect(screen.getByText('properties content')).toBeDefined();
  });

  it('a STORED collapse is what opens', () => {
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    settings.hydrate({ [CONTEXT_PANEL_OPEN_SETTING.id]: false });
    drawn(settings);
    expect(screen.queryByText('properties content')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show the properties panel' })).toBeDefined();
  });

  it('IN A NARROW ROW its handle opens it as a SHEET, which takes the focus, and Escape gives the focus back (ADR-0146)', async () => {
    const settings = drawn();
    await act(async () => {
      lastPresence?.measure(600);
      await Promise.resolve();
    });
    // GAVE WAY: the handle, with the setting still on — the person's choice is untouched.
    expect(screen.queryByText('properties content')).toBeNull();
    expect(settings.get(CONTEXT_PANEL_OPEN_SETTING.id)).toBe(true);
    const handle = screen.getByRole('button', { name: 'Show the properties panel' });

    await act(async () => {
      handle.focus();
      handle.click();
      await Promise.resolve();
    });
    const sheet = document.querySelector('[data-panel-sheet="end"]');
    expect(sheet?.textContent).toContain('properties content');
    expect(sheet?.contains(document.activeElement)).toBe(true);
    // THE HANDLE NOW CLOSES IT, and says so: it and the sheet's own chevron are the two ways, named alike.
    expect(screen.getAllByRole('button', { name: 'Collapse the properties panel' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Show the properties panel' })).toBeNull();

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
    });
    expect(document.querySelector('[data-panel-sheet]')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show the properties panel' }));
    expect(settings.get(CONTEXT_PANEL_OPEN_SETTING.id)).toBe(true);
  });
});
