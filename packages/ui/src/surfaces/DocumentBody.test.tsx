// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { act, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { DOCUMENT_PANEL_OPEN_SETTING, DOCUMENT_PANEL_WIDTH_SETTING } from '../settings/layout.js';
import { SettingsStore } from '../settingsStore.js';
import { DocumentBody } from './DocumentBody.js';

/**
 * The document's row as a person meets it: a resize handle while the panel is open, none while it
 * is collapsed, and the stored width untouched by either.
 *
 * The width a person drags to is not here: happy-dom lays nothing out, so no resize can finish (see
 * `Splitter.test.tsx`). That half is the rendered test's, against the production build.
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
      <DocumentBody settings={settings} panel={<p>panel</p>} page={<p>page</p>} />
    </Wrapped>,
  );
  return settings;
}

describe('DocumentBody', () => {
  it('OPEN: one resize handle, between the panel and the page', () => {
    drawn();
    const handle = screen.getByRole('separator', { name: 'Resize the document panel' });
    const panel = screen.getByText('panel');
    const page = screen.getByText('page');
    expect(panel.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(handle.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('COLLAPSED: no resize handle, and both panes still render', () => {
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    settings.hydrate({ [DOCUMENT_PANEL_OPEN_SETTING.id]: false });
    drawn(settings);
    // No splitter at all while shut: the machine's own collapse would be a second owner of
    // "is the panel open", and a handle for a panel nobody can see resizes nothing.
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.getByText('panel')).toBeDefined();
    expect(screen.getByText('page')).toBeDefined();
  });

  it('collapsing and reopening neither WRITES nor forgets the stored width', async () => {
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    // A value that is NOT the fallback, so a body that wrote its fallback back is caught.
    settings.hydrate({ [DOCUMENT_PANEL_WIDTH_SETTING.id]: 320 });
    const writes: string[] = [];
    settings.subscribe((id) => {
      if (id === DOCUMENT_PANEL_WIDTH_SETTING.id) writes.push(id);
    });
    drawn(settings);

    await act(async () => {
      settings.set(DOCUMENT_PANEL_OPEN_SETTING.id, false);
      await Promise.resolve();
    });
    expect(screen.queryByRole('separator')).toBeNull();
    await act(async () => {
      settings.set(DOCUMENT_PANEL_OPEN_SETTING.id, true);
      await Promise.resolve();
    });

    expect(screen.getByRole('separator', { name: 'Resize the document panel' })).toBeDefined();
    expect(writes).toStrictEqual([]);
    expect(settings.get(DOCUMENT_PANEL_WIDTH_SETTING.id)).toBe(320);
  });
});
