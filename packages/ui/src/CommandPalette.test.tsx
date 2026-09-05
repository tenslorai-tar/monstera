// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion } from '@monstera/shared';
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CommandPalette } from './CommandPalette.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN, FIND_TITLE, SAVE_TITLE, UNDO_TITLE } from './messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from './registries/commands.js';

/**
 * The palette, as a projection.
 *
 * The properties worth asserting are the registration ones: what it shows comes
 * from the registry and nowhere else, a command hidden by `when` is absent, and
 * clicking runs the command it names. Everything else is a text field.
 */

const CONTEXT: CommandContext = {
  docId: asDocId('00000000-0000-4000-8000-0000000000bb'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 3,
  openDocuments: [],
};

const NO_DOCUMENT: CommandContext = {
  docId: undefined,
  version: undefined,
  hasSelection: false,
  dirty: false,
  page: undefined,
  pageCount: undefined,
  openDocuments: [],
};

function command(id: string, title: UiCommand['title'], extra: Partial<UiCommand> = {}): UiCommand {
  return { id, title, placements: [], run: vi.fn(), ...extra };
}

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function open(registry: CommandRegistry, context = CONTEXT, onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <Wrapped>
        <CommandPalette registry={registry} context={context} onClose={onClose} />
      </Wrapped>,
    ),
  };
}

function titles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.m-palette-title')].map((node) => node.textContent);
}

/**
 * The palette's query field.
 *
 * Throws rather than asserting non-null: a case that cannot find the field has
 * not typed into an empty palette, it has failed to render one, and the error
 * should say which.
 */
function queryField(container: HTMLElement): HTMLInputElement {
  const field = container.querySelector('input');
  if (field === null) throw new Error('the palette rendered no query field');
  return field;
}

/** The palette's root, for the cases that dispatch an event at it. */
function palette(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('.m-palette');
  if (root === null) throw new Error('the palette did not render');
  return root;
}

describe('CommandPalette', () => {
  it('shows what the REGISTRY holds, in the registrys own order', () => {
    // THE WHOLE POINT. There is no list in the component, so a command added to
    // the registry appears here with no edit — and this case is what would go
    // red if somebody added one.
    const registry = new CommandRegistry([
      command('z.save', SAVE_TITLE),
      command('a.undo', UNDO_TITLE),
    ]);
    const { container } = open(registry);

    // Sorted by id, which puts undo first despite being registered second —
    // asserting the order is what catches a projection that quietly preserved
    // registration order instead, and that would make the palette's contents
    // depend on where a command was composed.
    expect(titles(container)).toStrictEqual(['Undo', 'Save']);
  });

  it('omits a command whose `when` refuses this context', () => {
    // `when` decides EXISTENCE, not enablement (ADR-0029), so an unavailable
    // command must be absent rather than present and inert — a palette listing
    // a command that does nothing is §10.4's defect with a search box on it.
    const registry = new CommandRegistry([
      command('a.always', UNDO_TITLE),
      command('b.needs-document', SAVE_TITLE, { when: (c) => c.docId !== undefined }),
    ]);

    expect(titles(open(registry, CONTEXT).container)).toStrictEqual(['Undo', 'Save']);
    expect(titles(open(registry, NO_DOCUMENT).container)).toStrictEqual(['Undo']);
  });

  it('filters on the RENDERED title, because an id is not what a person types', () => {
    const registry = new CommandRegistry([
      command('a.one', SAVE_TITLE),
      command('b.two', FIND_TITLE),
    ]);
    const { container } = open(registry);

    fireEvent.change(queryField(container), {
      target: { value: 'sav' },
    });
    // "Save" matches and "Find on this page" does not. Matching on the id would
    // have found `a.one` for a query of "a", which is not a thing anybody types.
    expect(titles(container)).toStrictEqual(['Save']);
  });

  it('RUNS the command it names, with the context it was given', () => {
    // The other half of the wired-tools pair for this surface: a list that
    // rendered and dispatched nothing is exactly the display-only defect.
    const run = vi.fn();
    const registry = new CommandRegistry([command('a.one', SAVE_TITLE, { run })]);
    const { container, onClose } = open(registry);

    const item = container.querySelector<HTMLButtonElement>('.m-palette-item');
    if (item === null) throw new Error('the palette listed no command to click');
    item.click();

    expect(run).toHaveBeenCalledWith(CONTEXT);
    // AND CLOSES, because a palette that stayed open over the thing it just
    // acted on hides the result of the action.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says so when nothing matches, rather than showing an empty box', () => {
    const registry = new CommandRegistry([command('a.one', SAVE_TITLE)]);
    const { container } = open(registry);

    fireEvent.change(queryField(container), {
      target: { value: 'nothing matches this' },
    });

    expect(container.querySelector('.m-palette-list')).toBeNull();
    expect(container.querySelector('.m-palette-empty')?.textContent).toBe('No command matches.');
  });

  it('closes on Escape', () => {
    const registry = new CommandRegistry([command('a.one', SAVE_TITLE)]);
    const { container, onClose } = open(registry);

    fireEvent.keyDown(palette(container), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
