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
export const ABOUT_TITLE = messageKey('dialog.about.title');
export const ABOUT_COMMAND_TITLE = messageKey('command.show-about.title');
export const REVEAL_LOG_TITLE = messageKey('command.reveal-log.title');
export const HISTORY_TRIMMED_TITLE = messageKey('dialog.history-trimmed.title');
export const HISTORY_TRIMMED_APPLIED = messageKey('dialog.history-trimmed.applied');
export const HISTORY_TRIMMED_LOST = messageKey('dialog.history-trimmed.lost');
export const ABOUT_VERSION_LABEL = messageKey('dialog.about.version');
export const ABOUT_CHANNEL_LABEL = messageKey('dialog.about.channel');
export const ROTATE_PAGE_TITLE = messageKey('command.rotate-page.title');
export const FIND_TITLE = messageKey('command.find.title');
export const ZOOM_IN_TITLE = messageKey('command.zoom-in.title');
export const ZOOM_OUT_TITLE = messageKey('command.zoom-out.title');
export const FIT_WIDTH_TITLE = messageKey('command.fit-width.title');
export const FIT_PAGE_TITLE = messageKey('command.fit-page.title');
export const DARK_PAGE_TITLE = messageKey('setting.viewing.dark-page.title');
export const LOUPE_TITLE = messageKey('setting.viewing.loupe.title');
export const RULERS_TITLE = messageKey('setting.viewing.rulers.title');
export const GRID_TITLE = messageKey('setting.viewing.grid.title');
export const RULER_UNIT_TITLE = messageKey('setting.viewing.ruler-unit.title');
export const HORIZONTAL_RULER_LABEL = messageKey('surface.ruler.horizontal.label');
export const VERTICAL_RULER_LABEL = messageKey('surface.ruler.vertical.label');
export const ACCENT_TITLE = messageKey('setting.appearance.accent.title');
export const PALETTE_LABEL = messageKey('surface.palette.label');
export const PALETTE_PLACEHOLDER = messageKey('surface.palette.placeholder');
export const PALETTE_EMPTY = messageKey('surface.palette.empty');
export const PALETTE_TITLE = messageKey('command.palette.title');
export const DESTINATIONS_LABEL = messageKey('surface.destinations.label');
export const DESTINATIONS_EMPTY = messageKey('surface.destinations.empty');
export const DESTINATIONS_UNAVAILABLE = messageKey('surface.destinations.unavailable');
export const DESTINATION_UNRESOLVED = messageKey('surface.destinations.unresolved');
export const LAYERS_LABEL = messageKey('surface.layers.label');
export const LAYERS_EMPTY = messageKey('surface.layers.empty');
export const LAYERS_UNAVAILABLE = messageKey('surface.layers.unavailable');
export const LINKS_LABEL = messageKey('surface.links.label');
export const LINKS_EMPTY = messageKey('surface.links.empty');
export const LINKS_UNAVAILABLE = messageKey('surface.links.unavailable');
export const LINKS_TO_PAGE = messageKey('surface.links.to-page');
export const LINKS_EXTERNAL = messageKey('surface.links.external');
export const STATUS_LABEL = messageKey('surface.status.label');
export const STATUS_PAGE_OF = messageKey('surface.status.page-of');
export const STATUS_ZOOM = messageKey('surface.status.zoom');
export const THUMBNAILS_LABEL = messageKey('surface.thumbnails.label');
export const THUMBNAIL_PAGE = messageKey('surface.thumbnails.page');
export const NEXT_PAGE_TITLE = messageKey('command.page-next.title');
export const PREVIOUS_PAGE_TITLE = messageKey('command.page-previous.title');
export const FIRST_PAGE_TITLE = messageKey('command.page-first.title');
export const LAST_PAGE_TITLE = messageKey('command.page-last.title');
export const GO_BACK_TITLE = messageKey('command.go-back.title');
export const GO_FORWARD_TITLE = messageKey('command.go-forward.title');
export const SETTINGS_PROBLEM_TITLE = messageKey('dialog.settings-problem.title');
export const SETTINGS_APPLIED_NOW = messageKey('dialog.settings-problem.applied');
export const SETTINGS_NOT_STORED = messageKey('dialog.settings-problem.not-stored');
export const FIND_LABEL = messageKey('surface.find.label');
export const FIND_SUBMIT = messageKey('surface.find.submit');
export const FIND_MATCHES = messageKey('surface.find.matches');
export const FIND_EMPTY = messageKey('surface.find.empty');
export const FIND_TRUNCATED = messageKey('surface.find.truncated');
export const FIND_REFUSED = messageKey('surface.find.refused');
export const UNDO_TITLE = messageKey('command.undo.title');
export const SAVE_TITLE = messageKey('command.save.title');
export const DOCUMENT_TOOLS_LABEL = messageKey('surface.quick-toolbar.label');
export const SAVE_PROBLEM_TITLE = messageKey('dialog.save-problem.title');
export const SAVE_WORK_INTACT = messageKey('dialog.save-problem.intact');
export const SAVE_REFUSED_CONTESTED = messageKey('dialog.save-problem.contested');
export const SAVE_REFUSED_REPLACED = messageKey('dialog.save-problem.replaced');
export const SAVE_REFUSED_TARGET_ABSENT = messageKey('dialog.save-problem.target-absent');
export const SAVE_REFUSED_UNVERIFIABLE = messageKey('dialog.save-problem.unverifiable');
export const SAVE_WRITE_FAILED = messageKey('dialog.save-problem.write-failed');
export const PROBLEM_TITLE = messageKey('dialog.command-problem.title');
export const PROBLEM_NOT_OPEN = messageKey('dialog.command-problem.not-open');
export const PROBLEM_BUSY = messageKey('dialog.command-problem.busy');
export const PROBLEM_POISONED = messageKey('dialog.command-problem.poisoned');
export const PROBLEM_NO_CHECKPOINT = messageKey('dialog.command-problem.no-checkpoint');
export const PROBLEM_INTERNAL = messageKey('dialog.command-problem.internal');
export const PROBLEM_REFERENCE_LABEL = messageKey('dialog.command-problem.reference');

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
  [ABOUT_TITLE]: 'About Monstera',
  [ABOUT_COMMAND_TITLE]: 'About',
  // "Reveal" and not "Open": the command shows the folder in the file manager,
  // and a name promising to open a log would be a name that fails the moment
  // there are five rotated files and no one of them is *the* log.
  [REVEAL_LOG_TITLE]: 'Reveal diagnostics log',
  [ABOUT_VERSION_LABEL]: 'Version',
  [ABOUT_CHANNEL_LABEL]: 'Install channel',
  // "Rotate page" and not "Rotate": the command rotates the page on screen, and
  // a name that promised the document would be a name the behaviour contradicts
  // the moment there is a second page.
  [ROTATE_PAGE_TITLE]: 'Rotate page',
  [FIND_TITLE]: 'Find',
  [ZOOM_IN_TITLE]: 'Zoom in',
  [ZOOM_OUT_TITLE]: 'Zoom out',
  [FIT_WIDTH_TITLE]: 'Fit width',
  [FIT_PAGE_TITLE]: 'Fit page',
  [DARK_PAGE_TITLE]: 'Dark page',
  [LOUPE_TITLE]: 'Loupe',
  [RULERS_TITLE]: 'Show rulers',
  [GRID_TITLE]: 'Show grid',
  [RULER_UNIT_TITLE]: 'Ruler unit',
  [HORIZONTAL_RULER_LABEL]: 'Horizontal ruler',
  [VERTICAL_RULER_LABEL]: 'Vertical ruler',
  [ACCENT_TITLE]: 'Accent colour',
  [PALETTE_LABEL]: 'Command palette',
  [PALETTE_PLACEHOLDER]: 'Search commands',
  [PALETTE_EMPTY]: 'No command matches.',
  [PALETTE_TITLE]: 'Command palette',
  [DESTINATIONS_LABEL]: 'Outline',
  [DESTINATIONS_EMPTY]: 'This document has no outline.',
  [DESTINATIONS_UNAVAILABLE]: 'The outline could not be read.',
  [DESTINATION_UNRESOLVED]: '{title} (goes nowhere)',
  [LAYERS_LABEL]: 'Layers',
  [LAYERS_EMPTY]: 'This document has no layers.',
  [LAYERS_UNAVAILABLE]: 'The layers could not be read.',
  [LINKS_LABEL]: 'Links on this page',
  [LINKS_EMPTY]: 'This page has no links.',
  [LINKS_UNAVAILABLE]: 'The links on this page could not be read.',
  [LINKS_TO_PAGE]: 'Go to page {page}',
  [LINKS_EXTERNAL]: 'Opens {uri}',
  [STATUS_LABEL]: 'Document status',
  [STATUS_PAGE_OF]: 'Page {page} of {count}',
  [STATUS_ZOOM]: '{percent}%',
  [THUMBNAILS_LABEL]: 'Page thumbnails',
  [THUMBNAIL_PAGE]: 'Page {page}',
  [NEXT_PAGE_TITLE]: 'Next page',
  [PREVIOUS_PAGE_TITLE]: 'Previous page',
  [FIRST_PAGE_TITLE]: 'First page',
  [LAST_PAGE_TITLE]: 'Last page',
  [GO_BACK_TITLE]: 'Back',
  [GO_FORWARD_TITLE]: 'Forward',
  [SETTINGS_PROBLEM_TITLE]: 'Preference not saved',
  [SETTINGS_APPLIED_NOW]: '{setting} is in effect now.',
  [SETTINGS_NOT_STORED]: 'It could not be stored, so it will not be remembered next time.',
  [FIND_LABEL]: 'Find on this page',
  // NOT 'Find', which is the toolbar command's title: two controls sharing an
  // accessible name is one a screen-reader user cannot tell apart, and it was
  // found by a test that could not tell them apart either.
  [FIND_SUBMIT]: 'Search this page',
  // A COUNT, because "found" without one cannot say whether narrowing the query
  // helped, which is the user's next decision.
  [FIND_MATCHES]: '{count} matches on this page',
  // NOT "no results", which reads as a failure. The document was searched and
  // the word is not on this page — which is an answer.
  [FIND_EMPTY]: 'Nothing on this page matches.',
  [FIND_TRUNCATED]: 'More matches than can be listed. Narrow the search.',
  // The document was NOT searched, which is a different thing from finding
  // nothing and must never render as it.
  [FIND_REFUSED]: 'This page could not be searched just now.',
  [UNDO_TITLE]: 'Undo',
  [SAVE_TITLE]: 'Save',
  [DOCUMENT_TOOLS_LABEL]: 'Document tools',
  // "Not saved" and never "Save failed". Invariant 18's whole subject is that
  // the work survives a save that did not happen, and a title naming a failure
  // invites the reading that something was lost.
  [SAVE_PROBLEM_TITLE]: 'The document was not saved',
  // THE LOAD-BEARING SENTENCE, and it is the reason this dialog exists rather
  // than a toast. Invariant 18: *"never by a dialog whose only option discards
  // their edits"* — a user meeting a refusal needs to know first that their
  // work is still there, before anything about why.
  [SAVE_WORK_INTACT]: 'Your changes are still open and unsaved. Nothing has been lost.',
  // "Undo history" and not "history": the document's own history is what a
  // reader will assume, and this dialog is about neither the file nor its
  // contents.
  [HISTORY_TRIMMED_TITLE]: 'Older undo steps were released',
  // THE SUCCESS FIRST. This dialog follows an operation that worked, so a body
  // opening with the loss would read as a failure report.
  [HISTORY_TRIMMED_APPLIED]: 'Your change was applied and your document is intact.',
  // The count is interpolated rather than described: whether to save now turns
  // on how much went, and "some older steps" cannot say.
  [HISTORY_TRIMMED_LOST]:
    'To stay within the memory this application is allowed, {dropped} older step(s) can no ' +
    'longer be undone. Everything more recent still can.',
  // Each reason says what the user can DO. "Contested" and "unverifiable" are
  // the kernel's words for a verdict; a person needs the next action.
  [SAVE_REFUSED_CONTESTED]: 'Another open document is writing to this file. Close it and try again.',
  [SAVE_REFUSED_REPLACED]: 'The file on disk is not the one this document was opened from. Use Save As to write somewhere else.',
  [SAVE_REFUSED_TARGET_ABSENT]: 'The file this document came from is no longer there. Use Save As to write somewhere else.',
  [SAVE_REFUSED_UNVERIFIABLE]: 'Monstera could not confirm the file on disk is still the same one, so it did not overwrite it.',
  [SAVE_WRITE_FAILED]: 'The file could not be written. Check that it is not open in another application, and that there is room on the disk.',
  // "Could not be done" and never "error". Every code below leaves the document
  // exactly as it was, so the title describes the operation and not the state.
  [PROBLEM_TITLE]: 'That could not be done',
  [PROBLEM_NOT_OPEN]: 'That document is no longer open.',
  [PROBLEM_BUSY]: 'The document is busy with something else. Try again in a moment.',
  // INVARIANT 18 CLAUSE (i)'s "tell the user", and the sentence carries its two
  // halves in the order that matters: the work is here, and here is what to do.
  // A poisoned document is refused precisely so the edits are STRANDED rather
  // than destroyed, and a message that only said "failed" would invite the user
  // to close the window — which is the one action that loses them.
  [PROBLEM_POISONED]:
    'Monstera can no longer work on this document. Your changes are still open and unsaved — save them somewhere else, or close and reopen the file to start again.',
  [PROBLEM_NO_CHECKPOINT]: 'This step cannot be undone in this version.',
  [PROBLEM_INTERNAL]: 'Something went wrong inside Monstera. Your document is unchanged.',
  // A label, not a sentence: the value beside it is an opaque id, and ADR-0009
  // §9 is why it is the only thing about the diagnostic that crosses.
  [PROBLEM_REFERENCE_LABEL]: 'Reference',
};
