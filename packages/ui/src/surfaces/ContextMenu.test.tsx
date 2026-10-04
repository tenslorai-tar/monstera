// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import type { IconName } from '../primitives/icons.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { PanelPresence } from '../panelPresence.js';
import { CONTEXT_PANEL_OPEN_SETTING } from '../settings/layout.js';
import { SettingsStore } from '../settingsStore.js';
import { selectionPropertiesCommand } from '../commands/annotationCommands.js';
import { ContextMenuArea, type MenuAt, inPageMenu, menuGroups } from './ContextMenu.js';

/**
 * §7's context menus, rendered (the owner's section 7, 2026-09-19).
 *
 * `projections.test.ts` proves which commands a menu CONTAINS. This file proves the surface: a
 * right-click over the region opens the menu with those commands, choosing one RUNS it against the
 * context the region was given — the right-clicked page, not the one on show — and a region with
 * nothing placed renders no menu at all.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 5,
  openDocuments: [],
};

/** A registry of two page commands and one tab command, recording each run's context. */
function recording(): { registry: CommandRegistry; runs: { id: string; page: number | undefined }[] } {
  const runs: { id: string; page: number | undefined }[] = [];
  const command = (id: string, title: string, menu: 'page' | 'tab', order: number, icon: IconName): UiCommand => ({
    id,
    feedback: { kind: 'visible' },
    // Existing catalogue keys, so the rendered text is a real title rather than a raw key.
    title: messageKey(title),
    icon,
    placements: [{ surface: 'context-menu', context: menu, order }],
    run: (context) => {
      runs.push({ id, page: context.page });
    },
  });
  const registry = new CommandRegistry([
    command('t.rotate', 'command.rotate-page.title', 'page', 10, 'RotateCw'),
    command('t.delete', 'command.delete-page.title', 'page', 20, 'Trash2'),
    command('t.close', 'command.close-tab.title', 'tab', 10, 'LogOut'),
  ]);
  return { registry, runs };
}

describe('ContextMenuArea', () => {
  it('opens on a right-click with the commands placed in ITS context, in order', async () => {
    const { registry } = recording();
    render(
      <Wrapped>
        <ContextMenuArea registry={registry} context={CONTEXT} menus={['page']}>
          <div data-testid="region">page</div>
        </ContextMenuArea>
      </Wrapped>,
    );

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('region'), { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });

    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.getAttribute('data-command'))).toStrictEqual(['t.rotate', 't.delete']);
  });

  it('draws each item\'s OWN glyph before its title, hidden from its name (the owner\'s item 9b)', async () => {
    const { registry } = recording();
    render(
      <Wrapped>
        <ContextMenuArea registry={registry} context={CONTEXT} menus={['page']}>
          <div data-testid="region">page</div>
        </ContextMenuArea>
      </Wrapped>,
    );
    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('region'), { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });
    const items = await screen.findAllByRole('menuitem');
    // TOLD APART BY LUCIDE'S CLASS, so a glyph drawn for the wrong command, or one glyph for all, is red.
    const glyphs = items.map((item) => {
      const first = item.firstElementChild;
      return {
        hidden: first?.getAttribute('aria-hidden'),
        glyph: [...(first?.querySelector('svg')?.classList ?? [])].find((name) => name.startsWith('lucide-')),
      };
    });
    expect(glyphs).toStrictEqual([
      { hidden: 'true', glyph: 'lucide-rotate-cw' },
      { hidden: 'true', glyph: 'lucide-trash2' },
    ]);
    // OUT OF THE NAME: the item is still found by its title alone.
    expect(screen.getByRole('menuitem', { name: EN[messageKey('command.rotate-page.title')] })).toBe(items[0]);
  });

  it('runs the chosen command against the context it was HANDED — the right-clicked page', async () => {
    const { registry, runs } = recording();
    render(
      <Wrapped>
        <ContextMenuArea registry={registry} context={{ ...CONTEXT, page: 3 }} menus={['page']}>
          <div data-testid="region">page 4</div>
        </ContextMenuArea>
      </Wrapped>,
    );

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('region'), { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });
    const rotate = (await screen.findAllByRole('menuitem'))[0];
    if (rotate === undefined) throw new Error('no item');
    await act(async () => {
      fireEvent.click(rotate);
      await Promise.resolve();
    });

    expect(runs).toStrictEqual([{ id: 't.rotate', page: 3 }]);
  });

  it('shows each context as a GROUP, most specific first, with a separator between — the page’s items stay', async () => {
    const { registry } = recording();
    render(
      <Wrapped>
        <ContextMenuArea registry={registry} context={CONTEXT} menus={['tab', 'page']}>
          <div data-testid="region">page</div>
        </ContextMenuArea>
      </Wrapped>,
    );

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('region'), { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });

    const popup = (await screen.findAllByRole('menuitem'))[0]?.parentElement;
    const order = [...(popup?.children ?? [])].map((child) =>
      child.getAttribute('role') === 'separator' ? '|' : (child.getAttribute('data-command') ?? '?'),
    );
    expect(order).toStrictEqual(['t.close', '|', 't.rotate', 't.delete']);
  });

  it('the ANNOTATION menu’s Properties opens the panel — the real command, through the real surface', async () => {
    // The wired pair's UI half for `annotate.properties`: its own file proves what the command
    // writes, and this proves the menu item reaches it. Both halves are needed — a projection
    // that listed it and dispatched nothing reads identically here.
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    settings.set(CONTEXT_PANEL_OPEN_SETTING.id, false);
    const selection = {
      page: 0,
      version: asDocVersion(1),
      items: [{ index: 1, rect: { x0: 0, y0: 0, x1: 10, y1: 10 }, kind: 'square' as const, contents: '', author: '', created: null, blend: 'normal' as const, style: { colour: [1, 0, 0] as const, opacity: 1, borderWidth: 2 } }],
    };
    const registry = new CommandRegistry([
      selectionPropertiesCommand({
        settings,
        presence: new PanelPresence(settings),
        selection: () => selection,
        onDelete: () => undefined,
        onPlace: () => undefined,
      }, { picked: () => undefined }),
    ]);

    render(
      <Wrapped>
        <ContextMenuArea registry={registry} context={CONTEXT} menus={['annotation']}>
          <div data-testid="region">a note</div>
        </ContextMenuArea>
      </Wrapped>,
    );
    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('region'), { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });

    const item = (await screen.findAllByRole('menuitem'))[0];
    if (item === undefined) throw new Error('the annotation menu shows no item');
    expect(item.getAttribute('data-command')).toBe('annotate.properties');
    expect(settings.get(CONTEXT_PANEL_OPEN_SETTING.id)).toBe(false);

    await act(async () => {
      fireEvent.click(item);
      await Promise.resolve();
    });
    expect(settings.get(CONTEXT_PANEL_OPEN_SETTING.id)).toBe(true);
  });

  it('CONTROL: a region with nothing placed in its context renders its children and NO menu', async () => {
    const { registry } = recording();
    const { container } = render(
      <Wrapped>
        <ContextMenuArea registry={registry} context={CONTEXT} menus={['annotation']}>
          <div data-testid="region">a note</div>
        </ContextMenuArea>
      </Wrapped>,
    );

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('region'), { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });

    expect(screen.queryAllByRole('menuitem')).toStrictEqual([]);
    expect(container.querySelector('[data-context-menu]')).toBeNull();
    expect(screen.getByTestId('region').textContent).toBe('a note');
  });
});

