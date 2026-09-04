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
export const DELETE_PAGES_TITLE = messageKey('dialog.delete-pages.title');
export const DELETE_PAGES_LABEL = messageKey('dialog.delete-pages.label');
export const DELETE_PAGES_HINT = messageKey('dialog.delete-pages.hint');
export const DELETE_PAGES_APPLY = messageKey('dialog.delete-pages.apply');
export const DELETE_PAGES_EMPTY = messageKey('dialog.delete-pages.empty');
export const DELETE_PAGES_NOT_A_NUMBER = messageKey('dialog.delete-pages.not-a-number');
export const DELETE_PAGES_OUT_OF_RANGE = messageKey('dialog.delete-pages.out-of-range');
export const DELETE_PAGES_BACKWARDS = messageKey('dialog.delete-pages.backwards');
export const DELETE_PAGES_EVERYTHING = messageKey('dialog.delete-pages.everything');
export const DELETE_PAGES_COMMAND_TITLE = messageKey('command.delete-pages.title');
export const CROP_PAGES_TITLE = messageKey('dialog.crop-pages.title');
export const CROP_PAGES_TOP = messageKey('dialog.crop-pages.top');
export const CROP_PAGES_BOTTOM = messageKey('dialog.crop-pages.bottom');
export const CROP_PAGES_LEFT = messageKey('dialog.crop-pages.left');
export const CROP_PAGES_RIGHT = messageKey('dialog.crop-pages.right');
export const CROP_PAGES_THIS = messageKey('dialog.crop-pages.this-page');
export const CROP_PAGES_ALL = messageKey('dialog.crop-pages.all-pages');
export const CROP_PAGES_APPLY = messageKey('dialog.crop-pages.apply');
export const CROP_PAGES_NOT_A_NUMBER = messageKey('dialog.crop-pages.not-a-number');
export const CROP_PAGES_NEGATIVE = messageKey('dialog.crop-pages.negative');
export const CROP_PAGES_COMMAND_TITLE = messageKey('command.crop-pages.title');
export const DUPLICATE_PAGES_TITLE = messageKey('dialog.duplicate-pages.title');
export const DUPLICATE_PAGES_COMPARED = messageKey('dialog.duplicate-pages.compared');
export const DUPLICATE_PAGES_NONE = messageKey('dialog.duplicate-pages.none');
export const DUPLICATE_PAGES_GROUP = messageKey('dialog.duplicate-pages.group');
export const DUPLICATE_PAGES_REMOVE = messageKey('dialog.duplicate-pages.remove');
export const DUPLICATE_PAGES_TRUNCATED = messageKey('dialog.duplicate-pages.truncated');
export const FIND_DUPLICATES_COMMAND_TITLE = messageKey('command.find-duplicate-pages.title');
export const ABOUT_VERSION_LABEL = messageKey('dialog.about.version');
export const ABOUT_CHANNEL_LABEL = messageKey('dialog.about.channel');
export const ROTATE_PAGE_TITLE = messageKey('command.rotate-page.title');
export const ROTATE_PAGE_180_TITLE = messageKey('command.rotate-page-180.title');
export const ROTATE_PAGE_270_TITLE = messageKey('command.rotate-page-270.title');
export const INSERT_BLANK_PAGE_TITLE = messageKey('command.insert-blank-page.title');
export const DUPLICATE_PAGE_TITLE = messageKey('command.duplicate-page.title');
export const DELETE_PAGE_TITLE = messageKey('command.delete-page.title');
export const FIND_TITLE = messageKey('command.find.title');
export const ZOOM_IN_TITLE = messageKey('command.zoom-in.title');
export const ZOOM_OUT_TITLE = messageKey('command.zoom-out.title');
export const FIT_WIDTH_TITLE = messageKey('command.fit-width.title');
export const FIT_PAGE_TITLE = messageKey('command.fit-page.title');
export const DARK_PAGE_TITLE = messageKey('setting.viewing.dark-page.title');
export const LOUPE_TITLE = messageKey('setting.viewing.loupe.title');
export const SPLIT_VIEW_TITLE = messageKey('setting.viewing.split.title');
export const SPLIT_SECOND_LABEL = messageKey('surface.split.second-label');
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
export const FIND_CASE_SENSITIVE = messageKey('surface.find.case-sensitive');
export const FIND_WHOLE_WORD = messageKey('surface.find.whole-word');
export const FIND_REGEX = messageKey('surface.find.regex');
export const FIND_ALL_PAGES = messageKey('surface.find.all-pages');
export const FIND_CANCEL = messageKey('surface.find.cancel');
export const FIND_PROGRESS = messageKey('surface.find.progress');
export const FIND_CANCELLED = messageKey('surface.find.cancelled');
export const FIND_BAD_PATTERN = messageKey('surface.find.bad-pattern');
export const FIND_DOCUMENT_MATCHES = messageKey('surface.find.document-matches');
export const FIND_DOCUMENT_EMPTY = messageKey('surface.find.document-empty');
export const FIND_MATCH_ON_PAGE = messageKey('surface.find.match-on-page');
export const FIND_NEXT_MATCH = messageKey('surface.find.next-match');
export const FIND_PREVIOUS_MATCH = messageKey('surface.find.previous-match');
export const FIND_MATCH_POSITION = messageKey('surface.find.match-position');
export const COMPARE_PICK = messageKey('surface.compare.pick');
export const COMPARE_SAME = messageKey('surface.compare.same');
export const COMPARE_SECOND_LABEL = messageKey('surface.compare.second-label');
export const TAB_STRIP_LABEL = messageKey('surface.tabs.label');
export const TAB_CLOSE = messageKey('surface.tabs.close');
export const TAB_OPEN_ANOTHER = messageKey('surface.tabs.open-another');
export const VIEW_PROBLEM_TITLE = messageKey('surface.view-problem.title');
export const VIEW_PROBLEM_BODY = messageKey('surface.view-problem.body');
export const VIEW_PROBLEM_RETRY = messageKey('surface.view-problem.retry');
export const START_TITLE = messageKey('surface.start.title');
export const START_INVITATION = messageKey('surface.start.invitation');
export const START_ABSENT = messageKey('surface.start.absent');
export const START_AT_CAPACITY = messageKey('surface.start.at-capacity');
export const RECENT_LABEL = messageKey('surface.recent.label');
export const RECENT_EMPTY = messageKey('surface.recent.empty');
export const RECENT_MISSING = messageKey('surface.recent.missing');
export const RECOVER_OFFER = messageKey('surface.recent.recover-offer');
export const RECOVER_LABEL = messageKey('surface.recent.recover-label');
export const LAYERS_LABEL = messageKey('surface.layers.label');
export const LAYERS_EMPTY = messageKey('surface.layers.empty');
export const LAYERS_UNAVAILABLE = messageKey('surface.layers.unavailable');
export const LINKS_LABEL = messageKey('surface.links.label');
export const LINKS_EMPTY = messageKey('surface.links.empty');
export const LINKS_UNAVAILABLE = messageKey('surface.links.unavailable');
export const LINKS_TO_PAGE = messageKey('surface.links.to-page');
export const LINKS_EXTERNAL = messageKey('surface.links.external');
export const STATUS_GO_TO = messageKey('surface.status.go-to');
export const STATUS_GO_TO_OUTSIDE = messageKey('surface.status.go-to-outside');
export const GO_TO_TITLE = messageKey('command.go-to.title');
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
  // THE DEGREES ARE IN THE NAME for two of the three and not the first, and
  // that is the existing label kept rather than a scheme half-applied: "Rotate
  // page" has been on the toolbar and in three test cases since Stage 1, and
  // renaming it to "Rotate page 90°" would be a rename with no reader asking
  // for it. The two new ones say their angle because without it they are three
  // controls a person cannot tell apart.
  [ROTATE_PAGE_TITLE]: 'Rotate page',
  [ROTATE_PAGE_180_TITLE]: 'Rotate page 180°',
  [ROTATE_PAGE_270_TITLE]: 'Rotate page 270°',
  // "Blank page" rather than "Insert page": what a person is adding is the
  // noun, and *insert* alone leaves them asking what.
  [INSERT_BLANK_PAGE_TITLE]: 'Insert blank page',
  [DUPLICATE_PAGE_TITLE]: 'Duplicate page',
  // NAMES WHAT GOES, not the verb alone. *Delete* beside three *Rotate page*
  // controls reads as a mode rather than an action on the page being looked at,
  // and this is the one control in the toolbar that removes something.
  [DELETE_PAGE_TITLE]: 'Delete page',
  [FIND_TITLE]: 'Find',
  [ZOOM_IN_TITLE]: 'Zoom in',
  [ZOOM_OUT_TITLE]: 'Zoom out',
  [FIT_WIDTH_TITLE]: 'Fit width',
  [FIT_PAGE_TITLE]: 'Fit page',
  [DARK_PAGE_TITLE]: 'Dark page',
  [LOUPE_TITLE]: 'Loupe',
  [SPLIT_VIEW_TITLE]: 'Split view',
  // NAMES WHICH PANE IT IS. Two scrollable regions with the same accessible
  // name are two regions a screen-reader user cannot tell apart, and the second
  // one is the whole point of the feature.
  [SPLIT_SECOND_LABEL]: 'Second view of this document',
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
  [FIND_CASE_SENSITIVE]: 'Match case',
  [FIND_WHOLE_WORD]: 'Whole word',
  [FIND_REGEX]: 'Regular expression',
  [FIND_ALL_PAGES]: 'Search all pages',
  [FIND_CANCEL]: 'Cancel',
  [FIND_PROGRESS]: 'Searched {done} of {count} pages',
  // NAMES WHAT WAS DISCARDED. A cancelled walk keeps nothing, and a message
  // that only said "cancelled" would leave a reader wondering whether the
  // partial count they glimpsed is still on screen.
  [FIND_CANCELLED]: 'Search cancelled. No results were kept.',
  [FIND_BAD_PATTERN]: 'That is not a valid regular expression.',
  [FIND_DOCUMENT_MATCHES]: '{count} matches in this document',
  [FIND_DOCUMENT_EMPTY]: 'Nothing in this document matches.',
  [FIND_MATCH_ON_PAGE]: 'Page {page}: {text}',
  [FIND_NEXT_MATCH]: 'Next match',
  [FIND_PREVIOUS_MATCH]: 'Previous match',
  // BOTH NUMBERS, because a reader stepping through matches needs to know how
  // far they have to go as much as where they are, and "match 7" alone is the
  // half that tells them neither.
  [FIND_MATCH_POSITION]: 'Match {position} of {count}',
  [COMPARE_PICK]: 'Compare with',
  // THE DEFAULT IS THIS DOCUMENT AGAIN, which is split view. Naming it as an
  // option rather than as an absence is what makes it something a reader can
  // return to.
  [COMPARE_SAME]: 'This document',
  [COMPARE_SECOND_LABEL]: 'Second view: {name}',
  [TAB_STRIP_LABEL]: 'Open documents',
  // THE FILE'S NAME IS IN THE CONTROL'S NAME. Six tabs give six close buttons,
  // and six of them called "Close" are six controls a screen-reader user
  // cannot tell apart.
  [TAB_CLOSE]: 'Close {name}',
  [TAB_OPEN_ANOTHER]: 'Open another document',
  [VIEW_PROBLEM_TITLE]: 'This document could not be displayed.',
  // NAMES WHAT SURVIVED, which is the actionable half. A reader who has just
  // watched a view vanish assumes the worst about their file; §10.5a's
  // guarantee is that nothing of theirs is involved, and saying so is what
  // makes *try again* worth pressing.
  [VIEW_PROBLEM_BODY]: 'Your file is unchanged. Trying again returns to the same page.',
  [VIEW_PROBLEM_RETRY]: 'Try again',
  [START_TITLE]: 'Monstera',
  [START_INVITATION]: 'Open a PDF to begin.',
  // SAYS WHAT HAPPENED AND WHAT IS LIKELY. A file the picker offered and the
  // service could not read has almost always moved, and naming that is what
  // makes the message actionable rather than a report.
  [START_ABSENT]: 'That file could not be opened. It may have been moved, renamed or deleted.',
  [START_AT_CAPACITY]: 'There is not enough room to open that document. Close another one first.',
  [RECENT_LABEL]: 'Recent documents',
  [RECENT_EMPTY]: 'Nothing opened yet.',
  // NAMES WHAT HAPPENED rather than blaming the reader. A row goes stale
  // because the file moved or the list outlived the run that made it, and
  // neither is something they did.
  [RECENT_MISSING]: 'That document could not be opened. It may have been moved or renamed.',
  // NAMES NOTHING, because the list beneath it does. This read "Reopen
  // {name}?" while one document could be open and the newest recent entry was
  // that document; with tabs the offer is a recorded set, and a sentence
  // naming one of several would be the inference tabs ended, in a string.
  [RECOVER_OFFER]: 'Monstera closed unexpectedly. These documents were open:',
  // ONE CONTROL PER DOCUMENT, each named with the file it reopens — a column
  // of buttons all called "Reopen" is a column a screen-reader user cannot
  // tell apart, which is the tab strip's close control one surface over.
  [RECOVER_LABEL]: 'Reopen {name}',
  [LAYERS_LABEL]: 'Layers',
  [LAYERS_EMPTY]: 'This document has no layers.',
  [LAYERS_UNAVAILABLE]: 'The layers could not be read.',
  [LINKS_LABEL]: 'Links on this page',
  [LINKS_EMPTY]: 'This page has no links.',
  [LINKS_UNAVAILABLE]: 'The links on this page could not be read.',
  [LINKS_TO_PAGE]: 'Go to page {page}',
  [LINKS_EXTERNAL]: 'Opens {uri}',
  [STATUS_GO_TO]: 'Go to page',
  // NAMES THE RANGE. "That page does not exist" leaves a reader guessing where
  // the document ends, and the count is on screen a few pixels away only while
  // they are looking at it rather than at the field they just typed into.
  [STATUS_GO_TO_OUTSIDE]: 'This document has pages 1 to {count}.',
  [GO_TO_TITLE]: 'Go to page',
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
  [DELETE_PAGES_TITLE]: 'Delete pages',
  [DELETE_PAGES_LABEL]: 'Pages to delete',
  // AN EXAMPLE, not a description of the grammar. "Comma-separated ranges"
  // makes a person work out what that means; "1-3, 5" is the same information
  // in a form they can copy.
  [DELETE_PAGES_HINT]: '1-3, 5',
  // NAMES WHAT IT DOES. "OK" on the one control in this build that removes
  // pages is a button a person presses without reading.
  [DELETE_PAGES_APPLY]: 'Delete pages',
  [DELETE_PAGES_EMPTY]: 'Type the pages to delete, for example 1-3, 5.',
  // THE OFFENDING PART IS QUOTED BACK. A message describing the class leaves a
  // person re-reading a whole expression to find which piece was wrong.
  [DELETE_PAGES_NOT_A_NUMBER]: '“{part}” is not a page or a page range.',
  [DELETE_PAGES_OUT_OF_RANGE]: '“{part}” is outside this document, which has {pageCount} pages.',
  // The correction is named rather than performed: reading 5-3 as 3-5 would
  // delete three pages the user did not ask for.
  [DELETE_PAGES_BACKWARDS]: '“{part}” counts backwards. Write the lower page first.',
  [DELETE_PAGES_EVERYTHING]:
    'That is every page. A document with no pages cannot be opened — close it instead.',
  [DELETE_PAGES_COMMAND_TITLE]: 'Delete pages…',
  [CROP_PAGES_TITLE]: 'Crop pages',
  // THE UNIT IS IN EVERY LABEL, not in a note beside the fields. A person
  // typing 10 into a box marked "Top" has no way to know what ten of.
  [CROP_PAGES_TOP]: 'Top (points)',
  [CROP_PAGES_BOTTOM]: 'Bottom (points)',
  [CROP_PAGES_LEFT]: 'Left (points)',
  [CROP_PAGES_RIGHT]: 'Right (points)',
  [CROP_PAGES_THIS]: 'This page',
  [CROP_PAGES_ALL]: 'All pages',
  [CROP_PAGES_APPLY]: 'Crop',
  [CROP_PAGES_NOT_A_NUMBER]: 'Margins are numbers of points. Leave an edge empty to keep it.',
  // NAMED SEPARATELY from the general refusal: "that is not a number" is
  // unhelpful about a string that plainly is one, and cropping by a negative
  // margin is growing the page — a different operation.
  [CROP_PAGES_NEGATIVE]: 'A margin cannot be negative. Cropping only takes away.',
  [CROP_PAGES_COMMAND_TITLE]: 'Crop pages…',
  [DUPLICATE_PAGES_TITLE]: 'Duplicate pages',
  // WHAT WAS COMPARED, in the user's terms rather than the format's. "Content
  // and resources" would be true and would leave a person unable to tell
  // whether their annotated copy counts as the same page — which is exactly the
  // question this sentence exists to answer.
  [DUPLICATE_PAGES_COMPARED]:
    'Pages are compared by what is drawn on them. Comments and form entries are not compared, ' +
    'and pages that look alike but were built separately are not listed.',
  [DUPLICATE_PAGES_NONE]: 'No duplicate pages were found.',
  [DUPLICATE_PAGES_GROUP]: 'Pages {pages}',
  // THE COUNT IS IN THE LABEL. "Remove duplicates" leaves a person pressing a
  // button without knowing how many pages go, which is the one thing they want
  // to know before a delete.
  [DUPLICATE_PAGES_REMOVE]: 'Remove {count} duplicate page(s)',
  [DUPLICATE_PAGES_TRUNCATED]:
    'This list was cut short, so there may be more duplicates than are shown.',
  [FIND_DUPLICATES_COMMAND_TITLE]: 'Find duplicate pages…',
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
  [PROBLEM_INTERNAL]: 'Something went wrong inside Monstera. Your document is unchanged.',
  // A label, not a sentence: the value beside it is an opaque id, and ADR-0009
  // §9 is why it is the only thing about the diagnostic that crosses.
  [PROBLEM_REFERENCE_LABEL]: 'Reference',
};
