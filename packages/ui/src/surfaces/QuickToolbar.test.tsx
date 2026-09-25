// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { QUICK_TOOLBAR_EDGE_SETTING, QUICK_TOOLBAR_OPEN_SETTING } from '../settings/layout.js';
import { SettingsStore } from '../settingsStore.js';
import { QuickToolbar } from './QuickToolbar.js';

/**
 * §10.3's floating quick toolbar as a person meets it: a vertical pill of icon buttons, each named
 * by its command, hidden by its own setting and placed on the edge that setting names. Where it sits
 * on screen is the rendered test's — happy-dom lays nothing out.
 */

const ROTATE = messageKey('test.quick.rotate');
const CROP = messageKey('test.quick.crop');

beforeAll(() => {
  activateCatalogue('en', { ...EN, [ROTATE]: 'Rotate page', [CROP]: 'Crop pages' });
});

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

const context: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

function drawn(commands: readonly UiCommand[], settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS))): SettingsStore {
  render(
    <Wrapped>
      <QuickToolbar registry={new CommandRegistry(commands)} context={context} settings={settings} />
    </Wrapped>,
  );
  return settings;
}

const rotate = vi.fn();
const COMMANDS: readonly UiCommand[] = [
  { id: 'edit.crop', title: CROP, icon: 'Crop', placements: [{ surface: 'quick-toolbar', order: 20 }], run: vi.fn() },
  { id: 'edit.rotate', title: ROTATE, icon: 'RotateCw', placements: [{ surface: 'quick-toolbar', order: 10 }], run: rotate },
];

describe('QuickToolbar', () => {
  it('draws ICON buttons in order, named by their commands, and a click runs the command', () => {
    drawn(COMMANDS);
    const bar = screen.getByRole('toolbar', { name: 'Document tools' });
    expect(bar.getAttribute('aria-orientation')).toBe('vertical');
    const buttons = [...bar.querySelectorAll('button')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toStrictEqual(['Rotate page', 'Crop pages']);
    // AN ICON AND NO TEXT: the defect was text buttons 150 px wide. Every button draws a glyph at
    // §10.4's primary-control size and carries no text node of its own.
    for (const button of buttons) {
      expect(button.classList.contains('m-icon-button--control')).toBe(true);
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.textContent).toBe('');
    }
    const first = buttons[0];
    if (first === undefined) throw new Error('the toolbar has a first button');
    fireEvent.click(first);
    expect(rotate).toHaveBeenCalledWith(context);
  });

  it('is ABSENT when its setting hides it, and returns when the setting shows it again', async () => {
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    settings.set(QUICK_TOOLBAR_OPEN_SETTING.id, false);
    drawn(COMMANDS, settings);
    expect(screen.queryByRole('toolbar')).toBeNull();
    await act(async () => {
      settings.set(QUICK_TOOLBAR_OPEN_SETTING.id, true);
      await Promise.resolve();
    });
    expect(screen.getByRole('toolbar', { name: 'Document tools' })).toBeDefined();
  });

  it('sits on the EDGE its setting names', async () => {
    const settings = drawn(COMMANDS);
    const bar = screen.getByRole('toolbar');
    expect(bar.classList.contains('m-quick-toolbar--start')).toBe(true);
    await act(async () => {
      settings.set(QUICK_TOOLBAR_EDGE_SETTING.id, 'end');
      await Promise.resolve();
    });
    expect(screen.getByRole('toolbar').classList.contains('m-quick-toolbar--end')).toBe(true);
    expect(screen.getByRole('toolbar').classList.contains('m-quick-toolbar--start')).toBe(false);
  });

  it('is absent with nothing placed on it', () => {
    drawn([]);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});
