import { useLingui } from '@lingui/react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type { MessageKey } from '@monstera/shared';
import { X } from 'lucide-react';
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { CLOSE_LABEL, DIALOG_CANCEL, DIALOG_OK } from '../messages/en.js';
import { Button } from './Button.js';
import { IconButton } from './IconButton.js';
import { OPENS_FOCUSED } from './Input.js';
import { Problem } from './Problem.js';

/**
 * The one dialog primitive. Every dialog in the application is this (B9).
 *
 * ## What is delegated, and why delegating it is the point
 *
 * The focus trap, the Escape handler, the outside-press dismissal, the
 * `aria-labelledby` wiring and the inert-ing of the rest of the document all
 * come from Base UI. Rule 0 names this class exactly — *"accessible focus traps,
 * menus and comboboxes are exactly the class of solved problem Rule 0 says not
 * to re-derive by hand"* — and a hand-written trap is wrong in the cases nobody
 * tests: shift-tab off the first element, a control that becomes disabled while
 * focused, content that mounts after the trap.
 *
 * `modal` is passed as `true` rather than `'trap-focus'`. A document editor's
 * dialogs are decisions about the document; leaving the page scrollable and
 * clickable behind one invites an edit the dialog is mid-way through deciding
 * about.
 *
 * ## Focus opens ON THE DIALOG, not on its first control — unless the dialog asks for words
 *
 * A dialog whose body names the field it was opened to be typed into opens on that field (`openingField`). Every
 * other dialog opens on the popup itself, for the reason that follows.
 *
 * Base UI's default initial focus is the popup's first tabbable element
 * (`dialog/popup/DialogPopup.js`, 1.7.0), which here is the header's Close icon
 * button — and that button is a tooltip trigger that opens on focus
 * (`tooltip/trigger/TooltipTrigger.js`). The tooltip's dismiss handler sits on the
 * button itself and, after closing the tooltip, stops the key
 * (`floating-ui-react/hooks/useDismiss.js`). So the first Escape a person pressed
 * closed a tooltip they never asked for, and the dialog needed a second.
 * Measured 2026-09-15 in Chromium on two dialogs opened two ways; the live run's
 * *"Escape did not close the problem dialog"* the day before was this.
 *
 * Focusing the popup instead puts a screen reader on the dialog's name — its title
 * — and opens no tooltip, so the first Escape reaches the dialog. Tab still moves
 * into the controls; a Close button a person tabs to shows its tooltip, and
 * Escape there closes the tooltip first, which is the innermost-first order a
 * person who focused it can see happening.
 *
 * ## The CSP question, answered by measurement rather than by caution
 *
 * §9.27 pins `style-src 'self'` and names the live risk as *"a library that
 * injects a `<style>` element or sets a style attribute at run time"*. Base UI
 * does inject one — `styleDisableScrollbar.getElement(nonce)` — and this
 * primitive does not reach it. Grepped against `@base-ui/react@1.7.0` in
 * `node_modules` on 2026-08-28, the only two call sites are
 * `scroll-area/root/ScrollAreaRoot.js` and `select/popup/SelectPopup.js`, both
 * gated on `!disableStyleElements`. Neither is a Stage 0 primitive.
 *
 * **So the exposure arrives with `Select` or `ScrollArea`, and that is its
 * trigger.** Whichever commit adds one owes `CSPProvider disableStyleElements`
 * above it, or a measured argument that the injection is permitted.
 *
 * What could NOT be measured here is stated rather than assumed: happy-dom
 * enforces no CSP and injected zero style elements either way, so a test
 * asserting "no style element appears" would pass identically with the guard
 * removed — the vacuous-fixture shape, so it is not written. The observation is
 * owed to the Playwright pass, against a real Chromium receiving the real
 * policy.
 *
 * The inline `style` attributes visible in Base UI's rendered output are not the
 * same question: they come from React's `style` prop, which reaches the element
 * through `node.style.setProperty`, and §9.27 records that CSP does not
 * intercept CSSOM writes.
 */
