import { isTypingField } from './surfaces/shortcuts.js';

/**
 * The text field that has the focus — or HAD it when the menu bar took it — for the Edit menu's *Cut*, *Copy*, *Paste*
 * and *Select all* (ADR-0107, the owner's answer of 2026-09-26: they act on what has focus).
 *
 * ## Why a menu cannot simply ask `document.activeElement`
 *
 * Opening a menu moves the focus into the menu, so by the time an item runs, the field a person was typing in no
 * longer has it. This keeps the last field that did, and forgets it the moment the focus goes anywhere that is not a
 * field and not the menu bar or one of its menus — so a field typed in an hour ago and left for the page is not what
 * *Paste* pastes into.
 *
 * `inMenus` decides what counts as the menu bar, and the caller passes it, because which elements are the menu is the
 * surface's knowledge and not this module's.
 *
 * ## A stable object whose listening is started and stopped
 *
 * The shell creates one per mount and an effect starts and stops it, so nothing the shell holds is ever reassigned —
 * the state lives in this closure. `field` is what a command's `when` asks, including while a menu is drawn.
 */
export interface TypingFocus {
  /** The field, if one has the focus or had it when a menu took it, and it is still in the document. */
  readonly field: () => HTMLElement | undefined;
  /** Begins listening on `target`; the answer is `undefined` until something is focused. */
  readonly start: (target: Document) => void;
  /** Stops listening and forgets the field. */
  readonly stop: () => void;
}

export function createTypingFocus(inMenus: (element: Element) => boolean): TypingFocus {
  let last: HTMLElement | undefined;
  let listening: Document | undefined;
  const entered = (event: FocusEvent): void => {
    const to = event.target;
    if (isTypingField(to)) last = to;
    else if (!(to instanceof Element) || !inMenus(to)) last = undefined;
  };
  const left = (event: FocusEvent): void => {
    // FOCUS LEAVING FOR NOTHING — a press on the page, which focuses no element, or the window losing the focus — is
    // leaving the field. `focusin` does not fire for the body, so this is the half that sees it.
    if (event.relatedTarget === null && event.target === last) last = undefined;
  };
  const stop = (): void => {
    listening?.removeEventListener('focusin', entered);
    listening?.removeEventListener('focusout', left);
    listening = undefined;
    last = undefined;
  };
  return {
    field: () => (last?.isConnected === true ? last : undefined),
    start: (target) => {
      stop();
      target.addEventListener('focusin', entered);
      target.addEventListener('focusout', left);
      listening = target;
    },
    stop,
  };
}
