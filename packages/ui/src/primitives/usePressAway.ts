import { type RefObject, useEffect, useEffectEvent } from 'react';

/**
 * Closes an INLINE list — one drawn in place under its field rather than in a portal — on a press anywhere outside it
 * and on Escape wherever the focus is: the one rule every inline picker takes (B3a).
 *
 * ## Why an inline list needs this and a portal's does not
 *
 * A list in a portal is Base UI's (`Menu`, `Dialog`), whose dismissal listens on the document. An inline list exists
 * where a portal would take the focus out of the element that holds it — the font picker inside the text editor's
 * Properties panel, whose focus must stay in the panel for the editor to stay open. Such a list had to close itself, and
 * the font picker did not: it closed on a choice and on an Escape typed in its own search box only, so a press in the
 * panel or on the page, or an Escape once the focus had moved, left it open (the owner's review of 0.1.16.0, R9).
 *
 * ## The press still does its own work
 *
 * The listener is on the window in the CAPTURE phase and only closes: it neither stops the press nor moves the focus,
 * so a press on the page that would end an edit, or on another control, does exactly that. Escape is the exception —
 * it is consumed, because the same key in the text editor would finish the words.
 *
 * @param open whether the list is open; nothing listens while it is closed
 * @param inside every element a press may land in without closing it: the field and the list
 * @param close what closing is; called once per press or Escape
 */
export function usePressAway(open: boolean, inside: readonly RefObject<HTMLElement | null>[], close: (how: 'press' | 'escape') => void): void {
  // THE LATEST `close` AND `inside`, read when an event arrives, so the listeners are added once per opening rather than
  // on every render of a list whose callbacks are new each time.
  const pressed = useEffectEvent((event: PointerEvent): void => {
    const target = event.target;
    if (target instanceof Node && inside.some((ref) => ref.current?.contains(target) === true)) return;
    close('press');
  });
  const keyed = useEffectEvent((event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close('escape');
  });
  useEffect(() => {
    if (!open) return undefined;
    const onPress = (event: PointerEvent): void => {
      pressed(event);
    };
    const onKey = (event: KeyboardEvent): void => {
      keyed(event);
    };
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
}
