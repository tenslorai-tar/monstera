// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { displayLocationSchema } from '@monstera/contract';
import { type FileHandle, asDocId, asDocVersion, asFileHandle, messageKey } from '@monstera/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import type { Placement } from '../registries/placement.js';
import { RECENT_RECHECK_MS } from '../recentLine.js';
import { MenuBar, type RecentMenu, type RecentMenuEntry } from './MenuBar.js';

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
  return { id, title: messageKey(title), placements, icon: 'File', run: () => undefined, feedback: { kind: 'visible' }, ...over };
}

beforeAll(() => {
  activateCatalogue('en', {
    ...EN,
    'test.menu.open': 'Open',
    'test.menu.print': 'Print',
    'test.menu.dark': 'Dark theme',
    'test.menu.rotate': 'Rotate',
    'test.menu.pages': 'Pages',
    'test.menu.clear': 'Clear list',
  });
});

/** A File › Recent that has never been read, for the cases not about it. */
const NO_RECENT: RecentMenu = {
  read: () => Promise.resolve(undefined),
  open: () => undefined,
};

function drawn(
  commands: readonly UiCommand[],
  focusBefore: () => HTMLElement | undefined = () => undefined,
  recent: RecentMenu = NO_RECENT,
): ReactElement {
  return (
    <I18nProvider i18n={i18n}>
      <MenuBar registry={new CommandRegistry(commands)} context={CONTEXT} focusBefore={focusBefore} recent={recent} />
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

  describe('File › Recent, the row’s own value control (ADR-0143)', () => {
    /** A recent entry as main answers one. */
    const entry = (handle: string, name: string, available: boolean): RecentMenuEntry => ({
      handle: asFileHandle(handle),
      name,
      location: displayLocationSchema.parse({ within: null, folder: null }),
      openedAt: null,
      availability: available ? 'available' : 'unavailable',
    });
    const clear = (run: () => void = () => undefined): UiCommand =>
      command('a.clear', 'test.menu.clear', [{ surface: 'menu-bar', menu: 'file', group: 0, order: 15, submenu: 'recent' }], {
        icon: 'ListX',
        run,
      });
    const openCommand = command('a.open', 'test.menu.open', [{ surface: 'menu-bar', menu: 'file', group: 0, order: 10 }]);

    /** Opens File, then its Recent submenu, and answers the submenu's popup. */
    async function openRecent(): Promise<HTMLElement> {
      await open('File');
      const trigger = await screen.findByRole('menuitem', { name: 'Recent' });
      await act(async () => {
        fireEvent.click(trigger);
        await Promise.resolve();
      });
      const popup = document.querySelector<HTMLElement>('[data-submenu-popup="recent"]');
      if (popup === null) throw new Error('File › Recent did not open');
      return popup;
    }

    it('lists EVERY file main sends, a missing one DISABLED AND SAYING SO, then Clear list after a separator', async () => {
      const opened = vi.fn<(handle: FileHandle) => void>();
      const runClear = vi.fn();
      const ten = [
        entry('h-gone', 'gone.pdf', false),
        ...Array.from({ length: 9 }, (_, at) => entry(`h-${String(at)}`, `file-${String(at)}.pdf`, true)),
      ];
      render(drawn([openCommand, clear(runClear)], undefined, { read: () => Promise.resolve(ten), open: opened }));
      const popup = await openRecent();

      // ALL TEN, in main's order — the start screen's four is that view's own number, never this one's.
      const items = within(popup).getAllByRole('menuitem');
      expect(items.map((item) => item.getAttribute('data-recent-file') ?? item.getAttribute('data-command'))).toStrictEqual([
        'gone.pdf',
        ...Array.from({ length: 9 }, (_, at) => `file-${String(at)}.pdf`),
        'a.clear',
      ]);
      // NEVER HIDDEN: listed, disabled, and its state in its name and on screen.
      const gone = within(popup).getByRole('menuitem', { name: 'gone.pdf, unavailable' });
      expect(gone.getAttribute('aria-disabled')).toBe('true');
      expect(gone.textContent).toContain('Unavailable');
      // CONTROL: an available file is neither disabled nor marked.
      const first = within(popup).getByRole('menuitem', { name: 'file-0.pdf' });
      expect(first.getAttribute('aria-disabled')).not.toBe('true');
      expect(first.textContent).not.toContain('Unavailable');
      // THE SEPARATOR sits between the files and the submenu's command.
      expect(popup.querySelector('[role="separator"]')?.nextElementSibling?.getAttribute('data-command')).toBe('a.clear');

      await act(async () => {
        fireEvent.click(first);
        await Promise.resolve();
      });
      // BY THE HANDLE main minted for that row — the second row's, so a surface sending the first one's fails.
      expect(opened.mock.calls).toStrictEqual([[asFileHandle('h-0')]]);
    });

    it('a file STILL BEING LOOKED FOR is disabled and says Checking…, and the list is read again until it resolves (7d)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const opened = vi.fn<(handle: FileHandle) => void>();
        let reads = 0;
        const read = (): Promise<readonly RecentMenuEntry[]> => {
          reads += 1;
          const checking: RecentMenuEntry = { ...entry('h-n', 'network.pdf', true), availability: 'checking' };
          return Promise.resolve([reads === 1 ? checking : entry('h-n', 'network.pdf', true)]);
        };
        render(drawn([openCommand, clear()], undefined, { read, open: opened }));
        const popup = await openRecent();

        const slow = within(popup).getByRole('menuitem', { name: 'network.pdf, checking' });
        expect(slow.getAttribute('aria-disabled')).toBe('true');
        expect(slow.textContent).toContain('Checking…');
        await act(async () => {
          fireEvent.click(slow);
          await Promise.resolve();
        });
        expect(opened).not.toHaveBeenCalled();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(RECENT_RECHECK_MS);
        });
        expect(reads).toBe(2);
        expect(within(popup).getByRole('menuitem', { name: 'network.pdf' }).getAttribute('aria-disabled')).not.toBe('true');
      } finally {
        vi.useRealTimers();
      }
    });

    it('a click on an UNAVAILABLE file opens nothing', async () => {
      const opened = vi.fn<(handle: FileHandle) => void>();
      render(drawn([openCommand, clear()], undefined, { read: () => Promise.resolve([entry('h-gone', 'gone.pdf', false)]), open: opened }));
      const popup = await openRecent();
      await act(async () => {
        fireEvent.click(within(popup).getByRole('menuitem', { name: 'gone.pdf, unavailable' }));
        await Promise.resolve();
      });
      expect(opened).not.toHaveBeenCalled();
    });

    it('Clear list RUNS its command over a list, and is DISABLED over an empty one, which says so', async () => {
      const runClear = vi.fn();
      const { unmount } = render(
        drawn([openCommand, clear(runClear)], undefined, { read: () => Promise.resolve([entry('h-a', 'a.pdf', true)]), open: () => undefined }),
      );
      let popup = await openRecent();
      await act(async () => {
        fireEvent.click(within(popup).getByRole('menuitem', { name: 'Clear list' }));
        await Promise.resolve();
      });
      expect(runClear).toHaveBeenCalledTimes(1);
      unmount();

      render(drawn([openCommand, clear(runClear)], undefined, { read: () => Promise.resolve([]), open: () => undefined }));
      popup = await openRecent();
      expect(within(popup).getByRole('menuitem', { name: 'No recent files' }).getAttribute('aria-disabled')).toBe('true');
      const disabled = within(popup).getByRole('menuitem', { name: 'Clear list' });
      expect(disabled.getAttribute('aria-disabled')).toBe('true');
      // THE DECISION, not only its look: pressed over an empty list it runs nothing.
      await act(async () => {
        fireEvent.click(disabled);
        await Promise.resolve();
      });
      expect(runClear).toHaveBeenCalledTimes(1);
    });

    it('reads main’s list EACH TIME File opens, so the submenu shows the list as it is now', async () => {
      // TWO ANSWERS, one per opening: a submenu that kept its first read would still show the file the second removed.
      const answers = [[entry('h-a', 'a.pdf', true)], [entry('h-a', 'a.pdf', false)]];
      const read = vi.fn(() => Promise.resolve(answers.shift()));
      render(drawn([openCommand, clear()], undefined, { read, open: () => undefined }));
      let popup = await openRecent();
      expect(within(popup).getByRole('menuitem', { name: 'a.pdf' })).toBeTruthy();
      // CLOSED by the File trigger itself, which toggles its menu, and then opened again.
      await open('File');
      expect(document.querySelector('[data-submenu-popup="recent"]')).toBeNull();
      popup = await openRecent();
      expect(within(popup).getByRole('menuitem', { name: 'a.pdf, unavailable' })).toBeTruthy();
      expect(read).toHaveBeenCalledTimes(2);
    });
  });
});
