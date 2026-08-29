import type { MessageKey } from '@monstera/shared';
import { messageKey } from '@monstera/shared';

/**
 * The English catalogue.
 *
 * ## Hand-written, and that is not the end state
 *
 * [ADR-0005](../../../../docs/DECISIONS/0005-ui-foundation-libraries.md) chooses
 * `@lingui/cli` to **extract** messages by walking the AST and to compile
 * catalogues at build time, with `extract --clean` failing CI when they drift
 * from source. That is the mechanism, and it is owed. It is not written yet
 * because extraction reads `<Trans>` and `msg()` call sites, and this
 * application has none — every message here is registry metadata, which is an
 * explicit id rather than a source string.
 *
 * So this file is the smallest thing that is **true**: the keys that exist, each
 * with its English text, in one place a reader can check against the
 * registrations. The trigger is the first `<Trans>` — the same commit
 * ADR-0005 says must settle the macro transform, because that is when a message
 * starts having a source form for a tool to extract.
 *
 * ## Every key is minted, not typed
 *
 * `messageKey()` is the only door, and it checks the `<domain>.<name>` grammar.
 * A typo here is a throw at module load rather than a key that resolves to
 * nothing at the moment a control renders.
 */

export const OPEN_DOCUMENT_TITLE = messageKey('command.open-document.title');
export const CLOSE_LABEL = messageKey('action.close.label');
export const DOCUMENT_SURFACE_LABEL = messageKey('surface.document.label');
export const THEME_TITLE = messageKey('setting.appearance-theme.title');

/**
 * The catalogue itself.
 *
 * A `Record<MessageKey, string>` rather than a plain object literal keyed by
 * string, so a key that is not minted cannot be added — the completeness check
 * this file eventually owes is *"every registered key has an entry"*, and that
 * check is only worth writing once both sides are the same type.
 */
export const EN: Readonly<Record<MessageKey, string>> = {
  [OPEN_DOCUMENT_TITLE]: 'Open a document',
  [CLOSE_LABEL]: 'Close',
  [DOCUMENT_SURFACE_LABEL]: 'Document',
  [THEME_TITLE]: 'Theme',
};
