// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import { ContextMenuArea } from './ContextMenu.js';

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
  const command = (id: string, title: string, menu: 'page' | 'tab', order: number): UiCommand => ({
    id,
    // Existing catalogue keys, so the rendered text is a real title rather than a raw key.
    title: messageKey(title),
    placements: [{ surface: 'context-menu', context: menu, order }],
    run: (context) => {
      runs.push({ id, page: context.page });
    },
  });
  const registry = new CommandRegistry([
    command('t.rotate', 'command.rotate-page.title', 'page', 10),
    command('t.delete', 'command.delete-page.title', 'page', 20),
    command('t.close', 'command.close-tab.title', 'tab', 10),
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
