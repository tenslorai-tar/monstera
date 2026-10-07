// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { act, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import appCss from '../app.css?raw';
import { activateCatalogue, i18n } from '../i18n.js';
import { CONTEXT_PANEL_TAB_ACCESSIBILITY, EN } from '../messages/en.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { DOCUMENT_PANEL_OPEN_SETTING, DOCUMENT_PANEL_SETTING } from '../settings/layout.js';
import { PanelPresence } from '../panelPresence.js';
import { SettingsStore } from '../settingsStore.js';
import { DocumentPanel, type PanelTool } from './DocumentPanel.js';

/**
 * §10.3's document panel, as a surface a person operates.
 *
 * Each panel's content is a marked stand-in, because what this file asserts is the host:
 * one panel at a time, six tabs named by their panel, the collapse and its reopen, and the
 * settings as the one owner of both.
 */

beforeAll(() => {
  activateCatalogue('en', EN);
});

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

const STAND_INS = {
  bookmarks: <p>bookmarks content</p>,
  comments: <p>comments content</p>,
  forms: <p>forms content</p>,
  layers: <p>layers content</p>,
  search: <p>search content</p>,
};

function drawn(
  settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS)),
  tool?: PanelTool,
): {
  readonly settings: SettingsStore;
  readonly presence: PanelPresence;
} {
  const presence = new PanelPresence(settings);
  render(
    <Wrapped>
      <DocumentPanel
        tool={tool}
        settings={settings}
        presence={presence}
        pages={<p>pages content</p>}
        panels={STAND_INS}
      />
    </Wrapped>,
  );
  return { settings, presence };
}

describe('DocumentPanel', () => {
  it('a TOOL takes the body while it is open, a tab or its close button closes it, and the setting is untouched (ADR-0189)', async () => {
    const closed = vi.fn();
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    drawn(settings, { title: CONTEXT_PANEL_TAB_ACCESSIBILITY, content: <p>tool content</p>, onClose: closed });

    expect(screen.getByText('tool content')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Accessibility' })).toBeDefined();
    // THE PANEL'S OWN BODY IS NOT DRAWN BESIDE IT, so the tool's content is not one of two.
    expect(screen.queryByText('pages content')).toBeNull();
    expect(settings.get(DOCUMENT_PANEL_SETTING.id)).toBe('pages');

    await act(async () => {
      screen.getByRole('button', { name: 'Close' }).click();
      await Promise.resolve();
    });
    expect(closed).toHaveBeenCalledTimes(1);
    // THE CHOSEN TAB TOO, which fires no change of its own: it is the way back to the panel.
    await act(async () => {
      screen.getByRole('tab', { name: 'Pages' }).click();
      await Promise.resolve();
    });
    expect(closed).toHaveBeenCalledTimes(2);
  });

  it('CONTROL: with no tool the panel shows its own chosen body and no close button', () => {
    drawn();
    expect(screen.getByText('pages content')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByText('tool content')).toBeNull();
  });

  it('shows ONE panel, Pages by default, with SIX tabs named by their panel', () => {
    drawn();

    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))).toStrictEqual([
      'Pages',
      'Bookmarks',
      'Comments',
      'Forms',
      'Layers',
      'Search',
    ]);
    expect(screen.getByText('pages content')).toBeDefined();
    // ONE, not six hidden: the other panels' content is absent from the document.
    expect(screen.queryByText('search content')).toBeNull();
    expect(screen.queryByText('bookmarks content')).toBeNull();
  });

  it('choosing a tab SWAPS the panel and WRITES the setting that owns it', async () => {
    const { settings } = drawn();

    await act(async () => {
      screen.getByRole('tab', { name: 'Layers' }).click();
      await Promise.resolve();
    });

    expect(screen.getByText('layers content')).toBeDefined();
    expect(screen.queryByText('pages content')).toBeNull();
    // THE SETTING, not component state: a new session opens on the same panel.
    expect(settings.get(DOCUMENT_PANEL_SETTING.id)).toBe('layers');
  });

  it('the chosen tab carries the attribute the STYLESHEET selects on, and the others do not', async () => {
    // The two halves speak different vocabularies: Base UI names the state, and app.css
    // selects on a name. A selector spelt `data-selected` styled nothing while every other
    // case here passed, so this reads the selector out of the stylesheet itself and asserts
    // the rendered tab matches it. `?raw` rather than a filesystem read: this package never
    // imports Node, and Vite hands the bundler's own copy of the text.
    const selector = /\.m-panel-tab\[([a-z-]+)\]\s*\{/u.exec(appCss)?.[1];
    expect(selector, 'app.css names no attribute selector for the chosen panel tab').toBeDefined();
    const attribute = selector ?? '';

    drawn();
    await act(async () => {
      screen.getByRole('tab', { name: 'Search' }).click();
      await Promise.resolve();
    });

    const tabs = screen.getAllByRole('tab');
    const carrying = tabs.filter((tab) => tab.hasAttribute(attribute)).map((tab) => tab.getAttribute('aria-label'));
    expect(carrying).toStrictEqual(['Search']);
  });

  it('a STORED choice is the panel that opens', () => {
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    settings.hydrate({ [DOCUMENT_PANEL_SETTING.id]: 'forms' });
    drawn(settings);

    expect(screen.getByText('forms content')).toBeDefined();
    expect(screen.queryByText('pages content')).toBeNull();
  });

  it('COLLAPSES to a handle, and the handle REOPENS the same panel', async () => {
    const { settings } = drawn();
    await act(async () => {
      screen.getByRole('tab', { name: 'Comments' }).click();
      await Promise.resolve();
    });

    await act(async () => {
      screen.getByRole('button', { name: 'Collapse the document panel' }).click();
      await Promise.resolve();
    });

    // GONE, strip and all, and a handle in its place.
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('comments content')).toBeNull();
    expect(settings.get(DOCUMENT_PANEL_OPEN_SETTING.id)).toBe(false);

    await act(async () => {
      screen.getByRole('button', { name: 'Show the document panel' }).click();
      await Promise.resolve();
    });

    // THE PANEL IT HAD, not the default: collapsing hides the panel and changes no choice.
    expect(screen.getByText('comments content')).toBeDefined();
    expect(settings.get(DOCUMENT_PANEL_OPEN_SETTING.id)).toBe(true);
  });

  it('IN A ROW WITH NO ROOM for it, opens from its handle as a SHEET, and its chevron closes only the sheet (ADR-0146)', async () => {
    const { settings, presence } = drawn();
    await act(async () => {
      presence.measure(400);
      await Promise.resolve();
    });
    expect(screen.queryByRole('tab')).toBeNull();
    await act(async () => {
      screen.getByRole('button', { name: 'Show the document panel' }).click();
      await Promise.resolve();
    });
    const sheet = document.querySelector('[data-panel-sheet="start"]');
    expect(sheet?.textContent).toContain('pages content');

    // THE PANEL'S OWN CHEVRON, inside the sheet: it closes the sheet and leaves the setting on, where in the row it
    // shuts the setting — so a wider window draws the panel again.
    const chevron = sheet?.querySelector<HTMLButtonElement>('button[aria-label="Collapse the document panel"]');
    expect(chevron).not.toBeNull();
    await act(async () => {
      chevron?.click();
      await Promise.resolve();
    });
    expect(document.querySelector('[data-panel-sheet]')).toBeNull();
    expect(settings.get(DOCUMENT_PANEL_OPEN_SETTING.id)).toBe(true);
  });
});
