// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion } from '@monstera/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, type Mock, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN, LAYOUT_FOCUS_COMMAND_TITLE, PALETTE_TITLE } from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { LAYOUT_MODE_SETTING } from '../settings/layout.js';
import { SettingsStore } from '../settingsStore.js';
import { TitleBar } from './TitleBar.js';

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

type Spy = UiCommand & { readonly run: Mock<(context: CommandContext) => void> };

/** Stand-ins that RECORD and write nothing, so a changed setting can only have come from the bar itself. */
function spies(): { readonly palette: Spy; readonly ribbon: Spy; readonly studio: Spy; readonly focus: Spy } {
  const spy = (id: string, shortcut?: string): Spy => ({
    id,
    title: id === 'view.command-palette' ? PALETTE_TITLE : LAYOUT_FOCUS_COMMAND_TITLE,
    placements: [],
    ...(shortcut === undefined ? {} : { shortcut }),
    run: vi.fn<(context: CommandContext) => void>(),
  });
  return {
    palette: spy('view.command-palette', 'Ctrl+K'),
    ribbon: spy('view.layout-ribbon'),
    studio: spy('view.layout-studio'),
    focus: spy('view.layout-focus', 'Ctrl+Shift+F'),
  };
}

function drawn(commands: readonly UiCommand[], children?: ReactNode): { readonly settings: SettingsStore } {
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  render(
    <Wrapped>
      <TitleBar registry={new CommandRegistry(commands)} context={context} settings={settings}>
        {children}
      </TitleBar>
    </Wrapped>,
  );
  return { settings };
}

const switcher = (): HTMLElement => screen.getByRole('group', { name: 'Layout' });

describe('TitleBar', () => {
  it('the COMMAND SEARCH runs the palette command, once, and shows its chord', () => {
    const all = spies();
    drawn(Object.values(all));
    const search = screen.getByRole('button', { name: /Search commands/u });
    expect(within(search).getByText('Ctrl+K')).toBeDefined();
    fireEvent.click(search);
    expect(all.palette.run).toHaveBeenCalledTimes(1);
    expect(all.focus.run).not.toHaveBeenCalled();
  });

  it('the SWITCHER lights the segment the setting holds, and follows it', async () => {
    const { settings } = drawn(Object.values(spies()));
    const lit = (): string[] =>
      within(switcher())
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-pressed') === 'true')
        .map((button) => button.textContent);
    expect(lit()).toStrictEqual(['Ribbon']);
    await act(async () => {
      settings.set(LAYOUT_MODE_SETTING.id, 'studio');
      await Promise.resolve();
    });
    expect(lit()).toStrictEqual(['Studio']);
  });

  it('choosing Focus RUNS view.layout-focus and writes no setting itself — the command remembers the mode left', () => {
    // THE DECISION IS THE OBSERVABLE, not the end state: a bar that wrote the setting directly would also end in
    // Focus, and Escape would then return to Ribbon because nothing was remembered. The stand-in commands write
    // nothing, so an unchanged setting is the proof the bar did not write it.
    const all = spies();
    const { settings } = drawn(Object.values(all));
    fireEvent.click(within(switcher()).getByRole('button', { name: 'Focus' }));
    expect(all.focus.run).toHaveBeenCalledTimes(1);
    expect(all.focus.run).toHaveBeenCalledWith(context);
    expect(all.ribbon.run).not.toHaveBeenCalled();
    expect(all.studio.run).not.toHaveBeenCalled();
    expect(settings.get(LAYOUT_MODE_SETTING.id)).toBe('ribbon');
  });

  it('places the tabs it is given inside the bar', () => {
    drawn(Object.values(spies()), <nav aria-label="Open documents" />);
    const bar = document.querySelector('.m-title-bar');
    expect(bar?.querySelector('nav[aria-label="Open documents"]')).not.toBeNull();
  });

  it('draws NEITHER control over a registry without their commands — a control that does nothing is a defect', () => {
    // THE CONTROL is every case above, where the same bar over the registered commands draws both.
    drawn([]);
    expect(screen.queryByRole('button', { name: /Search commands/u })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Layout' })).toBeNull();
  });

  it('draws no switcher when ONE of the three mode commands is missing', () => {
    const { palette, ribbon, studio } = spies();
    drawn([palette, ribbon, studio]);
    expect(screen.getByRole('button', { name: /Search commands/u })).toBeDefined();
    expect(screen.queryByRole('group', { name: 'Layout' })).toBeNull();
  });
});
