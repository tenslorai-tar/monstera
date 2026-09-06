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
export const WATERMARK_PAGES_TITLE = messageKey('dialog.watermark-pages.title');
export const WATERMARK_PAGES_TEXT = messageKey('dialog.watermark-pages.text');
export const WATERMARK_PAGES_OPACITY = messageKey('dialog.watermark-pages.opacity');
export const WATERMARK_PAGES_ROTATION = messageKey('dialog.watermark-pages.rotation');
export const WATERMARK_PAGES_SIZE = messageKey('dialog.watermark-pages.size');
export const WATERMARK_PAGES_THIS = messageKey('dialog.watermark-pages.this-page');
export const WATERMARK_PAGES_ALL = messageKey('dialog.watermark-pages.all-pages');
export const WATERMARK_PAGES_APPLY = messageKey('dialog.watermark-pages.apply');
export const WATERMARK_PAGES_NO_TEXT = messageKey('dialog.watermark-pages.no-text');
export const WATERMARK_PAGES_NOT_A_NUMBER = messageKey('dialog.watermark-pages.not-a-number');
export const WATERMARK_PAGES_OPACITY_RANGE = messageKey('dialog.watermark-pages.opacity-range');
export const WATERMARK_PAGES_SIZE_RANGE = messageKey('dialog.watermark-pages.size-range');
export const WATERMARK_PAGES_COMMAND_TITLE = messageKey('command.watermark-pages.title');
export const HEADER_FOOTER_TITLE = messageKey('dialog.header-footer.title');
export const HEADER_FOOTER_HEADER = messageKey('dialog.header-footer.header');
export const HEADER_FOOTER_FOOTER = messageKey('dialog.header-footer.footer');
export const HEADER_FOOTER_LEFT = messageKey('dialog.header-footer.left');
export const HEADER_FOOTER_CENTRE = messageKey('dialog.header-footer.centre');
export const HEADER_FOOTER_RIGHT = messageKey('dialog.header-footer.right');
export const HEADER_FOOTER_TOKENS = messageKey('dialog.header-footer.tokens');
export const HEADER_FOOTER_SIZE = messageKey('dialog.header-footer.size');
export const HEADER_FOOTER_MARGIN = messageKey('dialog.header-footer.margin');
export const HEADER_FOOTER_THIS = messageKey('dialog.header-footer.this-page');
export const HEADER_FOOTER_ALL = messageKey('dialog.header-footer.all-pages');
export const HEADER_FOOTER_APPLY = messageKey('dialog.header-footer.apply');
export const HEADER_FOOTER_EMPTY = messageKey('dialog.header-footer.empty');
export const HEADER_FOOTER_NOT_A_NUMBER = messageKey('dialog.header-footer.not-a-number');
export const HEADER_FOOTER_COMMAND_TITLE = messageKey('command.header-footer.title');
export const BATES_NUMBER_TITLE = messageKey('dialog.bates-number.title');
export const BATES_NUMBER_PREFIX = messageKey('dialog.bates-number.prefix');
export const BATES_NUMBER_SUFFIX = messageKey('dialog.bates-number.suffix');
export const BATES_NUMBER_START = messageKey('dialog.bates-number.start');
export const BATES_NUMBER_DIGITS = messageKey('dialog.bates-number.digits');
export const BATES_NUMBER_PREVIEW = messageKey('dialog.bates-number.preview');
export const BATES_NUMBER_EDGE_HEADER = messageKey('dialog.bates-number.edge-header');
export const BATES_NUMBER_EDGE_FOOTER = messageKey('dialog.bates-number.edge-footer');
export const BATES_NUMBER_SLOT_LEFT = messageKey('dialog.bates-number.slot-left');
export const BATES_NUMBER_SLOT_CENTRE = messageKey('dialog.bates-number.slot-centre');
export const BATES_NUMBER_SLOT_RIGHT = messageKey('dialog.bates-number.slot-right');
export const BATES_NUMBER_THIS = messageKey('dialog.bates-number.this-page');
export const BATES_NUMBER_ALL = messageKey('dialog.bates-number.all-pages');
export const BATES_NUMBER_APPLY = messageKey('dialog.bates-number.apply');
export const BATES_NUMBER_NOT_A_NUMBER = messageKey('dialog.bates-number.not-a-number');
export const BATES_NUMBER_COMMAND_TITLE = messageKey('command.bates-number.title');
export const SAVE_COPY_TITLE = messageKey('command.save-copy.title');
export const PAGE_TRANSITION_TITLE = messageKey('dialog.page-transition.title');
export const PAGE_TRANSITION_REPLACE = messageKey('dialog.page-transition.replace');
export const PAGE_TRANSITION_DISSOLVE = messageKey('dialog.page-transition.dissolve');
export const PAGE_TRANSITION_FADE = messageKey('dialog.page-transition.fade');
export const PAGE_TRANSITION_BOX = messageKey('dialog.page-transition.box');
export const PAGE_TRANSITION_BLINDS = messageKey('dialog.page-transition.blinds');
export const PAGE_TRANSITION_REPLACE_NOTE = messageKey('dialog.page-transition.replace-note');
export const PAGE_TRANSITION_DURATION = messageKey('dialog.page-transition.duration');
export const PAGE_TRANSITION_THIS = messageKey('dialog.page-transition.this-page');
export const PAGE_TRANSITION_ALL = messageKey('dialog.page-transition.all-pages');
export const PAGE_TRANSITION_APPLY = messageKey('dialog.page-transition.apply');
export const PAGE_TRANSITION_NOT_A_NUMBER = messageKey('dialog.page-transition.not-a-number');
export const PAGE_TRANSITION_COMMAND_TITLE = messageKey('command.page-transition.title');
export const PAGE_BACKGROUND_COMMAND_TITLE = messageKey('command.page-background.title');
export const RESIZE_PAGES_TITLE = messageKey('dialog.resize-pages.title');
export const RESIZE_PAGES_A3 = messageKey('dialog.resize-pages.a3');
export const RESIZE_PAGES_A4 = messageKey('dialog.resize-pages.a4');
export const RESIZE_PAGES_A5 = messageKey('dialog.resize-pages.a5');
export const RESIZE_PAGES_LETTER = messageKey('dialog.resize-pages.letter');
export const RESIZE_PAGES_LEGAL = messageKey('dialog.resize-pages.legal');
export const RESIZE_PAGES_TABLOID = messageKey('dialog.resize-pages.tabloid');
export const RESIZE_PAGES_WIDTH = messageKey('dialog.resize-pages.width');
export const RESIZE_PAGES_HEIGHT = messageKey('dialog.resize-pages.height');
export const RESIZE_PAGES_UNIFORM_NOTE = messageKey('dialog.resize-pages.uniform-note');
export const RESIZE_PAGES_THIS = messageKey('dialog.resize-pages.this-page');
export const RESIZE_PAGES_ALL = messageKey('dialog.resize-pages.all-pages');
export const RESIZE_PAGES_APPLY = messageKey('dialog.resize-pages.apply');
export const RESIZE_PAGES_NOT_A_SIZE = messageKey('dialog.resize-pages.not-a-size');
export const RESIZE_PAGES_COMMAND_TITLE = messageKey('command.resize-pages.title');
export const MERGE_DOCUMENT_COMMAND_TITLE = messageKey('command.merge-document.title');
export const MERGE_DOCUMENT_TITLE = messageKey('dialog.merge-document.title');
export const MERGE_DOCUMENT_LABEL = messageKey('dialog.merge-document.label');
export const MERGE_DOCUMENT_APPLY = messageKey('dialog.merge-document.apply');
export const MERGE_DOCUMENT_NONE_TITLE = messageKey('dialog.merge-document-none.title');
export const MERGE_DOCUMENT_NONE_BODY = messageKey('dialog.merge-document-none.body');
export const INSERT_FROM_PDF_COMMAND_TITLE = messageKey('command.insert-from-pdf.title');
export const INSERT_FROM_PDF_TITLE = messageKey('dialog.insert-from-pdf.title');
export const INSERT_FROM_PDF_LABEL = messageKey('dialog.insert-from-pdf.label');
export const INSERT_FROM_PDF_POSITION = messageKey('dialog.insert-from-pdf.position');
export const INSERT_FROM_PDF_RANGE = messageKey('dialog.insert-from-pdf.range');
export const INSERT_FROM_PDF_APPLY = messageKey('dialog.insert-from-pdf.apply');
export const REPLACE_PAGE_COMMAND_TITLE = messageKey('command.replace-page.title');
export const REPLACE_PAGE_TITLE = messageKey('dialog.replace-page.title');
export const REPLACE_PAGE_LABEL = messageKey('dialog.replace-page.label');
export const REPLACE_PAGE_WHICH = messageKey('dialog.replace-page.which');
export const REPLACE_PAGE_APPLY = messageKey('dialog.replace-page.apply');
export const EXTRACT_PAGES_COMMAND_TITLE = messageKey('command.extract-pages.title');
export const EXTRACT_PAGES_TITLE = messageKey('dialog.extract-pages.title');
export const EXTRACT_PAGES_LABEL = messageKey('dialog.extract-pages.label');
export const EXTRACT_PAGES_EMPTY = messageKey('dialog.extract-pages.empty');
export const EXTRACT_PAGES_APPLY = messageKey('dialog.extract-pages.apply');
export const SPLIT_DOCUMENT_COMMAND_TITLE = messageKey('command.split-document.title');
export const SPLIT_DOCUMENT_TITLE = messageKey('dialog.split-document.title');
export const SPLIT_DOCUMENT_EACH_PAGE = messageKey('dialog.split-document.each-page');
export const SPLIT_DOCUMENT_RANGES = messageKey('dialog.split-document.ranges');
export const SPLIT_DOCUMENT_LABEL = messageKey('dialog.split-document.label');
export const SPLIT_DOCUMENT_EMPTY = messageKey('dialog.split-document.empty');
export const SPLIT_DOCUMENT_FILES = messageKey('dialog.split-document.files');
export const SPLIT_DOCUMENT_APPLY = messageKey('dialog.split-document.apply');
export const INSERT_IMAGE_COMMAND_TITLE = messageKey('command.insert-image.title');
export const INSERT_IMAGE_PROBLEM_TITLE = messageKey('dialog.insert-image-problem.title');
export const INSERT_IMAGE_UNREADABLE = messageKey('dialog.insert-image-problem.unreadable');
export const INSERT_IMAGE_TOO_LARGE = messageKey('dialog.insert-image-problem.too-large');
export const GENERATE_TOC_COMMAND_TITLE = messageKey('command.generate-toc.title');
export const GENERATE_TOC_PROBLEM_TITLE = messageKey('dialog.generate-toc-problem.title');
export const GENERATE_TOC_NO_OUTLINE = messageKey('dialog.generate-toc-problem.no-outline');
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
export const RECTANGLE_TOOL_TITLE = messageKey('command.annotate-rectangle.title');
export const ELLIPSE_TOOL_TITLE = messageKey('command.annotate-ellipse.title');
export const LINE_TOOL_TITLE = messageKey('command.annotate-line.title');
export const ARROW_TOOL_TITLE = messageKey('command.annotate-arrow.title');
export const INK_TOOL_TITLE = messageKey('command.annotate-ink.title');
export const REDACT_TOOL_TITLE = messageKey('command.annotate-redact.title');
export const ANNOTATION_SURFACE_LABEL = messageKey('surface.annotation.label');
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
export const ANNOTATIONS_LABEL = messageKey('surface.annotations.label');
export const ANNOTATIONS_EMPTY = messageKey('surface.annotations.empty');
export const ANNOTATIONS_UNAVAILABLE = messageKey('surface.annotations.unavailable');
export const ANNOTATIONS_TRUNCATED = messageKey('surface.annotations.truncated');
export const ANNOTATIONS_REMOVE = messageKey('surface.annotations.remove');
export const ANNOTATIONS_ROW = messageKey('surface.annotations.row');
export const ANNOTATIONS_KIND_SQUARE = messageKey('surface.annotations.kind.square');
export const ANNOTATIONS_KIND_CIRCLE = messageKey('surface.annotations.kind.circle');
export const ANNOTATIONS_KIND_LINE = messageKey('surface.annotations.kind.line');
export const ANNOTATIONS_KIND_INK = messageKey('surface.annotations.kind.ink');
export const ANNOTATIONS_KIND_REDACT = messageKey('surface.annotations.kind.redact');
export const ANNOTATIONS_KIND_TEXT_BOX = messageKey('surface.annotations.kind.text-box');
export const ANNOTATIONS_KIND_STICKY_NOTE = messageKey('surface.annotations.kind.sticky-note');
export const ANNOTATIONS_KIND_CARET = messageKey('surface.annotations.kind.caret');
export const ANNOTATIONS_KIND_POLYGON = messageKey('surface.annotations.kind.polygon');
export const ANNOTATIONS_KIND_POLYLINE = messageKey('surface.annotations.kind.polyline');
export const POLYGON_TOOL_TITLE = messageKey('command.annotate.polygon');
export const POLYLINE_TOOL_TITLE = messageKey('command.annotate.polyline');
export const CLOUD_TOOL_TITLE = messageKey('command.annotate.cloud');
export const ERASER_TOOL_TITLE = messageKey('command.annotate.eraser');
export const SELECT_TOOL_TITLE = messageKey('command.annotate.select');
export const LINK_ADDRESS_TOOL_TITLE = messageKey('command.annotate.link-address');
export const LINK_PAGE_TOOL_TITLE = messageKey('command.annotate.link-page');
export const LINK_ADDRESS_TITLE = messageKey('dialog.link-address.title');
export const LINK_ADDRESS_LABEL = messageKey('dialog.link-address.label');
export const LINK_ADDRESS_APPLY = messageKey('dialog.link-address.apply');
export const LINK_ADDRESS_EMPTY = messageKey('dialog.link-address.empty');
export const LINK_ADDRESS_TOO_LONG = messageKey('dialog.link-address.too-long');
export const LINK_ADDRESS_SCHEME = messageKey('dialog.link-address.scheme');
export const LINK_PAGE_TITLE = messageKey('dialog.link-page.title');
export const LINK_PAGE_LABEL = messageKey('dialog.link-page.label');
export const LINK_PAGE_APPLY = messageKey('dialog.link-page.apply');
export const LINK_PAGE_EMPTY = messageKey('dialog.link-page.empty');
export const LINK_PAGE_TOO_LONG = messageKey('dialog.link-page.too-long');
export const LINK_PAGE_NOT_A_NUMBER = messageKey('dialog.link-page.not-a-number');
export const DELETE_SELECTION_TITLE = messageKey('command.annotate.delete-selection');
export const NUDGE_LEFT_TITLE = messageKey('command.annotate.nudge-left');
export const NUDGE_RIGHT_TITLE = messageKey('command.annotate.nudge-right');
export const NUDGE_UP_TITLE = messageKey('command.annotate.nudge-up');
export const NUDGE_DOWN_TITLE = messageKey('command.annotate.nudge-down');
export const ANNOTATION_TEXT_TITLE = messageKey('dialog.annotation-text.title');
export const ANNOTATION_TEXT_LABEL = messageKey('dialog.annotation-text.label');
export const ANNOTATION_TEXT_APPLY = messageKey('dialog.annotation-text.apply');
export const ANNOTATION_TEXT_EMPTY = messageKey('dialog.annotation-text.empty');
export const ANNOTATION_TEXT_TOO_LONG = messageKey('dialog.annotation-text.too-long');
export const ANNOTATION_NOTE_TITLE = messageKey('dialog.annotation-note.title');
export const ANNOTATION_NOTE_LABEL = messageKey('dialog.annotation-note.label');
export const ANNOTATION_NOTE_APPLY = messageKey('dialog.annotation-note.apply');
export const ANNOTATION_NOTE_EMPTY = messageKey('dialog.annotation-note.empty');
export const ANNOTATION_NOTE_TOO_LONG = messageKey('dialog.annotation-note.too-long');
export const TOOL_TEXT_BOX_TITLE = messageKey('command.annotate.text-box');
export const TOOL_STICKY_NOTE_TITLE = messageKey('command.annotate.sticky-note');
export const TOOL_CARET_TITLE = messageKey('command.annotate.caret');
export const ANNOTATIONS_KIND_CALLOUT = messageKey('surface.annotations.kind.callout');
export const ANNOTATIONS_KIND_TYPEWRITER = messageKey('surface.annotations.kind.typewriter');
export const TYPEWRITER_TOOL_TITLE = messageKey('command.annotate.typewriter');
export const TYPEWRITER_DIALOG_TITLE = messageKey('dialog.typewriter.title');
export const TYPEWRITER_LABEL = messageKey('dialog.typewriter.label');
export const TYPEWRITER_APPLY = messageKey('dialog.typewriter.apply');
export const TYPEWRITER_EMPTY = messageKey('dialog.typewriter.empty');
export const TYPEWRITER_TOO_LONG = messageKey('dialog.typewriter.too-long');
export const CALLOUT_TOOL_TITLE = messageKey('command.annotate.callout');
export const CALLOUT_DIALOG_TITLE = messageKey('dialog.callout.title');
export const CALLOUT_LABEL = messageKey('dialog.callout.label');
export const CALLOUT_APPLY = messageKey('dialog.callout.apply');
export const CALLOUT_EMPTY = messageKey('dialog.callout.empty');
export const CALLOUT_TOO_LONG = messageKey('dialog.callout.too-long');
export const ANNOTATIONS_KIND_HIGHLIGHT = messageKey('surface.annotations.kind.highlight');
export const ANNOTATIONS_KIND_UNDERLINE = messageKey('surface.annotations.kind.underline');
export const ANNOTATIONS_KIND_STRIKEOUT = messageKey('surface.annotations.kind.strikeout');
export const HIGHLIGHT_TOOL_TITLE = messageKey('command.annotate.highlight');
export const UNDERLINE_TOOL_TITLE = messageKey('command.annotate.underline');
export const STRIKEOUT_TOOL_TITLE = messageKey('command.annotate.strikeout');
export const ANNOTATIONS_KIND_OTHER = messageKey('surface.annotations.kind.other');
export const ANNOTATIONS_FOREIGN = messageKey('surface.annotations.foreign');
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
export const PROBLEM_STALE_TARGET = messageKey('dialog.command-problem.stale-target');
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
  [RECTANGLE_TOOL_TITLE]: 'Rectangle',
  // ELLIPSE, not *circle*, although `/Subtype /Circle` is what the file says.
  // The format's name is a term of art and the control's is what a person
  // drags — and a control called Circle that draws an oval is a control that
  // did something else.
  [ELLIPSE_TOOL_TITLE]: 'Ellipse',
  [LINE_TOOL_TITLE]: 'Line',
  [ARROW_TOOL_TITLE]: 'Arrow',
  // WHAT THE CONTROL DOES, not what the format calls it. `/Ink` is the
  // subtype; a person drawing with it is drawing freehand, and every
  // application this one replaces labels it so.
  [INK_TOOL_TITLE]: 'Freehand',
  // MARK, and the word is load-bearing. This control removes nothing — burning
  // a redaction in is a different command with a different save mode — and a
  // label reading "Redact" would promise the removal to the one person who
  // most needs to know it has not happened yet.
  [REDACT_TOOL_TITLE]: 'Mark for redaction',
  // NAMES THE PAGE, because a scroller shows several and each carries its own
  // drawing surface. Two surfaces with the same accessible name are two a
  // screen-reader user cannot tell apart, which is `SPLIT_SECOND_LABEL`'s
  // argument on a list rather than a pair.
  [ANNOTATION_SURFACE_LABEL]: 'Draw on page {page}',
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
  [ANNOTATIONS_LABEL]: 'Annotations in this document',
  [ANNOTATIONS_EMPTY]: 'This document has no annotations.',
  [ANNOTATIONS_UNAVAILABLE]: 'The annotations in this document could not be read.',
  // NAMES THE BOUND rather than saying "and more". A reader deciding whether
  // the list is complete needs the number, and a panel headed *the annotations
  // in this document* that quietly showed some of them is the display-only sin
  // in a list.
  [ANNOTATIONS_TRUNCATED]: 'Only the first 4,096 annotations are listed.',
  // SAYS WHAT IT REMOVES, not just "Delete". The row beside it names a kind and
  // a page, and a bare verb on a list of similar rows is the label a person
  // clicks on the wrong line.
  [ANNOTATIONS_REMOVE]: 'Remove this annotation',
  [ANNOTATIONS_ROW]: '{kind} on page {page}',
  // THE CONTROL'S WORDS, not the format's. `/Square` and `/Circle` are terms of
  // art; a person drew a rectangle and an ellipse, and the labels match the
  // tools that made them.
  [ANNOTATIONS_KIND_SQUARE]: 'Rectangle',
  [ANNOTATIONS_KIND_CIRCLE]: 'Ellipse',
  [ANNOTATIONS_KIND_LINE]: 'Line',
  [ANNOTATIONS_KIND_INK]: 'Freehand',
  [ANNOTATIONS_KIND_REDACT]: 'Redaction mark',
  // NAMES THE OBJECT, not who wrote it. A `/FreeText` from another application
  // is a text box too, and the row beside this label shows its words.
  [ANNOTATIONS_KIND_TEXT_BOX]: 'Text box',
  [ANNOTATIONS_KIND_STICKY_NOTE]: 'Note',
  [ANNOTATIONS_KIND_CARET]: 'Insertion mark',
  // ONE LABEL FOR THE POLYGON AND THE CLOUD, because the panel names the object
  // and both are `/Polygon`. A *Cloud* row would be this build's tool
  // vocabulary applied to a document somebody else wrote.
  [ANNOTATIONS_KIND_POLYGON]: 'Shape',
  [ANNOTATIONS_KIND_POLYLINE]: 'Connected lines',
  [ANNOTATIONS_KIND_CALLOUT]: 'Callout',
  [ANNOTATIONS_KIND_TYPEWRITER]: 'Typed text',
  [TYPEWRITER_TOOL_TITLE]: 'Typewriter',
  [TYPEWRITER_DIALOG_TITLE]: 'Typewriter',
  // *TYPE ONTO THE PAGE* rather than *Text*, because the difference from the
  // text box is exactly that there is no box — the label is where a person
  // learns which of the two they picked.
  [TYPEWRITER_LABEL]: 'Type onto the page',
  [TYPEWRITER_APPLY]: 'Add text',
  [TYPEWRITER_EMPTY]: 'Type the words to add to the page.',
  [TYPEWRITER_TOO_LONG]: 'That is too long to store.',
  [CALLOUT_TOOL_TITLE]: 'Callout',
  [CALLOUT_DIALOG_TITLE]: 'Callout',
  [CALLOUT_LABEL]: 'Note',
  [CALLOUT_APPLY]: 'Add callout',
  [CALLOUT_EMPTY]: 'Type what this callout should say.',
  [CALLOUT_TOO_LONG]: 'That note is too long to store.',
  [ANNOTATIONS_KIND_HIGHLIGHT]: 'Highlight',
  [ANNOTATIONS_KIND_UNDERLINE]: 'Underline',
  [ANNOTATIONS_KIND_STRIKEOUT]: 'Strikethrough',
  [HIGHLIGHT_TOOL_TITLE]: 'Highlight text',
  [UNDERLINE_TOOL_TITLE]: 'Underline text',
  // *STRIKETHROUGH* IN THE CONTROL AND `/StrikeOut` IN THE FILE. The format's
  // name is not the word a reader uses, and this row is the reader's.
  [STRIKEOUT_TOOL_TITLE]: 'Strike through text',
  // ONLY THE FOREIGN ROWS ARE LABELLED, because *this application wrote this*
  // is the ordinary case in a panel a person reached from their own drawing
  // tools, and a badge on every row is a badge nobody reads. What is worth
  // saying is that a mark came from somewhere else before they change it.
  [ANNOTATIONS_FOREIGN]: 'Came with the document',
  [POLYGON_TOOL_TITLE]: 'Polygon',
  [POLYLINE_TOOL_TITLE]: 'Connected lines',
  [CLOUD_TOOL_TITLE]: 'Cloud',
  // *ERASE ANNOTATION* RATHER THAN *ERASER*, because this removes a whole mark
  // and does not rub away part of a stroke — which is what an eraser does in
  // every drawing application a reader is coming from. The control says what
  // happens; the row's name is not the promise.
  [ERASER_TOOL_TITLE]: 'Erase annotation',
  // *SELECT ANNOTATIONS*, because this build has another selection — text — and
  // a bare *Select* in a palette beside the Edit ribbon would be the wrong one
  // for the reader who most needs the right one.
  [SELECT_TOOL_TITLE]: 'Select annotations',
  [LINK_ADDRESS_TOOL_TITLE]: 'Link to a web address',
  [LINK_PAGE_TOOL_TITLE]: 'Link to a page',
  [LINK_ADDRESS_TITLE]: 'Link to a web address',
  [LINK_ADDRESS_LABEL]: 'Address',
  [LINK_ADDRESS_APPLY]: 'Add link',
  [LINK_ADDRESS_EMPTY]: 'Type the address this link should open.',
  [LINK_ADDRESS_TOO_LONG]: 'That address is too long to store.',
  // NAMES WHAT IS ACCEPTED rather than what was wrong, because the person is
  // about to type again and the useful sentence is the one that says what to
  // type. The three schemes are the ones this build will write into a document
  // that leaves this machine.
  [LINK_ADDRESS_SCHEME]: 'Links can open a web page or an email address: start with https://, http:// or mailto:.',
  [LINK_PAGE_TITLE]: 'Link to a page',
  [LINK_PAGE_LABEL]: 'Page number',
  [LINK_PAGE_APPLY]: 'Add link',
  [LINK_PAGE_EMPTY]: 'Type the page this link should go to.',
  [LINK_PAGE_TOO_LONG]: 'That is not a page number.',
  [LINK_PAGE_NOT_A_NUMBER]: 'Type a page number, counting from 1.',
  [DELETE_SELECTION_TITLE]: 'Delete selected annotations',
  // ONE NAME FOR BOTH STEPS. The coarse nudge is the same command with Shift
  // held, and a second entry reading *Move selection left further* would be
  // catalogue noise for a distinction the chord already makes.
  [NUDGE_LEFT_TITLE]: 'Move selection left',
  [NUDGE_RIGHT_TITLE]: 'Move selection right',
  [NUDGE_UP_TITLE]: 'Move selection up',
  [NUDGE_DOWN_TITLE]: 'Move selection down',
  [ANNOTATION_TEXT_TITLE]: 'Text box',
  [ANNOTATION_TEXT_LABEL]: 'Text',
  [ANNOTATION_TEXT_APPLY]: 'Add text box',
  // NAMES WHAT IS MISSING, not that something is wrong. The field is empty when
  // the dialog opens, so this is the first thing a person reads — it has to
  // read as an instruction rather than as a complaint about what they did.
  [ANNOTATION_TEXT_EMPTY]: 'Type the text this box should show.',
  [ANNOTATION_TEXT_TOO_LONG]: 'That is too long for one text box. Shorten it, or use several.',
  [ANNOTATION_NOTE_TITLE]: 'Note',
  [ANNOTATION_NOTE_LABEL]: 'Comment',
  [ANNOTATION_NOTE_APPLY]: 'Add note',
  [ANNOTATION_NOTE_EMPTY]: 'Type the comment this note should hold.',
  [ANNOTATION_NOTE_TOO_LONG]: 'That is too long for one note. Shorten it, or use several.',
  [TOOL_TEXT_BOX_TITLE]: 'Text box',
  [TOOL_STICKY_NOTE_TITLE]: 'Note',
  [TOOL_CARET_TITLE]: 'Insertion mark',
  // WHAT IT IS RATHER THAN WHAT IT IS NOT. A row reading *Unknown* tells a
  // reader the application is confused; *Annotation* tells them a comment is
  // there and which page to look at, which is what the panel is for.
  [ANNOTATIONS_KIND_OTHER]: 'Annotation',
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
  // "Save a copy" and NOT "Save as". They are different operations and the
  // label is the only thing telling the user which one this is: the document
  // does not move, so a person who picks this and closes the original is still
  // prompted about unsaved work. Naming it "Save as" would promise a move this
  // command deliberately does not make.
  [SAVE_COPY_TITLE]: 'Save a copy…',
  [PAGE_TRANSITION_TITLE]: 'Page transition',
  [PAGE_TRANSITION_REPLACE]: 'None',
  [PAGE_TRANSITION_DISSOLVE]: 'Dissolve',
  [PAGE_TRANSITION_FADE]: 'Fade',
  [PAGE_TRANSITION_BOX]: 'Box',
  [PAGE_TRANSITION_BLINDS]: 'Blinds',
  // Says what NONE does, because it is the option that reads as "leave it
  // alone" and is in fact a change: it writes a transition meaning no visible
  // effect, which is how a reader turns an existing one off.
  [PAGE_TRANSITION_REPLACE_NOTE]:
    'None sets the page to change with no visible effect. Transitions show in full-screen reading.',
  [PAGE_TRANSITION_DURATION]: 'Duration (seconds)',
  [PAGE_TRANSITION_THIS]: 'This page',
  [PAGE_TRANSITION_ALL]: 'All pages',
  [PAGE_TRANSITION_APPLY]: 'Set transition',
  [PAGE_TRANSITION_NOT_A_NUMBER]: 'Duration is a number of seconds, from 0 to 60.',
  [PAGE_TRANSITION_COMMAND_TITLE]: 'Page transition…',
  // NO ELLIPSIS. The convention this file already follows is that a trailing
  // "…" promises a dialog, and this command applies immediately.
  [PAGE_BACKGROUND_COMMAND_TITLE]: 'Add page background',
  [RESIZE_PAGES_TITLE]: 'Resize pages',
  [RESIZE_PAGES_A3]: 'A3',
  [RESIZE_PAGES_A4]: 'A4',
  [RESIZE_PAGES_A5]: 'A5',
  [RESIZE_PAGES_LETTER]: 'Letter',
  [RESIZE_PAGES_LEGAL]: 'Legal',
  [RESIZE_PAGES_TABLOID]: 'Tabloid',
  [RESIZE_PAGES_WIDTH]: 'Width (points)',
  [RESIZE_PAGES_HEIGHT]: 'Height (points)',
  [RESIZE_PAGES_UNIFORM_NOTE]:
    'Content is scaled to fit and centred, keeping its proportions. A page that is turned takes ' +
    'the size you asked for as you see it.',
  [RESIZE_PAGES_THIS]: 'This page',
  [RESIZE_PAGES_ALL]: 'All pages',
  [RESIZE_PAGES_APPLY]: 'Resize',
  [RESIZE_PAGES_NOT_A_SIZE]: 'Width and height are numbers of points, above 0 and up to 14400.',
  [RESIZE_PAGES_COMMAND_TITLE]: 'Resize pages…',
  [MERGE_DOCUMENT_COMMAND_TITLE]: 'Merge a document…',
  [MERGE_DOCUMENT_TITLE]: 'Merge a document',
  [MERGE_DOCUMENT_LABEL]: 'Document to merge in',
  [MERGE_DOCUMENT_APPLY]: 'Merge',
  [MERGE_DOCUMENT_NONE_TITLE]: 'Nothing to merge',
  // NAMES THE ACTION THAT FIXES IT, because ADR-0040 Decision 2 makes opening
  // the other document the step a reader has to take — and a message that only
  // reported the absence would leave them looking for a merge control that
  // takes a file.
  [MERGE_DOCUMENT_NONE_BODY]:
    'Merging copies pages from another open document. Open the document you want to merge in, then try again.',
  [INSERT_FROM_PDF_COMMAND_TITLE]: 'Insert from PDF…',
  [INSERT_FROM_PDF_TITLE]: 'Insert from PDF',
  [INSERT_FROM_PDF_LABEL]: 'Document to insert',
  [INSERT_FROM_PDF_POSITION]: 'Insert before page',
  [INSERT_FROM_PDF_RANGE]: 'Between 1 and {last}, where {last} puts it at the end.',
  [INSERT_FROM_PDF_APPLY]: 'Insert',
  [REPLACE_PAGE_COMMAND_TITLE]: 'Replace page…',
  [REPLACE_PAGE_TITLE]: 'Replace page',
  [REPLACE_PAGE_LABEL]: 'Replace it with',
  // NAMES THE PAGE, because this control destroys one and a reader must be able
  // to check it is the page they mean before pressing.
  [REPLACE_PAGE_WHICH]: 'Page {page} will be removed and replaced.',
  [REPLACE_PAGE_APPLY]: 'Replace page',
  [EXTRACT_PAGES_COMMAND_TITLE]: 'Extract pages…',
  [EXTRACT_PAGES_TITLE]: 'Extract pages',
  [EXTRACT_PAGES_LABEL]: 'Pages to extract',
  // SAYS WHAT HAPPENS TO THE OPEN DOCUMENT, because the obvious worry about a
  // control called *extract* is whether it removes them. It does not.
  [EXTRACT_PAGES_EMPTY]:
    'Type the pages to extract, for example 1-3, 5. This document is not changed.',
  [EXTRACT_PAGES_APPLY]: 'Extract to a new PDF',
  [SPLIT_DOCUMENT_COMMAND_TITLE]: 'Split…',
  [SPLIT_DOCUMENT_TITLE]: 'Split into several PDFs',
  [SPLIT_DOCUMENT_EACH_PAGE]: 'One file for each page',
  [SPLIT_DOCUMENT_RANGES]: 'One file for each range',
  [SPLIT_DOCUMENT_LABEL]: 'Ranges',
  [SPLIT_DOCUMENT_EMPTY]: 'Type the ranges to split into, for example 1-3, 4-6.',
  // THE NUMBER A READER CHECKS BEFORE PRESSING, and it says where they go —
  // the folder is chosen after this dialog, so *saved* would be premature.
  [SPLIT_DOCUMENT_FILES]: 'This document is not changed. {files} files will be written.',
  [SPLIT_DOCUMENT_APPLY]: 'Choose a folder…',
  [INSERT_IMAGE_COMMAND_TITLE]: 'Insert image…',
  [INSERT_IMAGE_PROBLEM_TITLE]: 'That image could not be added',
  [INSERT_IMAGE_UNREADABLE]:
    'The file you chose is not a JPEG or PNG this app can read. Your document has not changed.',
  [INSERT_IMAGE_TOO_LARGE]:
    'That image is larger than {megabytes} MB, which is the most this app will make a page from. ' +
    'Your document has not changed.',
  [GENERATE_TOC_COMMAND_TITLE]: 'Table of contents',
  [GENERATE_TOC_PROBLEM_TITLE]: 'There is nothing to tabulate',
  // NAMES WHAT IS MISSING AND WHERE IT COMES FROM. "No bookmarks" alone reads
  // as a failure of the app; a person who has never met the word needs to know
  // it is something the document either carries or does not.
  [GENERATE_TOC_NO_OUTLINE]:
    'This document has no bookmarks, so there are no headings to build a table of contents ' +
    'from. Your document has not changed.',
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
  [WATERMARK_PAGES_TITLE]: 'Watermark',
  [WATERMARK_PAGES_TEXT]: 'Text',
  [WATERMARK_PAGES_OPACITY]: 'Opacity (%)',
  [WATERMARK_PAGES_ROTATION]: 'Angle (degrees)',
  [WATERMARK_PAGES_SIZE]: 'Size (points)',
  [WATERMARK_PAGES_THIS]: 'This page',
  [WATERMARK_PAGES_ALL]: 'All pages',
  [WATERMARK_PAGES_APPLY]: 'Add watermark',
  [WATERMARK_PAGES_NO_TEXT]: 'A watermark needs some text.',
  [WATERMARK_PAGES_NOT_A_NUMBER]:
    'Opacity, angle and size are numbers. Leave one empty to use its default.',
  [WATERMARK_PAGES_OPACITY_RANGE]: 'Opacity runs from 0 to 100 per cent.',
  [WATERMARK_PAGES_SIZE_RANGE]: 'Size is in points, above 0 and no more than 1000.',
  [WATERMARK_PAGES_COMMAND_TITLE]: 'Watermark…',
  [HEADER_FOOTER_TITLE]: 'Headers and footers',
  [HEADER_FOOTER_HEADER]: 'Header',
  [HEADER_FOOTER_FOOTER]: 'Footer',
  [HEADER_FOOTER_LEFT]: 'Left',
  [HEADER_FOOTER_CENTRE]: 'Centre',
  [HEADER_FOOTER_RIGHT]: 'Right',
  [HEADER_FOOTER_TOKENS]: 'Type {n} for the page number and {N} for the page count.',
  [HEADER_FOOTER_SIZE]: 'Size (points)',
  [HEADER_FOOTER_MARGIN]: 'Margin (points)',
  [HEADER_FOOTER_THIS]: 'This page',
  [HEADER_FOOTER_ALL]: 'All pages',
  [HEADER_FOOTER_APPLY]: 'Add',
  [HEADER_FOOTER_EMPTY]: 'Fill in at least one header or footer.',
  [HEADER_FOOTER_NOT_A_NUMBER]:
    'Size and margin are numbers of points. Size is at most 1000 and margin at most 500.',
  [HEADER_FOOTER_COMMAND_TITLE]: 'Headers and footers…',
  [BATES_NUMBER_TITLE]: 'Bates numbering',
  [BATES_NUMBER_PREFIX]: 'Prefix',
  [BATES_NUMBER_SUFFIX]: 'Suffix',
  [BATES_NUMBER_START]: 'Start at',
  [BATES_NUMBER_DIGITS]: 'Digits',
  [BATES_NUMBER_PREVIEW]: 'Fill in the fields to see the first number.',
  [BATES_NUMBER_EDGE_HEADER]: 'Top',
  [BATES_NUMBER_EDGE_FOOTER]: 'Bottom',
  [BATES_NUMBER_SLOT_LEFT]: 'Left',
  [BATES_NUMBER_SLOT_CENTRE]: 'Centre',
  [BATES_NUMBER_SLOT_RIGHT]: 'Right',
  [BATES_NUMBER_THIS]: 'This page',
  [BATES_NUMBER_ALL]: 'All pages',
  [BATES_NUMBER_APPLY]: 'Number pages',
  [BATES_NUMBER_NOT_A_NUMBER]:
    'Start is a whole number and digits is between 1 and 12.',
  [BATES_NUMBER_COMMAND_TITLE]: 'Bates numbering…',
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
  // SAYS NOTHING CHANGED FIRST, then what to do. The person clicked delete on a
  // row and the row is still there, so the sentence they need is that the
  // document is untouched — not an explanation of versions, which is ours.
  [PROBLEM_STALE_TARGET]:
    'That list was out of date, so nothing was changed. The document moved on while it was open. The list has been refreshed — have another look and try again.',
  [PROBLEM_INTERNAL]: 'Something went wrong inside Monstera. Your document is unchanged.',
  // A label, not a sentence: the value beside it is an opaque id, and ADR-0009
  // §9 is why it is the only thing about the diagnostic that crosses.
  [PROBLEM_REFERENCE_LABEL]: 'Reference',
};
