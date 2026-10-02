// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion } from '@monstera/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import {
  DONATE_COMMAND_TITLE,
  EN,
  LAYOUT_FOCUS_COMMAND_TITLE,
  PALETTE_TITLE,
  THEME_DARK_COMMAND_TITLE,
  THEME_LIGHT_COMMAND_TITLE,
} from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { THEME_SETTING } from '../settings/appearance.js';
import { LAYOUT_MODE_SETTING } from '../settings/layout.js';
import { SettingsStore } from '../settingsStore.js';
import { TitleBar } from './TitleBar.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
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

type Spy = UiCommand & { readonly run: Mock<(context: CommandContext) => void> };

/** Stand-ins that RECORD and write nothing, so a changed setting can only have come from the bar itself. */
function spies(): { readonly palette: Spy; readonly ribbon: Spy; readonly studio: Spy; readonly focus: Spy } {
  const spy = (id: string, shortcut?: string): Spy => ({
    id,
    feedback: { kind: 'visible' },
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

/** {@link drawn}, answering the render's `unmount` for a case that draws more than once. */
function drawnWith(commands: readonly UiCommand[]): { readonly unmount: () => void } {
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  return render(
    <Wrapped>
      <TitleBar registry={new CommandRegistry(commands)} context={context} settings={settings} />
    </Wrapped>,
  );
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

  it('draws NOT ONE of the application’s own commands: they are the menu row’s since ADR-0113', () => {
    // A command placed where Donate now is. The bar used to project these, so a bar still doing it would draw a
    // Donate button here; the menu bar's own cases prove the same command IS drawn there.
    const donate: Spy = {
      id: 'app.donate',
      feedback: { kind: 'visible' },
      title: DONATE_COMMAND_TITLE,
      icon: 'Heart',
      placements: [{ surface: 'menu-bar-commands', tone: 'gold', order: 1 }],
      run: vi.fn<(context: CommandContext) => void>(),
    };
    drawn([...Object.values(spies()), donate]);
    expect(screen.queryByRole('button', { name: 'Donate' })).toBeNull();
    expect(screen.getByRole('button', { name: /Search commands/u })).toBeDefined();
  });

  describe('the LIGHT AND DARK SWITCH (ADR-0132)', () => {
    /** Stand-ins for View › Theme's two commands, recording and writing nothing. */
    const themeSpies = (): { readonly light: Spy; readonly dark: Spy } => ({
      light: {
        id: 'view.theme-light',
        title: THEME_LIGHT_COMMAND_TITLE,
        placements: [],
        run: vi.fn<(context: CommandContext) => void>(),
        feedback: { kind: 'visible' },
      },
      dark: {
        id: 'view.theme-dark',
        title: THEME_DARK_COMMAND_TITLE,
        placements: [],
        run: vi.fn<(context: CommandContext) => void>(),
        feedback: { kind: 'visible' },
      },
    });

    /** The platform's answers: which of these media queries match. */
    function platform(matching: readonly string[]): void {
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (query: string) =>
          ({
            matches: matching.includes(query),
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          }) as unknown as MediaQueryList,
      );
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('while DARK is chosen it offers light, RUNS view.theme-light once and writes nothing itself', async () => {
      platform([]);
      const theme = themeSpies();
      const { settings } = drawn([...Object.values(spies()), theme.light, theme.dark]);
      await act(async () => {
        settings.set(THEME_SETTING.id, 'dark');
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
      expect(theme.light.run).toHaveBeenCalledTimes(1);
      expect(theme.light.run).toHaveBeenCalledWith(context);
      expect(theme.dark.run).not.toHaveBeenCalled();
      // THE STAND-INS WRITE NOTHING, so an unchanged setting is the proof the bar did not write it.
      expect(settings.get(THEME_SETTING.id)).toBe('dark');
    });

    it('from SYSTEM it picks the opposite of what is SHOWING: light under a dark system, dark under a light one', () => {
      for (const [system, offered, runs] of [
        [['(prefers-color-scheme: dark)'], 'Switch to light theme', 'light'],
        [[], 'Switch to dark theme', 'dark'],
      ] as const) {
        platform(system);
        const theme = themeSpies();
        const { unmount } = drawnWith([...Object.values(spies()), theme.light, theme.dark]);
        fireEvent.click(screen.getByRole('button', { name: offered }));
        expect([theme.light.run.mock.calls.length, theme.dark.run.mock.calls.length]).toStrictEqual(runs === 'light' ? [1, 0] : [0, 1]);
        unmount();
        vi.restoreAllMocks();
      }
    });

    it('under WINDOWS HIGH CONTRAST it is disabled, still focusable, says why, and runs nothing', () => {
      platform(['(forced-colors: active)']);
      const theme = themeSpies();
      drawn([...Object.values(spies()), theme.light, theme.dark]);
      const off = screen.getByRole('button', { name: 'Windows high contrast is on, so light and dark follow it' });
      expect(off.getAttribute('aria-disabled')).toBe('true');
      // FOCUSABLE, so its tooltip can be reached: a natively disabled button fires no hover and takes no focus.
      expect(off.hasAttribute('disabled')).toBe(false);
      fireEvent.click(off);
      expect([theme.light.run, theme.dark.run].map((run) => run.mock.calls.length)).toStrictEqual([0, 0]);
    });

    it('CONTROL: without View › Theme’s commands there is no switch, so nothing renders that does nothing', () => {
      platform([]);
      drawn(Object.values(spies()));
      expect(screen.queryByRole('button', { name: /Switch to (light|dark) theme/u })).toBeNull();
    });
  });
});
