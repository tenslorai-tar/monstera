// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion } from '@monstera/shared';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
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

/**
 * Renders the palette and hands back the BODY as its container.
 *
 * The palette is the dialog primitive, which portals its popup to the body, so the element `render` returns holds
 * none of it — a query there finds nothing, and a case built on it fails for the harness's reason.
 */
function open(registry: CommandRegistry, context = CONTEXT, onClose = vi.fn()) {
  const rendered = render(
    <Wrapped>
      <CommandPalette registry={registry} context={context} onClose={onClose} />
    </Wrapped>,
  );
  return { onClose, unmount: rendered.unmount, container: document.body };
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

/** The palette's popup. */
function palette(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('.m-palette');
  if (root === null) throw new Error('the palette did not render');
  return root;
}

/** Fires a key where a person's key press would arrive: at the element given, bubbling, cancellable. */
function press(target: EventTarget, key: string): void {
  act(() => {
    target.dispatchEvent(new globalThis.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }));
  });
}

/** Waits for the primitive to move initial focus, which it does after paint, and returns where it went. */
async function landed(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(document.activeElement).not.toBe(document.body);
  });
  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) throw new Error('focus landed on an element');
  return element;
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

    const first = open(registry, CONTEXT);
    expect(titles(first.container)).toStrictEqual(['Undo', 'Save']);
    // UNMOUNTED between the two, because both portal to the one body and the second read would count the first.
    first.unmount();
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

  /*
   * DISMISSAL, ONE CASE PER ROUTE AND PER PLACE FOCUS CAN BE.
   *
   * The palette would not close in a live session on 2026-09-17, by Escape, by a click outside, or from its title-bar
   * control. The cases here before then fired Escape at the palette's own elements, and a handler on the palette's
   * root hears exactly those — so they passed while the defect lived in every key that arrived from ANYWHERE ELSE.
   * The separating fixtures below are the ones that handler could not hear: a key whose target is outside the popup,
   * and a press outside it. Measured against the previous component: those two red, the in-popup ones green.
   *
   * Each case's control is a key or a press the same position sends that must NOT close, so a listener that closed on
   * every event cannot pass it.
   */
  describe('closes', () => {
    it('on Escape WHERE FOCUS LANDS when it opens — which is the query field', async () => {
      const registry = new CommandRegistry([command('a.one', SAVE_TITLE)]);
      const { container, onClose } = open(registry);
      const where = await landed();
      // READ BACK, not chosen: the field is where a person's first key goes, and the case asserts it went there.
      expect(where).toBe(queryField(container));

      press(where, 'a');
      expect(onClose).not.toHaveBeenCalled();
      press(where, 'Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('on Escape from a RESULT ROW, where Tab or a pointer leaves focus', async () => {
      const registry = new CommandRegistry([command('a.one', SAVE_TITLE)]);
      const { container, onClose } = open(registry);
      await landed();
      const row = container.querySelector<HTMLButtonElement>('.m-palette-item');
      if (row === null) throw new Error('the palette listed a row');
      row.focus();
      expect(document.activeElement).toBe(row);

      press(row, 'ArrowDown');
      expect(onClose).not.toHaveBeenCalled();
      press(row, 'Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('on Escape from the POPUP itself, where a click on its padding leaves focus', async () => {
      const registry = new CommandRegistry([command('a.one', SAVE_TITLE)]);
      const { container, onClose } = open(registry);
      await landed();
      const popup = palette(container);

      press(popup, 'Shift');
      expect(onClose).not.toHaveBeenCalled();
      press(popup, 'Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('on Escape arriving from OUTSIDE the popup — the key a handler on the palette could never hear', async () => {
      // THE SEPARATING CASE. The target is the body, which is where a key goes once focus has left the palette.
      const registry = new CommandRegistry([command('a.one', SAVE_TITLE)]);
      const { onClose } = open(registry);
      await landed();

      press(document.body, 'a');
      expect(onClose).not.toHaveBeenCalled();
      press(document.body, 'Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('on a press OUTSIDE it, on the backdrop that covers the rest of the window', async () => {
      const registry = new CommandRegistry([command('a.one', SAVE_TITLE)]);
      const { container, onClose } = open(registry);
      await landed();
      const backdrop = container.querySelector<HTMLElement>('.m-dialog__backdrop');
      if (backdrop === null) throw new Error('a modal palette draws a backdrop');

      // CONTROL: the same press sequence INSIDE the popup does not close it.
      const popup = palette(container);
      fireEvent.pointerDown(popup);
      fireEvent.mouseDown(popup);
      fireEvent.pointerUp(popup);
      fireEvent.mouseUp(popup);
      fireEvent.click(popup);
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.pointerDown(backdrop);
      fireEvent.mouseDown(backdrop);
      fireEvent.pointerUp(backdrop);
      fireEvent.mouseUp(backdrop);
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('from its Close control', async () => {
      const registry = new CommandRegistry([command('a.one', SAVE_TITLE)]);
      const { container, onClose } = open(registry);
      await landed();
      const close = [...container.querySelectorAll<HTMLElement>('.m-palette [aria-label]')].find(
        (element) => element.getAttribute('aria-label') === 'Close',
      );
      if (close === undefined) throw new Error('the palette carries a Close control');
      act(() => {
        close.click();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('an Escape that closed the palette does NOT reach a listener on the document', () => {
    // The application's shortcuts listen on `document`, and Escape is `view.leave-focus` there. Without this, closing
    // the palette in Focus would also leave Focus — one key, two effects.
    const registry = new CommandRegistry([command('a.one', SAVE_TITLE)]);
    const { container, onClose } = open(registry);
    const reached = vi.fn();
    document.addEventListener('keydown', reached);
    try {
      fireEvent.keyDown(queryField(container), { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(reached).not.toHaveBeenCalled();
      // CONTROL: a key the palette does not consume still reaches the document, so the listener can see at all.
      fireEvent.keyDown(queryField(container), { key: 'a' });
      expect(reached).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', reached);
    }
  });
});
