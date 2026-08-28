import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

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
  title: string;
  /** The accessible name of the close control — an action, e.g. "Close". */
  closeLabel: string;
  children: ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  closeLabel,
  children,
}: DialogProps): ReactElement {
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
        <BaseDialog.Popup className="m-dialog">
          <div className="m-dialog__header">
            <BaseDialog.Title className="m-dialog__title">{title}</BaseDialog.Title>
            {/* Inside the popup, per Base UI's own requirement for a modal
                dialog: a touch screen reader has no other way out. */}
            <BaseDialog.Close
              nativeButton={false}
              render={<IconButton icon={X} label={closeLabel} size="control" />}
            />
          </div>
          <div className="m-dialog__body">{children}</div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
