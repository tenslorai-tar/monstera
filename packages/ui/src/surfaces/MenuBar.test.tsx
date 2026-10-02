// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import type { Placement } from '../registries/placement.js';
import { MenuBar } from './MenuBar.js';

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-0000000000b1'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

/** A command with a glyph, which the registry requires of every command a menu lists. */
function command(id: string, title: string, placements: readonly Placement[], over: Partial<UiCommand> = {}): UiCommand {
  return { id, title: messageKey(title), placements, icon: 'File', run: () => undefined, ...over };
}

beforeAll(() => {
  activateCatalogue('en', {
    ...EN,
    'test.menu.open': 'Open',
    'test.menu.print': 'Print',
    'test.menu.dark': 'Dark theme',
    'test.menu.rotate': 'Rotate',
    'test.menu.pages': 'Pages',
  });
});

function drawn(commands: readonly UiCommand[], focusBefore: () => HTMLElement | undefined = () => undefined): ReactElement {
  return (
    <I18nProvider i18n={i18n}>
      <MenuBar registry={new CommandRegistry(commands)} context={CONTEXT} focusBefore={focusBefore} />
    </I18nProvider>
  );
}

async function open(menu: string): Promise<void> {
  await act(async () => {
    fireEvent.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: menu }));
    await Promise.resolve();
  });
}

