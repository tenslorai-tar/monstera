import { PDF_PERMISSIONS, type CommandOfKind, type PdfPermission } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { Apply, MupdfSession } from './engineSeam.js';
import { protectSession, withDocument } from './mupdfWriter.js';

/**
 * A document's protection — set, changed or removed.
 *
 * ## It writes NOTHING to the page tree, and that is the engine's own shape
 *
 * Measured 2026-09-12 (JOURNAL that date): a plain `saveToBuffer('')` of a
 * document opened from encrypted bytes **keeps the encryption**, because
 * MuPDF's default is `encrypt=keep`. So protection is a property of how a
 * document is written, and this command records it on the engine's session for
 * every later serialise to read — `flattenFormFields`' shape exactly
 * ([ADR-0045](../../../docs/DECISIONS/0045-a-removals-garbage-collection-belongs-to-the-command.md)),
 * which is the precedent rather than a new idea.
 *
 * ## `/P` IS COMPOSED HERE AND NOWHERE ELSE
 *
 * The wire carries what is **granted**, by name. `/P` withholds, in a signed
 * 32-bit integer whose low two bits and bits 7–8 are reserved and must stay
 * set, so the value for *everything granted* is `-1` and each refusal clears
 * one bit. A renderer composing that would be a second opinion about a rule the
 * format owns (B3a), and the direction is the part that gets written backwards:
 * a bit SET means permitted.
 */

/**
 * Which bit of `/P` each permission is, one-based as the specification numbers
 * them.
 *
 * ISO 32000-2 table 22. Bit 3 print, 4 modify, 5 copy, 6 annotate, 9 fill
 * forms, 11 assemble, 12 print at high resolution. **Bit 10 is deliberately
 * absent**: PDF 2.0 deprecates it and requires accessibility extraction to be
 * granted regardless, so a control for it would be one the format says is
 * ignored — the wired-tools rule's own defect with a specification behind it.
 *
 * Keyed on the contract's own list, so a permission added there without a bit
 * here is a compile error rather than a flag that silently grants everything.
 */
const PERMISSION_BITS: Readonly<Record<PdfPermission, number>> = {
  print: 3,
  modify: 4,
  copy: 5,
  annotate: 6,
  'fill-forms': 9,
  assemble: 11,
  'print-high-quality': 12,
};

/**
 * `/P` for a set of granted permissions.
 *
 * Starts at `-1` — every bit set, which is every permission granted and every
 * reserved bit in the state the specification requires — and clears one bit per
 * permission **withheld**. Built by subtraction rather than addition because
 * the reserved bits have no names: an additive composition would have to know
 * which bits to set for reasons that are not permissions, and getting that
 * wrong produces a document readers refuse for a reason no dialog mentions.
 *
 * Exported for its own case. The value is what a document's protection means,
 * and it is arithmetic no assertion elsewhere could observe: `hasPermission`
 * answered `true` for all eight on every fixture measured 2026-09-12, so the
 * engine's own reader cannot be the instrument here.
 */
export function permissionBits(granted: readonly PdfPermission[]): number {
  let bits = -1;
  for (const permission of PDF_PERMISSIONS) {
    if (granted.includes(permission)) continue;
    const bit = PERMISSION_BITS[permission];
    bits &= ~(1 << (bit - 1));
  }
  return bits;
}

/**
 * The MuPDF save options for a protection command.
 *
 * Exported for its own case, and the case is the interesting one: the option
 * string is the entire observable of this command until something serialises,
 * so a wrong term here is a document that saves without the protection it was
 * asked for and reports success.
 *
 * **`encrypt=none` carries no other term.** MuPDF measured 2026-09-12 writes a
 * document with no `/Encrypt` key at all for that option, and a password beside
 * it would be a value the writer ignores — which reads, in a diff, as a removal
 * that kept the password.
 */
export function protectionOptions(command: CommandOfKind<'setDocumentProtection'>): string {
  if (command.encryption === 'none') return 'encrypt=none';
  const terms = [`encrypt=${command.encryption}`];
  if (command.userPassword !== undefined) terms.push(`user-password=${command.userPassword}`);
  if (command.ownerPassword !== undefined) terms.push(`owner-password=${command.ownerPassword}`);
  if (command.permissions !== undefined) {
    terms.push(`permissions=${String(permissionBits(command.permissions))}`);
  }
  return terms.join(',');
}

/**
 * Records the protection this document is to be written with.
 *
 * **No engine call at all**, which is what makes this the one apply in the
 * kernel that touches no document — and the reason is above: MuPDF has no
 * in-session encryption to set. The session's token is the key, so a forged one
 * is refused by `protectSession` before anything is recorded.
 */
export const applySetDocumentProtection: Apply<'mupdf', 'setDocumentProtection'> = (
  session,
  command,
) => protectSession(session, protectionOptions(command));

/**
 * Reports that a protection change's prior state is not recorded.
 *
 * **Not *cannot be* — must not be.** The prior state of this command is a
 * password, and a capture is serialised into main's command log, which is
 * exactly where ADR-0055 says a password never goes. So the refusal is a rule
 * rather than a limit of the engine, and it is stated as one.
 *
 * The checkpoint the bus mints is the whole of the undo, and it carries the
 * stated limit the declaration records: a checkpoint taken on a document that
 * was already protected is encrypted, and nothing here keeps the password that
 * would reopen it.
 */
export const captureSetDocumentProtection = (
  session: MupdfSession,
): Promise<CaptureResult<never>> =>
  withDocument(session, () => ({
    captured: false,
    reason:
      'a protection change cannot be recorded as prior state: the prior state is a password, ' +
      'and a capture is serialised into the command log — the one place ADR-0055 says a ' +
      'password never goes',
  }));

/**
 * Refuses to invert, for {@link captureSetDocumentProtection}'s reason.
 *
 * `CommandPrior['setDocumentProtection']` is `never`, so this is unreachable by
 * construction and exists because the spec table requires the member. The throw
 * is what says so at the one place somebody could make it reachable.
 */
export const invertSetDocumentProtection = (): never => {
  throw new Error(
    'setDocumentProtection is declared non-invertible: its prior state is a password, which ' +
      'must never reach the command log. Undo restores the checkpoint.',
  );
};