export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dialog's accessible name, rendered as its heading. */
  title: MessageKey;
  /** The accessible name of the close control — an action, e.g. "Close". */
  closeLabel: MessageKey;
  /**
   * Where focus lands when the dialog opens. When omitted, the field the body marks `opensFocused`, or the popup itself
   * where the body marks none (`openingField`, and the tooltip reason above).
   *
   * Given by a dialog that is not a body of the pattern — the command palette names its query field.
   */
  initialFocus?: RefObject<HTMLElement | null>;
  /** A second class on the popup, for a dialog placed differently from the centred default. */
  popupClassName?: string;
  children: ReactNode;
}

/**
 * The field the body was opened to be typed into, or `null` when it names none.
 *
 * A dialog that asks for words — a text box drawn, a note placed, a password asked for — opens there (the owner's
 * review: a text box, a typewriter and a note opened with typing going nowhere). **The body names that field**
 * (`Input`'s `opensFocused`); the dialog does not take its first text field, because Settings and Help hold text fields
 * too and were not opened to be typed into: focus in a setting's box is a stray key away from editing it. A dialog
 * whose body names none keeps the popup, for the tooltip reason above.
 */
function openingField(popup: HTMLElement | null): HTMLElement | null {
  return popup?.querySelector<HTMLElement>(`.m-dialog__body [${OPENS_FOCUSED}]:not(:disabled)`) ?? null;
}

/**
 * Where a body's `DialogFooter` is drawn: the popup's foot, after the body and outside it, so the body scrolls and the
 * footer never does. `undefined` outside a dialog (a body rendered on its own, as a unit test renders one), where the
 * footer stays in place; `null` for the one commit before the foot is attached.
 *
 * **WHY A SLOT, and not a footer pinned inside the scrolling body.** A sticky footer stayed in view, but the rows
 * scrolled under it and had to be covered, and the dialog's ground is glass — translucent over a blur of the window —
 * which no colour of the footer's own can match: an opaque cover drew a white band in light (measured 2026-10-03,
 * Reading order and tags and Sign document at 760 × 560), and one at the ground's own alpha let the rows through. A
 * footer outside the scroll has nothing under it, so it is drawn on the ground itself.
 */
const FooterSlot = createContext<HTMLElement | null | undefined>(undefined);

