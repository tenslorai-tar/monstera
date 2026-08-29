import type { MessageKey } from '@monstera/shared';
import { Suspense, createElement, useCallback, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { Dialog } from '../primitives/Dialog.js';
import type { DialogRegistry } from '../registries/dialogs.js';

/**
 * The ONE dialog mount point, derived from the dialog registry (§7).
 *
 * One mount point means one focus trap, one Escape handler and one
 * `aria-labelledby` wiring — met once in `<Dialog>` rather than per dialog,
 * which is what makes §10.4's accessibility obligations substrate (B9). A
 * dialog that mounted itself would be a second focus trap, and two focus traps
 * is a defect nobody notices until two dialogs are open.
 *
 * ## Props are validated at the OPEN call, never here
 *
 * `openWith` is the registry's, and this component calls it. Validating in the
 * component would put the check downstream of the state that already holds bad
 * props, so an invalid open would render a broken dialog before anything could
 * refuse it. Decision 7's *"validating at the open call is the only place both
 * sides exist"*, applied literally.
 *
 * ## Why the resolver is injected
 *
 * A dialog's title is a `MessageKey`, and `messages.ts` records that the
 * primitives keep `string` until a runtime resolver lands, because *"a control
 * that displays `dialog.rename.title` to a user is worse than one that displays
 * English."* This host does not decide which of those it is: it takes a
 * `resolve` and the application supplies one. That keeps the trigger in
 * `messages.ts` clean — the primitives change in the commit that lands a
 * resolver — and means no key reaches a user through a choice made here.
 */

export interface DialogHostProps {
  readonly registry: DialogRegistry;
  /** Turns a key into display text. Identity until a catalogue exists. */
  readonly resolve: (key: MessageKey) => string;
  /** The close control's accessible name, already resolved. */
  readonly closeLabel: string;
  /** Shown while a lazily-loaded dialog body is still arriving. */
  readonly pending?: ReactNode;
}

/** What one open dialog is, while it is open. */
interface OpenDialog {
  readonly id: string;
  readonly props: unknown;
}

/**
 * Holds the open dialog and the two operations on it.
 *
 * A hook rather than a store because a dialog is **shell state and not document
 * state**: §6's one-store-per-`DocId` rule exists so a document's state cannot
 * outlive it, and a dialog belongs to the window. Putting it in a document
 * store would close the dialog when the document closed, which is right by
 * accident and wrong the moment a dialog spans two documents.
 */
export function useDialogHost(registry: DialogRegistry): {
  readonly open: OpenDialog | undefined;
  readonly show: (id: string, props: unknown) => void;
  readonly close: () => void;
} {
  const [open, setOpen] = useState<OpenDialog | undefined>(undefined);

  const show = useCallback(
    (id: string, props: unknown) => {
      // Throws on an unregistered id or refused props, and the throw is the
      // point: it happens before any state changes, so a refused open leaves
      // whatever was showing exactly as it was rather than half-replacing it.
      const validated = registry.openWith(id, props);
      setOpen({ id, props: validated.props });
    },
    [registry],
  );

  const close = useCallback(() => {
    setOpen(undefined);
  }, []);

  return { open, show, close };
}

/**
 * Renders whichever dialog is open, in the one `<Dialog>`.
 *
 * Nothing is rendered when none is — not a hidden dialog. A mounted-but-closed
 * dialog keeps its body's state across opens, so the second open shows the
 * first one's half-filled form; and it costs the lazy chunk on first paint,
 * which is what Decision 7's laziness is for.
 */
export function DialogHost({
  registry,
  resolve,
  closeLabel,
  pending = null,
  open,
  onClose,
}: DialogHostProps & {
  readonly open: OpenDialog | undefined;
  readonly onClose: () => void;
}): ReactElement | null {
  if (open === undefined) return null;

  const entry = registry.get(open.id);
  // Unreachable through `show`, which refuses an unregistered id before any
  // state moves. Answering null rather than throwing because a render is the
  // wrong place to raise a programming error the open call already refuses.
  if (entry === undefined) return null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={resolve(entry.title)}
      closeLabel={closeLabel}
    >
      <Suspense fallback={pending}>
        {createElement(entry.component as never, open.props as never)}
      </Suspense>
    </Dialog>
  );
}
