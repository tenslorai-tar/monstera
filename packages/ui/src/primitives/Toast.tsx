import { useLingui } from '@lingui/react';
import { X } from 'lucide-react';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Icon } from './Icon.js';
import { IconButton } from './IconButton.js';

/**
 * What a toast reports: a thing that worked, or a thing that did not.
 *
 * **Outcomes, not colours.** They pick an icon and a border here, but a caller naming a colour
 * would put the theme inside the feature, which §10.2 bans — and the high-contrast theme has no
 * quiet green to spend.
 */
export type ToastKind = 'done' | 'problem';

/** One message on screen. The store in `toasts.ts` holds these; this file draws them. */
export interface ToastMessage {
  /**
   * Distinguishes this toast from every other, INCLUDING a repeat of the same text.
   *
   * Saving twice raises the same words twice, and a list keyed on the words would make the
   * second replace the first silently — the person then sees one toast for two saves and cannot
   * tell whether the second landed.
   */
  readonly id: number;
  readonly kind: ToastKind;
  /** The line the person reads. A `MessageKey`, so B9's ban on literal strings holds here too. */
  readonly message: MessageKey;
}

/**
 * One brief confirmation.
 *
 * ## Each toast times ITSELF out
 *
 * One timer per message rather than one sweep over the queue: two saves a second apart must
 * leave a second apart, and a shared interval would round them to its own tick. The effect's
 * cleanup clears it, so a toast dismissed by hand takes its timer with it.
 *
 * ## And the timer STOPS while a person is on it
 *
 * The × is a tab stop, so a keyboard user can be on it when the lifetime runs out — and a toast
 * removed from under its own focused button drops focus to the page, losing the reader's place
 * (WCAG 2.2.1 asks that a time limit can be extended; 2.4.3 that focus keeps its order). So the
 * timer runs only while the toast has neither the pointer over it nor focus inside it, and on
 * leaving it resumes with what was LEFT rather than starting again, so hovering on the way past
 * does not make a toast stay twice as long.
 *
 * ## A PROBLEM has no timer at all
 *
 * Pausing on hover and focus extends the time only for someone who reaches the toast before it goes, and a problem is
 * the message a person most needs to read at their own pace (WCAG 2.2.1: a time limit can be turned off). So a problem
 * stays until its × is pressed or newer messages push it out of the three kept; a confirmation, which repeats what
 * the person can see happened, keeps its lifetime.
 */
function ToastRow({
  toast,
  dismissLabel,
  onDismiss,
  lifetime,
}: {
  readonly toast: ToastMessage;
  readonly dismissLabel: MessageKey;
  readonly onDismiss: (id: number) => void;
  readonly lifetime: number;
}): ReactElement {
  const { _ } = useLingui();
  const { id } = toast;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // WHAT IS LEFT of the lifetime, carried across a pause. A ref, because spending it is not
  // something the toast re-renders for.
  const remaining = useRef(lifetime);
  const held = hovered || focused;
  const timed = toast.kind !== 'problem';

  useEffect(() => {
    if (held || !timed) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => {
      onDismiss(id);
    }, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [held, timed, id, onDismiss]);

  return (
    <div
      className={`m-toast m-toast--${toast.kind}`}
      onBlur={(event) => {
        // FOCUS MOVING BETWEEN THIS TOAST'S OWN PARTS is not leaving it.
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
          setFocused(false);
        }
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
    >
      <Icon name={toast.kind === 'done' ? 'CircleCheck' : 'CircleAlert'} size="dense" />
      <p className="m-toast__message">{_(toast.message)}</p>
      <IconButton
        icon={X}
        label={dismissLabel}
        onClick={() => {
          onDismiss(id);
        }}
        size="dense"
      />
    </div>
  );
}

/**
 * The strip along the bottom that holds them (§10.4's `Toast`).
 *
 * ## The region is ALWAYS mounted, and that is the accessibility of it
 *
 * A live region announces what changes INSIDE it. Mounting the region together with its first
 * message makes the region itself the change, and a screen reader that had nothing to watch
 * announces nothing — the classic silent toast. So this renders whether or not anything is in
 * it, and only its children come and go.
 *
 * `polite` rather than `assertive`: these report something the person just did, so interrupting
 * whatever they are reading to say *Saved* is worse than saying it a moment later. A message
 * that must interrupt is one the person has to answer, and that is a `Dialog`.
 *
 * ## A toast SAYS a thing happened; it never asks
 *
 * Nothing here takes an answer, carries an action or can be waited on. A caller that needs a
 * decision opens a `<Dialog>`, because a message that vanishes after a few seconds cannot hold
 * a choice a person has to make. Invariant 18's *never by a dialog whose only option discards*
 * points the same way from the other end — the two carriers divide by whether the person must
 * reply, not by how serious the news is.
 */
export function ToastStrip({
  toasts,
  dismissLabel,
  onDismiss,
  lifetime,
}: {
  readonly toasts: readonly ToastMessage[];
  /** The × button's accessible name. A prop, for the reason `Button`'s `label` is one. */
  readonly dismissLabel: MessageKey;
  /** Takes one toast off, by its id. */
  readonly onDismiss: (id: number) => void;
  /** How long each stays. Passed in so a test states the duration rather than waiting one. */
  readonly lifetime: number;
}): ReactElement {
  const strip = useRef<HTMLDivElement | null>(null);
  // CLEAR OF WHAT MUST NOT BE COVERED. The strip sits at the window's bottom-right, which is where the assistant's
  // composer ends, and a save's toast covered its Send button — by 6 px at rest at 1280 × 800 (measured 2026-10-02; a
  // check that caught the toast mid-slide passed). An element that must stay reachable says so with
  // `data-toast-avoid`; while a toast is shown, the strip lifts above any such element it would overlap. Nothing moves
  // when none is on screen, and the primitive names no surface.
  useLayoutEffect(() => {
    const own = strip.current;
    if (own === null) return;
    if (toasts.length === 0) {
      own.style.removeProperty('--m-toasts-clear');
      return;
    }
    const mine = own.getBoundingClientRect();
    let clear = 0;
    for (const element of globalThis.document.querySelectorAll<HTMLElement>('[data-toast-avoid]')) {
      const box = element.getBoundingClientRect();
      const across = box.left < mine.right && mine.left < box.right;
      if (across && box.height > 0) clear = Math.max(clear, globalThis.innerHeight - box.top);
    }
    if (clear > 0) own.style.setProperty('--m-toasts-clear', `${String(clear)}px`);
    else own.style.removeProperty('--m-toasts-clear');
  }, [toasts]);
  return (
    // `aria-live` and not `role="alert"`: alert is assertive, and the status bar below is
    // already this window's one `role="status"` region. Two of those would have a screen reader
    // announce a save twice — once here, and once as the bar's own saved-state text changed.
    <div aria-live="polite" className="m-toasts" ref={strip}>
      {toasts.map((toast) => (
        <ToastRow
          dismissLabel={dismissLabel}
          key={toast.id}
          lifetime={lifetime}
          onDismiss={onDismiss}
          toast={toast}
        />
      ))}
    </div>
  );
}
