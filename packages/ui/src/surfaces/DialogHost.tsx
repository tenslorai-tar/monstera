import type { MessageKey } from '@monstera/shared';
import { Suspense, useCallback, useState } from 'react';
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
 * ## The injected resolver is GONE, and this is the commit `messages.ts` named
 *
 * This host used to take a `resolve` and a pre-resolved `closeLabel`, because
 * the primitives took `string` and something had to turn a key into text
 * without deciding, here, what a missing one renders. The resolver landed, the
 * primitives take `MessageKey`, and both props go with it: a key now travels
 * unresolved all the way to the control that displays it, and is resolved once,
 * where it is rendered.
 *
 * That removes the shape this file was carefully avoiding — a host holding text
 * in one language while a control beside it holds a key — rather than managing
 * it. It also unblocks mounting this host at all: its `closeLabel` was the
 * "already resolved" string that had no honest source before a catalogue
 * existed.
 */

export interface DialogHostProps {
  readonly registry: DialogRegistry;
  /** The close control's accessible name, as a key the control resolves. */
  readonly closeLabel: MessageKey;
  /** Shown while a lazily-loaded dialog body is still arriving. */
  readonly pending?: ReactNode;
}

/** What one open dialog is, while it is open. */
interface OpenDialog {
  readonly id: string;
  readonly props: unknown;
  /**
   * Settles the promise {@link useDialogHost}'s `ask` handed the opener.
   *
   * Called exactly once, by whichever of resolve, close or a replacing open
   * gets there first — which is what the state machine below is for. A promise
   * settled twice is not an error at run time; it is an answer nobody sees, and
   * the caller that awaited it has already moved on.
   */
  readonly settle: (answer: unknown) => void;
  /**
   * Rejects that promise, for an answer the result schema refuses.
   *
   * A body that answers with the wrong shape is a defect in this build, and the
   * opener is the only thing that can report it — the value was on its way to
   * becoming a command's argument. Swallowing it would leave a command silently
   * doing nothing, which is the display-only failure at the seam that exists to
   * prevent it.
   */
  readonly fail: (thrown: unknown) => void;
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
  /**
   * Opens a dialog and **asks it a question**
   * ([ADR-0038](../../../../docs/DECISIONS/0038-a-dialog-answers-the-command-that-opened-it.md)).
   *
   * The promise settles with the value the body resolved, or with `undefined`
   * when the dialog was dismissed. An informational dialog can only ever settle
   * `undefined`, so every existing caller ignores the promise exactly as it
   * ignored `void` — which is why this REPLACES `show` rather than sitting
   * beside it. Two ways to open a dialog is the second opinion B3a is about,
   * and the one somebody reaches for would be the one with no gate.
   */
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  /** Dismisses whatever is open, settling its promise `undefined`. */
  readonly close: () => void;
  /** Takes a body's answer, validates it, settles and closes. */
  readonly resolve: (result: unknown) => void;
} {
  const [open, setOpen] = useState<OpenDialog | undefined>(undefined);

  const ask = useCallback(
    (id: string, props: unknown) => {
      // Throws on an unregistered id or refused props, and the throw is the
      // point: it happens before any state changes, so a refused open leaves
      // whatever was showing exactly as it was rather than half-replacing it.
      //
      // OUTSIDE THE PROMISE, deliberately. Inside the executor the same throw
      // becomes a rejection, and every caller that opens a dialog without
      // awaiting — which is every informational one — would turn a programming
      // error into an unhandled rejection nobody attributes. A synchronous
      // throw still reaches an `await deps.ask(…)` as an ordinary one.
      const validated = registry.openWith(id, props);
      return new Promise<unknown>((settle, fail) => {
        setOpen((previous) => {
          // A SECOND OPEN DISMISSES THE FIRST rather than stranding it. Before
          // this returned a promise, replacing an open dialog was invisible; a
          // caller awaiting the one that went would now wait for ever, which is
          // a hang rather than a wrong answer.
          previous?.settle(undefined);
          return { id, props: validated.props, settle, fail };
        });
      });
    },
    [registry],
  );

  const close = useCallback(() => {
    // OUTSIDE THE UPDATER, for `resolve`'s reason. Settling twice is harmless
    // — a promise ignores the second — so this one was benign where `resolve`
    // was not; it is written the same way anyway, because "the side effect in
    // this updater happens to be idempotent" is a property the next one will
    // not have.
    open?.settle(undefined);
    setOpen(undefined);
  }, [open]);

  const resolve = useCallback(
    (result: unknown) => {
      if (open === undefined) return;
      // VALIDATED HERE, where the id is known — and OUTSIDE the state updater,
      // which is where the first version put it. React runs an updater during
      // render, so a throw from there is a render error: it unmounts the tree
      // instead of rejecting the promise the opener is awaiting. The dialog
      // seam's whole subject is a value crossing back out, and the failure path
      // for that value has to reach the same place the value would.
      let answer: unknown;
      try {
        answer = registry.answerOf(open.id, result);
      } catch (thrown) {
        open.fail(thrown);
        setOpen(undefined);
        return;
      }
      open.settle(answer);
      setOpen(undefined);
    },
    [open, registry],
  );

  return { open, ask, close, resolve };
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
  closeLabel,
  pending = null,
  open,
  onClose,
  onResolve,
}: DialogHostProps & {
  readonly open: OpenDialog | undefined;
  readonly onClose: () => void;
  /** What a body's `resolve` reaches. See {@link useDialogHost}. */
  readonly onResolve: (result: unknown) => void;
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
      title={entry.title}
      closeLabel={closeLabel}
    >
      {/* The entry mounts itself. `declareDialog` built this closure where the
          schema and the component were still the same type, so nothing is cast
          here — see EEEEE-2 in the entry's own comment. */}
      <Suspense fallback={pending}>{entry.mount(open.props, onResolve)}</Suspense>
    </Dialog>
  );
}