describe('a list’s ONE page menu (inPageMenu)', () => {
  /** Three slots marked as `useVisiblePages` marks them, with a gap between the second and third that is no page. */
  function list(registry: CommandRegistry, asked: number[]): ReactElement {
    const menuAt: MenuAt<number> = (page) => {
      asked.push(page);
      const context = { ...CONTEXT, page };
      const groups = menuGroups(registry, context, ['page']);
      return groups.length === 0 ? undefined : { context, groups };
    };
    return (
      <Wrapped>
        {inPageMenu(
          menuAt,
          <>
            <div data-page="0">page 1</div>
            <div data-page="1">page 2</div>
            <div data-testid="gap">between</div>
            <div data-page="3">
              <span data-testid="inside">page 4’s text</span>
            </div>
          </>,
        )}
      </Wrapped>
    );
  }

  it('asks for nothing at render, and for THE RIGHT-CLICKED page at the right-click — whose items run against it', async () => {
    const { registry, runs } = recording();
    const asked: number[] = [];
    const { container } = render(list(registry, asked));
    // ONE MENU FOR THE LIST, and no page's menu built before a right-click asked for it.
    expect(container.querySelectorAll('.m-context-menu-region')).toHaveLength(1);
    expect(asked).toStrictEqual([]);

    // A TARGET INSIDE THE SLOT, not the slot itself: the slot holding it is the page.
    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('inside'), { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });
    expect(asked).toStrictEqual([3]);
    const rotate = (await screen.findAllByRole('menuitem'))[0];
    if (rotate === undefined) throw new Error('no item');
    await act(async () => {
      fireEvent.click(rotate);
      await Promise.resolve();
    });
    expect(runs).toStrictEqual([{ id: 't.rotate', page: 3 }]);
  });

  it('CONTROL: a right-click in NO page opens nothing — not even the menu the last page opened', async () => {
    const { registry } = recording();
    const asked: number[] = [];
    render(list(registry, asked));
    // A PAGE'S MENU FIRST, then closed: the area now holds page 4's answer, which is what a gap must not reopen.
    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('inside'), { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });
    expect(await screen.findAllByRole('menuitem')).not.toStrictEqual([]);
    await act(async () => {
      fireEvent.keyDown(screen.getAllByRole('menuitem')[0] ?? document.body, { key: 'Escape' });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryAllByRole('menuitem')).toStrictEqual([]);
    });

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('gap'), { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });
    expect(asked).toStrictEqual([3]);
    expect(screen.queryAllByRole('menuitem')).toStrictEqual([]);
  });
});
