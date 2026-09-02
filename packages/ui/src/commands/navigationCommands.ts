import {
  FIRST_PAGE_TITLE,
  GO_BACK_TITLE,
  GO_FORWARD_TITLE,
  LAST_PAGE_TITLE,
  NEXT_PAGE_TITLE,
  PREVIOUS_PAGE_TITLE,
} from '../messages/en.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';

/**
 * Moving around a document.
 *
 * ## Every one of these is a JUMP, and that is what the history records
 *
 * Scrolling is not a command and does not push. `DocumentState.history`'s own
 * header says why: a back-stack that recorded scrolling would step back one
 * page at a time through everything a reader read, and Alt+Left would be
 * useless where it is most wanted — *return me to where I was before I jumped
 * to page 400*.
 *
 * ## Why PageUp/PageDown are commands at all, when the browser already scrolls
 *
 * A scrollable element handles those keys natively, by a **viewport** — so at a
 * zoom where one page does not fill the viewport, the native key lands
 * somewhere in the middle of a page and the reader has to finish the job by
 * hand. These move by a PAGE, which is the unit the document has. The native
 * behaviour is prevented by the shortcut map, and this is what replaces it.
 *
 * ## The navigator is passed in, not read from a context
 *
 * A command holds what it needs at registration, the same way the document
 * commands hold the client. The page count and the current page come through
 * `CommandContext` because they change under the command, which is exactly what
 * the context is for.
 */

/** What a navigation command needs to do its job. */
export interface Navigator {
  /** Go to a page, recording it in the history. Zero-based. */
  readonly jumpTo: (page: number) => void;
  /** Step back through the history, if there is anywhere to go. */
  readonly back: () => void;
  /** Step forward. */
  readonly forward: () => void;
}

/**
 * Clamps a page into the document.
 *
 * **Clamped rather than refused**, because every caller here is a control a
 * reader pressed: pressing "next page" on the last page should do nothing
 * visible, not raise anything. A refusal would need a message, and *you are
 * already at the end* is not news to someone looking at the end.
 */
function within(page: number, pageCount: number): number {
  return Math.min(Math.max(page, 0), Math.max(0, pageCount - 1));
}

/**
 * The four relative moves, as four registrations.
 *
 * `zoomCommand`'s reason for two rather than one parameterised command applies
 * unchanged: a toolbar, a chord and a palette all invoke a command with no
 * arguments, so a direction has to be baked into the registration.
 */
export function pageMoveCommand(
  move: 'next' | 'previous' | 'first' | 'last',
  deps: { readonly navigator: Navigator },
): UiCommand {
  const titles = {
    next: NEXT_PAGE_TITLE,
    previous: PREVIOUS_PAGE_TITLE,
    first: FIRST_PAGE_TITLE,
    last: LAST_PAGE_TITLE,
  } as const;
  const shortcuts = {
    next: 'PageDown',
    previous: 'PageUp',
    first: 'Ctrl+Home',
    last: 'Ctrl+End',
  } as const;

  return {
    id: `view.page-${move}`,
    title: titles[move],
    shortcut: shortcuts[move],
    placements: [],
    when: hasDocument,
    run: (context: CommandContext): void => {
      const count = context.pageCount ?? 0;
      if (count === 0) return;
      const at = context.page ?? 0;
      const target = {
        next: at + 1,
        previous: at - 1,
        first: 0,
        last: count - 1,
      }[move];
      deps.navigator.jumpTo(within(target, count));
    },
  };
}

/**
 * Alt+Left and Alt+Right.
 *
 * **Registered even where there is nowhere to go**, for `zoomCommand`'s reason:
 * `when` decides existence rather than enablement (ADR-0029), and a control
 * that vanished at the start of the history would disappear from the palette
 * mid-session. Pressing it there does nothing, which is what the store's
 * `undefined` return means.
 */
export function historyCommand(
  direction: 'back' | 'forward',
  deps: { readonly navigator: Navigator },
): UiCommand {
  return {
    id: direction === 'back' ? 'view.go-back' : 'view.go-forward',
    title: direction === 'back' ? GO_BACK_TITLE : GO_FORWARD_TITLE,
    shortcut: direction === 'back' ? 'Alt+ArrowLeft' : 'Alt+ArrowRight',
    placements: [],
    when: hasDocument,
    run: (): void => {
      if (direction === 'back') deps.navigator.back();
      else deps.navigator.forward();
    },
  };
}
