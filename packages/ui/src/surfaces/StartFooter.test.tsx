// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion } from '@monstera/shared';
import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { ABOUT_COMMAND_TITLE, EN, KEYBOARD_SHORTCUTS_COMMAND_TITLE, SETTINGS_COMMAND_TITLE } from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import { StartFooter } from './StartFooter.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

const context: CommandContext = {
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

const about: UiCommand = {
  id: 'app.about',
  icon: 'Info',
  title: ABOUT_COMMAND_TITLE,
  placements: [{ surface: 'start-screen', slot: 'footer', order: 1 }],
  run: () => undefined,
};

const help = (shortcut: string): UiCommand => ({
  id: 'app.keyboard-shortcuts',
  icon: 'Keyboard',
  title: KEYBOARD_SHORTCUTS_COMMAND_TITLE,
  shortcut,
  placements: [],
  run: () => undefined,
});

function drawn(commands: readonly UiCommand[], version: string | undefined): void {
  render(
    <Wrapped>
      <StartFooter registry={new CommandRegistry(commands)} context={context} version={version} />
    </Wrapped>,
  );
}

describe('StartFooter', () => {
  it('names F1 in the hint when the registry binds F1', () => {
    drawn([about, help('F1')], '1.2.3');
    expect(screen.getByText('Press F1 for keyboard shortcuts')).toBeDefined();
  });

  it('draws NO hint over a registry that binds nothing to F1 — a sentence naming a dead key is the defect', () => {
    // THE CONTROL for the case above: the same footer, the same command, a different chord. A hint drawn
    // unconditionally passes the first case and fails this one.
    drawn([about, help('Ctrl+/')], '1.2.3');
    expect(screen.queryByText(/for keyboard shortcuts/u)).toBeNull();
  });

  it('draws the version it is given, and no version line without one', () => {
    const { unmount } = render(
      <Wrapped>
        <StartFooter registry={new CommandRegistry([about])} context={context} version="1.2.3" />
      </Wrapped>,
    );
    expect(screen.getByText('Monstera 1.2.3')).toBeDefined();
    unmount();
    drawn([about], undefined);
    expect(screen.queryByText(/^Monstera/u)).toBeNull();
    // THE FOOTER STILL DRAWS — the missing piece is the version's alone.
    expect(screen.getByText('© Tenslor Inc.')).toBeDefined();
    expect(screen.getByText('AGPL 3.0 or later')).toBeDefined();
  });

  it('projects the footer slot’s commands as LINKS, in their declared order', () => {
    const settings: UiCommand = { ...about, id: 'app.settings', title: SETTINGS_COMMAND_TITLE, placements: [{ surface: 'start-screen', slot: 'footer', order: 1 }] };
    const aboutSecond: UiCommand = { ...about, placements: [{ surface: 'start-screen', slot: 'footer', order: 2 }] };
    // REGISTERED IN THE OTHER ORDER, so a footer drawing registration order reads *About, Settings* here.
    drawn([aboutSecond, settings], undefined);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toStrictEqual(['Settings', 'About']);
    // The design's words, not bordered buttons.
    for (const button of buttons) expect(button.className).toContain('m-button--quiet');
  });
});
