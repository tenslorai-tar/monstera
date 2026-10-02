import type { ContractClient } from '@monstera/contract';
import type { FileHandle, MessageKey } from '@monstera/shared';

import { TOAST_COPIED, TOAST_SHOW_IN_FOLDER } from '../messages/en.js';
import type { ShowToast } from '../toasts.js';

/** What confirming a write needs: where the toast goes, and how to ask main to show the file. */
export interface ConfirmWrittenDeps {
  readonly toast: ShowToast;
  readonly client: ContractClient;
}

/**
 * Says a write landed, with *Show in folder* — THE ONE WAY a command confirms a file it wrote (B3a).
 *
 * ## Why every file write confirms
 *
 * `documentCommands.ts` used to hold that a file appearing where the person asked was its own confirmation, and the
 * owner's report retired that rule for the whole class: an export lands out of sight, in a folder the window does not
 * show, so a successful one and a dismissed picker looked the same. Four commands were retrofitted; the audit of 2
 * October found fourteen more saying nothing. One function, so a file write added tomorrow confirms the way these do
 * and none can spell its own.
 *
 * ## The handle is the write's own answer
 *
 * `written` is what the channel answered for this write (the contract's `WRITTEN`), so *Show in folder* shows the file
 * this toast is about and nothing the renderer could name otherwise. A file moved since is main's `revealed: false`,
 * and nothing more is said: the person moved it.
 */
export function confirmWritten(deps: ConfirmWrittenDeps, message: MessageKey, written: FileHandle): void {
  deps.toast('done', message, {
    label: TOAST_SHOW_IN_FOLDER,
    run: () => {
      void deps.client['file.reveal']({ handle: written });
    },
  });
}

/**
 * Says an action that FINISHED OUT OF SIGHT landed — a print job, an unseen signature, removed active content — and
 * offers nothing, because there is no file to show. The other half of the one confirmation path; a command whose
 * effect the page itself shows confirms through neither.
 */
export function confirmDone(deps: Pick<ConfirmWrittenDeps, 'toast'>, message: MessageKey): void {
  deps.toast('done', message);
}

/**
 * Says a copy reached the clipboard — EVERY copy's confirmation, whatever was copied (the owner's answer of 2 October):
 * text on the page or in a field, marks, an answer of the assistant's, an address. The clipboard is out of sight like a
 * print job, so it is {@link confirmDone}'s case with one sentence for all of them.
 *
 * **Called on main's word only**: each copy runs in main, which answers whether it did (`window.edit`'s `done`,
 * `window.copyText`'s `copied`, the marks' count). A toast shown before that answer would say *Copied* for a copy that
 * failed.
 */
export function confirmCopied(deps: Pick<ConfirmWrittenDeps, 'toast'>): void {
  confirmDone(deps, TOAST_COPIED);
}