export function Dialog({
  open,
  onOpenChange,
  title,
  closeLabel,
  initialFocus,
  popupClassName,
  children,
}: DialogProps): ReactElement {
  // Only the title is resolved here. `closeLabel` travels to `IconButton` as a
  // key and is resolved there, because resolving it twice would be two answers
  // to one question — and passing an already-resolved string would need
  // `IconButton` to accept one, which is the prop type this commit removes.
  const { _ } = useLingui();
  const popup = useRef<HTMLDivElement>(null);
  // FOCUSED AS THE POPUP ATTACHES, in the commit that opens it: Base UI's `initialFocus` moves focus a frame later, and
  // keys typed in that frame went to the page (the palette's measurement, 12 of 20 openings). A ref callback runs after
  // the popup's descendants are attached, so the body's field is there to take it. STABLE, because React calls a ref
  // callback whose identity changed again on every render, and each call would pull focus back to the first field
  // from wherever the person had moved it.
  const attachPopup = useCallback(
    (element: HTMLDivElement | null): void => {
      popup.current = element;
      if (element !== null && initialFocus === undefined) openingField(element)?.focus();
    },
    [initialFocus],
  );
  // WHETHER A PRESS HAS BEGUN SINCE THE DIALOG OPENED, from a capturing listener attached in the commit that opens
  // it — before any later input event can be dispatched. `onOpenChange` below reads it.
  const pressedWhileOpen = useRef(false);
  // THE FOOT, held as state so the body's footer renders into it once it is attached. A ref callback's update is applied
  // in the same commit, before the browser paints, so the footer is never drawn a frame late.
  const [foot, setFoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    pressedWhileOpen.current = false;
    if (!open) return undefined;
    const pressed = (): void => {
      pressedWhileOpen.current = true;
    };
    document.addEventListener('pointerdown', pressed, true);
    return (): void => {
      document.removeEventListener('pointerdown', pressed, true);
    };
  }, [open]);

  return (
    <BaseDialog.Root
      modal
      onOpenChange={(next, details): void => {
        // AN OUTSIDE PRESS COUNTS ONLY IF IT BEGAN WHILE THIS DIALOG WAS OPEN. Base UI's `intentional` dismissal closes
        // on any outside `click` whose press did not start inside the popup, and never asks whether the press began
        // before the dialog existed — so a dialog opened on a pointer-up (a drawn text box, a typewriter's click) was
        // closed by the `click` that ends that same press whenever Base UI's listener was attached before the browser
        // dispatched it (measured 2026-10-03: reason `outside-press`, event `click`, 1 ms after the `mouseup`).
        if (!next && details.reason === 'outside-press' && !pressedWhileOpen.current) return;
        onOpenChange(next);
      }}
      open={open}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="m-dialog__backdrop" />
        <BaseDialog.Popup
          className={popupClassName === undefined ? 'm-dialog' : `m-dialog ${popupClassName}`}
          initialFocus={initialFocus ?? (() => openingField(popup.current) ?? popup.current)}
          ref={attachPopup}
        >
          <div className="m-dialog__header">
            <BaseDialog.Title className="m-dialog__title">{_(title)}</BaseDialog.Title>
            {/* Inside the popup, per Base UI's own requirement for a modal
                dialog: a touch screen reader has no other way out. */}
            {/* `nativeButton`, because `IconButton` RENDERS ONE. Declared `false` here until
                2026-09-22, and the mismatch was not cosmetic: told the element is not a button, Base
                UI attaches its own keyboard emulation, and that swallowed Escape — so a dialog whose
                focus was on this control could not be dismissed by the key every other place in it
                answers. Measured on the shortcuts dialog: Escape from the field closed it, Escape
                from this button did not. */}
            <BaseDialog.Close nativeButton render={<IconButton icon={X} label={closeLabel} size="control" />} />
          </div>
          <FooterSlot.Provider value={foot}>
            <div className="m-dialog__body">{children}</div>
          </FooterSlot.Provider>
          <div className="m-dialog__foot" ref={setFoot} />
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/*
 * THE DIALOG PATTERN (the owner adopted it 2026-10-02, from the samples of Export pages as images, Export to Word and
 * Signature): a dialog's body is Settings' visual language. Each question is a ROW — its name and a muted note on the
 * left, its control on the right — a choice that needs a sentence per option is a list of CHOICES, and the body ends in
 * a FOOTER with Cancel and the one action at the right. They live here, beside `Dialog`, so every body is composed of
 * the same three parts and the spacing between them is one set of rules rather than one per dialog.
 */

/**
 * One question: its name and an optional note on the left, the control on the right. The control names itself (every
 * primitive takes a `label`), so the row's name is what is seen and the control's is what is announced; a control
 * shown beside its row passes `labelShownBeside` so the name is not printed twice.
 *
 * A `problem` is the sentence that says why what is in the control is refused, on a line of its own across the row,
 * so it sits with the field it is about rather than with the next question. It is an `alert`, mounted only while there
 * is one: an alert is announced when it appears, where a live region that was not there before is not.
 */
export function DialogRow({
  label,
  note,
  noteValues,
  problem,
  children,
}: {
  readonly label: MessageKey;
  readonly note?: MessageKey | undefined;
  /** The note's values, for a note that counts or names something — a source document's pages. */
  readonly noteValues?: Readonly<Record<string, string | number>> | undefined;
  /** Already translated, since a refusal names the part that was wrong; empty or absent while nothing is refused. */
  readonly problem?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  const { _ } = useLingui();
  const control = useRef<HTMLDivElement>(null);
  return (
    <div className="m-dialog-row">
      <div className="m-dialog-row__text">
        <span className="m-dialog-row__label">{_(label)}</span>
        {note === undefined ? null : <span className="m-dialog-row__note">{_(note, noteValues)}</span>}
      </div>
      <div className="m-dialog-row__control" ref={control}>
        {children}
      </div>
      {problem === undefined || problem === '' ? null : (
        <div className="m-dialog-row__problem">
          <Problem message={problem} about={{ within: control }} />
        </div>
      )}
    </div>
  );
}

/**
 * A choice's words: a catalogue key, or text that is the document's own and is shown as it is — an object's kind and
 * where it sits, which no catalogue holds. One shape for both, so a choice of things in a document is drawn by the
 * same rows as a choice of options rather than by a copy of them.
 */
export type ChoiceText = MessageKey | { readonly shown: string };

/** One option of `DialogChoices`: a short name, and the sentence that says what a person gets. */
export interface DialogChoice<Value extends string> {
  readonly value: Value;
  readonly label: ChoiceText;
  readonly note: ChoiceText;
}

/**
 * A choice whose options each need a sentence, as rows: a radio, a short name, the sentence under it. A segmented
 * control holds names, not sentences, and a sentence wrapped inside one is the defect this replaces.
 *
 * The group is named by its heading through `aria-labelledby`, so a screen reader announces the question once, on
 * entering the group, and each radio by its own name.
 */
export function DialogChoices<Value extends string>({
  label,
  note,
  options,
  value,
  onChange,
}: {
  readonly label: MessageKey;
  readonly note?: MessageKey | undefined;
  readonly options: readonly DialogChoice<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}): ReactElement {
  const { _ } = useLingui();
  const heading = useId();
  const name = useId();
  const say = (text: ChoiceText): string => (typeof text === 'string' ? _(text) : text.shown);
  return (
    <div aria-labelledby={heading} className="m-dialog-choices" role="radiogroup">
      <div className="m-dialog-row__text" id={heading}>
        <span className="m-dialog-row__label">{_(label)}</span>
        {note === undefined ? null : <span className="m-dialog-row__note">{_(note)}</span>}
      </div>
      {options.map((option) => (
        <label className="m-dialog-choice" key={option.value}>
          <input
            checked={option.value === value}
            name={name}
            onChange={() => {
              onChange(option.value);
            }}
            type="radio"
          />
          <span className="m-dialog-row__text">
            <span className="m-dialog-row__label">{say(option.label)}</span>
            <span className="m-dialog-row__note">{say(option.note)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/*
 * THE PATTERN FOR A WINDOW THAT IS BROWSED OR STEPPED THROUGH (the owner, 2 October: Cloud storage, Help, Keyboard
 * shortcuts, Spell check and Camera capture, which asked no one question and so had kept their own layouts). The same
 * title bar, rows and footer as a question's dialog, plus three parts: a SECTION per thing being browsed, with a
 * heading in the row's type and a state at its right; a section's ACTIONS in one row, the main one first and a quieter
 * one set apart at the end; and a SCROLLING region, so a long list moves between the title bar and the footer and
 * neither scrolls away.
 */

/**
 * One part of a browsed window: its heading, an optional state at the heading's right (*Signed in*), an optional
 * one-line note, then its content. A `section` named by its heading, so a screen reader can move between them.
 */
export function DialogSection({
  title,
  values,
  state,
  note,
  data,
  children,
}: {
  readonly title: MessageKey;
  readonly values?: Record<string, unknown> | undefined;
  readonly state?: ReactNode;
  readonly note?: ReactNode;
  /** `data-` attributes the caller marks the section with, for its own tests and styles. */
  readonly data?: Readonly<Record<`data-${string}`, string>> | undefined;
  readonly children?: ReactNode;
}): ReactElement {
  const { _ } = useLingui();
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="m-dialog-section" {...data}>
      <div className="m-dialog-section__head">
        <h3 className="m-dialog-section__title" id={heading}>
          {_(title, values)}
        </h3>
        {state === undefined ? null : <span className="m-dialog-section__state">{state}</span>}
      </div>
      {note === undefined ? null : <p className="m-dialog-section__note">{note}</p>}
      {children}
    </section>
  );
}

/**
 * A section's actions in one row that wraps: the main action first, as the caller orders them, and `apart` — a
 * quieter action such as *Sign out* — at the row's end, separated from the rest.
 */
export function DialogActions({ children, apart }: { readonly children?: ReactNode; readonly apart?: ReactNode }): ReactElement {
  return (
    <div className="m-dialog-actions">
      {children}
      {apart === undefined ? null : <span className="m-dialog-actions__apart">{apart}</span>}
    </div>
  );
}

/**
 * The part of a browsed window that scrolls. A body built of this and a `DialogFooter` side by side keeps its footer
 * (and anything placed before this, such as a search field) in view while the list moves.
 *
 * A REGION WITH NOTHING FOCUSABLE IN IT gives a keyboard no way to scroll it (axe's `scrollable-region-focusable`), so a
 * body whose list is only to be read passes `label` and the region takes the Tab stop itself, named. A body with buttons
 * in the list does not need it: they are the way in.
 */
export function DialogScroll({ children, label }: { readonly children: ReactNode; readonly label?: string }): ReactElement {
  return label === undefined ? (
    <div className="m-dialog-scroll">{children}</div>
  ) : (
    <div className="m-dialog-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/**
 * The body's foot: Cancel, then the action, at the right. Cancel is Base UI's `Close`, which works anywhere inside the
 * popup and closes it exactly as the header's close control does, so a body needs no dismissal of its own and
 * Cancel cannot mean anything different from the X. Its words are the primitive's, so every dialog says the same.
 */
export function DialogFooter({
  children,
  aside,
  dismissal = 'cancel',
}: {
  readonly children?: ReactNode;
  /**
   * An action about the whole window that is neither its answer nor its dismissal (*Reset all shortcuts*), at the
   * footer's start, apart from the buttons at its end.
   */
  readonly aside?: ReactNode;
  /**
   * What the footer's closing button says, which is decided by what the dialog IS (the owner, 2026-10-02):
   *
   * - `cancel` — it asks something, and closing declines;
   * - `ok` — a message, which asks nothing: its one button acknowledges;
   * - `close` — a report or a window of facts: its one button puts it away;
   * - `own` — the body's own buttons include the answer a dismissal is (*Skip*, *I understand*), which the command
   *   records, so a Cancel beside it would be a second way to say the same thing that records nothing. The footer
   *   draws none; the header's close still dismisses.
   *
   * With no `children` the closing button is the dialog's only action, so it is the primary one.
   */
  readonly dismissal?: 'cancel' | 'ok' | 'close' | 'own';
}): ReactElement | null {
  const only = children === undefined;
  const slot = useContext(FooterSlot);
  const footer = (
    <div className="m-dialog-footer">
      {aside === undefined ? null : <span className="m-dialog-footer__aside">{aside}</span>}
      {dismissal === 'own' ? null : (
        <BaseDialog.Close
          nativeButton
          render={<Button label={DISMISSAL[dismissal]} {...(only ? { variant: 'primary' as const } : {})} />}
        />
      )}
      {children}
    </div>
  );
  // IN THE POPUP'S FOOT where there is one (`FooterSlot`); in place where the body is rendered on its own.
  if (slot === undefined) return footer;
  return slot === null ? null : createPortal(footer, slot);
}

const DISMISSAL: Readonly<Record<'cancel' | 'ok' | 'close', MessageKey>> = {
  cancel: DIALOG_CANCEL,
  ok: DIALOG_OK,
  close: CLOSE_LABEL,
};