describe('MenuBar (ADR-0107)', () => {
  it('is ONE named menubar holding the menus the registry projects, in order, and no others', () => {
    render(
      drawn([
        command('a.open', 'test.menu.open', [{ surface: 'menu-bar', menu: 'file', group: 0, order: 1 }]),
        command('a.rotate', 'test.menu.rotate', [{ surface: 'ribbon', section: 'organize', group: messageKey('test.menu.pages'), order: 1 }], {
          icon: 'RotateCw',
        }),
      ]),
    );
    const bar = screen.getByRole('menubar', { name: 'Menu bar' });
    expect(within(bar).getAllByRole('menuitem').map((trigger) => trigger.textContent)).toStrictEqual(['File', 'Organize']);
  });

  it('an unavailable item is DISABLED, not hidden; a chord comes from the shortcut map; running one runs its command', async () => {
    const run = vi.fn();
    render(
      drawn([
        command('a.open', 'test.menu.open', [{ surface: 'menu-bar', menu: 'file', group: 0, order: 1 }], { shortcut: 'Ctrl+O', run }),
        command('a.print', 'test.menu.print', [{ surface: 'menu-bar', menu: 'file', group: 0, order: 2 }], { when: () => false }),
      ]),
    );
    await open('File');
    const openItem = await screen.findByRole('menuitem', { name: 'Open' });
    const printItem = screen.getByRole('menuitem', { name: 'Print' });
    // SEEN, and ANNOUNCED as a shortcut rather than as part of the name.
    expect(openItem.textContent).toContain('Ctrl+O');
    expect(openItem.getAttribute('aria-keyshortcuts')).toBe('Ctrl+O');
    expect(printItem.getAttribute('aria-disabled')).toBe('true');
    // CONTROL: the available item is not disabled, so the attribute above is the `when`, not every item's.
    expect(openItem.getAttribute('aria-disabled')).not.toBe('true');

    await act(async () => {
      fireEvent.click(openItem);
      await Promise.resolve();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(CONTEXT);
  });

  // THE GLYPH COLUMN (the owner's review of 0.1.8.0: the menus listed text only): every item draws its OWN command's
  // icon in the column before its title, a disabled item's too, hidden from the item's name.
  it('every item draws its command’s icon in the column before the title, a disabled one included', async () => {
    render(
      drawn([
        command('a.open', 'test.menu.open', [{ surface: 'menu-bar', menu: 'file', group: 0, order: 1 }], { icon: 'FolderOpen' }),
        command('a.print', 'test.menu.print', [{ surface: 'menu-bar', menu: 'file', group: 0, order: 2 }], {
          icon: 'Printer',
          when: () => false,
        }),
      ]),
    );
    await open('File');
    const items = [await screen.findByRole('menuitem', { name: 'Open' }), screen.getByRole('menuitem', { name: 'Print' })];
    // EACH ITEM'S OWN GLYPH, told apart by lucide's class for it: the same icon on every row would pass a bare count.
    expect(items.map((each) => each.querySelector('.m-menu-bar__icon svg')?.getAttribute('class'))).toStrictEqual([
      expect.stringContaining('lucide-folder-open'),
      expect.stringContaining('lucide-printer'),
    ]);
    // BEFORE THE TITLE, and out of the name.
    for (const each of items) {
      const icon = each.querySelector('.m-menu-bar__icon');
      const title = each.querySelector('.m-menu-bar__title');
      expect(icon?.nextElementSibling).toBe(title);
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(items[1]?.getAttribute('aria-disabled')).toBe('true');
  });

  it('a command that sets a state is a CHECKABLE item, checked exactly when it is on', async () => {
    let on = true;
    const dark = command('v.dark', 'test.menu.dark', [{ surface: 'menu-bar', menu: 'view', group: 0, order: 1 }], {
      checked: () => on,
    });
    const view = render(drawn([dark]));
    await open('View');
    expect((await screen.findByRole('menuitemcheckbox', { name: 'Dark theme' })).getAttribute('aria-checked')).toBe('true');
    view.unmount();

    on = false;
    render(drawn([dark]));
    await open('View');
    expect((await screen.findByRole('menuitemcheckbox', { name: 'Dark theme' })).getAttribute('aria-checked')).toBe('false');
  });

  it('F10 moves the focus to the first menu', () => {
    render(drawn([command('a.open', 'test.menu.open', [{ surface: 'menu-bar', menu: 'file', group: 0, order: 1 }])]));
    fireEvent.keyDown(window, { key: 'F10' });
    expect(document.activeElement?.textContent).toBe('File');
  });

  it('Alt pressed and released ALONE moves the focus to the first menu; CONTROL: Alt used as a modifier does not', () => {
    render(drawn([command('a.open', 'test.menu.open', [{ surface: 'menu-bar', menu: 'file', group: 0, order: 1 }])]));
    const start = document.activeElement;

    // ALT AS A MODIFIER: another key between its press and release, which is Alt+something, not a request for the bar.
    fireEvent.keyDown(window, { key: 'Alt', altKey: true });
    fireEvent.keyDown(window, { key: 'f', altKey: true });
    fireEvent.keyUp(window, { key: 'Alt' });
    expect(document.activeElement).toBe(start);

    fireEvent.keyDown(window, { key: 'Alt', altKey: true });
    fireEvent.keyUp(window, { key: 'Alt' });
    expect(document.activeElement?.textContent).toBe('File');
  });

  describe('the application’s own commands, PROJECTED at the row’s centre (ADR-0113)', () => {
    const placed = (id: string, title: string, tone: 'gold' | 'violet' | 'plain', order: number, run = vi.fn()): UiCommand =>
      command(id, title, [{ surface: 'menu-bar-commands', tone, order }], { icon: 'Heart', run });

    it('draws each placed command in DECLARED order, outside the menubar, and clicking one runs it alone', () => {
      const donate = vi.fn();
      const rate = vi.fn();
      // REGISTERED IN REVERSE, so a projection that returned its input unsorted would read Print before Open.
      render(drawn([placed('a.rate', 'test.menu.print', 'violet', 2, rate), placed('a.donate', 'test.menu.open', 'gold', 1, donate)]));

      const group = document.querySelector('.m-menu-bar__commands');
      expect([...(group?.querySelectorAll('button') ?? [])].map((button) => button.textContent)).toStrictEqual(['Open', 'Print']);
      // NOT A MENU: a button in the row, never an item the menubar's arrow keys walk.
      expect(within(screen.getByRole('menubar')).queryByRole('menuitem', { name: 'Open' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
      expect(donate).toHaveBeenCalledTimes(1);
      expect(donate).toHaveBeenCalledWith(CONTEXT);
      expect(rate).not.toHaveBeenCalled();
    });

    it('the TONE comes from the placement, so the bar never reads a command’s id', () => {
      render(
        drawn([
          placed('a.one', 'test.menu.open', 'gold', 1),
          placed('a.two', 'test.menu.print', 'violet', 2),
          placed('a.three', 'test.menu.dark', 'plain', 3),
        ]),
      );
      expect(screen.getByRole('button', { name: 'Open' }).className).toContain('m-button--gold');
      expect(screen.getByRole('button', { name: 'Print' }).className).toContain('m-button--violet');
      // THE CONTROL: the same surface and component, one field different, and not a brand tone.
      expect(screen.getByRole('button', { name: 'Dark theme' }).className).toContain('m-button--default');
    });

    it('draws no group and no reserve over a registry with no such placement', () => {
      render(drawn([command('a.open', 'test.menu.open', [{ surface: 'menu-bar', menu: 'file', group: 0, order: 1 }])]));
      expect(document.querySelector('.m-menu-bar__commands')).toBeNull();
      expect(document.querySelector('.m-menu-bar__reserve')).toBeNull();
    });
  });
});
