import { useLingui } from '@lingui/react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type { MessageKey } from '@monstera/shared';
import { X } from 'lucide-react';
import { type ReactElement, type ReactNode, type RefObject, useId, useRef } from 'react';

import { CLOSE_LABEL, DIALOG_CANCEL, DIALOG_OK } from '../messages/en.js';
import { Button } from './Button.js';
import { IconButton } from './IconButton.js';

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
 * ## Focus opens ON THE DIALOG, not on its first control
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
   * Where focus lands when the dialog opens; the popup itself when omitted.
   *
   * A dialog whose whole purpose is a field — the command palette — takes the field, because the chord that opened it
   * says the person is about to type. Every other dialog keeps the popup, for the tooltip reason above.
   */
  initialFocus?: RefObject<HTMLElement | null>;
  /** A second class on the popup, for a dialog placed differently from the centred default. */
  popupClassName?: string;
  children: ReactNode;
}

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

  return (
    <BaseDialog.Root
      modal
      onOpenChange={(next): void => {
        onOpenChange(next);
      }}
      open={open}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="m-dialog__backdrop" />
        <BaseDialog.Popup
          className={popupClassName === undefined ? 'm-dialog' : `m-dialog ${popupClassName}`}
          initialFocus={initialFocus ?? popup}
          ref={popup}
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
          <div className="m-dialog__body">{children}</div>
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
 */
export function DialogRow({
  label,
  note,
  children,
}: {
  readonly label: MessageKey;
  readonly note?: MessageKey | undefined;
  readonly children: ReactNode;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-dialog-row">
      <div className="m-dialog-row__text">
        <span className="m-dialog-row__label">{_(label)}</span>
        {note === undefined ? null : <span className="m-dialog-row__note">{_(note)}</span>}
      </div>
      <div className="m-dialog-row__control">{children}</div>
    </div>
  );
}

/** One option of `DialogChoices`: a short name, and the sentence that says what a person gets. */
export interface DialogChoice<Value extends string> {
  readonly value: Value;
  readonly label: MessageKey;
  readonly note: MessageKey;
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
            <span className="m-dialog-row__label">{_(option.label)}</span>
            <span className="m-dialog-row__note">{_(option.note)}</span>
          </span>
        </label>
      ))}
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
  dismissal = 'cancel',
}: {
  readonly children?: ReactNode;
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
}): ReactElement {
  const only = children === undefined;
  return (
    <div className="m-dialog-footer">
      {dismissal === 'own' ? null : (
        <BaseDialog.Close
          nativeButton
          render={<Button label={DISMISSAL[dismissal]} {...(only ? { variant: 'primary' as const } : {})} />}
        />
      )}
      {children}
    </div>
  );
}

const DISMISSAL: Readonly<Record<'cancel' | 'ok' | 'close', MessageKey>> = {
  cancel: DIALOG_CANCEL,
  ok: DIALOG_OK,
  close: CLOSE_LABEL,
};
