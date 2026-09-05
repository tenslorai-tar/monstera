import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it, vi } from 'vitest';

import type { CommandContext } from '../registries/commands.js';
import { historyCommand, pageMoveCommand } from './navigationCommands.js';

/**
 * The navigation commands, against a recording navigator.
 *
 * What these assert is the DECISION: which page each command asks for, given a
 * context. Where the reader ends up is the scroller's, and whether the history
 * moves correctly is the store's — each proven where it lives.
 */

function contextAt(page: number, pageCount: number): CommandContext {
  return {
    docId: asDocId('00000000-0000-4000-8000-0000000000aa'),
    version: asDocVersion(1),
    hasSelection: false,
    dirty: false,
    page,
    pageCount,
    openDocuments: [],
  };
}

function recording() {
  return { jumpTo: vi.fn(), back: vi.fn(), forward: vi.fn() };
}

describe('pageMoveCommand', () => {
  it('moves one page from WHERE THE READER IS, not from the start', () => {
    // The fixture is deliberately mid-document: a command that ignored the
    // context and sent a literal would pass a case written at page 0.
    const navigator = recording();
    void pageMoveCommand('next', { navigator }).run(contextAt(3, 10));
    expect(navigator.jumpTo).toHaveBeenCalledWith(4);

    void pageMoveCommand('previous', { navigator }).run(contextAt(3, 10));
    expect(navigator.jumpTo).toHaveBeenLastCalledWith(2);
  });

  it('goes to the ends by the documents own count', () => {
    const navigator = recording();
    void pageMoveCommand('last', { navigator }).run(contextAt(3, 10));
    // NINE, not ten: pages are zero-based here and the last index is count - 1.
    // A command that sent the count would be one past the end, which is the
    // off-by-one this build has already shipped once in the other direction.
    expect(navigator.jumpTo).toHaveBeenCalledWith(9);

    void pageMoveCommand('first', { navigator }).run(contextAt(3, 10));
    expect(navigator.jumpTo).toHaveBeenLastCalledWith(0);
  });

  it('clamps at both ends instead of asking for a page that is not there', () => {
    const navigator = recording();
    void pageMoveCommand('next', { navigator }).run(contextAt(9, 10));
    expect(navigator.jumpTo).toHaveBeenCalledWith(9);

    void pageMoveCommand('previous', { navigator }).run(contextAt(0, 10));
    expect(navigator.jumpTo).toHaveBeenLastCalledWith(0);
  });

  it('asks for NOTHING when the document has no pages yet', () => {
    // ASSERTING THE CALL THAT WAS NOT MADE, because the tidy end state is the
    // same either way: a scroller told to reveal page 0 of an empty document
    // finds no slot and does nothing, so the store would be the only thing that
    // could tell — and it would have a spurious history entry.
    const navigator = recording();
    void pageMoveCommand('last', { navigator }).run(contextAt(0, 0));
    expect(navigator.jumpTo).not.toHaveBeenCalled();
  });

  it('is absent with no document', () => {
    const noDocument: CommandContext = {
      docId: undefined,
      version: undefined,
      hasSelection: false,
      dirty: false,
      page: undefined,
      pageCount: undefined,
      openDocuments: [],
    };
    const navigator = recording();
    expect(pageMoveCommand('next', { navigator }).when?.(noDocument)).toBe(false);
    expect(pageMoveCommand('next', { navigator }).when?.(contextAt(0, 5))).toBe(true);
  });
});

describe('historyCommand', () => {
  it('delegates the DECISION to the store rather than deciding here', () => {
    // Both directions call through unconditionally. Whether there is anywhere
    // to go is the store's answer — a command that checked first would be a
    // second opinion about the history's own bounds, and the two would drift.
    const navigator = recording();
    void historyCommand('back', { navigator }).run(contextAt(3, 10));
    expect(navigator.back).toHaveBeenCalledTimes(1);
    expect(navigator.forward).not.toHaveBeenCalled();

    void historyCommand('forward', { navigator }).run(contextAt(3, 10));
    expect(navigator.forward).toHaveBeenCalledTimes(1);
  });

  it('carries the chords a reader expects, and two distinct ids', () => {
    const navigator = recording();
    const back = historyCommand('back', { navigator });
    const forward = historyCommand('forward', { navigator });

    expect(back.shortcut).toBe('Alt+ArrowLeft');
    expect(forward.shortcut).toBe('Alt+ArrowRight');
    // CONTROL: two registrations, not one — the registry throws on a duplicate
    // id, so a factory that returned the same id twice would fail at
    // composition rather than here, and this says which was intended.
    expect(back.id).not.toBe(forward.id);
  });
});
