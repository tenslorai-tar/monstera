import type {
  AiProviderId,
  CloudProviderId,
  CloudRefusal,
  CloudState,
  OcrLanguage,
  TranslationLanguage,
} from '@monstera/contract';
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
export const REDUCE_MOTION_TITLE = messageKey('setting.appearance-reduce-motion.title');
export const REDUCE_MOTION_DESCRIPTION = messageKey('setting.appearance-reduce-motion.description');
export const THUMBNAIL_SIZE_TITLE = messageKey('setting.viewing-thumbnail-size.title');
export const THUMBNAIL_SIZE_DESCRIPTION = messageKey('setting.viewing-thumbnail-size.description');
export const THUMBNAIL_SIZE_SMALL = messageKey('setting.viewing-thumbnail-size.small');
export const THUMBNAIL_SIZE_MEDIUM = messageKey('setting.viewing-thumbnail-size.medium');
export const THUMBNAIL_SIZE_LARGE = messageKey('setting.viewing-thumbnail-size.large');
/** `appearance.thumbnail-size`'s members, each its own exported key as the other option sets are. */
export const THUMBNAIL_SIZE_OPTION_TITLES = {
  small: THUMBNAIL_SIZE_SMALL,
  medium: THUMBNAIL_SIZE_MEDIUM,
  large: THUMBNAIL_SIZE_LARGE,
} as const;
export const ABOUT_TITLE = messageKey('dialog.about.title');
export const ABOUT_COMMAND_TITLE = messageKey('command.show-about.title');
export const DONATE_TITLE = messageKey('dialog.donate.title');
export const DONATE_COMMAND_TITLE = messageKey('command.donate.title');
export const DONATE_LICENCE = messageKey('dialog.donate.licence');
export const DONATE_WHERE = messageKey('dialog.donate.where');
export const DONATE_OPEN = messageKey('dialog.donate.open');
export const DONATE_LATER = messageKey('dialog.donate.later');
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
export const EXPORT_FORM_DATA_JSON_TITLE = messageKey('command.export-form-data.json');
export const EXPORT_FORM_DATA_XFDF_TITLE = messageKey('command.export-form-data.xfdf');
export const EXPORT_FORM_DATA_FDF_TITLE = messageKey('command.export-form-data.fdf');
export const IMPORT_FORM_DATA_JSON_TITLE = messageKey('command.import-form-data.json');
export const IMPORT_FORM_DATA_XFDF_TITLE = messageKey('command.import-form-data.xfdf');
export const IMPORT_FORM_DATA_FDF_TITLE = messageKey('command.import-form-data.fdf');
export const IMPORT_FORM_DATA_PROBLEM_TITLE = messageKey('dialog.import-form-data.title');
export const IMPORT_FORM_DATA_UNREADABLE = messageKey('dialog.import-form-data.unreadable');
export const IMPORT_FORM_DATA_TOO_LARGE = messageKey('dialog.import-form-data.too-large');
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
export const DESKEW_PAGES_COMMAND_TITLE = messageKey('command.deskew-pages.title');
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
export const IMPORT_PAGE_AS_LAYER_COMMAND_TITLE = messageKey('command.import-page-as-layer.title');
export const IMPORT_PAGE_AS_LAYER_TITLE = messageKey('dialog.import-page-as-layer.title');
export const IMPORT_PAGE_AS_LAYER_LABEL = messageKey('dialog.import-page-as-layer.label');
export const IMPORT_PAGE_AS_LAYER_WHICH = messageKey('dialog.import-page-as-layer.which');
export const IMPORT_PAGE_AS_LAYER_APPLY = messageKey('dialog.import-page-as-layer.apply');
export const EXTRACT_PAGES_COMMAND_TITLE = messageKey('command.extract-pages.title');
export const EDIT_PAGE_EXTERNALLY_COMMAND_TITLE = messageKey('command.edit-page-externally.title');
export const REIMPORT_EXTERNAL_EDIT_TITLE = messageKey('dialog.reimport-external-edit.title');
export const REIMPORT_EXTERNAL_EDIT_SAVED = messageKey('dialog.reimport-external-edit.saved');
export const REIMPORT_EXTERNAL_EDIT_APPLY = messageKey('dialog.reimport-external-edit.apply');
export const EXTERNAL_EDIT_PROBLEM_TITLE = messageKey('dialog.external-edit-problem.title');
export const EXTERNAL_EDIT_PROBLEM_NOT_PDF = messageKey('dialog.external-edit-problem.not-pdf');
export const EXTERNAL_EDIT_PROBLEM_LAUNCH_FAILED = messageKey('dialog.external-edit-problem.launch-failed');
export const EXTERNAL_EDIT_PROBLEM_NOT_WATCHABLE = messageKey('dialog.external-edit-problem.not-watchable');
export const EXTERNAL_EDIT_PROBLEM_DOCUMENT_CHANGED = messageKey(
  'dialog.external-edit-problem.document-changed',
);
export const EXTERNAL_EDIT_PROBLEM_OPEN_ELSEWHERE = messageKey('dialog.external-edit-problem.open-elsewhere');
export const EXTERNAL_EDIT_PROBLEM_ABSENT = messageKey('dialog.external-edit-problem.absent');
export const EXTERNAL_EDIT_PROBLEM_AT_CAPACITY = messageKey('dialog.external-edit-problem.at-capacity');
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
export const EXPORT_PAGE_IMAGES_COMMAND_TITLE = messageKey('command.export-page-images.title');
export const EXPORT_PAGE_IMAGES_TITLE = messageKey('dialog.export-page-images.title');
export const EXPORT_WORD_COMMAND_TITLE = messageKey('command.export-word.title');
export const EXPORT_POWERPOINT_COMMAND_TITLE = messageKey('command.export-powerpoint.title');
export const EXPORT_WORD_TITLE = messageKey('dialog.export-word.title');
export const EXPORT_WORD_MODE = messageKey('dialog.export-word.mode');
export const EXPORT_WORD_RICH = messageKey('dialog.export-word.rich');
export const EXPORT_WORD_LAYOUT = messageKey('dialog.export-word.layout');
export const EXPORT_WORD_TEXT = messageKey('dialog.export-word.text');
export const EXPORT_WORD_APPLY = messageKey('dialog.export-word.apply');
export const EXPORT_PDFA_COMMAND_TITLE = messageKey('command.export-pdfa.title');
export const PDFA_REMOVALS_TITLE = messageKey('dialog.pdfa-removals.title');
export const OPTIMIZE_COMMAND_TITLE = messageKey('command.optimize.title');
export const OPTIMIZE_TITLE = messageKey('dialog.optimize.title');
export const OPTIMIZE_QUALITY = messageKey('dialog.optimize.quality');
export const OPTIMIZE_HIGH = messageKey('dialog.optimize.high');
export const OPTIMIZE_MEDIUM = messageKey('dialog.optimize.medium');
export const OPTIMIZE_LOW = messageKey('dialog.optimize.low');
export const OPTIMIZE_MEASURE = messageKey('dialog.optimize.measure');
export const OPTIMIZE_SIZES = messageKey('dialog.optimize.sizes');
export const OPTIMIZE_NOT_SMALLER = messageKey('dialog.optimize.not-smaller');
export const OPTIMIZE_SAVE = messageKey('dialog.optimize.save');
export const OPTIMIZE_KEEPS = messageKey('dialog.optimize.keeps');
export const PDFA_REMOVALS_SAVED = messageKey('dialog.pdfa-removals.saved');
export const PDFA_REMOVALS_CONVERTER_WORDS = messageKey('dialog.pdfa-removals.converter-words');
export const PDFA_REMOVALS_TAGS = messageKey('dialog.pdfa-removals.tags');
export const PRINT_COMMAND_TITLE = messageKey('command.print.title');
export const EMAIL_COMMAND_TITLE = messageKey('command.email.title');
export const PRINT_TITLE = messageKey('dialog.print.title');
export const PRINT_DPI = messageKey('dialog.print.dpi');
export const PRINT_DPI_150 = messageKey('dialog.print.dpi-150');
export const PRINT_DPI_300 = messageKey('dialog.print.dpi-300');
export const PRINT_DPI_600 = messageKey('dialog.print.dpi-600');
export const PRINT_APPLY = messageKey('dialog.print.apply');
export const GROUP_COMPARE = messageKey('surface.ribbon.group.compare');
export const GROUP_COMMENT_FILES = messageKey('surface.ribbon.group.comment-files');
export const ACCESSIBILITY_COMMAND_TITLE = messageKey('command.accessibility-check.title');
export const ACCESSIBILITY_TITLE = messageKey('dialog.accessibility-check.title');
export const ACCESSIBILITY_SUMMARY = messageKey('dialog.accessibility-check.summary');
export const ACCESSIBILITY_NOT_CONFORMANCE = messageKey('dialog.accessibility-check.not-conformance');
export const ACCESSIBILITY_REFUSED = messageKey('dialog.accessibility-check.refused');
export const ACCESSIBILITY_MACHINE_HEADING = messageKey('dialog.accessibility-check.machine-heading');
export const ACCESSIBILITY_PERSON_HEADING = messageKey('dialog.accessibility-check.person-heading');
export const ACCESSIBILITY_PAGES = messageKey('dialog.accessibility-check.pages');
export const ACCESSIBILITY_VERDICT_PASSED = messageKey('dialog.accessibility-check.verdict.passed');
export const ACCESSIBILITY_VERDICT_FAILED = messageKey('dialog.accessibility-check.verdict.failed');
export const ACCESSIBILITY_VERDICT_NOT_APPLICABLE = messageKey('dialog.accessibility-check.verdict.not-applicable');
export const ACCESSIBILITY_VERDICT_NOT_DETERMINED = messageKey('dialog.accessibility-check.verdict.not-determined');
export const ACCESSIBILITY_RULE_5_1 = messageKey('dialog.accessibility-check.rule.5-1');
export const ACCESSIBILITY_RULE_6_2_1 = messageKey('dialog.accessibility-check.rule.6.2-1');
export const ACCESSIBILITY_RULE_7_1_4 = messageKey('dialog.accessibility-check.rule.7.1-4');
export const ACCESSIBILITY_RULE_7_1_5 = messageKey('dialog.accessibility-check.rule.7.1-5');
export const ACCESSIBILITY_RULE_7_1_8 = messageKey('dialog.accessibility-check.rule.7.1-8');
export const ACCESSIBILITY_RULE_7_1_9 = messageKey('dialog.accessibility-check.rule.7.1-9');
export const ACCESSIBILITY_RULE_7_1_10 = messageKey('dialog.accessibility-check.rule.7.1-10');
export const ACCESSIBILITY_RULE_7_1_11 = messageKey('dialog.accessibility-check.rule.7.1-11');
export const ACCESSIBILITY_RULE_7_3_1 = messageKey('dialog.accessibility-check.rule.7.3-1');
export const ACCESSIBILITY_RULE_7_16_1 = messageKey('dialog.accessibility-check.rule.7.16-1');
export const ACCESSIBILITY_RULE_7_18_1_2 = messageKey('dialog.accessibility-check.rule.7.18.1-2');
export const ACCESSIBILITY_RULE_7_18_1_3 = messageKey('dialog.accessibility-check.rule.7.18.1-3');
export const ACCESSIBILITY_RULE_7_18_3_1 = messageKey('dialog.accessibility-check.rule.7.18.3-1');
export const ACCESSIBILITY_RULE_7_18_5_2 = messageKey('dialog.accessibility-check.rule.7.18.5-2');
export const ACCESSIBILITY_RULE_7_21_4_1_1 = messageKey('dialog.accessibility-check.rule.7.21.4.1-1');
export const ACCESSIBILITY_RULE_UNKNOWN = messageKey('dialog.accessibility-check.rule.unknown');
export const ACCESSIBILITY_HUMAN_READING_ORDER = messageKey('dialog.accessibility-check.human.reading-order');
export const ACCESSIBILITY_HUMAN_ALT_TEXT = messageKey('dialog.accessibility-check.human.alternative-text-meaningful');
export const ACCESSIBILITY_HUMAN_HEADINGS = messageKey('dialog.accessibility-check.human.headings-reflect-structure');
export const ACCESSIBILITY_HUMAN_TABLES = messageKey('dialog.accessibility-check.human.table-headers-correct');
export const ACCESSIBILITY_HUMAN_COLOUR = messageKey('dialog.accessibility-check.human.colour-not-sole-means');
export const ACCESSIBILITY_HUMAN_LANGUAGE = messageKey('dialog.accessibility-check.human.language-of-passages');
export const ACCESSIBILITY_HUMAN_LINKS = messageKey('dialog.accessibility-check.human.link-text-meaningful');
export const EXPORT_ANNOTATIONS_JSON_TITLE = messageKey('command.export-annotations.json');
export const EXPORT_ANNOTATIONS_XFDF_TITLE = messageKey('command.export-annotations.xfdf');
export const EXPORT_ANNOTATIONS_FDF_TITLE = messageKey('command.export-annotations.fdf');
export const IMPORT_ANNOTATIONS_JSON_TITLE = messageKey('command.import-annotations.json');
export const IMPORT_ANNOTATIONS_XFDF_TITLE = messageKey('command.import-annotations.xfdf');
export const IMPORT_ANNOTATIONS_FDF_TITLE = messageKey('command.import-annotations.fdf');
export const IMPORT_ANNOTATIONS_PROBLEM_TITLE = messageKey('dialog.import-annotations.title');
export const IMPORT_ANNOTATIONS_UNREADABLE = messageKey('dialog.import-annotations.unreadable');
export const IMPORT_ANNOTATIONS_TOO_LARGE = messageKey('dialog.import-annotations.too-large');
export const COMPARE_COMMAND_TITLE = messageKey('command.compare-documents.title');
export const COMPARE_PROGRESS = messageKey('task.compare-documents');
export const OPTIMIZE_CHECKING = messageKey('task.optimize-checking');
export const COMPARE_DOCUMENTS_TITLE = messageKey('dialog.compare-documents.title');
export const COMPARE_DOCUMENTS_LABEL = messageKey('dialog.compare-documents.label');
export const COMPARE_DOCUMENTS_APPLY = messageKey('dialog.compare-documents.apply');
export const COMPARE_RESULT_TITLE = messageKey('dialog.compare-result.title');
export const COMPARE_RESULT_NONE = messageKey('dialog.compare-result.none');
export const COMPARE_RESULT_REFUSED = messageKey('dialog.compare-result.refused');
export const COMPARE_RESULT_WHAT = messageKey('dialog.compare-result.what');
export const COMPARE_RESULT_SUMMARY = messageKey('dialog.compare-result.summary');
export const COMPARE_RESULT_PARTIAL = messageKey('dialog.compare-result.partial');
export const COMPARE_RESULT_EXTRA_HERE = messageKey('dialog.compare-result.extra-here');
export const COMPARE_RESULT_EXTRA_OTHER = messageKey('dialog.compare-result.extra-other');
export const COMPARE_RESULT_CLIPPED = messageKey('dialog.compare-result.clipped');
export const COMPARE_RESULT_TRUNCATED = messageKey('dialog.compare-result.truncated');
export const COMPARE_RESULT_PAGE = messageKey('dialog.compare-result.page');
export const COMPARE_RESULT_REMOVED = messageKey('dialog.compare-result.removed');
export const COMPARE_RESULT_ADDED = messageKey('dialog.compare-result.added');
export const READ_BARCODES_COMMAND_TITLE = messageKey('command.read-barcodes.title');
export const PLACE_BARCODE_TOOL_TITLE = messageKey('command.organize.place-barcode');
export const PAGE_BARCODES_TITLE = messageKey('dialog.page-barcodes.title');
export const PAGE_BARCODES_FOUND = messageKey('dialog.page-barcodes.found');
export const PAGE_BARCODES_NONE = messageKey('dialog.page-barcodes.none');
export const PAGE_BARCODES_TRUNCATED = messageKey('dialog.page-barcodes.truncated');
export const PAGE_BARCODES_REFUSED = messageKey('dialog.page-barcodes.refused');
export const PAGE_BARCODES_TYPE = messageKey('dialog.page-barcodes.type');
export const PAGE_BARCODES_CONTENT = messageKey('dialog.page-barcodes.content');
export const PLACE_BARCODE_TITLE = messageKey('dialog.place-barcode.title');
export const PLACE_BARCODE_TEXT = messageKey('dialog.place-barcode.text');
export const PLACE_BARCODE_FORMAT = messageKey('dialog.place-barcode.format');
export const PLACE_BARCODE_QR = messageKey('dialog.place-barcode.qr');
export const PLACE_BARCODE_DATA_MATRIX = messageKey('dialog.place-barcode.data-matrix');
export const PLACE_BARCODE_AZTEC = messageKey('dialog.place-barcode.aztec');
export const PLACE_BARCODE_PDF417 = messageKey('dialog.place-barcode.pdf417');
export const PLACE_BARCODE_CODE128 = messageKey('dialog.place-barcode.code128');
export const PLACE_BARCODE_EAN13 = messageKey('dialog.place-barcode.ean13');
export const PLACE_BARCODE_REFUSED = messageKey('dialog.place-barcode.refused');
export const PLACE_BARCODE_APPLY = messageKey('dialog.place-barcode.apply');
export const EXPORT_EXCEL_COMMAND_TITLE = messageKey('command.export-excel.title');
export const EXPORT_EXCEL_TITLE = messageKey('dialog.export-excel.title');
export const EXPORT_EXCEL_LAYOUT = messageKey('dialog.export-excel.layout');
export const EXPORT_EXCEL_ENGINE = messageKey('dialog.export-excel.engine');
export const EXPORT_EXCEL_ENGINE_AUTOMATIC = messageKey('dialog.export-excel.engine.automatic');
export const EXPORT_EXCEL_ENGINE_AZURE = messageKey('dialog.export-excel.engine.azure');
export const EXPORT_EXCEL_ENGINE_CLAUDE = messageKey('dialog.export-excel.engine.claude');
export const EXPORT_EXCEL_SENDS_AZURE = messageKey('dialog.export-excel.sends.azure');
export const EXPORT_EXCEL_SENDS_CLAUDE = messageKey('dialog.export-excel.sends.claude');
export const EXCEL_SERVICE_REFUSED = messageKey('dialog.service-refused.body');
export const SERVICE_REFUSED_TITLE = messageKey('dialog.service-refused.title');
export const EXPORT_EXCEL_SHEET_PER_PAGE = messageKey('dialog.export-excel.sheet-per-page');
export const EXPORT_EXCEL_ONE_SHEET = messageKey('dialog.export-excel.one-sheet');
export const EXPORT_EXCEL_APPLY = messageKey('dialog.export-excel.apply');
export const EXPORT_EXCEL_PAGE = messageKey('dialog.export-excel.page');
export const EXPORT_EXCEL_PREVIOUS_PAGE = messageKey('dialog.export-excel.previous-page');
export const EXPORT_EXCEL_NEXT_PAGE = messageKey('dialog.export-excel.next-page');
export const EXPORT_EXCEL_NO_TABLES_HERE = messageKey('dialog.export-excel.no-tables-here');
export const EXPORT_EXCEL_TABLE = messageKey('dialog.export-excel.table');
export const EXPORT_EXCEL_CELL = messageKey('dialog.export-excel.cell');
export const EXPORT_EXCEL_CLIPPED = messageKey('dialog.export-excel.clipped');
export const EXPORT_EXCEL_TRUNCATED = messageKey('dialog.export-excel.truncated');
export const EXPORT_PAGE_IMAGES_ALL = messageKey('dialog.export-page-images.all');
export const EXPORT_PAGE_IMAGES_RANGES = messageKey('dialog.export-page-images.ranges');
export const EXPORT_PAGE_IMAGES_LABEL = messageKey('dialog.export-page-images.label');
export const EXPORT_PAGE_IMAGES_EMPTY = messageKey('dialog.export-page-images.empty');
export const EXPORT_PAGE_IMAGES_FORMAT = messageKey('dialog.export-page-images.format');
export const EXPORT_PAGE_IMAGES_PNG = messageKey('dialog.export-page-images.png');
export const EXPORT_PAGE_IMAGES_JPEG = messageKey('dialog.export-page-images.jpeg');
export const EXPORT_PAGE_IMAGES_WEBP = messageKey('dialog.export-page-images.webp');
export const EXPORT_PAGE_IMAGES_DPI = messageKey('dialog.export-page-images.dpi');
export const EXPORT_PAGE_IMAGES_QUALITY = messageKey('dialog.export-page-images.quality');
export const EXPORT_PAGE_IMAGES_OUT_OF_BOUNDS = messageKey('dialog.export-page-images.out-of-bounds');
export const EXPORT_PAGE_IMAGES_FILES = messageKey('dialog.export-page-images.files');
export const EXPORT_TEXT_COMMAND_TITLE = messageKey('command.export-text.title');
export const EXPORT_LAYOUT_TEXT_COMMAND_TITLE = messageKey('command.export-layout-text.title');
export const INSERT_IMAGE_COMMAND_TITLE = messageKey('command.insert-image.title');
export const INSERT_IMAGE_PROBLEM_TITLE = messageKey('dialog.insert-image-problem.title');
export const INSERT_IMAGE_UNREADABLE = messageKey('dialog.insert-image-problem.unreadable');
export const INSERT_IMAGE_TOO_LARGE = messageKey('dialog.insert-image-problem.too-large');
export const INSERT_IMAGE_TOO_MANY_PIXELS = messageKey('dialog.insert-image-problem.too-many-pixels');
/** TOOLS › Create, where D9's import rows land. */
export const GROUP_CREATE = messageKey('surface.ribbon.group.create');
export const NEW_FROM_MARKDOWN_COMMAND_TITLE = messageKey('command.new-from-markdown.title');
export const APPEND_MARKDOWN_COMMAND_TITLE = messageKey('command.append-markdown.title');
export const NEW_FROM_CSV_COMMAND_TITLE = messageKey('command.new-from-csv.title');
export const NEW_FROM_IMAGES_COMMAND_TITLE = messageKey('command.new-from-images.title');
export const OPEN_FROM_URL_COMMAND_TITLE = messageKey('command.open-from-url.title');
export const NEW_FROM_CAMERA_COMMAND_TITLE = messageKey('command.new-from-camera.title');
export const CAMERA_CAPTURE_TITLE = messageKey('dialog.camera-capture.title');
export const CAMERA_CAPTURE_TAKE = messageKey('dialog.camera-capture.take');
export const CAMERA_CAPTURE_DONE = messageKey('dialog.camera-capture.done');
export const CAMERA_CAPTURE_COUNT = messageKey('dialog.camera-capture.count');
export const CAMERA_CAPTURE_PREVIEW = messageKey('dialog.camera-capture.preview');
export const CAMERA_CAPTURE_STARTING = messageKey('dialog.camera-capture.starting');
export const CAMERA_CAPTURE_DENIED = messageKey('dialog.camera-capture.denied');
export const CAMERA_CAPTURE_ABSENT = messageKey('dialog.camera-capture.absent');
export const CAMERA_CAPTURE_FAILED = messageKey('dialog.camera-capture.failed');
export const CAMERA_CAPTURE_FULL = messageKey('dialog.camera-capture.full');
export const OPEN_FROM_URL_TITLE = messageKey('dialog.open-from-url.title');
export const OPEN_FROM_URL_LABEL = messageKey('dialog.open-from-url.label');
export const OPEN_FROM_URL_APPLY = messageKey('dialog.open-from-url.apply');
export const OPEN_FROM_URL_EMPTY = messageKey('dialog.open-from-url.empty');
export const OPEN_FROM_URL_TOO_LONG = messageKey('dialog.open-from-url.too-long');
export const OPEN_FROM_URL_SCHEME = messageKey('dialog.open-from-url.scheme');
export const URL_OPEN_PROBLEM_TITLE = messageKey('dialog.url-open-problem.title');
export const URL_OPEN_NOT_HTTPS = messageKey('dialog.url-open-problem.not-https');
export const URL_OPEN_CREDENTIALS = messageKey('dialog.url-open-problem.credentials');
export const URL_OPEN_BLOCKED_ADDRESS = messageKey('dialog.url-open-problem.blocked-address');
export const URL_OPEN_UNRESOLVABLE = messageKey('dialog.url-open-problem.unresolvable');
export const URL_OPEN_TOO_MANY_REDIRECTS = messageKey('dialog.url-open-problem.too-many-redirects');
export const URL_OPEN_HTTP_ERROR = messageKey('dialog.url-open-problem.http-error');
export const URL_OPEN_UNREACHABLE = messageKey('dialog.url-open-problem.unreachable');
export const URL_OPEN_TOO_LARGE = messageKey('dialog.url-open-problem.too-large');
export const URL_OPEN_NOT_A_PDF = messageKey('dialog.url-open-problem.not-a-pdf');
export const URL_OPEN_CONTESTED = messageKey('dialog.url-open-problem.contested');
export const URL_OPEN_WRITE_FAILED = messageKey('dialog.url-open-problem.write-failed');
export const URL_OPEN_ABSENT = messageKey('dialog.url-open-problem.absent');
export const URL_OPEN_AT_CAPACITY = messageKey('dialog.url-open-problem.at-capacity');
export const MARKDOWN_IMPORT_PROBLEM_TITLE = messageKey('dialog.markdown-import-problem.title');
export const MARKDOWN_IMPORT_UNREADABLE = messageKey('dialog.markdown-import-problem.unreadable');
export const MARKDOWN_IMPORT_TOO_LARGE = messageKey('dialog.markdown-import-problem.too-large');
export const MARKDOWN_IMPORT_NOT_UTF8 = messageKey('dialog.markdown-import-problem.not-utf8');
export const MARKDOWN_IMPORT_UNENCODABLE = messageKey('dialog.markdown-import-problem.unencodable');
export const MARKDOWN_IMPORT_UNENCODABLE_LINE = messageKey(
  'dialog.markdown-import-problem.unencodable-line',
);
export const MARKDOWN_IMPORT_NOTHING_TO_DRAW = messageKey(
  'dialog.markdown-import-problem.nothing-to-draw',
);
export const MARKDOWN_IMPORT_CONTESTED = messageKey('dialog.markdown-import-problem.contested');
export const MARKDOWN_IMPORT_MALFORMED_CSV = messageKey('dialog.markdown-import-problem.malformed-csv');
export const MARKDOWN_IMPORT_TOO_MANY_COLUMNS = messageKey(
  'dialog.markdown-import-problem.too-many-columns',
);
export const MARKDOWN_IMPORT_MALFORMED_CSV_NO_LINE = messageKey(
  'dialog.markdown-import-problem.malformed-csv-no-line',
);
export const MARKDOWN_IMPORT_TOO_MANY_COLUMNS_NO_LINE = messageKey(
  'dialog.markdown-import-problem.too-many-columns-no-line',
);
export const MARKDOWN_IMPORT_WRITE_FAILED = messageKey('dialog.markdown-import-problem.write-failed');
export const MARKDOWN_IMPORT_ABSENT = messageKey('dialog.markdown-import-problem.absent');
export const MARKDOWN_IMPORT_AT_CAPACITY = messageKey('dialog.markdown-import-problem.at-capacity');
export const MARKDOWN_IMPORT_IMAGE_UNREADABLE = messageKey(
  'dialog.markdown-import-problem.image-unreadable',
);
export const MARKDOWN_IMPORT_IMAGE_UNREADABLE_NO_FILE = messageKey(
  'dialog.markdown-import-problem.image-unreadable-no-file',
);
export const MARKDOWN_IMPORT_TOO_MANY_PIXELS = messageKey(
  'dialog.markdown-import-problem.too-many-pixels',
);
export const MARKDOWN_IMPORT_TOO_MANY_PIXELS_NO_FILE = messageKey(
  'dialog.markdown-import-problem.too-many-pixels-no-file',
);
export const MARKDOWN_IMPORT_TOO_MANY_IMAGES = messageKey(
  'dialog.markdown-import-problem.too-many-images',
);
export const MARKDOWN_IMPORT_IMAGES_TOO_LARGE = messageKey(
  'dialog.markdown-import-problem.images-too-large',
);
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
export const WORD_COUNT_COMMAND_TITLE = messageKey('command.word-count.title');
export const WORD_COUNT_TITLE = messageKey('dialog.word-count.title');
export const WORD_COUNT_WORDS_LABEL = messageKey('dialog.word-count.words');
export const WORD_COUNT_CHARACTERS_LABEL = messageKey('dialog.word-count.characters');
export const WORD_COUNT_CHARACTERS_TIGHT_LABEL = messageKey('dialog.word-count.characters-tight');
export const WORD_COUNT_PAGES_LABEL = messageKey('dialog.word-count.pages');
export const WORD_COUNT_PARTIAL = messageKey('dialog.word-count.partial');
export const PAGE_STRUCTURE_COMMAND_TITLE = messageKey('command.page-structure.title');
export const PAGE_STRUCTURE_TITLE = messageKey('dialog.page-structure.title');
export const PAGE_STRUCTURE_PAGE = messageKey('dialog.page-structure.page');
export const PAGE_STRUCTURE_UNTAGGED = messageKey('dialog.page-structure.untagged');
export const PAGE_STRUCTURE_LINES = messageKey('dialog.page-structure.lines');
export const PAGE_STRUCTURE_UNTAGGED_LINES = messageKey('dialog.page-structure.untagged-lines');
export const PAGE_STRUCTURE_IMAGES = messageKey('dialog.page-structure.images');
export const PAGE_STRUCTURE_TRUNCATED = messageKey('dialog.page-structure.truncated');
export const PAGE_STRUCTURE_REFUSED = messageKey('dialog.page-structure.refused');
export const SPELL_CHECK_COMMAND_TITLE = messageKey('command.spell-check.title');
export const SPELL_CHECK_TITLE = messageKey('dialog.spell-check.title');
export const SPELL_CHECK_LANGUAGE = messageKey('dialog.spell-check.language');
export const SPELL_CHECK_LANGUAGE_EN = messageKey('dialog.spell-check.language-en');
export const SPELL_CHECK_CLEAN = messageKey('dialog.spell-check.clean');
export const SPELL_CHECK_UNAVAILABLE = messageKey('dialog.spell-check.unavailable');
export const SPELL_CHECK_PARTIAL = messageKey('dialog.spell-check.partial');
export const SPELL_CHECK_OCCURRENCES = messageKey('dialog.spell-check.occurrences');
export const SPELL_CHECK_FIRST_PAGE = messageKey('dialog.spell-check.first-page');
export const SPELL_CHECK_SUGGESTIONS = messageKey('dialog.spell-check.suggestions');
export const SPELL_CHECK_NO_SUGGESTIONS = messageKey('dialog.spell-check.no-suggestions');
export const SPELL_CHECK_ADD = messageKey('dialog.spell-check.add');
export const SPELL_CHECK_ADDED = messageKey('dialog.spell-check.added');
export const SPELL_CHECK_SAVE = messageKey('dialog.spell-check.save');
export const OCR_COMMAND_TITLE = messageKey('command.ocr.title');
export const OCR_EXPORT_COMMAND_TITLE = messageKey('command.ocr-export.title');
export const ENHANCE_COMMAND_TITLE = messageKey('command.enhance-scans.title');
export const ENHANCE_OUTCOME_TITLE = messageKey('dialog.enhance-outcome.title');
export const ENHANCE_OUTCOME_PAGES = messageKey('dialog.enhance-outcome.pages');
export const ENHANCE_OUTCOME_NONE = messageKey('dialog.enhance-outcome.none');
export const SCAN_COMMAND_TITLE = messageKey('command.straighten-scans.title');
export const SCAN_OUTCOME_TITLE = messageKey('dialog.scan-outcome.title');
export const SCAN_OUTCOME_PAGES = messageKey('dialog.scan-outcome.pages');
export const SCAN_OUTCOME_NONE = messageKey('dialog.scan-outcome.none');
export const OCR_TITLE = messageKey('dialog.ocr.title');
export const OCR_UNAVAILABLE = messageKey('dialog.ocr.unavailable');
export const OCR_LANGUAGE = messageKey('dialog.ocr.language');
export const OCR_THIS_PAGE = messageKey('dialog.ocr.this-page');
export const OCR_ALL_PAGES = messageKey('dialog.ocr.all-pages');
export const OCR_START = messageKey('dialog.ocr.start');
export const OCR_HANDWRITING = messageKey('dialog.ocr.handwriting');
export const OCR_HANDWRITING_READY = messageKey('dialog.ocr.handwriting-ready');
export const EXPORT_EXCEL_SERVICES_NO_KEY = messageKey('dialog.export-excel.services-no-key');
export const OCR_OUTCOME_TITLE = messageKey('dialog.ocr-outcome.title');
export const OCR_OUTCOME_RECOGNISED = messageKey('dialog.ocr-outcome.recognised');
export const OCR_OUTCOME_NONE = messageKey('dialog.ocr-outcome.none');
export const OCR_OUTCOME_SKIPPED = messageKey('dialog.ocr-outcome.skipped');
export const OCR_OUTCOME_STOPPED = messageKey('dialog.ocr-outcome.stopped');
export const OCR_LANGUAGE_ENG = messageKey('dialog.ocr.language-eng');
export const OCR_LANGUAGE_SPA = messageKey('dialog.ocr.language-spa');
export const OCR_LANGUAGE_FRA = messageKey('dialog.ocr.language-fra');
export const OCR_LANGUAGE_DEU = messageKey('dialog.ocr.language-deu');
export const OCR_LANGUAGE_POR = messageKey('dialog.ocr.language-por');
export const OCR_LANGUAGE_ITA = messageKey('dialog.ocr.language-ita');
export const OCR_LANGUAGE_NLD = messageKey('dialog.ocr.language-nld');
export const OCR_LANGUAGE_RUS = messageKey('dialog.ocr.language-rus');
export const OCR_LANGUAGE_ARA = messageKey('dialog.ocr.language-ara');
export const OCR_LANGUAGE_HEB = messageKey('dialog.ocr.language-heb');
export const OCR_LANGUAGE_HIN = messageKey('dialog.ocr.language-hin');
export const OCR_LANGUAGE_JPN = messageKey('dialog.ocr.language-jpn');
export const OCR_LANGUAGE_KOR = messageKey('dialog.ocr.language-kor');
export const OCR_LANGUAGE_CHI_SIM = messageKey('dialog.ocr.language-chi-sim');

/**
 * One title per model, keyed on the model's own name.
 *
 * **Fourteen flat exports and a record over them**, rather than the keys minted
 * inside this object: `en.test.ts` walks this module's exported **strings** to
 * find which catalogue entries are reachable, so a key that exists only inside a
 * record reads to it as an entry no code can ask for. The record is what
 * `OcrBody` indexes — a `switch` over fourteen names in a component would be the
 * mapping table B3a is about — and `satisfies Record<OcrLanguage, …>` is what
 * makes a fifteenth provisioned model a compile error here rather than a blank
 * button.
 */
export const OCR_LANGUAGE_NAMES = {
  eng: OCR_LANGUAGE_ENG,
  spa: OCR_LANGUAGE_SPA,
  fra: OCR_LANGUAGE_FRA,
  deu: OCR_LANGUAGE_DEU,
  por: OCR_LANGUAGE_POR,
  ita: OCR_LANGUAGE_ITA,
  nld: OCR_LANGUAGE_NLD,
  rus: OCR_LANGUAGE_RUS,
  ara: OCR_LANGUAGE_ARA,
  heb: OCR_LANGUAGE_HEB,
  hin: OCR_LANGUAGE_HIN,
  jpn: OCR_LANGUAGE_JPN,
  kor: OCR_LANGUAGE_KOR,
  chi_sim: OCR_LANGUAGE_CHI_SIM,
} as const satisfies Record<OcrLanguage, MessageKey>;
/**
 * Translate page (ADR-0097). The language names are the catalogue's, keyed by the contract's ids, so
 * a twenty-first language is a compile error here rather than a blank option — `OCR_LANGUAGE_NAMES`'
 * shape.
 */
export const TRANSLATE_PAGE_TITLE = messageKey('command.edit.translate-page');
export const RIBBON_TRANSLATE_PAGE = messageKey('command.edit.translate-page.ribbon');
export const TRANSLATE_PAGE_DIALOG_TITLE = messageKey('dialog.translate-page.title');
export const TRANSLATE_PAGE_INTRO = messageKey('dialog.translate-page.intro');
export const TRANSLATE_PAGE_LANGUAGE = messageKey('dialog.translate-page.language');
export const TRANSLATE_PAGE_CHOOSE_LANGUAGE = messageKey('dialog.translate-page.choose-language');
export const TRANSLATE_PAGE_PROVIDER = messageKey('dialog.translate-page.provider');
export const TRANSLATE_PAGE_LIMITS = messageKey('dialog.translate-page.limits');
export const TRANSLATE_PAGE_NO_PROVIDER = messageKey('dialog.translate-page.no-provider');
export const TRANSLATE_PAGE_START = messageKey('dialog.translate-page.start');
export const TRANSLATE_PAGE_PROGRESS = messageKey('task.translate-page');
export const TOAST_PAGE_TRANSLATED = messageKey('toast.page-translated');
export const TOAST_NOTHING_TO_TRANSLATE = messageKey('toast.nothing-to-translate');
export const TOAST_TRANSLATE_REJECTED = messageKey('toast.translate-rejected');
export const TOAST_TRANSLATE_UNREADABLE = messageKey('toast.translate-unreadable');
export const TOAST_TRANSLATE_NO_MODEL = messageKey('toast.translate-no-model');
export const TOAST_TRANSLATE_NOT_WRITABLE = messageKey('toast.translate-not-writable');
// NAMED, one constant each, because the catalogue's reachability check reads exported names — an
// inline `messageKey(…)` in the map below would be an entry no check can see is used.
export const TRANSLATION_LANGUAGE_EN = messageKey('translation.language.en');
export const TRANSLATION_LANGUAGE_FR = messageKey('translation.language.fr');
export const TRANSLATION_LANGUAGE_DE = messageKey('translation.language.de');
export const TRANSLATION_LANGUAGE_ES = messageKey('translation.language.es');
export const TRANSLATION_LANGUAGE_IT = messageKey('translation.language.it');
export const TRANSLATION_LANGUAGE_PT = messageKey('translation.language.pt');
export const TRANSLATION_LANGUAGE_NL = messageKey('translation.language.nl');
export const TRANSLATION_LANGUAGE_CA = messageKey('translation.language.ca');
export const TRANSLATION_LANGUAGE_GL = messageKey('translation.language.gl');
export const TRANSLATION_LANGUAGE_DA = messageKey('translation.language.da');
export const TRANSLATION_LANGUAGE_SV = messageKey('translation.language.sv');
export const TRANSLATION_LANGUAGE_NB = messageKey('translation.language.nb');
export const TRANSLATION_LANGUAGE_FI = messageKey('translation.language.fi');
export const TRANSLATION_LANGUAGE_ET = messageKey('translation.language.et');
export const TRANSLATION_LANGUAGE_IS = messageKey('translation.language.is');
export const TRANSLATION_LANGUAGE_GA = messageKey('translation.language.ga');
export const TRANSLATION_LANGUAGE_AF = messageKey('translation.language.af');
export const TRANSLATION_LANGUAGE_ID = messageKey('translation.language.id');
export const TRANSLATION_LANGUAGE_MS = messageKey('translation.language.ms');
export const TRANSLATION_LANGUAGE_SW = messageKey('translation.language.sw');
export const TRANSLATION_LANGUAGE_NAMES = {
  en: TRANSLATION_LANGUAGE_EN,
  fr: TRANSLATION_LANGUAGE_FR,
  de: TRANSLATION_LANGUAGE_DE,
  es: TRANSLATION_LANGUAGE_ES,
  it: TRANSLATION_LANGUAGE_IT,
  pt: TRANSLATION_LANGUAGE_PT,
  nl: TRANSLATION_LANGUAGE_NL,
  ca: TRANSLATION_LANGUAGE_CA,
  gl: TRANSLATION_LANGUAGE_GL,
  da: TRANSLATION_LANGUAGE_DA,
  sv: TRANSLATION_LANGUAGE_SV,
  nb: TRANSLATION_LANGUAGE_NB,
  fi: TRANSLATION_LANGUAGE_FI,
  et: TRANSLATION_LANGUAGE_ET,
  is: TRANSLATION_LANGUAGE_IS,
  ga: TRANSLATION_LANGUAGE_GA,
  af: TRANSLATION_LANGUAGE_AF,
  id: TRANSLATION_LANGUAGE_ID,
  ms: TRANSLATION_LANGUAGE_MS,
  sw: TRANSLATION_LANGUAGE_SW,
} as const satisfies Record<TranslationLanguage, MessageKey>;
export const EDITING_PERSONAL_DICTIONARY_TITLE = messageKey(
  'setting.editing.personal-dictionary.title',
);
export const EDITING_OCR_LANGUAGE_TITLE = messageKey('setting.editing.ocr-language.title');
export const EDITING_OCR_LANGUAGE_DESCRIPTION = messageKey('setting.editing.ocr-language.description');
export const EDITING_AZURE_ENDPOINT_DESCRIPTION = messageKey('setting.editing.azure-di-endpoint.description');
export const EDITING_AZURE_KEY_DESCRIPTION = messageKey('setting.editing.azure-di-key.description');
export const SECOND_RENDERER_DESCRIPTION = messageKey('setting.viewing.second-renderer.description');
export const EDITING_AZURE_ENDPOINT_TITLE = messageKey('setting.editing.azure-di-endpoint.title');
export const EDITING_AZURE_KEY_TITLE = messageKey('setting.editing.azure-di-key.title');
export const RULER_UNIT_TITLE = messageKey('setting.viewing.ruler-unit.title');
export const SECOND_RENDERER_TITLE = messageKey('setting.viewing.second-renderer.title');
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
export const WINDOW_PROBLEM_TITLE = messageKey('surface.window-problem.title');
export const WINDOW_PROBLEM_BODY = messageKey('surface.window-problem.body');
export const DIALOG_PROBLEM_TITLE = messageKey('surface.dialog-problem.title');
export const DIALOG_PROBLEM_BODY = messageKey('surface.dialog-problem.body');
export const START_TITLE = messageKey('surface.start.title');
export const START_PRODUCT = messageKey('surface.start.product');
export const START_TAGLINE = messageKey('surface.start.tagline');
export const START_VERSION = messageKey('surface.start.version');
export const START_COPYRIGHT = messageKey('surface.start.copyright');
export const START_F1_HINT = messageKey('surface.start.shortcuts-hint');
export const KEYBOARD_SHORTCUTS_TITLE = messageKey('dialog.keyboard-shortcuts.title');
export const KEYBOARD_SHORTCUTS_COMMAND_TITLE = messageKey('command.keyboard-shortcuts.title');
export const SHORTCUTS_COMMAND_HEADER = messageKey('dialog.keyboard-shortcuts.command');
export const SHORTCUTS_CHORD_HEADER = messageKey('dialog.keyboard-shortcuts.chord');
export const FEATURE_ANNOTATE_TITLE = messageKey('command.start-annotate.title');
export const FEATURE_FORMS_TITLE = messageKey('command.start-forms.title');
export const FEATURE_OCR_TITLE = messageKey('command.start-ocr.title');
export const FEATURE_SPLIT_MERGE_TITLE = messageKey('command.start-split-merge.title');
export const FEATURE_ENCRYPT_SIGN_TITLE = messageKey('command.start-encrypt-sign.title');
export const FEATURE_EXPORT_TITLE = messageKey('command.start-export.title');
export const FEATURE_ANNOTATE_SUMMARY = messageKey('command.start-annotate.summary');
export const FEATURE_FORMS_SUMMARY = messageKey('command.start-forms.summary');
export const FEATURE_OCR_SUMMARY = messageKey('command.start-ocr.summary');
export const FEATURE_SPLIT_MERGE_SUMMARY = messageKey('command.start-split-merge.summary');
export const FEATURE_ENCRYPT_SIGN_SUMMARY = messageKey('command.start-encrypt-sign.summary');
export const FEATURE_EXPORT_SUMMARY = messageKey('command.start-export.summary');
export const START_ABSENT = messageKey('surface.start.absent');
export const START_AT_CAPACITY = messageKey('surface.start.at-capacity');
export const START_NO_PATH = messageKey('surface.start.no-path');
export const START_DROP_HINT = messageKey('surface.start.drop-hint');
export const DROP_OVERLAY = messageKey('surface.drop.overlay');
export const PRIVACY_RECENT_PREVIEWS_TITLE = messageKey('setting.privacy.recent-previews.title');
export const PRIVACY_RECENT_PREVIEWS_DESCRIPTION = messageKey('setting.privacy.recent-previews.description');
export const RECENT_HEADING = messageKey('surface.recent.heading');
export const RECENT_CLEAR = messageKey('surface.recent.clear');
export const RECENT_PLACEHOLDER = messageKey('surface.recent.placeholder');
export const RECENT_TODAY = messageKey('surface.recent.today');
export const RECENT_YESTERDAY = messageKey('surface.recent.yesterday');
export const RECENT_IN_DOCUMENTS = messageKey('surface.recent.in-documents');
export const RECENT_IN_DOWNLOADS = messageKey('surface.recent.in-downloads');
export const RECENT_IN_DESKTOP = messageKey('surface.recent.in-desktop');
export const RECENT_WHERE_NESTED = messageKey('surface.recent.where-nested');
export const RECENT_META = messageKey('surface.recent.meta');
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
export const FORMS_LABEL = messageKey('surface.forms.label');
export const FORMS_EMPTY = messageKey('surface.forms.empty');
export const FORMS_UNAVAILABLE = messageKey('surface.forms.unavailable');
export const FORMS_TRUNCATED = messageKey('surface.forms.truncated');
export const FORMS_ROW = messageKey('surface.forms.row');
export const FORMS_GO_TO_PAGE = messageKey('surface.forms.go-to-page');
export const FORMS_READ_ONLY = messageKey('surface.forms.read-only');
export const FORMS_NOT_FILLABLE = messageKey('surface.forms.not-fillable');
export const FORMS_CHOICE_EMPTY = messageKey('surface.forms.choice-empty');
export const FORMS_MANY_VALUES = messageKey('surface.forms.many-values');
export const FLAT_FIELDS_COMMAND_TITLE = messageKey('command.flat-fields.title');
export const FLAT_FIELDS_TITLE = messageKey('dialog.flat-fields.title');
export const FLAT_FIELDS_GUESSED = messageKey('dialog.flat-fields.guessed');
export const FLAT_FIELDS_NONE = messageKey('dialog.flat-fields.none');
export const FLAT_FIELDS_TRUNCATED = messageKey('dialog.flat-fields.truncated');
export const FLAT_FIELDS_ALL_TEXT = messageKey('dialog.flat-fields.all-text');
export const FLAT_FIELDS_ACCEPT = messageKey('dialog.flat-fields.accept');
export const EDIT_TEXT_COMMAND_TITLE = messageKey('command.text.edit');
export const TEXT_EDIT_LAYER_LABEL = messageKey('surface.text-edit.layer');
export const TEXT_EDIT_BLOCK_LABEL = messageKey('surface.text-edit.block');
export const TEXT_EDIT_EDITOR_LABEL = messageKey('surface.text-edit.editor');
export const TEXT_EDIT_NONE = messageKey('surface.text-edit.none');
export const TEXT_EDIT_TRUNCATED = messageKey('surface.text-edit.truncated');
export const TEXT_EDIT_UNADDRESSABLE = messageKey('surface.text-edit.unaddressable');
export const TEXT_EDIT_PROMOTE = messageKey('surface.text-edit.promote');
export const TEXT_EDIT_ROTATED = messageKey('surface.text-edit.rotated');
export const TEXT_EDIT_NOT_WRITABLE = messageKey('surface.text-edit.not-writable');
export const PAGE_IMAGE_ONLY = messageKey('surface.page.image-only');
export const FIND_REPLACE_WITH = messageKey('surface.find.replace-with');
export const FIND_REPLACE_ALL = messageKey('surface.find.replace-all');
export const FIND_REPLACED = messageKey('surface.find.replaced');
export const EDIT_PAGE_OBJECT_TITLE = messageKey('dialog.edit-page-object.title');
export const EDIT_PAGE_OBJECT_EXPLAINS = messageKey('dialog.edit-page-object.explains');
export const EDIT_PAGE_OBJECT_WHICH = messageKey('dialog.edit-page-object.which');
export const EDIT_PAGE_OBJECT_MOVE_X = messageKey('dialog.edit-page-object.move-x');
export const EDIT_PAGE_OBJECT_MOVE_Y = messageKey('dialog.edit-page-object.move-y');
export const EDIT_PAGE_OBJECT_SCALE_X = messageKey('dialog.edit-page-object.scale-x');
export const EDIT_PAGE_OBJECT_SCALE_Y = messageKey('dialog.edit-page-object.scale-y');
export const EDIT_PAGE_OBJECT_PLACE = messageKey('dialog.edit-page-object.place');
export const EDIT_PAGE_OBJECT_COLOUR = messageKey('dialog.edit-page-object.colour');
export const EDIT_PAGE_OBJECT_RECOLOR = messageKey('dialog.edit-page-object.recolor');
export const EDIT_PAGE_OBJECT_NO_FILL = messageKey('dialog.edit-page-object.no-fill');
export const EDIT_PAGE_OBJECT_DELETE = messageKey('dialog.edit-page-object.delete');
export const EDIT_PAGE_OBJECT_NONE = messageKey('dialog.edit-page-object.none');
export const EDIT_PAGE_OBJECT_TRUNCATED = messageKey('dialog.edit-page-object.truncated');
export const EDIT_PAGE_OBJECT_COMMAND_TITLE = messageKey('command.document.edit-page-object');
// UNDER THE DIALOG'S OWN DOMAIN rather than an `object-kind.` one of their own:
// a key's FIRST segment may not carry a hyphen (`KEY_SHAPE`), and the one
// surface that shows these words is this dialog. A domain invented for six
// strings with one reader would be a namespace nothing else joins.
export const OBJECT_KIND_UNKNOWN = messageKey('dialog.edit-page-object.kind-unknown');
export const OBJECT_KIND_TEXT = messageKey('dialog.edit-page-object.kind-text');
export const OBJECT_KIND_PATH = messageKey('dialog.edit-page-object.kind-path');
export const OBJECT_KIND_IMAGE = messageKey('dialog.edit-page-object.kind-image');
export const OBJECT_KIND_SHADING = messageKey('dialog.edit-page-object.kind-shading');
export const OBJECT_KIND_FORM = messageKey('dialog.edit-page-object.kind-form');
export const FORMS_DELETE = messageKey('surface.forms.delete');
export const FORMS_FLATTEN = messageKey('surface.forms.flatten');
export const FORMS_FLATTEN_CONFIRM = messageKey('surface.forms.flatten-confirm');
export const FORM_FIELD_TEXT_TOOL_TITLE = messageKey('command.forms.field-text');
export const FORM_FIELD_CHECKBOX_TOOL_TITLE = messageKey('command.forms.field-checkbox');
export const FORM_FIELD_RADIO_TOOL_TITLE = messageKey('command.forms.field-radio');
export const FORM_FIELD_DROPDOWN_TOOL_TITLE = messageKey('command.forms.field-dropdown');
export const FORM_FIELD_LISTBOX_TOOL_TITLE = messageKey('command.forms.field-listbox');
export const FORM_FIELD_TEXT_TITLE = messageKey('dialog.form-field-text.title');
export const FORM_FIELD_CHECKBOX_TITLE = messageKey('dialog.form-field-checkbox.title');
export const FORM_FIELD_RADIO_TITLE = messageKey('dialog.form-field-radio.title');
export const FORM_FIELD_DROPDOWN_TITLE = messageKey('dialog.form-field-dropdown.title');
export const FORM_FIELD_LISTBOX_TITLE = messageKey('dialog.form-field-listbox.title');
export const FORM_FIELD_TEXT_APPLY = messageKey('dialog.form-field-text.apply');
export const FORM_FIELD_CHECKBOX_APPLY = messageKey('dialog.form-field-checkbox.apply');
export const FORM_FIELD_RADIO_APPLY = messageKey('dialog.form-field-radio.apply');
export const FORM_FIELD_DROPDOWN_APPLY = messageKey('dialog.form-field-dropdown.apply');
export const FORM_FIELD_LISTBOX_APPLY = messageKey('dialog.form-field-listbox.apply');
export const FORM_FIELD_NAME_LABEL = messageKey('dialog.form-field.name');
export const FORM_FIELD_GROUP_LABEL = messageKey('dialog.form-field.group');
export const FORM_FIELD_OPTION_LABEL = messageKey('dialog.form-field.option');
export const FORM_FIELD_OPTIONS_LABEL = messageKey('dialog.form-field.options');
export const FORM_FIELD_ADD_OPTION = messageKey('dialog.form-field.add-option');
export const FORM_FIELD_REMOVE_OPTION = messageKey('dialog.form-field.remove-option');
export const FORM_FIELD_NAME_EMPTY = messageKey('dialog.form-field.name-empty');
export const FORM_FIELD_NAME_TOO_LONG = messageKey('dialog.form-field.name-too-long');
export const FORM_FIELD_NAME_SEGMENT = messageKey('dialog.form-field.name-segment');
export const FORM_FIELD_OPTIONS_EMPTY = messageKey('dialog.form-field.options-empty');
export const FORMS_KIND_TEXT = messageKey('surface.forms.kind.text');
export const FORMS_KIND_CHECKBOX = messageKey('surface.forms.kind.checkbox');
export const FORMS_KIND_RADIO = messageKey('surface.forms.kind.radio');
export const FORMS_KIND_DROPDOWN = messageKey('surface.forms.kind.dropdown');
export const FORMS_KIND_LISTBOX = messageKey('surface.forms.kind.listbox');
export const FORMS_KIND_SIGNATURE = messageKey('surface.forms.kind.signature');
export const FORMS_KIND_BUTTON = messageKey('surface.forms.kind.button');
export const FORMS_KIND_OTHER = messageKey('surface.forms.kind.other');
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
export const SNAPSHOT_TOOL_TITLE = messageKey('command.view.snapshot');
export const PLACE_IMAGE_TOOL_TITLE = messageKey('command.annotate.image');
export const OCR_REGION_TOOL_TITLE = messageKey('command.tools.ocr-region');
export const CLOUD_REGION_TOOL_TITLE = messageKey('command.tools.cloud-region');
export const LINK_ADDRESS_TOOL_TITLE = messageKey('command.annotate.link-address');
export const LINK_PAGE_TOOL_TITLE = messageKey('command.annotate.link-page');
export const DOCUMENT_PASSWORD_TITLE = messageKey('dialog.document-password.title');
export const DOCUMENT_PASSWORD_ASKS = messageKey('dialog.document-password.asks');
export const DOCUMENT_PASSWORD_LABEL = messageKey('dialog.document-password.label');
export const DOCUMENT_PASSWORD_APPLY = messageKey('dialog.document-password.apply');
export const DOCUMENT_PASSWORD_EMPTY = messageKey('dialog.document-password.empty');
export const DOCUMENT_PASSWORD_WRONG = messageKey('dialog.document-password.wrong');
export const DOCUMENT_PASSWORD_TOO_LONG = messageKey('dialog.document-password.too-long');

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
export const SELECTION_PROPERTIES_TITLE = messageKey('command.annotate.properties');
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
export const ANNOTATION_EDIT_TITLE = messageKey('dialog.annotation-edit.title');
export const ANNOTATION_EDIT_LABEL = messageKey('dialog.annotation-edit.label');
export const ANNOTATION_EDIT_APPLY = messageKey('dialog.annotation-edit.apply');
export const ANNOTATION_EDIT_EMPTY = messageKey('dialog.annotation-edit.empty');
export const ANNOTATION_EDIT_TOO_LONG = messageKey('dialog.annotation-edit.too-long');
export const EDIT_SELECTION_TITLE = messageKey('command.annotate.edit-selection');
export const ANNOTATION_REPLY_TITLE = messageKey('dialog.annotation-reply.title');
export const ANNOTATION_REPLY_LABEL = messageKey('dialog.annotation-reply.label');
export const ANNOTATION_REPLY_APPLY = messageKey('dialog.annotation-reply.apply');
export const ANNOTATION_REPLY_EMPTY = messageKey('dialog.annotation-reply.empty');
export const ANNOTATION_REPLY_TOO_LONG = messageKey('dialog.annotation-reply.too-long');
export const REPLY_SELECTION_TITLE = messageKey('command.annotate.reply-selection');
export const ANNOTATIONS_REPLY_ROW = messageKey('panel.annotations.reply-row');
export const TOOL_TEXT_BOX_TITLE = messageKey('command.annotate.text-box');
export const TOOL_STICKY_NOTE_TITLE = messageKey('command.annotate.sticky-note');
export const TOOL_CARET_TITLE = messageKey('command.annotate.caret');
export const EDITING_COLOUR_TITLE = messageKey('setting.editing.annotation-colour');
export const EDITING_AUTHOR_NAME_TITLE = messageKey('setting.editing.author-name');
export const EDITING_AUTHOR_NAME_DESCRIPTION = messageKey('setting.editing.author-name.description');
export const EDITING_OPACITY_TITLE = messageKey('setting.editing.annotation-opacity');
export const EDITING_LINE_WIDTH_TITLE = messageKey('setting.editing.annotation-line-width');
export const EDITING_FONT_SIZE_TITLE = messageKey('setting.editing.annotation-font-size');
export const EDITING_IMAGE_PAGES_TITLE = messageKey('setting.editing.image-pages');
export const STYLE_PANEL_LABEL = messageKey('surface.style.label');
export const COMMENT_STYLES_NO_WIDTH = messageKey('surface.comment-styles.no-width');
export const STYLE_COLOUR_AUTO = messageKey('surface.style.colour-auto');
export const PROPERTIES_AS_DEFAULT = messageKey('surface.properties.as-default');
export const PROPERTIES_AUTHOR = messageKey('surface.properties.author');
export const PROPERTIES_BLEND = messageKey('surface.properties.blend');
export const PROPERTIES_BLEND_MULTIPLY = messageKey('surface.properties.blend.multiply');
export const PROPERTIES_BLEND_NORMAL = messageKey('surface.properties.blend.normal');
export const PROPERTIES_CREATED = messageKey('surface.properties.created');
export const PROPERTIES_COLOUR = messageKey('surface.properties.colour');
export const PROPERTIES_OPACITY = messageKey('surface.properties.opacity');
export const PROPERTIES_OPACITY_VALUE = messageKey('surface.properties.opacity-value');
export const PROPERTIES_LINE_WIDTH = messageKey('surface.properties.line-width');
export const PROPERTIES_WIDTH_VALUE = messageKey('surface.properties.width-value');
export const PROPERTIES_FONT_SIZE = messageKey('surface.properties.font-size');
export const PROPERTIES_COMMENT = messageKey('surface.properties.comment');
export const PROPERTIES_NEW_HEADING = messageKey('surface.properties.new-heading');
export const PROPERTIES_NEW_HINT = messageKey('surface.properties.new-hint');
export const PROPERTIES_WHERE = messageKey('surface.properties.where');
export const PROPERTIES_ACTIONS = messageKey('surface.properties.actions');
export const PROPERTIES_CUSTOM_COLOUR = messageKey('surface.properties.custom-colour');
export const PROPERTIES_COLOUR_YELLOW = messageKey('surface.properties.colour.yellow');
export const PROPERTIES_COLOUR_GREEN = messageKey('surface.properties.colour.green');
export const PROPERTIES_COLOUR_BLUE = messageKey('surface.properties.colour.blue');
export const PROPERTIES_COLOUR_PINK = messageKey('surface.properties.colour.pink');
export const PROPERTIES_COLOUR_ORANGE = messageKey('surface.properties.colour.orange');
export const PROPERTIES_COLOUR_PURPLE = messageKey('surface.properties.colour.purple');
export const PROPERTIES_COLOUR_RED = messageKey('surface.properties.colour.red');
export const PROPERTIES_COLOUR_GREY = messageKey('surface.properties.colour.grey');
export const ANNOTATIONS_KIND_CALLOUT = messageKey('surface.annotations.kind.callout');
export const ANNOTATIONS_KIND_TYPEWRITER = messageKey('surface.annotations.kind.typewriter');
export const ANNOTATIONS_KIND_MEASURE_DISTANCE = messageKey('surface.annotations.kind.measure-distance');
export const ANNOTATIONS_KIND_MEASURE_AREA = messageKey('surface.annotations.kind.measure-area');
export const ANNOTATIONS_KIND_MEASURE_PERIMETER = messageKey('surface.annotations.kind.measure-perimeter');
export const MEASURE_DISTANCE_TOOL_TITLE = messageKey('command.annotate.measure-distance');
export const MEASURE_AREA_TOOL_TITLE = messageKey('command.annotate.measure-area');
export const MEASURE_PERIMETER_TOOL_TITLE = messageKey('command.annotate.measure-perimeter');
export const MEASURE_SCALE_TITLE = messageKey('setting.editing.measure-scale');
export const MEASURE_UNIT_TITLE = messageKey('setting.editing.measure-unit');
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
export const STATUS_PAGE_TOTAL = messageKey('surface.status.page-total');
export const STATUS_NAVIGATION = messageKey('surface.status.navigation');
export const STATUS_ZOOM_GROUP = messageKey('surface.status.zoom-group');
export const STATUS_ZOOM_SLIDER = messageKey('surface.status.zoom-slider');
export const STATUS_CHROME_GROUP = messageKey('surface.status.chrome-group');
/**
 * Where this document stands against its file — the owner's document export draws
 * *"Saved 2 min ago"* in the status bar, and this is the set that sentence needs.
 *
 * **Every one of them is about THIS WINDOW watching a save**, never about the file's own age,
 * which a renderer holding no path could not read (invariant 2).
 */
export const STATUS_SAVED_STATE = messageKey('surface.status.saved-state');
/** v5-02's *"24 pages · 2.4 MB"* in the status bar's document line. */
export const STATUS_PAGES = messageKey('surface.status.pages');
export const STATUS_SIZE_KB = messageKey('surface.status.size-kb');
export const STATUS_SIZE_MB = messageKey('surface.status.size-mb');
export const STATUS_UNSAVED = messageKey('surface.status.unsaved');
export const STATUS_SAVED = messageKey('surface.status.saved');
export const STATUS_SAVED_JUST_NOW = messageKey('surface.status.saved-just-now');
export const STATUS_SAVED_MINUTES = messageKey('surface.status.saved-minutes');
export const STATUS_SAVED_HOURS = messageKey('surface.status.saved-hours');
export const STATUS_SAVED_DAYS = messageKey('surface.status.saved-days');
/** The tab's dot: what a screen reader hears where a sighted reader sees it. */
export const TAB_UNSAVED = messageKey('surface.tabs.unsaved');
/**
 * The WINDOW's title — the taskbar's, Alt+Tab's and a screen reader's name for the window. The
 * product is "Monstera PDF Editor", never "Monstera" alone.
 */
export const WINDOW_TITLE = messageKey('surface.window.title');
export const WINDOW_TITLE_DOCUMENT = messageKey('surface.window.title-document');
export const WINDOW_TITLE_UNSAVED = messageKey('surface.window.title-unsaved');
/** The toast strip's × and the confirmations the save commands raise. */
export const TOAST_DISMISS = messageKey('action.toast-dismiss.label');
export const TOAST_SAVED = messageKey('toast.saved');
export const TOAST_COPY_SAVED = messageKey('toast.copy-saved');
export const TOAST_SMALLER_COPY_SAVED = messageKey('toast.smaller-copy-saved');
export const TOAST_PAGES_SAVED = messageKey('toast.pages-saved');
export const TOAST_SAVED_BACK = messageKey('toast.saved-back');
export const THUMBNAILS_LABEL = messageKey('surface.thumbnails.label');
/**
 * §10.3's document panel: six tabs, each named by its accessible name and tooltip,
 * since the panel has "no separate title row". The option titles are these same keys,
 * so the Settings dialog names a panel the way its tab does.
 */
export const PANEL_PAGES = messageKey('surface.panel.pages');
export const PANEL_BOOKMARKS = messageKey('surface.panel.bookmarks');
export const PANEL_COMMENTS = messageKey('surface.panel.comments');
export const PANEL_FORMS = messageKey('surface.panel.forms');
export const PANEL_LAYERS = messageKey('surface.panel.layers');
export const PANEL_SEARCH = messageKey('surface.panel.search');
export const PANEL_TITLES = {
  pages: PANEL_PAGES,
  bookmarks: PANEL_BOOKMARKS,
  comments: PANEL_COMMENTS,
  forms: PANEL_FORMS,
  layers: PANEL_LAYERS,
  search: PANEL_SEARCH,
} as const;
export const PANEL_STRIP_LABEL = messageKey('surface.panel.strip');
export const PANEL_COLLAPSE = messageKey('surface.panel.collapse');
export const PANEL_REOPEN = messageKey('surface.panel.reopen');
export const DOCUMENT_PANEL_TITLE = messageKey('setting.appearance-document-panel.title');
export const DOCUMENT_PANEL_OPEN_TITLE = messageKey('setting.appearance-document-panel-open.title');
export const DOCUMENT_PANEL_WIDTH_TITLE = messageKey('setting.appearance-document-panel-width.title');
export const PANEL_RESIZE = messageKey('surface.panel.resize');
export const CONTEXT_PANEL_LABEL = messageKey('surface.context-panel.label');
export const CONTEXT_PANEL_RESIZE = messageKey('surface.context-panel.resize');
export const CONTEXT_PANEL_COLLAPSE = messageKey('surface.context-panel.collapse');
export const CONTEXT_PANEL_REOPEN = messageKey('surface.context-panel.reopen');
export const CONTEXT_PANEL_OPEN_TITLE = messageKey('setting.appearance-context-panel-open.title');
export const CONTEXT_PANEL_TAB_TITLE = messageKey('setting.appearance-context-panel-tab.title');
export const CONTEXT_PANEL_TAB_PROPERTIES = messageKey('surface.context-panel.tab-properties');
export const CONTEXT_PANEL_TAB_ASSISTANT = messageKey('surface.context-panel.tab-assistant');
export const CONTEXT_PANEL_TAB_STRIP = messageKey('surface.context-panel.tab-strip');
export const ASSISTANT_PROVIDER_LABEL = messageKey('assistant.provider');
export const ASSISTANT_MODEL_LABEL = messageKey('assistant.model');
export const ASSISTANT_COMPOSER_LABEL = messageKey('assistant.composer');
export const ASSISTANT_CONVERSATION_LABEL = messageKey('assistant.conversation');
export const ASSISTANT_SEND = messageKey('assistant.send');
export const ASSISTANT_STOP = messageKey('assistant.stop');
export const ASSISTANT_REGENERATE = messageKey('assistant.regenerate');
export const OPEN_ASSISTANT_TITLE = messageKey('command.ai.open-assistant.title');
export const ASSISTANT_EDIT = messageKey('assistant.edit');
export const ASSISTANT_EDITING = messageKey('assistant.editing');
export const ASSISTANT_EDIT_CANCEL = messageKey('assistant.edit-cancel');
export const ASSISTANT_COPY = messageKey('assistant.copy');
export const ASSISTANT_COPIED = messageKey('assistant.copied');
export const ASSISTANT_ADD_NOTE = messageKey('assistant.add-note');
export const ASSISTANT_NOTED = messageKey('assistant.noted');
export const ASSISTANT_NEW_CHAT = messageKey('assistant.new-chat');
export const ASSISTANT_CAPTION = messageKey('assistant.caption');
export const ASSISTANT_SCOPE_PAGE = messageKey('assistant.scope.page');
export const ASSISTANT_SCOPE_DOCUMENT = messageKey('assistant.scope.document');
export const ASSISTANT_SCOPE_COMMENTS = messageKey('assistant.scope.comments');
export const ASSISTANT_SCOPE_PICTURE = messageKey('assistant.scope.picture');
export const ASSISTANT_SCOPE_SELECTION = messageKey('assistant.scope.selection');
export const ASSISTANT_SCOPE_COMMENT = messageKey('assistant.scope.comment');
export const ASSISTANT_SCOPE_NOTHING = messageKey('assistant.scope.nothing');
export const ASSISTANT_SCOPE_LEFT = messageKey('assistant.scope.left');
export const ASSISTANT_SCOPE_RIGHT = messageKey('assistant.scope.right');
export const ASSISTANT_SCOPE_BOTH = messageKey('assistant.scope.both');
export const ASSISTANT_YOU = messageKey('assistant.you');
export const ASSISTANT_ASSISTANT = messageKey('assistant.assistant');
export const ASSISTANT_EMPTY = messageKey('assistant.empty');
export const ASSISTANT_ASK = messageKey('assistant.ask-hint');
export const ASSISTANT_NO_KEY = messageKey('assistant.no-key');
export const ASSISTANT_NO_MODELS = messageKey('assistant.no-models');
export const ASSISTANT_PROBLEM_UNAUTHORISED = messageKey('assistant.problem-unauthorised');
export const ASSISTANT_PROBLEM_UNREACHABLE = messageKey('assistant.problem-unreachable');
export const ASSISTANT_PROBLEM_REJECTED = messageKey('assistant.problem-rejected');
/** Anthropic's account out of credit — one sentence for the assistant and Claude recognition alike. */
export const ANTHROPIC_OUT_OF_CREDIT = messageKey('service.anthropic-out-of-credit');
export const ASSISTANT_PROBLEM_UNREADABLE = messageKey('assistant.problem-unreadable');
export const AI_PROVIDER_ANTHROPIC = messageKey('assistant.provider-name.anthropic');
export const AI_PROVIDER_OPENAI = messageKey('assistant.provider-name.openai');
export const AI_PROVIDER_GEMINI = messageKey('assistant.provider-name.gemini');
export const AI_PROVIDER_MISTRAL = messageKey('assistant.provider-name.mistral');
export const AI_PROVIDER_XAI = messageKey('assistant.provider-name.xai');
export const AI_PROVIDER_AZURE_OPENAI = messageKey('assistant.provider-name.azure-openai');
export const AI_PROVIDER_OPENROUTER = messageKey('assistant.provider-name.openrouter');
export const AI_PROVIDER_GROQ = messageKey('assistant.provider-name.groq');
export const AI_PROVIDER_PERPLEXITY = messageKey('assistant.provider-name.perplexity');
export const AI_PROVIDER_DEEPSEEK = messageKey('assistant.provider-name.deepseek');
/**
 * Each provider's name as a person knows it — never the registry's id (ADR-0081).
 * `satisfies` makes an eleventh provider a compile error here rather than a blank option.
 */
export const AI_PROVIDER_NAMES = {
  anthropic: AI_PROVIDER_ANTHROPIC,
  openai: AI_PROVIDER_OPENAI,
  gemini: AI_PROVIDER_GEMINI,
  mistral: AI_PROVIDER_MISTRAL,
  xai: AI_PROVIDER_XAI,
  'azure-openai': AI_PROVIDER_AZURE_OPENAI,
  openrouter: AI_PROVIDER_OPENROUTER,
  groq: AI_PROVIDER_GROQ,
  perplexity: AI_PROVIDER_PERPLEXITY,
  deepseek: AI_PROVIDER_DEEPSEEK,
} as const satisfies Record<AiProviderId, MessageKey>;
export const ASSISTANT_ABOUT_LABEL = messageKey('assistant.about');
export const ASSISTANT_ABOUT_PAGE = messageKey('assistant.about.page');
export const ASSISTANT_ABOUT_DOCUMENT = messageKey('assistant.about.document');
export const ASSISTANT_ABOUT_SELECTION = messageKey('assistant.about.selection');
export const ASSISTANT_ABOUT_COMMENT = messageKey('assistant.about.comment');
export const ASSISTANT_ABOUT_COMMENTS = messageKey('assistant.about.comments');
export const ASSISTANT_ABOUT_PICTURE = messageKey('assistant.about.picture');
export const ASSISTANT_SENT_PICTURE = messageKey('assistant.sent.picture');
export const ASSISTANT_SENT_COMMENTS = messageKey('assistant.sent.comments');
export const ASSISTANT_SENT_COMMENTS_CUT = messageKey('assistant.sent.comments-cut');
export const ASSISTANT_NO_VISION = messageKey('assistant.no-vision');
export const ASSISTANT_PROBLEM_PAGE_TOO_LARGE = messageKey('assistant.problem.page-too-large');
export const ASSISTANT_QUICK_READ_TABLE = messageKey('assistant.quick.read-table');
export const SUMMARISE_COMMENTS_TITLE = messageKey('command.ai.summarise-comments');
export const ASSISTANT_PROMPT_SUMMARISE_COMMENTS = messageKey('assistant.prompt.summarise-comments');
export const GROUP_AI = messageKey('surface.ribbon.group.ai');
export const AI_SETUP_TITLE = messageKey('dialog.ai-setup.title');
export const AI_SETUP_COMMAND_TITLE = messageKey('command.ai.setup');
export const AI_SETUP_INTRO = messageKey('dialog.ai-setup.intro');
export const AI_SETUP_PROVIDER = messageKey('dialog.ai-setup.provider');
export const AI_SETUP_KEY = messageKey('dialog.ai-setup.key');
export const AI_SETUP_ENDPOINT = messageKey('dialog.ai-setup.endpoint');
export const AI_SETUP_CHECK = messageKey('dialog.ai-setup.check');
export const AI_SETUP_SKIP = messageKey('dialog.ai-setup.skip');
export const AI_SETUP_STORAGE_UNAVAILABLE = messageKey('dialog.ai-setup.storage-unavailable');
export const AI_SETUP_UNAUTHORISED = messageKey('dialog.ai-setup.unauthorised');
export const AI_SETUP_UNREACHABLE = messageKey('dialog.ai-setup.unreachable');
export const AI_SETUP_REJECTED = messageKey('dialog.ai-setup.rejected');
export const AI_SETUP_UNREADABLE = messageKey('dialog.ai-setup.unreadable');
export const AI_SETUP_NOT_STORED = messageKey('dialog.ai-setup.not-stored');
export const AI_SETUP_AT_START_TITLE = messageKey('setting.ai.setup-at-start.title');
export const AI_SAVE_HISTORY_TITLE = messageKey('setting.ai.save-history.title');
export const ASSISTANT_ABOUT_NOTHING = messageKey('assistant.about.nothing');
export const ASSISTANT_ABOUT_SENDS = messageKey('assistant.about.sends');
export const ASSISTANT_SENT_PAGE = messageKey('assistant.sent.page');
export const ASSISTANT_SENT_PAGES = messageKey('assistant.sent.pages');
export const ASSISTANT_SENT_CUT = messageKey('assistant.sent.cut');
export const ASSISTANT_SENT_NOTHING = messageKey('assistant.sent.nothing');
export const ASSISTANT_CITATION = messageKey('assistant.citation');
export const ASSISTANT_SIDES_LABEL = messageKey('assistant.sides');
export const ASSISTANT_SIDE_LEFT = messageKey('assistant.sides.left');
export const ASSISTANT_SIDE_RIGHT = messageKey('assistant.sides.right');
export const ASSISTANT_SIDE_BOTH = messageKey('assistant.sides.both');
export const ASSISTANT_SIDES_NEEDED = messageKey('assistant.sides.needed');
export const ASSISTANT_SENT_LEFT = messageKey('assistant.sent.left');
export const ASSISTANT_SENT_RIGHT = messageKey('assistant.sent.right');
export const ASSISTANT_CITATION_RIGHT = messageKey('assistant.citation.right');
export const ASSISTANT_QUICK_LABEL = messageKey('assistant.quick');
export const ASSISTANT_QUICK_SUMMARISE = messageKey('assistant.quick.summarise');
export const ASSISTANT_QUICK_DATES = messageKey('assistant.quick.dates');
export const ASSISTANT_QUICK_EXPLAIN_PAGE = messageKey('assistant.quick.explain-page');
export const ASK_AI_SELECTION_TITLE = messageKey('command.ai.ask-selection');
export const EXPLAIN_SELECTION_TITLE = messageKey('command.ai.explain-selection');
export const SUMMARISE_SELECTION_TITLE = messageKey('command.ai.summarise-selection');
export const TRANSLATE_SELECTION_TITLE = messageKey('command.ai.translate-selection');
export const DRAFT_REPLY_TITLE = messageKey('command.ai.draft-reply');
export const ASSISTANT_PROMPT_EXPLAIN = messageKey('assistant.prompt.explain');
export const ASSISTANT_PROMPT_SUMMARISE = messageKey('assistant.prompt.summarise');
export const ASSISTANT_PROMPT_TRANSLATE = messageKey('assistant.prompt.translate');
export const ASSISTANT_PROMPT_DRAFT_REPLY = messageKey('assistant.prompt.draft-reply');
export const ASSISTANT_POST_REPLY = messageKey('assistant.post-reply');
export const CONTEXT_PANEL_TAB_TITLES = {
  properties: CONTEXT_PANEL_TAB_PROPERTIES,
  assistant: CONTEXT_PANEL_TAB_ASSISTANT,
} as const;
export const QUICK_TOOLBAR_OPEN_TITLE = messageKey('setting.appearance-quick-toolbar-open.title');
export const QUICK_TOOLBAR_EDGE_TITLE = messageKey('setting.appearance-quick-toolbar-edge.title');
export const QUICK_TOOLBAR_EDGE_START = messageKey('setting.appearance-quick-toolbar-edge.start');
export const QUICK_TOOLBAR_EDGE_END = messageKey('setting.appearance-quick-toolbar-edge.end');
export const QUICK_TOOLBAR_EDGE_TITLES = {
  start: QUICK_TOOLBAR_EDGE_START,
  end: QUICK_TOOLBAR_EDGE_END,
} as const;
export const QUICK_TOOLBAR_TOGGLE_TITLE = messageKey('command.toggle-quick-toolbar.title');
export const DOCUMENT_PANEL_TOGGLE_TITLE = messageKey('command.toggle-panel.title');
export const CONTEXT_PANEL_TOGGLE_TITLE = messageKey('command.toggle-context-panel.title');
export const CONTEXT_PANEL_WIDTH_TITLE = messageKey('setting.appearance-context-panel-width.title');
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
export const SETTINGS_SECRET_NOT_STORED = messageKey('dialog.settings-problem.secret-not-stored');
export const SETTINGS_COMMAND_TITLE = messageKey('command.show-settings.title');
export const SETTINGS_TITLE = messageKey('dialog.settings.title');
export const SETTINGS_SAVE = messageKey('dialog.settings.save');
export const SETTINGS_INVALID = messageKey('dialog.settings.invalid');
export const SETTINGS_SECRET_STORED = messageKey('dialog.settings.secret-stored');
export const SETTINGS_SECRET_PLACEHOLDER = messageKey('dialog.settings.secret-placeholder');
export const SETTINGS_SECRET_REMOVE = messageKey('dialog.settings.secret-remove');
export const SETTINGS_SECRET_UNAVAILABLE = messageKey('dialog.settings.secret-unavailable');
// EACH MEMBER IS ITS OWN EXPORTED KEY, and the records below name them: the
// catalogue's reachability case finds keys by their exports, so a key minted
// inside a record is one it reports as an orphan — `OCR_LANGUAGE_NAMES`' shape.
export const SETTINGS_CATEGORY_GENERAL = messageKey('dialog.settings.category.general');
export const SETTINGS_CATEGORY_APPEARANCE = messageKey('dialog.settings.category.appearance');
export const SETTINGS_CATEGORY_VIEWING = messageKey('dialog.settings.category.viewing');
export const SETTINGS_CATEGORY_EDITING = messageKey('dialog.settings.category.editing');
export const SETTINGS_CATEGORY_PRIVACY = messageKey('dialog.settings.category.privacy');
export const SETTINGS_CATEGORY_ADVANCED = messageKey('dialog.settings.category.advanced');
export const SETTINGS_CATEGORY_RENDERING = messageKey('dialog.settings.category.rendering');
export const SETTINGS_SEARCH = messageKey('dialog.settings.search');
export const THEME_DESCRIPTION = messageKey('setting.appearance.theme.description');
export const LAYOUT_MODE_DESCRIPTION = messageKey('setting.appearance.layout-mode.description');
export const RULERS_DESCRIPTION = messageKey('setting.viewing.rulers.description');
export const DARK_PAGE_DESCRIPTION = messageKey('setting.viewing.dark-page.description');
export const LOUPE_DESCRIPTION = messageKey('setting.viewing.loupe.description');
export const GRID_DESCRIPTION = messageKey('setting.viewing.grid.description');
export const RULER_UNIT_DESCRIPTION = messageKey('setting.viewing.ruler-unit.description');
export const AI_SETUP_AT_START_DESCRIPTION = messageKey('setting.ai.setup-at-start.description');
export const AI_SAVE_HISTORY_DESCRIPTION = messageKey('setting.ai.save-history.description');
export const AI_AZURE_OPENAI_ENDPOINT_DESCRIPTION = messageKey('setting.ai.azure-openai-endpoint.description');
export const INTEGRATIONS_DOCUSIGN_KEY_DESCRIPTION = messageKey('setting.integrations.docusign-key.description');
export const INTEGRATIONS_DOCUSIGN_ENVIRONMENT_DESCRIPTION = messageKey('setting.integrations.docusign-environment.description');
export const ACCENT_PRESET_THEME = messageKey('setting.accent.preset.theme');
export const ACCENT_PRESET_GREEN = messageKey('setting.accent.preset.green');
export const ACCENT_PRESET_BLUE = messageKey('setting.accent.preset.blue');
export const ACCENT_PRESET_VIOLET = messageKey('setting.accent.preset.violet');
export const ACCENT_PRESET_ORANGE = messageKey('setting.accent.preset.orange');
export const ACCENT_REJECTED = messageKey('setting.accent.rejected');
export const ACCENT_DESCRIPTION = messageKey('setting.accent.description');
export const SETTINGS_PAGES_LABEL = messageKey('dialog.settings.pages-label');
export const SETTINGS_NO_MATCH = messageKey('dialog.settings.no-match');
export const SETTINGS_FOOTER_NOTE = messageKey('dialog.settings.footer-note');
export const SETTINGS_EXPORT = messageKey('dialog.settings.export');
export const SETTINGS_RESET = messageKey('dialog.settings.reset');
export const SETTINGS_DONE = messageKey('dialog.settings.done');
export const SETTINGS_AI_PROVIDER = messageKey('dialog.settings.ai-provider');
export const SETTINGS_AI_PROVIDER_DESCRIPTION = messageKey('dialog.settings.ai-provider.description');
export const SETTINGS_AI_PROVIDER_STORED = messageKey('dialog.settings.ai-provider.stored');
export const SETTINGS_ACTION_CLEAR_HISTORY = messageKey('dialog.settings.clear-history');
export const SETTINGS_ACTION_CLEAR_HISTORY_DESCRIPTION = messageKey('dialog.settings.clear-history.description');
export const SETTINGS_ACTION_CLEARED = messageKey('dialog.settings.clear-history.done');
export const SETTINGS_KEYBOARD_NOTE = messageKey('dialog.settings.keyboard-note');
export const SETTINGS_UPDATES_NOTE = messageKey('dialog.settings.updates-note');
export const SETTINGS_APPEARANCE_NOTE = messageKey('dialog.settings.appearance-note');
export const SETTINGS_VIEWING_NOTE = messageKey('dialog.settings.viewing-note');
export const SETTINGS_RENDERING_NOTE = messageKey('dialog.settings.rendering-note');
export const SETTINGS_EDITING_NOTE = messageKey('dialog.settings.editing-note');
export const SETTINGS_OCR_NOTE = messageKey('dialog.settings.ocr-note');
export const SETTINGS_AI_NOTE = messageKey('dialog.settings.ai-note');
export const SETTINGS_INTEGRATIONS_NOTE = messageKey('dialog.settings.integrations-note');
export const SETTINGS_PRIVACY_NOTE = messageKey('dialog.settings.privacy-note');
export const SETTINGS_CATEGORY_SAVING = messageKey('dialog.settings.category.saving');
export const SETTINGS_CATEGORY_OCR = messageKey('dialog.settings.category.ocr');
export const SETTINGS_CATEGORY_KEYBOARD = messageKey('dialog.settings.category.keyboard');
export const SETTINGS_CATEGORY_UPDATES = messageKey('dialog.settings.category.updates');
export const THEME_SYSTEM_TITLE = messageKey('setting.appearance-theme.system');
export const THEME_LIGHT_TITLE = messageKey('setting.appearance-theme.light');
export const THEME_DARK_TITLE = messageKey('setting.appearance-theme.dark');
export const LAYOUT_MODE_TITLE = messageKey('setting.appearance-layout-mode.title');
export const LAYOUT_MODE_RIBBON = messageKey('setting.appearance-layout-mode.ribbon');
export const LAYOUT_MODE_STUDIO = messageKey('setting.appearance-layout-mode.studio');
export const LAYOUT_MODE_FOCUS = messageKey('setting.appearance-layout-mode.focus');
export const LAYOUT_RIBBON_COMMAND_TITLE = messageKey('command.layout-ribbon.title');
export const LAYOUT_STUDIO_COMMAND_TITLE = messageKey('command.layout-studio.title');
export const LAYOUT_FOCUS_COMMAND_TITLE = messageKey('command.layout-focus.title');
export const LEAVE_FOCUS_COMMAND_TITLE = messageKey('command.leave-focus.title');
export const UNIT_PT_TITLE = messageKey('setting.unit.pt');
export const UNIT_MM_TITLE = messageKey('setting.unit.mm');
export const UNIT_CM_TITLE = messageKey('setting.unit.cm');
export const UNIT_M_TITLE = messageKey('setting.unit.m');
export const UNIT_IN_TITLE = messageKey('setting.unit.in');
export const UNIT_FT_TITLE = messageKey('setting.unit.ft');
export const IMAGE_PAGES_THIS_TITLE = messageKey('setting.editing.image-pages.this');
export const IMAGE_PAGES_ALL_TITLE = messageKey('setting.editing.image-pages.all');
export const SETTINGS_CATEGORY_AI = messageKey('dialog.settings.category.ai');
export const AI_ANTHROPIC_KEY_TITLE = messageKey('setting.ai.anthropic-key.title');
export const AI_OPENAI_KEY_TITLE = messageKey('setting.ai.openai-key.title');
export const AI_GEMINI_KEY_TITLE = messageKey('setting.ai.gemini-key.title');
export const AI_MISTRAL_KEY_TITLE = messageKey('setting.ai.mistral-key.title');
export const AI_XAI_KEY_TITLE = messageKey('setting.ai.xai-key.title');
export const AI_AZURE_OPENAI_KEY_TITLE = messageKey('setting.ai.azure-openai-key.title');
export const AI_AZURE_OPENAI_ENDPOINT_TITLE = messageKey('setting.ai.azure-openai-endpoint.title');
export const AI_OPENROUTER_KEY_TITLE = messageKey('setting.ai.openrouter-key.title');
export const AI_GROQ_KEY_TITLE = messageKey('setting.ai.groq-key.title');
export const AI_PERPLEXITY_KEY_TITLE = messageKey('setting.ai.perplexity-key.title');
export const AI_DEEPSEEK_KEY_TITLE = messageKey('setting.ai.deepseek-key.title');
export const CLAUDE_REGION_TOOL_TITLE = messageKey('command.annotate.claude-region');
/** Each registered category's heading in the Settings dialog. */
export const SETTINGS_CATEGORY_INTEGRATIONS = messageKey('dialog.settings.category.integrations');
export const INTEGRATIONS_DOCUSIGN_KEY_TITLE = messageKey('setting.integrations.docusign-key.title');
export const DOCUSIGN_SEND_COMMAND_TITLE = messageKey('command.docusign-send.title');
export const DOCUSIGN_RETRIEVE_COMMAND_TITLE = messageKey('command.docusign-retrieve.title');
export const DOCUSIGN_SEND_TITLE = messageKey('dialog.docusign-send.title');
export const DOCUSIGN_SEND_SUBJECT = messageKey('dialog.docusign-send.subject');
export const DOCUSIGN_SEND_SIGNER_NAME = messageKey('dialog.docusign-send.signer-name');
export const DOCUSIGN_SEND_SIGNER_EMAIL = messageKey('dialog.docusign-send.signer-email');
export const DOCUSIGN_SEND_ADD_SIGNER = messageKey('dialog.docusign-send.add-signer');
export const DOCUSIGN_SEND_REMOVE_SIGNER = messageKey('dialog.docusign-send.remove-signer');
export const DOCUSIGN_SEND_NOTE = messageKey('dialog.docusign-send.note');
export const DOCUSIGN_SEND_APPLY = messageKey('dialog.docusign-send.apply');
export const DOCUSIGN_NOTICE_TITLE = messageKey('dialog.docusign-notice.title');
export const DOCUSIGN_NOTICE_NO_INTEGRATION_KEY = messageKey('dialog.docusign-notice.no-integration-key');
export const DOCUSIGN_NOTICE_SECRETS_UNAVAILABLE = messageKey('dialog.docusign-notice.secrets-unavailable');
export const DOCUSIGN_NOTICE_SIGN_IN_CANCELLED = messageKey('dialog.docusign-notice.sign-in-cancelled');
export const DOCUSIGN_NOTICE_SIGN_IN_TIMED_OUT = messageKey('dialog.docusign-notice.sign-in-timed-out');
export const DOCUSIGN_NOTICE_SIGN_IN_DENIED = messageKey('dialog.docusign-notice.sign-in-denied');
export const DOCUSIGN_NOTICE_SIGN_IN_UNAVAILABLE = messageKey('dialog.docusign-notice.sign-in-unavailable');
export const DOCUSIGN_NOTICE_UNAUTHORISED = messageKey('dialog.docusign-notice.unauthorised');
export const DOCUSIGN_NOTICE_REJECTED = messageKey('dialog.docusign-notice.rejected');
export const DOCUSIGN_NOTICE_UNREACHABLE = messageKey('dialog.docusign-notice.unreachable');
export const DOCUSIGN_NOTICE_UNEXPECTED_ANSWER = messageKey('dialog.docusign-notice.unexpected-answer');
export const DOCUSIGN_NOTICE_NO_ACCOUNT = messageKey('dialog.docusign-notice.no-account');
export const DOCUSIGN_NOTICE_SENT = messageKey('dialog.docusign-notice.sent');
export const DOCUSIGN_NOTICE_NOTHING_SENT = messageKey('dialog.docusign-notice.nothing-sent');
export const DOCUSIGN_NOTICE_NOT_COMPLETED = messageKey('dialog.docusign-notice.not-completed');
export const INTEGRATIONS_DOCUSIGN_ENVIRONMENT_TITLE = messageKey(
  'setting.integrations.docusign-environment.title',
);
export const DOCUSIGN_ENVIRONMENT_PRODUCTION_TITLE = messageKey(
  'setting.integrations.docusign-environment.production',
);
export const DOCUSIGN_ENVIRONMENT_DEMO_TITLE = messageKey(
  'setting.integrations.docusign-environment.demo',
);
/** Each DocuSign environment's title, keyed on the contract's list. */
export const DOCUSIGN_ENVIRONMENT_TITLES = {
  production: DOCUSIGN_ENVIRONMENT_PRODUCTION_TITLE,
  demo: DOCUSIGN_ENVIRONMENT_DEMO_TITLE,
} as const;

export const SETTINGS_CATEGORY_TITLES = {
  general: SETTINGS_CATEGORY_GENERAL,
  appearance: SETTINGS_CATEGORY_APPEARANCE,
  viewing: SETTINGS_CATEGORY_VIEWING,
  rendering: SETTINGS_CATEGORY_RENDERING,
  editing: SETTINGS_CATEGORY_EDITING,
  saving: SETTINGS_CATEGORY_SAVING,
  ocr: SETTINGS_CATEGORY_OCR,
  ai: SETTINGS_CATEGORY_AI,
  integrations: SETTINGS_CATEGORY_INTEGRATIONS,
  keyboard: SETTINGS_CATEGORY_KEYBOARD,
  privacy: SETTINGS_CATEGORY_PRIVACY,
  updates: SETTINGS_CATEGORY_UPDATES,
  advanced: SETTINGS_CATEGORY_ADVANCED,
} as const;
/** `appearance.theme`'s members, by the word a person reads (ADR-0056). */
export const THEME_OPTION_TITLES = {
  system: THEME_SYSTEM_TITLE,
  light: THEME_LIGHT_TITLE,
  dark: THEME_DARK_TITLE,
} as const;
/** `appearance.layout-mode`'s members, by the word a person reads (§10.3's three chrome modes). */
export const LAYOUT_MODE_OPTION_TITLES = {
  ribbon: LAYOUT_MODE_RIBBON,
  studio: LAYOUT_MODE_STUDIO,
  focus: LAYOUT_MODE_FOCUS,
} as const;
/**
 * Every unit a setting offers, once. The ruler's three are a subset of the
 * measurement's six, so both settings take their titles from here rather than
 * each naming *centimetres* for itself.
 */
export const UNIT_TITLES = {
  pt: UNIT_PT_TITLE,
  mm: UNIT_MM_TITLE,
  cm: UNIT_CM_TITLE,
  m: UNIT_M_TITLE,
  in: UNIT_IN_TITLE,
  ft: UNIT_FT_TITLE,
} as const;
/** `editing.image-pages`' members. */
export const IMAGE_PAGES_TITLES = {
  this: IMAGE_PAGES_THIS_TITLE,
  all: IMAGE_PAGES_ALL_TITLE,
} as const;
export const FIND_LABEL = messageKey('surface.find.label');
export const FIND_SUBMIT = messageKey('surface.find.submit');
export const FIND_MATCHES = messageKey('surface.find.matches');
export const FIND_EMPTY = messageKey('surface.find.empty');
export const FIND_TRUNCATED = messageKey('surface.find.truncated');
export const FIND_REFUSED = messageKey('surface.find.refused');
export const UNDO_TITLE = messageKey('command.undo.title');
export const REDO_TITLE = messageKey('command.redo.title');
export const SAVE_TITLE = messageKey('command.save.title');
export const DOCUMENT_TOOLS_LABEL = messageKey('surface.quick-toolbar.label');

/**
 * The ribbon's own names: the rail, the tool area, the eight sections, and the
 * captions of the groups commands declare themselves into.
 *
 * The group captions are keys because a ribbon placement's `group` is a
 * `MessageKey` (§7, amended 2026-09-08): the caption is on screen, so it is a
 * visible string and belongs in a catalogue like every other. They are grouped
 * here rather than beside the commands that use them because several commands
 * from different files share one group, which is the whole point of a group.
 */
export const RIBBON_RAIL_LABEL = messageKey('surface.ribbon.rail');
export const RIBBON_TOOLS_LABEL = messageKey('surface.ribbon.tools');
export const RIBBON_MORE = messageKey('surface.ribbon.more');
export const SECTION_HOME = messageKey('surface.ribbon.section.home');
export const SECTION_COMMENT = messageKey('surface.ribbon.section.comment');
export const SECTION_EDIT = messageKey('surface.ribbon.section.edit');
export const SECTION_ORGANIZE = messageKey('surface.ribbon.section.organize');
export const SECTION_FORMS = messageKey('surface.ribbon.section.forms');
export const SECTION_REVIEW = messageKey('surface.ribbon.section.review');
export const SECTION_PROTECT = messageKey('surface.ribbon.section.protect');
export const SECTION_TOOLS = messageKey('surface.ribbon.section.tools');
export const RIBBON_SECTION_TITLE = messageKey('setting.appearance-ribbon-section.title');
/**
 * `appearance.ribbon-section`'s members, by the word the rail already shows. Declared AFTER the section keys it names,
 * because a module-scope object reads its members when the module evaluates.
 */
export const RIBBON_SECTION_OPTION_TITLES = {
  home: SECTION_HOME,
  comment: SECTION_COMMENT,
  edit: SECTION_EDIT,
  organize: SECTION_ORGANIZE,
  forms: SECTION_FORMS,
  review: SECTION_REVIEW,
  protect: SECTION_PROTECT,
  tools: SECTION_TOOLS,
} as const;

export const GROUP_FILE = messageKey('surface.ribbon.group.file');
export const GROUP_FIND = messageKey('surface.ribbon.group.find');
export const GROUP_PAGES = messageKey('surface.ribbon.group.pages');
export const GROUP_MARKS = messageKey('surface.ribbon.group.marks');
export const GROUP_TEXT = messageKey('surface.ribbon.group.text');
export const GROUP_PROOFING = messageKey('surface.ribbon.group.proofing');
export const GROUP_MARKUP = messageKey('surface.ribbon.group.markup');
export const GROUP_SHAPES = messageKey('surface.ribbon.group.shapes');
export const GROUP_STAMPS = messageKey('surface.ribbon.group.stamps');
export const GROUP_MEASURE = messageKey('surface.ribbon.group.measure');
export const GROUP_LINKS = messageKey('surface.ribbon.group.links');
export const GROUP_LANGUAGE = messageKey('surface.ribbon.group.language');
export const SHOW_COMMENTS_TITLE = messageKey('command.view.show-comments');
export const SHOW_FIELDS_TITLE = messageKey('command.view.show-fields');
export const MOVE_PAGE_EARLIER_TITLE = messageKey('command.document.move-page-earlier');
export const MOVE_PAGE_LATER_TITLE = messageKey('command.document.move-page-later');
export const GROUP_FIELDS = messageKey('surface.ribbon.group.fields');
/** The owner's v5 groups (ADR-0098): Home's Quick tools and Export, Organize's Combine and Adjust, Forms' Manage and Data. */
export const GROUP_QUICK_TOOLS = messageKey('surface.ribbon.group.quick-tools');
/** v5-02's Home › Export captions: *Share* is Email (the owner's mapping), *Open* the open command. */
export const RIBBON_SHARE = messageKey('surface.ribbon.share');
export const RIBBON_OPEN = messageKey('surface.ribbon.open');
/** v5-02's Home › Quick tools captions, the short forms of the tools' full names. */
export const RIBBON_SELECT = messageKey('surface.ribbon.select');
export const RIBBON_HIGHLIGHT = messageKey('surface.ribbon.highlight');
export const RIBBON_COMMENT = messageKey('surface.ribbon.comment');
/** §10.3's hand and text-selection tools, v5-02's *Hand* and *Text*. */
export const HAND_TOOL_TITLE = messageKey('command.hand-tool.title');
export const RIBBON_HAND = messageKey('surface.ribbon.hand');
export const SELECT_TEXT_TITLE = messageKey('command.select-text.title');
export const RIBBON_TEXT = messageKey('surface.ribbon.text');
/** v5-02's Home › Display caption for Compare documents. */
export const RIBBON_COMPARE = messageKey('surface.ribbon.compare');
/** v5-08's Forms captions: the Data menus (ADR-0101), Detect, and Flatten. */
export const RIBBON_FORM_DATA_EXPORT = messageKey('surface.ribbon.form-data-export');
export const RIBBON_FORM_DATA_IMPORT = messageKey('surface.ribbon.form-data-import');
export const RIBBON_DETECT_FIELDS = messageKey('surface.ribbon.detect-fields');
export const RIBBON_FLATTEN_FORM = messageKey('surface.ribbon.flatten-form');
export const GROUP_EXPORT = messageKey('surface.ribbon.group.export');
export const GROUP_COMBINE = messageKey('surface.ribbon.group.combine');
export const GROUP_ADJUST = messageKey('surface.ribbon.group.adjust');
export const GROUP_MANAGE = messageKey('surface.ribbon.group.manage');
export const GROUP_DATA = messageKey('surface.ribbon.group.data');
export const GROUP_DISPLAY = messageKey('surface.ribbon.group.display');
export const GROUP_NAVIGATE = messageKey('surface.ribbon.group.navigate');
export const GROUP_APPLICATION = messageKey('surface.ribbon.group.application');
/** TOOLS › OCR, which `BUILD-PROMPT.md`:472 names as D6's ribbon placement. */
export const GROUP_OCR = messageKey('surface.ribbon.group.ocr');
/** REVIEW › Accessibility, where D8's reading-order inspection sits. */
export const GROUP_ACCESSIBILITY = messageKey('surface.ribbon.group.accessibility');

/** PROTECT › Encryption, where Stage 7's password rows land. */
export const GROUP_ENCRYPTION = messageKey('surface.ribbon.group.encryption');

/** PROTECT › Redact, where the mark's tool and its burn-in meet. */
export const GROUP_REDACT = messageKey('surface.ribbon.group.redact');

export const PROTECT_DOCUMENT_COMMAND_TITLE = messageKey('command.protect-document.title');
export const PROTECT_DOCUMENT_TITLE = messageKey('dialog.protect-document.title');
export const PROTECT_DOCUMENT_SCHEME = messageKey('dialog.protect-document.scheme');
export const PROTECT_DOCUMENT_SCHEME_NONE = messageKey('dialog.protect-document.scheme-none');
export const PROTECT_DOCUMENT_SCHEME_AES256 = messageKey('dialog.protect-document.scheme-aes256');
export const PROTECT_DOCUMENT_SCHEME_AES128 = messageKey('dialog.protect-document.scheme-aes128');
export const PROTECT_DOCUMENT_SCHEME_RC4128 = messageKey('dialog.protect-document.scheme-rc4128');
export const PROTECT_DOCUMENT_SCHEME_RC440 = messageKey('dialog.protect-document.scheme-rc440');
export const PROTECT_DOCUMENT_USER = messageKey('dialog.protect-document.user');
export const PROTECT_DOCUMENT_OWNER = messageKey('dialog.protect-document.owner');
export const PROTECT_DOCUMENT_PERMISSIONS = messageKey('dialog.protect-document.permissions');
export const PROTECT_DOCUMENT_APPLY = messageKey('dialog.protect-document.apply');
export const PROTECT_DOCUMENT_REMOVE = messageKey('dialog.protect-document.remove');
export const PROTECT_DOCUMENT_NEEDS_A_PASSWORD = messageKey('dialog.protect-document.needs');
export const PROTECT_DOCUMENT_EXPLAINS = messageKey('dialog.protect-document.explains');
export const PROTECT_DOCUMENT_REMOVES = messageKey('dialog.protect-document.removes');
export const PERMISSION_PRINT = messageKey('permission.print');
export const PERMISSION_MODIFY = messageKey('permission.modify');
export const PERMISSION_COPY = messageKey('permission.copy');
export const PERMISSION_ANNOTATE = messageKey('permission.annotate');
export const PERMISSION_FILL_FORMS = messageKey('permission.fill-forms');
export const PERMISSION_ASSEMBLE = messageKey('permission.assemble');
export const PERMISSION_PRINT_HIGH_QUALITY = messageKey('permission.print-high-quality');

export const APPLY_REDACTIONS_COMMAND_TITLE = messageKey('command.apply-redactions.title');
export const APPLY_REDACTIONS_TITLE = messageKey('dialog.apply-redactions.title');
export const APPLY_REDACTIONS_WARNS = messageKey('dialog.apply-redactions.warns');
export const APPLY_REDACTIONS_SCOPE = messageKey('dialog.apply-redactions.scope');
export const APPLY_REDACTIONS_SCOPE_PAGE = messageKey('dialog.apply-redactions.scope-page');
export const APPLY_REDACTIONS_SCOPE_ALL = messageKey('dialog.apply-redactions.scope-all');
export const APPLY_REDACTIONS_COVER = messageKey('dialog.apply-redactions.cover');
export const APPLY_REDACTIONS_COVER_SOLID = messageKey('dialog.apply-redactions.cover-solid');
export const APPLY_REDACTIONS_COVER_NONE = messageKey('dialog.apply-redactions.cover-none');
export const APPLY_REDACTIONS_IMAGES = messageKey('dialog.apply-redactions.images');
export const APPLY_REDACTIONS_KEEP_TITLE = messageKey('dialog.apply-redactions.keep-title');
export const APPLY_REDACTIONS_KEEP_TITLE_WARNS = messageKey('dialog.apply-redactions.keep-title-warns');
export const APPLY_REDACTIONS_IMAGES_PIXELS = messageKey('dialog.apply-redactions.images-pixels');
export const APPLY_REDACTIONS_IMAGES_REMOVE = messageKey('dialog.apply-redactions.images-remove');
export const APPLY_REDACTIONS_APPLY = messageKey('dialog.apply-redactions.apply');

export const REDACT_MATCHES_COMMAND_TITLE = messageKey('command.redact-matches.title');
export const REDACT_MATCHES_TITLE = messageKey('dialog.redact-matches.title');
export const REDACT_MATCHES_LABEL = messageKey('dialog.redact-matches.label');
export const REDACT_MATCHES_SCOPE = messageKey('dialog.redact-matches.scope');
export const REDACT_MATCHES_SCOPE_ALL = messageKey('dialog.redact-matches.scope-all');
export const REDACT_MATCHES_SCOPE_PAGE = messageKey('dialog.redact-matches.scope-page');
export const REDACT_MATCHES_EXPLAINS = messageKey('dialog.redact-matches.explains');
export const REDACT_MATCHES_EMPTY = messageKey('dialog.redact-matches.empty');
export const REDACT_MATCHES_TOO_LONG = messageKey('dialog.redact-matches.too-long');
export const REDACT_MATCHES_APPLY = messageKey('dialog.redact-matches.apply');

export const SANITIZE_DOCUMENT_COMMAND_TITLE = messageKey('command.sanitize-document.title');
export const SANITIZE_DOCUMENT_TITLE = messageKey('dialog.sanitize-document.title');
export const SANITIZE_DOCUMENT_EXPLAINS = messageKey('dialog.sanitize-document.explains');
export const SANITIZE_DOCUMENT_EMPTY = messageKey('dialog.sanitize-document.empty');
export const SANITIZE_DOCUMENT_APPLY = messageKey('dialog.sanitize-document.apply');
export const SANITIZE_PART_JAVASCRIPT = messageKey('sanitize.javascript');
export const SANITIZE_PART_EMBEDDED_FILES = messageKey('sanitize.embedded-files');
export const SANITIZE_PART_EXTERNAL_ACTIONS = messageKey('sanitize.external-actions');
export const SANITIZE_PART_FLATTEN = messageKey('sanitize.flatten');

/** PROTECT › Signatures, where Stage 7's four signing rows land. */
export const GROUP_SIGNATURES = messageKey('surface.ribbon.group.signatures');

export const SIGN_DOCUMENT_COMMAND_TITLE = messageKey('command.sign-document.title');
export const SIGN_DOCUMENT_TITLE = messageKey('dialog.sign-document.title');
export const SIGN_DOCUMENT_EXPLAINS = messageKey('dialog.sign-document.explains');
export const SIGN_DOCUMENT_PASSPHRASE = messageKey('dialog.sign-document.passphrase');
export const SIGN_DOCUMENT_NAME = messageKey('dialog.sign-document.name');
export const SIGN_DOCUMENT_REASON = messageKey('dialog.sign-document.reason');
export const SIGN_DOCUMENT_LOCATION = messageKey('dialog.sign-document.location');
export const SIGN_DOCUMENT_CONTACT = messageKey('dialog.sign-document.contact');
export const SIGN_DOCUMENT_TOO_LONG = messageKey('dialog.sign-document.too-long');
export const SIGN_DOCUMENT_APPLY = messageKey('dialog.sign-document.apply');
export const SIGN_DOCUMENT_CERTIFY = messageKey('dialog.sign-document.certify');
export const SIGN_DOCUMENT_CERTIFY_NONE = messageKey('dialog.sign-document.certify-none');
export const SIGN_DOCUMENT_CERTIFY_LOCKED = messageKey('dialog.sign-document.certify-locked');
export const SIGN_DOCUMENT_CERTIFY_FORMS = messageKey('dialog.sign-document.certify-forms');
export const SIGN_DOCUMENT_CERTIFY_COMMENTS = messageKey('dialog.sign-document.certify-comments');
export const SIGN_DOCUMENT_TIMESTAMP = messageKey('dialog.sign-document.timestamp');
export const SIGN_DOCUMENT_TIMESTAMP_NONE = messageKey('dialog.sign-document.timestamp-none');
export const SIGN_DOCUMENT_TIMESTAMP_DIGICERT = messageKey(
  'dialog.sign-document.timestamp-digicert',
);
export const SIGN_DOCUMENT_TIMESTAMP_GLOBALSIGN = messageKey(
  'dialog.sign-document.timestamp-globalsign',
);
export const SIGN_DOCUMENT_TIMESTAMP_SECTIGO = messageKey('dialog.sign-document.timestamp-sectigo');
export const SIGN_DOCUMENT_TIMESTAMP_NOTE = messageKey('dialog.sign-document.timestamp-note');
export const SIGN_PROBLEM_TITLE = messageKey('dialog.sign-problem.title');
export const SIGN_PROBLEM_WRONG_PASSPHRASE = messageKey('dialog.sign-problem.wrong-passphrase');
export const SIGN_PROBLEM_UNREADABLE = messageKey('dialog.sign-problem.unreadable');
export const SIGN_PROBLEM_UNENCODABLE_TEXT = messageKey('dialog.sign-problem.unencodable-text');
export const SIGN_PROBLEM_IMAGE_UNREADABLE = messageKey('dialog.sign-problem.image-unreadable');
export const SIGN_PROBLEM_IMAGE_TOO_LARGE = messageKey('dialog.sign-problem.image-too-large');
export const SIGN_PROBLEM_SIGNATURE_TOO_LARGE = messageKey('dialog.sign-problem.signature-too-large');
export const SIGN_PROBLEM_TIMESTAMP_UNREACHABLE = messageKey(
  'dialog.sign-problem.timestamp-unreachable',
);
export const SIGN_PROBLEM_TIMESTAMP_REFUSED = messageKey('dialog.sign-problem.timestamp-refused');
export const SIGN_PROBLEM_TIMESTAMP_UNVERIFIABLE = messageKey(
  'dialog.sign-problem.timestamp-unverifiable',
);
export const SIGN_DOCUMENT_LOOK = messageKey('dialog.sign-document.look');
export const SIGN_DOCUMENT_LOOK_TYPED = messageKey('dialog.sign-document.look-typed');
export const SIGN_DOCUMENT_LOOK_DRAWN = messageKey('dialog.sign-document.look-drawn');
export const SIGN_DOCUMENT_LOOK_IMAGE = messageKey('dialog.sign-document.look-image');
export const SIGN_DOCUMENT_TEXT = messageKey('dialog.sign-document.text');
export const SIGN_DOCUMENT_FONT = messageKey('dialog.sign-document.font');
export const SIGN_DOCUMENT_FONT_HELVETICA = messageKey('dialog.sign-document.font-helvetica');
export const SIGN_DOCUMENT_FONT_TIMES = messageKey('dialog.sign-document.font-times');
export const SIGN_DOCUMENT_FONT_TIMES_ITALIC = messageKey(
  'dialog.sign-document.font-times-italic',
);
export const SIGN_DOCUMENT_FONT_COURIER = messageKey('dialog.sign-document.font-courier');
export const SIGN_DOCUMENT_PAD = messageKey('dialog.sign-document.pad');
export const SIGN_DOCUMENT_CLEAR = messageKey('dialog.sign-document.clear');
export const SIGN_DOCUMENT_IMAGE_NOTE = messageKey('dialog.sign-document.image-note');
export const SIGN_DOCUMENT_MARK_MISSING = messageKey('dialog.sign-document.mark-missing');
export const PLACE_SIGNATURE_TOOL_TITLE = messageKey('command.protect.place-signature');

export const SIGNATURES_COMMAND_TITLE = messageKey('command.signatures.title');
export const SIGNATURES_TITLE = messageKey('dialog.signatures.title');
export const SIGNATURES_NONE = messageKey('dialog.signatures.none');
export const SIGNATURES_UNREADABLE = messageKey('dialog.signatures.unreadable');
export const SIGNATURES_INTACT = messageKey('dialog.signatures.intact');
export const SIGNATURES_CHANGED = messageKey('dialog.signatures.changed');
export const SIGNATURES_APPENDED = messageKey('dialog.signatures.appended');
export const SIGNATURES_VALID_BETWEEN = messageKey('dialog.signatures.valid-between');
export const SIGNATURES_NOT_TRUSTED = messageKey('dialog.signatures.not-trusted');

/**
 * A long command's own name, as the status bar announces it while it runs.
 *
 * Separate from the command's title, and not a formatting of it. *Word count*
 * names a thing a reader asks for; *Counting words* names what is happening
 * right now, and a progress line reading "Word count — 12 of 400" describes a
 * noun rather than an activity.
 */
export const WORD_COUNT_PROGRESS = messageKey('task.word-count');
export const SPELL_CHECK_PROGRESS = messageKey('task.spell-check');
/**
 * Recognition's own name while it runs.
 *
 * The longest task in this build by an order of magnitude — 3.8–4.4 s per page —
 * which is why the bar it names is not optional (`BUILD-PROMPT.md` M5).
 */
export const OCR_PROGRESS = messageKey('task.ocr');
/** The READ's name, because the write is one command and takes no walk. */
export const ENHANCE_PROGRESS = messageKey('task.enhance');
export const TASK_PROGRESS = messageKey('status.task.progress');
export const TASK_CANCEL = messageKey('status.task.cancel');
export const CLOSE_TAB_TITLE = messageKey('command.close-tab.title');
export const CLOSE_OTHERS_TITLE = messageKey('command.close-others.title');
export const OPEN_SIDE_BY_SIDE_TITLE = messageKey('command.open-side-by-side.title');

/*
 * RIBBON CAPTIONS — one or two words, the owner's design pass (2026-09-21).
 *
 * A separate key per command rather than a shortened `title`, because `title`
 * reaches the palette and the four context menus too and nothing about those was
 * crowded. `UiCommand.ribbonTitle` carries the reasoning; the full title becomes
 * the button's tooltip in exactly the cases a key here exists.
 *
 * They are grouped by ribbon section, in the order the sweep reported them, so
 * that a section's captions can be read as a set — which is how a person meets
 * them. Two sections' import and export captions repeat across sections (Forms
 * and Review both spell *Import XFDF…*); the group caption above them says which
 * is which, and the tooltip says it in full.
 */
export const RIBBON_SAVE_COPY = messageKey('ribbon.save-copy');
export const RIBBON_EXPORT_LAYOUT_TEXT = messageKey('ribbon.export-layout-text');
export const RIBBON_EXPORT_WORD = messageKey('ribbon.export-word');
export const RIBBON_EXPORT_POWERPOINT = messageKey('ribbon.export-powerpoint');
export const RIBBON_EXPORT_EXCEL = messageKey('ribbon.export-excel');
export const RIBBON_EXPORT_PDFA = messageKey('ribbon.export-pdfa');
export const RIBBON_OPTIMIZE = messageKey('ribbon.optimize');
export const RIBBON_SNAPSHOT = messageKey('ribbon.snapshot');
export const RIBBON_STRIKEOUT = messageKey('ribbon.strikeout');
export const RIBBON_REDACT_MARK = messageKey('ribbon.redact-mark');
export const RIBBON_LINK_ADDRESS = messageKey('ribbon.link-address');
export const RIBBON_LINK_PAGE = messageKey('ribbon.link-page');
export const RIBBON_PLACE_IMAGE = messageKey('ribbon.place-image');
export const RIBBON_OCR_REGION = messageKey('ribbon.ocr-region');
export const RIBBON_CLOUD_REGION = messageKey('ribbon.cloud-region');
export const RIBBON_CLAUDE_REGION = messageKey('ribbon.claude-region');
export const RIBBON_EDIT_TEXT = messageKey('ribbon.edit-text');
export const RIBBON_EDIT_OBJECT = messageKey('ribbon.edit-object');
export const RIBBON_ROTATE_180 = messageKey('ribbon.rotate-180');
export const RIBBON_ROTATE_270 = messageKey('ribbon.rotate-270');
export const RIBBON_DESKEW = messageKey('ribbon.deskew');
export const RIBBON_PAGE_TRANSITION = messageKey('ribbon.page-transition');
export const RIBBON_PLACE_BARCODE = messageKey('ribbon.place-barcode');
export const RIBBON_INSERT_BLANK = messageKey('ribbon.insert-blank');
export const RIBBON_INSERT_FROM_PDF = messageKey('ribbon.insert-from-pdf');
export const RIBBON_GENERATE_TOC = messageKey('ribbon.generate-toc');
export const RIBBON_PAGE_BACKGROUND = messageKey('ribbon.page-background');
export const RIBBON_HEADER_FOOTER = messageKey('ribbon.header-footer');
export const RIBBON_EXPORT_PAGE_IMAGES = messageKey('ribbon.export-page-images');
export const RIBBON_MERGE = messageKey('ribbon.merge');
export const RIBBON_IMPORT_LAYER = messageKey('ribbon.import-layer');
export const RIBBON_EDIT_EXTERNALLY = messageKey('ribbon.edit-externally');
export const RIBBON_FIND_DUPLICATES = messageKey('ribbon.find-duplicates');
export const RIBBON_FORM_EXPORT_JSON = messageKey('ribbon.form-export-json');
export const RIBBON_FORM_EXPORT_XFDF = messageKey('ribbon.form-export-xfdf');
export const RIBBON_FORM_EXPORT_FDF = messageKey('ribbon.form-export-fdf');
export const RIBBON_FORM_IMPORT_JSON = messageKey('ribbon.form-import-json');
export const RIBBON_FORM_IMPORT_XFDF = messageKey('ribbon.form-import-xfdf');
export const RIBBON_FORM_IMPORT_FDF = messageKey('ribbon.form-import-fdf');
export const RIBBON_FIELD_TEXT = messageKey('ribbon.field-text');
export const RIBBON_FIELD_CHECKBOX = messageKey('ribbon.field-checkbox');
export const RIBBON_FIELD_RADIO = messageKey('ribbon.field-radio');
export const RIBBON_FIELD_DROPDOWN = messageKey('ribbon.field-dropdown');
export const RIBBON_FIELD_LISTBOX = messageKey('ribbon.field-listbox');
export const RIBBON_COMMENTS_IMPORT_XFDF = messageKey('ribbon.comments-import-xfdf');
export const RIBBON_COMMENTS_IMPORT_FDF = messageKey('ribbon.comments-import-fdf');
export const RIBBON_COMMENTS_IMPORT_JSON = messageKey('ribbon.comments-import-json');
export const RIBBON_COMMENTS_EXPORT_XFDF = messageKey('ribbon.comments-export-xfdf');
export const RIBBON_COMMENTS_EXPORT_FDF = messageKey('ribbon.comments-export-fdf');
export const RIBBON_COMMENTS_EXPORT_JSON = messageKey('ribbon.comments-export-json');
export const RIBBON_PROTECT_DOCUMENT = messageKey('ribbon.protect-document');
export const RIBBON_REDACT_MATCHES = messageKey('ribbon.redact-matches');
export const RIBBON_PLACE_SIGNATURE = messageKey('ribbon.place-signature');
export const RIBBON_DIAGNOSTICS = messageKey('ribbon.diagnostics');
export const RIBBON_NEW_FROM_MARKDOWN = messageKey('ribbon.new-from-markdown');
export const RIBBON_APPEND_MARKDOWN = messageKey('ribbon.append-markdown');
export const RIBBON_NEW_FROM_CSV = messageKey('ribbon.new-from-csv');
export const RIBBON_NEW_FROM_IMAGES = messageKey('ribbon.new-from-images');
export const RIBBON_OPEN_FROM_URL = messageKey('ribbon.open-from-url');
export const RIBBON_NEW_FROM_CAMERA = messageKey('ribbon.new-from-camera');
export const RIBBON_OCR = messageKey('ribbon.ocr');
export const RIBBON_OCR_EXPORT = messageKey('ribbon.ocr-export');
export const RIBBON_ENHANCE = messageKey('ribbon.enhance');
export const RIBBON_STRAIGHTEN_PHOTOS = messageKey('ribbon.straighten-photos');
export const COPY_SELECTION_TITLE = messageKey('command.text-copy.title');
export const HIGHLIGHT_SELECTION_TITLE = messageKey('command.text-highlight.title');
export const UNDERLINE_SELECTION_TITLE = messageKey('command.text-underline.title');
export const STRIKEOUT_SELECTION_TITLE = messageKey('command.text-strikeout.title');
export const COMMENT_SELECTION_TITLE = messageKey('command.text-comment.title');
export const REDACT_SELECTION_TITLE = messageKey('command.text-redact.title');
export const SEARCH_SELECTION_TITLE = messageKey('command.text-search.title');
export const CLOSE_UNSAVED_TITLE = messageKey('dialog.close-unsaved.title');
export const CLOSE_UNSAVED_QUESTION = messageKey('dialog.close-unsaved.question');
export const CLOSE_UNSAVED_SAVE = messageKey('dialog.close-unsaved.save');
export const CLOSE_UNSAVED_DISCARD = messageKey('dialog.close-unsaved.discard');
export const CLOSE_UNSAVED_CANCEL = messageKey('dialog.close-unsaved.cancel');
export const SAVE_PROBLEM_TITLE = messageKey('dialog.save-problem.title');
export const SAVE_WORK_INTACT = messageKey('dialog.save-problem.intact');
export const SAVE_REFUSED_CONTESTED = messageKey('dialog.save-problem.contested');
export const SAVE_REFUSED_REPLACED = messageKey('dialog.save-problem.replaced');
export const SAVE_REFUSED_TARGET_ABSENT = messageKey('dialog.save-problem.target-absent');
export const SAVE_REFUSED_UNREPRESENTABLE = messageKey('dialog.save-problem.unrepresentable');
export const SAVE_REFUSED_UNVERIFIABLE = messageKey('dialog.save-problem.unverifiable');
export const SAVE_WRITE_FAILED = messageKey('dialog.save-problem.write-failed');
export const SAVE_LAYOUT_UNAVAILABLE = messageKey('dialog.save-problem.layout-unavailable');
export const SAVE_LAYOUT_FAILED = messageKey('dialog.save-problem.layout-failed');
export const SAVE_NO_TABLES = messageKey('dialog.save-problem.no-tables');
export const SAVE_NO_TABLES_NO_TEXT = messageKey('dialog.save-problem.no-tables-no-text');
export const SAVE_REVIEW_CHANGED = messageKey('dialog.save-problem.review-changed');
export const SAVE_PDFA_UNAVAILABLE = messageKey('dialog.save-problem.pdfa-unavailable');
export const SAVE_PDFA_FAILED = messageKey('dialog.save-problem.pdfa-failed');
export const SAVE_OPTIMIZE_UNAVAILABLE = messageKey('dialog.save-problem.optimize-unavailable');
export const SAVE_OPTIMIZE_UNREADABLE = messageKey('dialog.save-problem.optimize-unreadable');
export const SAVE_OPTIMIZE_CHANGED = messageKey('dialog.save-problem.optimize-changed');
export const SAVE_PRINT_UNAVAILABLE = messageKey('dialog.save-problem.print-unavailable');
export const SAVE_PRINT_FAILED = messageKey('dialog.save-problem.print-failed');
export const SAVE_EMAIL_UNAVAILABLE = messageKey('dialog.save-problem.email-unavailable');
export const SAVE_EMAIL_FAILED = messageKey('dialog.save-problem.email-failed');
export const PROBLEM_TITLE = messageKey('dialog.command-problem.title');
export const PROBLEM_NOT_OPEN = messageKey('dialog.command-problem.not-open');
export const PROBLEM_BUSY = messageKey('dialog.command-problem.busy');
export const PROBLEM_POISONED = messageKey('dialog.command-problem.poisoned');
export const PROBLEM_STALE_TARGET = messageKey('dialog.command-problem.stale-target');
export const PROBLEM_ENGINE_UNAVAILABLE = messageKey('dialog.command-problem.engine-unavailable');
export const PROBLEM_RASTER_TOO_LARGE = messageKey('dialog.command-problem.raster-too-large');
export const PROBLEM_NOT_COPYABLE = messageKey('dialog.command-problem.not-copyable');
export const PROBLEM_SERVICE_NO_KEY = messageKey('dialog.command-problem.service-no-key');
export const PROBLEM_SERVICE_UNAUTHORISED = messageKey('dialog.command-problem.service-unauthorised');
export const PROBLEM_SERVICE_UNAVAILABLE = messageKey('dialog.command-problem.service-unavailable');
export const PROBLEM_SERVICE_REFUSED = messageKey('dialog.command-problem.service-refused');
export const COPY_ANNOTATIONS_TITLE = messageKey('command.annotate.copy-selection');
export const PASTE_ANNOTATIONS_TITLE = messageKey('command.annotate.paste');
export const PROBLEM_INTERNAL = messageKey('dialog.command-problem.internal');
export const PROBLEM_REFERENCE_LABEL = messageKey('dialog.command-problem.reference');
// CLOUD STORAGE (ADR-0091).
export const CLOUD_TITLE = messageKey('dialog.cloud.title');
export const CLOUD_COMMAND_TITLE = messageKey('command.cloud.storage');
export const SAVE_BACK_TITLE = messageKey('command.cloud.save-back');
export const CLOUD_OUTCOME_TITLE = messageKey('dialog.cloud-outcome.title');
export const CLOUD_SIGN_IN = messageKey('dialog.cloud.sign-in');
export const CLOUD_SIGN_OUT = messageKey('dialog.cloud.sign-out');
export const CLOUD_LIST = messageKey('dialog.cloud.list');
export const CLOUD_UPLOAD = messageKey('dialog.cloud.upload');
export const CLOUD_OPEN = messageKey('dialog.cloud.open');
export const CLOUD_FILES_LABEL = messageKey('dialog.cloud.files');
export const CLOUD_FILES_EMPTY = messageKey('dialog.cloud.files-empty');
export const CLOUD_GOOGLE_NOTE = messageKey('dialog.cloud.google-note');
export const CLOUD_NOTE_SIGNED_IN = messageKey('dialog.cloud.note.signed-in');
export const CLOUD_NOTE_SIGNED_OUT = messageKey('dialog.cloud.note.signed-out');
export const CLOUD_NOTE_UPLOADED = messageKey('dialog.cloud.note.uploaded');
export const SAVE_BACK_NOT_FROM_CLOUD = messageKey('dialog.cloud-outcome.not-from-cloud');
export const SAVE_BACK_SAVE_FAILED = messageKey('dialog.cloud-outcome.save-failed');
export const SAVE_BACK_KEPT_HERE = messageKey('dialog.cloud-outcome.kept-here');
export const CLOUD_PROVIDER_ONEDRIVE = messageKey('cloud.provider.onedrive');
export const CLOUD_PROVIDER_GOOGLE_DRIVE = messageKey('cloud.provider.google-drive');
export const CLOUD_STATE_NOT_CONFIGURED = messageKey('cloud.state.not-configured');
export const CLOUD_STATE_SIGNED_OUT = messageKey('cloud.state.signed-out');
export const CLOUD_STATE_SIGNED_IN = messageKey('cloud.state.signed-in');
export const CLOUD_PROBLEM_NOT_CONFIGURED = messageKey('cloud.problem.not-configured');
export const CLOUD_PROBLEM_SECRETS_UNAVAILABLE = messageKey('cloud.problem.secrets-unavailable');
export const CLOUD_PROBLEM_SIGN_IN_CANCELLED = messageKey('cloud.problem.sign-in-cancelled');
export const CLOUD_PROBLEM_SIGN_IN_TIMED_OUT = messageKey('cloud.problem.sign-in-timed-out');
export const CLOUD_PROBLEM_SIGN_IN_DENIED = messageKey('cloud.problem.sign-in-denied');
export const CLOUD_PROBLEM_SIGN_IN_UNAVAILABLE = messageKey('cloud.problem.sign-in-unavailable');
export const CLOUD_PROBLEM_UNAUTHORISED = messageKey('cloud.problem.unauthorised');
export const CLOUD_PROBLEM_UNREACHABLE = messageKey('cloud.problem.unreachable');
export const CLOUD_PROBLEM_REJECTED = messageKey('cloud.problem.rejected');
export const CLOUD_PROBLEM_UNEXPECTED_ANSWER = messageKey('cloud.problem.unexpected-answer');
export const CLOUD_PROBLEM_CHANGED_ELSEWHERE = messageKey('cloud.problem.changed-elsewhere');
export const CLOUD_PROBLEM_TOO_LARGE = messageKey('cloud.problem.too-large');
export const CLOUD_PROBLEM_NOT_A_PDF = messageKey('cloud.problem.not-a-pdf');
/** Each provider's name. `satisfies` makes a third provider a compile error until it has one. */
export const CLOUD_PROVIDER_NAMES = {
  onedrive: CLOUD_PROVIDER_ONEDRIVE,
  'google-drive': CLOUD_PROVIDER_GOOGLE_DRIVE,
} as const satisfies Record<CloudProviderId, MessageKey>;
export const CLOUD_STATE_NAMES = {
  'not-configured': CLOUD_STATE_NOT_CONFIGURED,
  'signed-out': CLOUD_STATE_SIGNED_OUT,
  'signed-in': CLOUD_STATE_SIGNED_IN,
} as const satisfies Record<CloudState, MessageKey>;
/** Each refusal in a person's words — exhaustive over the contract's list. */
export const CLOUD_PROBLEMS = {
  'not-configured': CLOUD_PROBLEM_NOT_CONFIGURED,
  'secrets-unavailable': CLOUD_PROBLEM_SECRETS_UNAVAILABLE,
  'sign-in-cancelled': CLOUD_PROBLEM_SIGN_IN_CANCELLED,
  'sign-in-timed-out': CLOUD_PROBLEM_SIGN_IN_TIMED_OUT,
  'sign-in-denied': CLOUD_PROBLEM_SIGN_IN_DENIED,
  'sign-in-unavailable': CLOUD_PROBLEM_SIGN_IN_UNAVAILABLE,
  unauthorised: CLOUD_PROBLEM_UNAUTHORISED,
  unreachable: CLOUD_PROBLEM_UNREACHABLE,
  rejected: CLOUD_PROBLEM_REJECTED,
  'unexpected-answer': CLOUD_PROBLEM_UNEXPECTED_ANSWER,
  'changed-elsewhere': CLOUD_PROBLEM_CHANGED_ELSEWHERE,
  'too-large': CLOUD_PROBLEM_TOO_LARGE,
  'not-a-pdf': CLOUD_PROBLEM_NOT_A_PDF,
} as const satisfies Record<CloudRefusal, MessageKey>;

/**
 * The catalogue itself.
 *
 * A `Record<MessageKey, string>` rather than a plain object literal keyed by
 * string, so a key that is not minted cannot be added — the completeness check
 * this file eventually owes is *"every registered key has an entry"*, and that
 * check is only worth writing once both sides are the same type.
 */
export const EN: Readonly<Record<MessageKey, string>> = {
  [OPEN_DOCUMENT_TITLE]: 'Open PDF…',
  [CLOSE_LABEL]: 'Close',
  [DOCUMENT_SURFACE_LABEL]: 'Document',
  [THEME_TITLE]: 'Theme',
  // v5-10's Appearance rows. *Also on when Windows asks* is true of the build: `applyMotion` reads both.
  [REDUCE_MOTION_TITLE]: 'Reduce motion',
  [REDUCE_MOTION_DESCRIPTION]:
    'Turns off the transitions and animations in the interface. Also on whenever Windows asks for reduced motion.',
  [THUMBNAIL_SIZE_TITLE]: 'Thumbnail size',
  [THUMBNAIL_SIZE_DESCRIPTION]: 'How large the page pictures in the Pages panel are drawn.',
  [THUMBNAIL_SIZE_OPTION_TITLES.small]: 'Small',
  [THUMBNAIL_SIZE_OPTION_TITLES.medium]: 'Medium',
  [THUMBNAIL_SIZE_OPTION_TITLES.large]: 'Large',
  [LAYOUT_MODE_TITLE]: 'Layout',
  [RIBBON_SECTION_TITLE]: 'Ribbon section',
  [LAYOUT_MODE_RIBBON]: 'Ribbon',
  [LAYOUT_MODE_STUDIO]: 'Studio',
  [LAYOUT_MODE_FOCUS]: 'Focus',
  [LAYOUT_RIBBON_COMMAND_TITLE]: 'Ribbon layout',
  [LAYOUT_STUDIO_COMMAND_TITLE]: 'Studio layout',
  [LAYOUT_FOCUS_COMMAND_TITLE]: 'Focus layout',
  [LEAVE_FOCUS_COMMAND_TITLE]: 'Leave Focus',
  [ABOUT_TITLE]: 'About Monstera',
  [ABOUT_COMMAND_TITLE]: 'About',
  [DONATE_TITLE]: 'Support Monstera',
  [DONATE_COMMAND_TITLE]: 'Donate',
  // BOTH SENTENCES ARE CHECKABLE, which is why they are these two and not a plea.
  // The licence is ADR-0001's; the second is a fact about the code — the button
  // hands one address to the browser and nothing else leaves.
  [DONATE_LICENCE]: 'Monstera is free software under the AGPL-3.0 licence, made by a small team.',
  [DONATE_WHERE]:
    'A donation pays for the time that goes into it. The page opens in your browser — Monstera never sees your payment details.',
  [DONATE_OPEN]: 'Open the donation page',
  [DONATE_LATER]: 'Not now',
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
  [WORD_COUNT_COMMAND_TITLE]: 'Word count',
  [WORD_COUNT_TITLE]: 'Word count',
  [WORD_COUNT_WORDS_LABEL]: 'Words',
  [WORD_COUNT_CHARACTERS_LABEL]: 'Characters',
  [WORD_COUNT_CHARACTERS_TIGHT_LABEL]: 'Characters, no spaces',
  [WORD_COUNT_PAGES_LABEL]: 'Pages counted',
  // SAYS THE FIGURES ARE SHORT, in the sentence rather than in a colour: a
  // total smaller than the document is indistinguishable from a correct total
  // for a shorter one, and a reader quoting it has no way to tell.
  [WORD_COUNT_PARTIAL]: 'Counted {counted} of {total} pages — these totals are incomplete.',
  [PAGE_STRUCTURE_COMMAND_TITLE]: 'Reading order',
  [PAGE_STRUCTURE_TITLE]: 'Reading order and tags',
  [PAGE_STRUCTURE_PAGE]: 'Tags on page {page}, in the order the document gives them.',
  [PAGE_STRUCTURE_UNTAGGED]: 'This page has no tags.',
  [PAGE_STRUCTURE_LINES]: '{count, plural, one {# line} other {# lines}}',
  [PAGE_STRUCTURE_UNTAGGED_LINES]:
    '{count, plural, one {One line of text is outside every tag.} other {# lines of text are outside every tag.}}',
  [PAGE_STRUCTURE_IMAGES]:
    '{count, plural, one {One image on this page.} other {# images on this page.}}',
  // A LIST THAT STOPS EARLY SAYS SO: a page shown tagged that far reads as a
  // page tagged that far.
  [PAGE_STRUCTURE_TRUNCATED]: 'This page has more tags than can be shown here, so the list stops early.',
  [PAGE_STRUCTURE_REFUSED]:
    'The tags on page {page} could not be read. The document may be busy or no longer open.',
  [SPELL_CHECK_COMMAND_TITLE]: 'Spell check',
  // NAMES THE PAGE, because the command acts on the one in front of the reader
  // and the ribbon has no other way to say so. "Replace text" alone reads as
  // find-and-replace, which is a different row and a different scope.
  [EDIT_PAGE_OBJECT_COMMAND_TITLE]: 'Edit an object on page',
  [SPELL_CHECK_TITLE]: 'Spell check',
  [SPELL_CHECK_LANGUAGE]: 'Checked against {language}',
  [SPELL_CHECK_LANGUAGE_EN]: 'English',
  // SAID OUT LOUD. A dialog that opened empty is indistinguishable from one
  // whose check never ran, and *found nothing* is the answer a reader was
  // hoping for — which is exactly when it needs stating rather than implying.
  [SPELL_CHECK_CLEAN]: 'No misspellings found.',
  [SPELL_CHECK_UNAVAILABLE]:
    'The spelling dictionary could not be loaded, so nothing was checked.',
  [SPELL_CHECK_PARTIAL]: 'Checked {counted} of {total} pages — this list is incomplete.',
  [SPELL_CHECK_OCCURRENCES]: '{count, plural, one {# time} other {# times}}',
  [SPELL_CHECK_FIRST_PAGE]: 'first on page {page}',
  [SPELL_CHECK_SUGGESTIONS]: 'Suggestions',
  [SPELL_CHECK_NO_SUGGESTIONS]: 'No suggestions',
  [SPELL_CHECK_ADD]: 'Add {word} to dictionary',
  [SPELL_CHECK_ADDED]: 'Added to your dictionary',
  [SPELL_CHECK_SAVE]:
    '{count, plural, one {Save one word to your dictionary} other {Save # words to your dictionary}}',
  // NAMES WHAT IT PRODUCES, not the technique. *OCR* is the name of the thing in
  // the ribbon group, where a reader who knows the word will look for it; the
  // command says what happens to their document.
  [OCR_COMMAND_TITLE]: 'Make scanned pages searchable',
  // NAMES THE FILE, because that is the difference from the command above: both
  // recognise, and this one also writes a copy.
  [OCR_EXPORT_COMMAND_TITLE]: 'Export a searchable copy',
  // SAYS WHAT CHANGES, not how. *Enhance* alone reads as a slider nobody is given:
  // the levels come from each image's own histogram.
  [ENHANCE_COMMAND_TITLE]: 'Clean up scanned pages',
  [ENHANCE_OUTCOME_TITLE]: 'Clean up',
  [ENHANCE_OUTCOME_PAGES]:
    '{count, plural, one {Cleaned up one scanned page} other {Cleaned up # scanned pages}}.',
  // THE EMPTY ANSWER SAID OUT LOUD, and it names the reason rather than the count.
  [ENHANCE_OUTCOME_NONE]: 'No scanned pages here — every page already carries text.',
  [SCAN_COMMAND_TITLE]: 'Straighten photographed pages',
  [SCAN_OUTCOME_TITLE]: 'Straighten',
  // WHERE, NOT WHICH: the dialog is told how many scanned pages were looked at, not
  // which of them held a sheet of paper, so the sentence says what happened to those.
  [SCAN_OUTCOME_PAGES]:
    '{count, plural, one {Looked for a sheet of paper on one scanned page} other {Looked for a sheet of paper on # scanned pages}}. Where one was found, the page is now just the sheet.',
  [SCAN_OUTCOME_NONE]: 'No scanned pages here — every page already carries text.',
  [OCR_TITLE]: 'Recognise text',
  // SAYS WHAT IS MISSING AND WHAT IT IS FOR, which is §10.5's no-binary state: a
  // dialog reading "unavailable" tells a reader nothing they can act on.
  [OCR_UNAVAILABLE]:
    'No recognition models are installed, so nothing can be read from a scan yet.',
  [OCR_LANGUAGE]: 'Language of the text',
  [OCR_THIS_PAGE]: 'This page',
  [OCR_ALL_PAGES]: 'All pages',
  [OCR_START]: 'Recognise',
  // THE ONE LINE THE OWNER SPECIFIED (2026-09-18): handwriting is read by a
  // service since ADR-0085, and a key is what makes its tool appear.
  [OCR_HANDWRITING]: 'To read handwriting, add an Azure or Anthropic key in Settings.',
  [OCR_HANDWRITING_READY]:
    'To read handwriting, draw a box with the Comment tool that sends it to Azure or to Claude — whichever you have a key for.',
  [EXPORT_EXCEL_SERVICES_NO_KEY]:
    'To read tables from scanned pages with Azure Document Intelligence or Claude, add a key in Settings.',
  [OCR_OUTCOME_TITLE]: 'Recognition',
  [OCR_OUTCOME_RECOGNISED]:
    '{count, plural, one {Read the text on one page} other {Read the text on # pages}}.',
  // THE EMPTY ANSWER SAID OUT LOUD, and it names the reason rather than the
  // count: a document whose pages all carry text has nothing to recognise, and a
  // dialog that simply closed would read as a feature that did not work.
  [OCR_OUTCOME_NONE]: 'Nothing needed recognising — every page here already carries text.',
  [OCR_OUTCOME_SKIPPED]:
    '{count, plural, one {One page already had text and was left alone} other {# pages already had text and were left alone}}.',
  // A CANCELLED RUN KEEPS WHAT IT FINISHED, which is the opposite of the spell
  // check's rule and for a stated reason: a recognised page is correct work on
  // the document, where a partial list of misspellings is a wrong answer.
  [OCR_OUTCOME_STOPPED]: 'Stopped early. The pages already recognised keep their text.',
  [OCR_LANGUAGE_NAMES.eng]: 'English',
  [OCR_LANGUAGE_NAMES.spa]: 'Spanish',
  [OCR_LANGUAGE_NAMES.fra]: 'French',
  [OCR_LANGUAGE_NAMES.deu]: 'German',
  [OCR_LANGUAGE_NAMES.por]: 'Portuguese',
  [OCR_LANGUAGE_NAMES.ita]: 'Italian',
  [OCR_LANGUAGE_NAMES.nld]: 'Dutch',
  [OCR_LANGUAGE_NAMES.rus]: 'Russian',
  [OCR_LANGUAGE_NAMES.ara]: 'Arabic',
  [OCR_LANGUAGE_NAMES.heb]: 'Hebrew',
  [OCR_LANGUAGE_NAMES.hin]: 'Hindi',
  [OCR_LANGUAGE_NAMES.jpn]: 'Japanese',
  [OCR_LANGUAGE_NAMES.kor]: 'Korean',
  [OCR_LANGUAGE_NAMES.chi_sim]: 'Chinese (Simplified)',
  [TRANSLATE_PAGE_TITLE]: 'Translate this page…',
  [RIBBON_TRANSLATE_PAGE]: 'Translate',
  [TRANSLATE_PAGE_DIALOG_TITLE]: 'Translate this page',
  [TRANSLATE_PAGE_INTRO]:
    'The text on this page is sent to the AI provider below, translated, and written back into the page where it was. Undo puts the original back.',
  [TRANSLATE_PAGE_LANGUAGE]: 'Translate into',
  [TRANSLATE_PAGE_CHOOSE_LANGUAGE]: 'Choose a language',
  [TRANSLATE_PAGE_PROVIDER]: 'Using',
  [TRANSLATE_PAGE_LIMITS]:
    'Languages written in the Latin alphabet. Where the page’s own font lacks a letter, that text is set in a standard font.',
  [TRANSLATE_PAGE_NO_PROVIDER]:
    'Translating uses an AI provider, and none is set up yet. Add a key in Settings › AI, then come back.',
  [TRANSLATE_PAGE_START]: 'Translate',
  [TRANSLATE_PAGE_PROGRESS]: 'Translating the page',
  [TOAST_PAGE_TRANSLATED]: 'Page translated. Undo puts the original back.',
  [TOAST_NOTHING_TO_TRANSLATE]: 'Nothing on this page needed translating.',
  [TOAST_TRANSLATE_REJECTED]: 'The provider refused to translate this page. Nothing was changed.',
  [TOAST_TRANSLATE_UNREADABLE]:
    'The provider’s answer could not be matched to the page’s text, so nothing was changed. Try again.',
  [TOAST_TRANSLATE_NO_MODEL]: 'That provider offered no model to translate with. Nothing was changed.',
  [TOAST_TRANSLATE_NOT_WRITABLE]:
    'Some translated letters cannot be shown in this page’s fonts, so nothing was changed.',
  [TRANSLATION_LANGUAGE_NAMES.en]: 'English',
  [TRANSLATION_LANGUAGE_NAMES.fr]: 'French',
  [TRANSLATION_LANGUAGE_NAMES.de]: 'German',
  [TRANSLATION_LANGUAGE_NAMES.es]: 'Spanish',
  [TRANSLATION_LANGUAGE_NAMES.it]: 'Italian',
  [TRANSLATION_LANGUAGE_NAMES.pt]: 'Portuguese',
  [TRANSLATION_LANGUAGE_NAMES.nl]: 'Dutch',
  [TRANSLATION_LANGUAGE_NAMES.ca]: 'Catalan',
  [TRANSLATION_LANGUAGE_NAMES.gl]: 'Galician',
  [TRANSLATION_LANGUAGE_NAMES.da]: 'Danish',
  [TRANSLATION_LANGUAGE_NAMES.sv]: 'Swedish',
  [TRANSLATION_LANGUAGE_NAMES.nb]: 'Norwegian (Bokmål)',
  [TRANSLATION_LANGUAGE_NAMES.fi]: 'Finnish',
  [TRANSLATION_LANGUAGE_NAMES.et]: 'Estonian',
  [TRANSLATION_LANGUAGE_NAMES.is]: 'Icelandic',
  [TRANSLATION_LANGUAGE_NAMES.ga]: 'Irish',
  [TRANSLATION_LANGUAGE_NAMES.af]: 'Afrikaans',
  [TRANSLATION_LANGUAGE_NAMES.id]: 'Indonesian',
  [TRANSLATION_LANGUAGE_NAMES.ms]: 'Malay',
  [TRANSLATION_LANGUAGE_NAMES.sw]: 'Swahili',
  [EDITING_PERSONAL_DICTIONARY_TITLE]: 'Personal dictionary',
  [EDITING_OCR_LANGUAGE_TITLE]: 'Recognition language',
  [EDITING_OCR_LANGUAGE_DESCRIPTION]: 'Used when you recognise text, unless you choose another for that run.',
  [EDITING_AZURE_ENDPOINT_DESCRIPTION]: 'Optional. Your own Azure resource address, for tables and difficult scans.',
  [EDITING_AZURE_KEY_DESCRIPTION]: 'Stored in the Windows credential vault. Never exported or logged.',
  [SECOND_RENDERER_DESCRIPTION]: 'Draws pages with PDFium instead of PDF.js. Slower; useful when a page looks wrong.',
  [EDITING_AZURE_ENDPOINT_TITLE]: 'Azure Document Intelligence endpoint',
  [EDITING_AZURE_KEY_TITLE]: 'Azure Document Intelligence key',
  [RULER_UNIT_TITLE]: 'Ruler unit',
  // SAYS WHAT IT IS, NOT THAT IT IS BETTER. The row was called *HD render* and
  // §6.1 called the engine behind it *higher fidelity*; both were amended on
  // 2026-09-10, because the two rasterisers were measured 12.716 levels apart
  // over inked pixels with no way to say which is right. A label promising
  // quality would be the claim the measurements refuse — and the honest one is
  // also the useful one, because *the other renderer* is exactly what a person
  // wants when a page looks wrong.
  [SECOND_RENDERER_TITLE]: 'Draw pages with the other renderer',
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
  [WINDOW_PROBLEM_TITLE]: 'Part of this window stopped working.',
  // The documents are held in main, and the tabs naming them live above the boundary, so
  // both survive a retry — which is what the sentence promises.
  [WINDOW_PROBLEM_BODY]: 'Your open documents are unchanged. Trying again redraws the window.',
  [DIALOG_PROBLEM_TITLE]: 'This could not be opened.',
  // NO RETRY IN A DIALOG: React caches a lazy body's failed import, so opening it again
  // fails the same way until the application restarts — and the sentence says so.
  [DIALOG_PROBLEM_BODY]: 'Nothing was changed. Close this, and restart Monstera if it happens again.',
  [START_TITLE]: 'Monstera',
  // §10.3's hero, word for word, and ADR-0002 keeps both lines beneath the supplied artwork.
  [START_PRODUCT]: 'PDF EDITOR',
  [START_TAGLINE]: 'Built For The Way You Work',
  [START_VERSION]: 'Version {version}',
  [START_COPYRIGHT]: '© Tenslor Inc.',
  // THE CHORD IS A VALUE, not part of the sentence: it is read off the shortcut map, so the hint cannot name a key
  // the registry does not bind.
  [START_F1_HINT]: 'Press {chord} for keyboard shortcuts',
  [KEYBOARD_SHORTCUTS_TITLE]: 'Keyboard shortcuts',
  [KEYBOARD_SHORTCUTS_COMMAND_TITLE]: 'Keyboard shortcuts',
  [SHORTCUTS_COMMAND_HEADER]: 'Command',
  [SHORTCUTS_CHORD_HEADER]: 'Shortcut',
  // §10.3's six start-screen shortcuts, word for word.
  [FEATURE_ANNOTATE_TITLE]: 'Annotate & mark up',
  [FEATURE_FORMS_TITLE]: 'Fill & create forms',
  [FEATURE_OCR_TITLE]: 'OCR scanned pages',
  [FEATURE_SPLIT_MERGE_TITLE]: 'Split & merge',
  [FEATURE_ENCRYPT_SIGN_TITLE]: 'Encrypt & sign',
  [FEATURE_EXPORT_TITLE]: 'Export anywhere',
  // v5-01's CARD LINES, each checked against the build on 2026-09-25 (JOURNAL). Where the design said more
  // than the build does, the line says less: *image* stamps, since no built-in stamp exists; no language count
  // for OCR, since the models are not packaged yet; and no *fidelity reports*, since only PDF/A reports one.
  [FEATURE_ANNOTATE_SUMMARY]: 'Highlight, ink, shapes, notes and image stamps — saved as real PDF annotations.',
  [FEATURE_FORMS_SUMMARY]: 'Fill any AcroForm, draw new fields, and export data as JSON, XFDF or FDF.',
  [FEATURE_OCR_SUMMARY]: 'On-device text recognition makes scanned pages searchable and selectable.',
  [FEATURE_SPLIT_MERGE_SUMMARY]: 'Reorder, extract, merge, and split by ranges or one file per page.',
  [FEATURE_ENCRYPT_SIGN_SUMMARY]: 'AES-256 passwords, true redaction and PKCS#7 digital signatures.',
  [FEATURE_EXPORT_SUMMARY]: 'Export to Word, Excel, PowerPoint, images and PDF/A.',
  // SAYS WHAT HAPPENED AND WHAT IS LIKELY. A file the picker offered and the
  // service could not read has almost always moved, and naming that is what
  // makes the message actionable rather than a report.
  [START_ABSENT]: 'That file could not be opened. It may have been moved, renamed or deleted.',
  [START_AT_CAPACITY]: 'There is not enough room to open that document. Close another one first.',
  // A DROPPED ITEM WITH NO FILE BEHIND IT: something dragged out of a browser or another program that is
  // not a file on this computer. Says what to do instead.
  [START_NO_PATH]: 'That is not a file on this computer, so it cannot be opened. Drop a PDF from File Explorer instead.',
  // v5-01's line under Open PDF, word for word.
  [START_DROP_HINT]: 'or drop a PDF anywhere in this window',
  [DROP_OVERLAY]: 'Drop to open',
  // A RECENT CARD'S SECOND LINE, v5-01's shape: *Today · Documents › Leases*. The known folders are
  // Windows' own names for them; the folder after the arrow is the person's own and is never translated.
  [PRIVACY_RECENT_PREVIEWS_TITLE]: 'Show previews of recent files',
  [PRIVACY_RECENT_PREVIEWS_DESCRIPTION]:
    'Keeps a small picture of each recent file’s first page, made when you opened it. Turning this off deletes them.',
  // v5-01's header over the cards, and its one action.
  [RECENT_HEADING]: 'Recent',
  [RECENT_CLEAR]: 'Clear list',
  // A CARD WITH NO PICTURE shows the page's shape and its type, the way a file icon does.
  [RECENT_PLACEHOLDER]: 'PDF',
  [RECENT_TODAY]: 'Today',
  [RECENT_YESTERDAY]: 'Yesterday',
  [RECENT_IN_DOCUMENTS]: 'Documents',
  [RECENT_IN_DOWNLOADS]: 'Downloads',
  [RECENT_IN_DESKTOP]: 'Desktop',
  [RECENT_WHERE_NESTED]: '{within} › {folder}',
  [RECENT_META]: '{when} · {where}',
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
  [FORMS_LABEL]: 'Form fields in this document',
  [FORMS_EMPTY]: 'This document has no form fields.',
  [FORMS_UNAVAILABLE]: 'The form fields in this document could not be read.',
  [FORMS_TRUNCATED]: 'Only the first 4,096 form fields are listed.',
  // THE FIELD'S OWN NAME, which is document data rather than a catalogue
  // string — a form's vocabulary belongs to whoever wrote the form. The kind
  // is beside it because two fields can share a name: a radio group is one
  // field with several widgets, and a reader scanning the list needs to know
  // which is which.
  [FORMS_ROW]: '{name} — {kind}, page {page}',
  [FORMS_GO_TO_PAGE]: 'Go to page {page}',
  // SAYS WHOSE DECISION IT IS. *Disabled* would read as a fault in the
  // application; the document set this flag, and the reader can do nothing
  // about it here.
  [FORMS_READ_ONLY]: 'The document marks this field read-only.',
  // AND THE OTHER REASON A CONTROL IS ABSENT, kept apart from it: a signature
  // and a push button are not fields a person types into at all, which is a
  // different fact from one this document happens to have locked.
  [FORMS_NOT_FILLABLE]: 'This field is not one that can be filled here.',
  // THE EMPTY CHOICE, which is a real value rather than a missing one:
  // measured, clearing a dropdown stores the empty string, and a document may
  // arrive with one already cleared.
  [FORMS_CHOICE_EMPTY]: '(none)',
  // A FIELD HOLDING SEVERAL VALUES, which this build can read and cannot write:
  // a fill carries one option, so offering the control would collect a choice
  // whose command discards the rest. It names the values so the reader can see
  // what is there rather than being told only that they cannot change it.
  [FORMS_MANY_VALUES]: 'This field holds several values ({values}), which cannot be changed here.',
  // "COULD BE" AND NEVER "ARE", because the measurement says the detector
  // cannot tell a field from an empty table cell — that is a fact about pages
  // rather than about this build, and a title claiming otherwise would be a
  // guess wearing an observation's clothes.
  [FLAT_FIELDS_COMMAND_TITLE]: 'Find fields on this page…',
  [FLAT_FIELDS_TITLE]: 'Fields this page could have',
  [FLAT_FIELDS_GUESSED]:
    'Monstera looked for ruled lines and boxes with a label beside them and nothing written in them. An empty box in a table looks the same, so check the list before accepting it.',
  [FLAT_FIELDS_NONE]: 'Nothing on this page looks like a place to write.',
  [FLAT_FIELDS_TRUNCATED]: 'There were more than Monstera lists here, so this page may have others.',
  [FLAT_FIELDS_ALL_TEXT]:
    'These are all created as text fields. Use the Forms tools to draw a tick box, a dropdown or a list.',
  [FLAT_FIELDS_ACCEPT]: 'Create {count} field(s)',
  [EDIT_TEXT_COMMAND_TITLE]: 'Edit text on the page',
  [TEXT_EDIT_LAYER_LABEL]: 'Editable text on page {page}',
  // THE BLOCK'S OWN FIRST WORDS name it, so a person moving through the page
  // with Tab or a screen reader hears which text each outline holds.
  [TEXT_EDIT_BLOCK_LABEL]: 'Edit “{words}”',
  [TEXT_EDIT_EDITOR_LABEL]: 'Text being edited. Press Esc when you are done.',
  [TEXT_EDIT_NONE]: 'This page has no text that can be edited.',
  [TEXT_EDIT_TRUNCATED]: 'This page has more text than can be outlined at once; some of it is not outlined.',
  // NAMES THE CAUSE IN A READER'S WORDS, and does not apologise. *Pasted in as
  // a block* is how a Form XObject got there to somebody who did not make the
  // PDF, and the button beside it is what makes the text editable.
  [TEXT_EDIT_UNADDRESSABLE]: 'Some text on this page was pasted in as a block and is not outlined.',
  // SAYS WHAT IT DOES TO THE PAGE: the block becomes ordinary page content,
  // which is a change to the document a person is agreeing to.
  [TEXT_EDIT_PROMOTE]: 'Unpack it so it can be edited',
  [TEXT_EDIT_ROTATED]: 'Text set at an angle on this page can’t be edited in place.',
  // SAYS NOTHING CHANGED FIRST, then what to do: the editor stays open with the
  // words, so the person can change the ones the font cannot show.
  [TEXT_EDIT_NOT_WRITABLE]:
    'Nothing was changed: the font on this page can’t show some of the characters you typed. Change them, or press Esc to put the text back.',
  // SAYS WHAT THE PAGE IS, not what the application cannot do. A reader looking
  // at words they cannot select has one question — why — and *this page is a
  // picture* answers it. It deliberately does not say *scanned*: the kernel
  // reports a raster and no text, which is also what a full-page diagram is,
  // and a message may not claim more than the reading behind it.
  [PAGE_IMAGE_ONLY]: 'This page is a picture, so there is no text to select or search.',
  [EDIT_PAGE_OBJECT_TITLE]: 'Edit an object on this page',
  // SAYS WHAT A ROW IS BEFORE OFFERING ANY, `FlatFieldsBody`'s rule. Each row
  // is a thing drawn on the page and the numbers are where it sits, measured
  // from the bottom-left corner — which is the PDF's own origin and not the
  // one a person would assume, so it is said rather than left to be inferred
  // from rows that look upside down.
  [EDIT_PAGE_OBJECT_EXPLAINS]:
    'Everything drawn on a page is a separate object. The numbers are where each one sits, in points from the bottom-left corner. Pick one, then move it, resize it, change its colour or remove it — you can undo any of these.',
  [EDIT_PAGE_OBJECT_WHICH]: 'Which object',
  [EDIT_PAGE_OBJECT_MOVE_X]: 'Move right by (points)',
  [EDIT_PAGE_OBJECT_MOVE_Y]: 'Move up by (points)',
  [EDIT_PAGE_OBJECT_SCALE_X]: 'Width × ',
  [EDIT_PAGE_OBJECT_SCALE_Y]: 'Height × ',
  [EDIT_PAGE_OBJECT_PLACE]: 'Move and resize',
  [EDIT_PAGE_OBJECT_COLOUR]: 'Colour',
  [EDIT_PAGE_OBJECT_RECOLOR]: 'Change colour',
  // SAYS WHOSE LIMITATION IT IS. *Cannot* would read as Monstera refusing; the
  // honest version is that the engine will not describe this object's colour,
  // which is also what tells a person that trying again will not help.
  [EDIT_PAGE_OBJECT_NO_FILL]: 'Monstera cannot read a colour for this object, so it cannot change it.',
  [EDIT_PAGE_OBJECT_DELETE]: 'Remove from page',
  [EDIT_PAGE_OBJECT_NONE]: 'This page has nothing drawn on it.',
  [EDIT_PAGE_OBJECT_TRUNCATED]:
    'There was more on this page than Monstera lists here, so it may have other objects.',
  // THE KINDS, as words a person recognises rather than PDF's vocabulary. A
  // reader does not know what a *path* is and does know what a shape is; the
  // one that stays technical is `form`, because it is a PDF form XObject rather
  // than a fillable form and calling it either would be worse than saying
  // *group*.
  [OBJECT_KIND_UNKNOWN]: 'Something else',
  [OBJECT_KIND_TEXT]: 'Text',
  [OBJECT_KIND_PATH]: 'Shape',
  [OBJECT_KIND_IMAGE]: 'Image',
  [OBJECT_KIND_SHADING]: 'Gradient',
  [OBJECT_KIND_FORM]: 'Group',
  // SAYS WHAT IT REMOVES, not just "Delete" — the annotation panel's argument
  // one walk along. The rows beside it name similar fields, and a bare verb on
  // a list of similar rows is the label a person clicks on the wrong line. It
  // also says FIELD rather than value, because the two are different actions
  // and the control next to it performs the other one.
  [FORMS_DELETE]: 'Delete this field',
  // NAMES THE CONSEQUENCE, not the verb. "Flatten" is the operation's name in
  // every PDF tool and it says nothing to a person who has not met it, so the
  // label says what changes about their document — and the confirmation says
  // the part that cannot be taken back.
  [FORMS_FLATTEN]: 'Flatten form',
  [FORMS_FLATTEN_CONFIRM]:
    'Flattening draws every field’s contents onto the page and removes the form. The fields can no longer be filled in. Comments are not affected.',
  // THE TOOLS SAY "DRAW", which is what the gesture is and what separates them
  // from the Forms panel's controls: those fill a field that exists, these put
  // one on the page.
  [FORM_FIELD_TEXT_TOOL_TITLE]: 'Draw a text field',
  [FORM_FIELD_CHECKBOX_TOOL_TITLE]: 'Draw a tick box',
  [FORM_FIELD_RADIO_TOOL_TITLE]: 'Draw a radio option',
  [FORM_FIELD_DROPDOWN_TOOL_TITLE]: 'Draw a dropdown',
  [FORM_FIELD_LISTBOX_TOOL_TITLE]: 'Draw a list box',
  [FORM_FIELD_TEXT_TITLE]: 'New text field',
  [FORM_FIELD_CHECKBOX_TITLE]: 'New tick box',
  [FORM_FIELD_RADIO_TITLE]: 'New radio option',
  [FORM_FIELD_DROPDOWN_TITLE]: 'New dropdown',
  [FORM_FIELD_LISTBOX_TITLE]: 'New list box',
  [FORM_FIELD_TEXT_APPLY]: 'Add text field',
  [FORM_FIELD_CHECKBOX_APPLY]: 'Add tick box',
  [FORM_FIELD_RADIO_APPLY]: 'Add radio option',
  [FORM_FIELD_DROPDOWN_APPLY]: 'Add dropdown',
  [FORM_FIELD_LISTBOX_APPLY]: 'Add list box',
  [FORM_FIELD_NAME_LABEL]: 'Field name',
  // THE GROUP'S NAME, not this widget's, and the label says so because a radio
  // group is one field with several widgets — so drawing a second option means
  // typing the SAME name again, which is the one thing about radio groups
  // people get wrong.
  [FORM_FIELD_GROUP_LABEL]: 'Group name — type the same name for every option in this group',
  [FORM_FIELD_OPTION_LABEL]: 'This option’s value',
  [FORM_FIELD_OPTIONS_LABEL]: 'Choice',
  [FORM_FIELD_ADD_OPTION]: 'Add a choice',
  [FORM_FIELD_REMOVE_OPTION]: 'Remove this choice',
  // NAMES WHAT IS MISSING rather than what is wrong: the field is empty when
  // the dialog opens, so this is the first sentence a person reads.
  [FORM_FIELD_NAME_EMPTY]: 'Give the field a name so it can be filled in and read back.',
  [FORM_FIELD_NAME_TOO_LONG]: 'That name is too long.',
  // EXPLAINS THE DOT, because nothing about a trailing dot looks wrong. A dot
  // groups fields — measured, `owner.first` and `owner.second` are two fields
  // under one parent — so an empty piece asks for a group with no name.
  [FORM_FIELD_NAME_SEGMENT]:
    'A dot groups fields, so “owner.first” and “owner.second” belong together. Every piece between dots needs a name.',
  [FORM_FIELD_OPTIONS_EMPTY]: 'Give it at least one choice, or nobody can pick anything.',
  [FORMS_KIND_TEXT]: 'Text',
  [FORMS_KIND_CHECKBOX]: 'Tick box',
  [FORMS_KIND_RADIO]: 'Option',
  [FORMS_KIND_DROPDOWN]: 'Dropdown',
  [FORMS_KIND_LISTBOX]: 'List',
  [FORMS_KIND_SIGNATURE]: 'Signature',
  [FORMS_KIND_BUTTON]: 'Button',
  [FORMS_KIND_OTHER]: 'Field',
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
  [EDITING_COLOUR_TITLE]: 'Annotation colour',
  [EDITING_AUTHOR_NAME_TITLE]: 'Your name for comments',
  // SAYS WHERE THE NAME GOES, because it leaves the machine in every document the person shares.
  [EDITING_AUTHOR_NAME_DESCRIPTION]:
    'Written into every comment and mark you make, and seen by anyone you share the document with. Leave it empty to use your Windows user name.',
  [EDITING_OPACITY_TITLE]: 'Annotation opacity',
  [EDITING_LINE_WIDTH_TITLE]: 'Annotation line width',
  [EDITING_FONT_SIZE_TITLE]: 'Annotation font size',
  [EDITING_IMAGE_PAGES_TITLE]: 'Place images on',
  [STYLE_PANEL_LABEL]: 'Annotation style',
  // SAID RATHER THAN SHOWN AS ZERO. Six subtypes have no `/BS` at all, and a 0
  // reads as *no border* rather than *no such property* — which is what a person
  // would then try to set.
  [COMMENT_STYLES_NO_WIDTH]: 'This kind carries no line width.',
  // *EACH TOOL'S OWN* rather than *Automatic*, because that is what the state
  // means: a highlighter stays yellow and a caret stays red. *Automatic* would
  // suggest something is being worked out from the page.
  [STYLE_COLOUR_AUTO]: 'Each tool’s own',
  // *ANNOTATIONS* AND NOT v5-02's *highlights*: the four style settings are shared by every tool, so
  // naming the selected kind would promise a per-kind default nothing stores.
  [PROPERTIES_AS_DEFAULT]: 'Use as default for new annotations',
  [PROPERTIES_AUTHOR]: 'Author',
  [PROPERTIES_BLEND]: 'Blend',
  // THE FORMAT'S OWN NAMES, which are what every other PDF tool calls them.
  [PROPERTIES_BLEND_MULTIPLY]: 'Multiply',
  [PROPERTIES_BLEND_NORMAL]: 'Normal',
  [PROPERTIES_CREATED]: 'Created {when}',
  [PROPERTIES_COLOUR]: 'Colour',
  [PROPERTIES_OPACITY]: 'Opacity',
  [PROPERTIES_OPACITY_VALUE]: '{opacity, number, percent}',
  [PROPERTIES_LINE_WIDTH]: 'Line width',
  [PROPERTIES_WIDTH_VALUE]: '{width, number} pt',
  [PROPERTIES_FONT_SIZE]: 'Font size',
  [PROPERTIES_COMMENT]: 'Comment',
  [PROPERTIES_NEW_HEADING]: 'New annotations',
  [PROPERTIES_NEW_HINT]: 'These set how the next annotation is drawn. Select one on the page to change it.',
  [PROPERTIES_WHERE]: '{count, plural, one {Page {page}} other {# selected · page {page}}}',
  [PROPERTIES_ACTIONS]: 'Selected annotation',
  [PROPERTIES_CUSTOM_COLOUR]: 'Custom colour',
  [PROPERTIES_COLOUR_YELLOW]: 'Yellow',
  [PROPERTIES_COLOUR_GREEN]: 'Green',
  [PROPERTIES_COLOUR_BLUE]: 'Blue',
  [PROPERTIES_COLOUR_PINK]: 'Pink',
  [PROPERTIES_COLOUR_ORANGE]: 'Orange',
  [PROPERTIES_COLOUR_PURPLE]: 'Purple',
  [PROPERTIES_COLOUR_RED]: 'Red',
  [PROPERTIES_COLOUR_GREY]: 'Grey',
  [ANNOTATIONS_KIND_CALLOUT]: 'Callout',
  [ANNOTATIONS_KIND_TYPEWRITER]: 'Typed text',
  // NAMED AS MEASUREMENTS rather than as the shapes they are: the file itself
  // says so through `/IT`, and a reader scanning the list wants to know which
  // lines are dimensions.
  [ANNOTATIONS_KIND_MEASURE_DISTANCE]: 'Distance',
  [ANNOTATIONS_KIND_MEASURE_AREA]: 'Area',
  [ANNOTATIONS_KIND_MEASURE_PERIMETER]: 'Perimeter',
  [MEASURE_DISTANCE_TOOL_TITLE]: 'Measure distance',
  [MEASURE_AREA_TOOL_TITLE]: 'Measure area',
  [MEASURE_PERIMETER_TOOL_TITLE]: 'Measure perimeter',
  [MEASURE_SCALE_TITLE]: 'Measurement scale, per point',
  [MEASURE_UNIT_TITLE]: 'Measurement unit',
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
  [SNAPSHOT_TOOL_TITLE]: 'Snapshot a region',
  [PLACE_IMAGE_TOOL_TITLE]: 'Place an image',
  // SAYS WHAT THE DRAG PRODUCES. "OCR region" is the row's name and means nothing
  // to a reader who has not met the acronym; the words it puts on the page are what
  // they are after.
  [OCR_REGION_TOOL_TITLE]: 'Recognise text in a box',
  // THE SERVICE IS NAMED AND SO IS THE SENDING. What a reader is choosing here
  // is that this part of their document leaves the machine, and a title like
  // "Recognise with better accuracy" would hide the only thing about this
  // control they could not work out for themselves.
  [CLOUD_REGION_TOOL_TITLE]: 'Send a box to Azure to recognise',
  [LINK_ADDRESS_TOOL_TITLE]: 'Link to a web address',
  [LINK_PAGE_TOOL_TITLE]: 'Link to a page',
  [DOCUMENT_PASSWORD_TITLE]: 'This document is protected',
  [DOCUMENT_PASSWORD_ASKS]: '{name} needs a password before it can be opened.',
  [DOCUMENT_PASSWORD_LABEL]: 'Password',
  [DOCUMENT_PASSWORD_APPLY]: 'Open document',
  [DOCUMENT_PASSWORD_EMPTY]: 'Type the password to open this document.',
  [DOCUMENT_PASSWORD_WRONG]: 'That password did not open the document. Try again.',
  [DOCUMENT_PASSWORD_TOO_LONG]: 'That is longer than any password this format can carry.',

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
  [SELECTION_PROPERTIES_TITLE]: 'Properties',
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
  // EDITING, so the words say *change* rather than *add*: the field opens
  // holding what the mark already says, and a button reading "Add" over a
  // pre-filled box describes something the command does not do.
  [ANNOTATION_EDIT_TITLE]: 'Edit comment',
  [ANNOTATION_EDIT_LABEL]: 'Comment',
  [ANNOTATION_EDIT_APPLY]: 'Save comment',
  // NOT "type a comment" — there was one a moment ago, and a person who cleared
  // the box is being told what happens next rather than what they forgot.
  [ANNOTATION_EDIT_EMPTY]: 'A comment cannot be empty. To remove it, delete the mark instead.',
  [ANNOTATION_EDIT_TOO_LONG]: 'That is too long for one comment. Shorten it, or use several.',
  [EDIT_SELECTION_TITLE]: 'Edit comment…',
  // ANSWERING SOMEBODY, so the words are about the exchange rather than about
  // the page: the box collects a reply to a comment that is already there, and
  // *Add note* over it would describe a mark of its own.
  [ANNOTATION_REPLY_TITLE]: 'Reply',
  [ANNOTATION_REPLY_LABEL]: 'Your reply',
  [ANNOTATION_REPLY_APPLY]: 'Post reply',
  [ANNOTATION_REPLY_EMPTY]: 'Type the reply this comment should get.',
  [ANNOTATION_REPLY_TOO_LONG]: 'That is too long for one reply. Shorten it, or post several.',
  [REPLY_SELECTION_TITLE]: 'Reply…',
  // THE ROW SAYS IT IS AN ANSWER, because the panel is a flat list and two
  // marks at the same spot are otherwise indistinguishable from a duplicate.
  [ANNOTATIONS_REPLY_ROW]: 'Reply',
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
  [STATUS_PAGE_TOTAL]: '/ {count}',
  [STATUS_NAVIGATION]: 'Page navigation',
  [STATUS_ZOOM_GROUP]: 'Zoom',
  [STATUS_CHROME_GROUP]: 'Panels and toolbars',
  [STATUS_SAVED_STATE]: 'Saved state',
  [STATUS_PAGES]: '{count, plural, one {# page} other {# pages}}',
  [STATUS_SIZE_KB]: '{size, number} KB',
  [STATUS_SIZE_MB]: '{size, number} MB',
  [STATUS_UNSAVED]: 'Unsaved changes',
  [STATUS_SAVED]: 'Saved',
  [STATUS_SAVED_JUST_NOW]: 'Saved just now',
  [STATUS_SAVED_MINUTES]: '{count, plural, one {Saved 1 min ago} other {Saved # min ago}}',
  [STATUS_SAVED_HOURS]: '{count, plural, one {Saved 1 hr ago} other {Saved # hr ago}}',
  [STATUS_SAVED_DAYS]: '{count, plural, one {Saved 1 day ago} other {Saved # days ago}}',
  [TAB_UNSAVED]: 'Unsaved changes',
  [WINDOW_TITLE]: 'Monstera PDF Editor',
  [WINDOW_TITLE_DOCUMENT]: '{file} — Monstera PDF Editor',
  [WINDOW_TITLE_UNSAVED]: '{file} ● — Monstera PDF Editor',
  [TOAST_DISMISS]: 'Dismiss',
  [TOAST_SAVED]: 'Saved',
  [TOAST_COPY_SAVED]: 'Copy saved',
  [TOAST_SMALLER_COPY_SAVED]: 'Smaller copy saved',
  [TOAST_PAGES_SAVED]: 'Pages saved',
  [TOAST_SAVED_BACK]: 'Saved to cloud storage',
  [STATUS_ZOOM_SLIDER]: 'Zoom level',
  [THUMBNAILS_LABEL]: 'Page thumbnails',
  [PANEL_PAGES]: 'Pages',
  [PANEL_BOOKMARKS]: 'Bookmarks',
  [PANEL_COMMENTS]: 'Comments',
  [PANEL_FORMS]: 'Forms',
  [PANEL_LAYERS]: 'Layers',
  [PANEL_SEARCH]: 'Search',
  [PANEL_STRIP_LABEL]: 'Document panels',
  [PANEL_COLLAPSE]: 'Collapse the document panel',
  [PANEL_REOPEN]: 'Show the document panel',
  [DOCUMENT_PANEL_TITLE]: 'Document panel',
  [DOCUMENT_PANEL_OPEN_TITLE]: 'Show the document panel',
  [DOCUMENT_PANEL_WIDTH_TITLE]: 'Document panel width',
  [PANEL_RESIZE]: 'Resize the document panel',
  [CONTEXT_PANEL_LABEL]: 'Properties',
  [CONTEXT_PANEL_TAB_TITLE]: 'Contextual panel tab',
  [CONTEXT_PANEL_TAB_PROPERTIES]: 'Properties',
  [CONTEXT_PANEL_TAB_ASSISTANT]: 'Assistant',
  [CONTEXT_PANEL_TAB_STRIP]: 'Contextual panel tabs',
  [ASSISTANT_PROVIDER_LABEL]: 'Provider',
  [ASSISTANT_MODEL_LABEL]: 'Model',
  [ASSISTANT_COMPOSER_LABEL]: 'Ask about this document',
  [ASSISTANT_CONVERSATION_LABEL]: 'Conversation',
  [ASSISTANT_SEND]: 'Send',
  [ASSISTANT_STOP]: 'Stop',
  [ASSISTANT_REGENERATE]: 'Regenerate this answer',
  [OPEN_ASSISTANT_TITLE]: 'Open the assistant',
  [ASSISTANT_EDIT]: 'Edit your question and ask again',
  [ASSISTANT_EDITING]: 'Editing your last question. Send replaces it and its answer.',
  [ASSISTANT_EDIT_CANCEL]: 'Cancel',
  [ASSISTANT_COPY]: 'Copy this answer',
  [ASSISTANT_COPIED]: 'Copied',
  [ASSISTANT_ADD_NOTE]: 'Add this answer to the page as a note',
  [ASSISTANT_NOTED]: 'Added to the page as a note',
  [ASSISTANT_NEW_CHAT]: 'New chat',
  [ASSISTANT_CAPTION]: '{model} · {scope}',
  [ASSISTANT_SCOPE_PAGE]: 'page {page}',
  [ASSISTANT_SCOPE_DOCUMENT]: 'whole document',
  [ASSISTANT_SCOPE_COMMENTS]: 'all comments',
  [ASSISTANT_SCOPE_PICTURE]: 'picture of page {page}',
  [ASSISTANT_SCOPE_SELECTION]: 'selected text',
  [ASSISTANT_SCOPE_COMMENT]: 'one comment',
  [ASSISTANT_SCOPE_NOTHING]: 'no document',
  [ASSISTANT_SCOPE_LEFT]: 'left document',
  [ASSISTANT_SCOPE_RIGHT]: 'right document',
  [ASSISTANT_SCOPE_BOTH]: 'both documents',
  [ASSISTANT_YOU]: 'You',
  [ASSISTANT_ASSISTANT]: 'Assistant',
  [ASSISTANT_EMPTY]: 'No provider key is stored yet. Add one in Settings › AI and the assistant can start answering.',
  [ASSISTANT_ASK]: 'Enter sends. Shift+Enter starts a new line.',
  [ASSISTANT_NO_KEY]: 'This provider has no key stored. Add it in Settings › AI; the key stays on this machine.',
  [ASSISTANT_NO_MODELS]: 'No models are listed for this provider yet. With a key stored, the list is fetched from the provider.',
  [ASSISTANT_PROBLEM_UNAUTHORISED]: 'The provider did not accept the key. Check it in Settings › AI, then ask again.',
  [ASSISTANT_PROBLEM_UNREACHABLE]: 'The provider could not be reached. Check the connection, then ask again.',
  [ASSISTANT_PROBLEM_REJECTED]: 'The provider refused the request, so nothing more arrived. What is above is what it sent.',
  // THE OWNER'S WORDING, 2026-09-19, verbatim: people will meet this from the assistant and from
  // Claude recognition, and it names the one place that fixes it.
  [ANTHROPIC_OUT_OF_CREDIT]: 'Your Anthropic account is out of credit — add credit at console.anthropic.com',
  [ASSISTANT_PROBLEM_UNREADABLE]: 'The answer stopped part way. What is above is what arrived.',
  [AI_PROVIDER_NAMES.anthropic]: 'Anthropic',
  [AI_PROVIDER_NAMES.openai]: 'OpenAI',
  [AI_PROVIDER_NAMES.gemini]: 'Google Gemini',
  [AI_PROVIDER_NAMES.mistral]: 'Mistral',
  [AI_PROVIDER_NAMES.xai]: 'xAI',
  [AI_PROVIDER_NAMES['azure-openai']]: 'Azure OpenAI',
  [AI_PROVIDER_NAMES.openrouter]: 'OpenRouter',
  [AI_PROVIDER_NAMES.groq]: 'Groq',
  [AI_PROVIDER_NAMES.perplexity]: 'Perplexity',
  [AI_PROVIDER_NAMES.deepseek]: 'DeepSeek',
  [ASSISTANT_ABOUT_LABEL]: 'Asking about',
  [ASSISTANT_ABOUT_PAGE]: 'This page ({page})',
  [ASSISTANT_ABOUT_DOCUMENT]: 'The whole document, up to {characters} characters',
  [ASSISTANT_ABOUT_SELECTION]: 'The text you selected on page {page}',
  [ASSISTANT_ABOUT_COMMENT]: 'The comment on page {page}',
  [ASSISTANT_ABOUT_COMMENTS]: 'All the comments in this document',
  // VISION ANALYSIS (ADR-0090): what goes is a picture, and the line says so before Send.
  [ASSISTANT_ABOUT_PICTURE]: 'A picture of this page ({page})',
  [ASSISTANT_SENT_PICTURE]: 'Sent a picture of page {page} of {count}',
  [ASSISTANT_SENT_COMMENTS]: '{comments, plural, one {Sent the one comment in this document} other {Sent all # comments in this document}}',
  [ASSISTANT_SENT_COMMENTS_CUT]: '{comments, plural, one {Sent the first comment — the list was too long to send whole} other {Sent the first # comments — the list was too long to send whole}}',
  [ASSISTANT_NO_VISION]: 'This model cannot read pictures. Choose a model that can, or ask about the page’s text.',
  [ASSISTANT_PROBLEM_PAGE_TOO_LARGE]: 'This page is too large to send as a picture. Ask about its text instead.',
  [ASSISTANT_QUICK_READ_TABLE]: 'Read the table on this page',
  [SUMMARISE_COMMENTS_TITLE]: 'Summarise comments',
  [ASSISTANT_PROMPT_SUMMARISE_COMMENTS]:
    'Summarise the comments on this document: what people ask for, what they point out, and what is still open. Cite the page of each point.',
  [GROUP_AI]: 'AI',
  // CLOUD STORAGE (ADR-0091). Plain words for where a provider stands and what failed.
  [CLOUD_TITLE]: 'Cloud storage',
  [CLOUD_COMMAND_TITLE]: 'Cloud storage…',
  [SAVE_BACK_TITLE]: 'Save back to cloud',
  [CLOUD_OUTCOME_TITLE]: 'Save back to cloud',
  [CLOUD_SIGN_IN]: 'Sign in',
  [CLOUD_SIGN_OUT]: 'Sign out',
  [CLOUD_LIST]: 'Show my PDFs',
  [CLOUD_UPLOAD]: 'Upload this document',
  [CLOUD_OPEN]: 'Open {name}',
  [CLOUD_FILES_LABEL]: 'PDFs in cloud storage',
  [CLOUD_FILES_EMPTY]: 'No PDFs were found here.',
  [CLOUD_GOOGLE_NOTE]:
    'Monstera can see only the Google Drive files it put there. To open one of your other PDFs from Monstera, upload it with Upload this document first.',
  [CLOUD_NOTE_SIGNED_IN]: 'Signed in.',
  [CLOUD_NOTE_SIGNED_OUT]: 'Signed out on this computer. Nothing in your cloud storage changed.',
  [CLOUD_NOTE_UPLOADED]: 'Uploaded. Save back to cloud now sends this document to that copy.',
  [SAVE_BACK_NOT_FROM_CLOUD]:
    'This document was not opened from cloud storage. To put it there, use Cloud storage… and Upload this document.',
  [SAVE_BACK_SAVE_FAILED]: 'The document could not be saved on this computer, so nothing was sent.',
  [SAVE_BACK_KEPT_HERE]: 'Your changes are saved on this computer. Try Save back to cloud again when the problem is fixed.',
  [CLOUD_PROVIDER_NAMES.onedrive]: 'OneDrive',
  [CLOUD_PROVIDER_NAMES['google-drive']]: 'Google Drive',
  [CLOUD_STATE_NAMES['not-configured']]: 'Not available in this build',
  [CLOUD_STATE_NAMES['signed-out']]: 'Not signed in',
  [CLOUD_STATE_NAMES['signed-in']]: 'Signed in',
  [CLOUD_PROBLEMS['not-configured']]: 'This build of Monstera is not set up to reach this provider.',
  [CLOUD_PROBLEMS['secrets-unavailable']]:
    'This computer cannot store a sign-in securely right now, so none can be kept.',
  [CLOUD_PROBLEMS['sign-in-cancelled']]: 'The sign-in was cancelled.',
  [CLOUD_PROBLEMS['sign-in-timed-out']]: 'The sign-in took too long and was stopped. Try again.',
  [CLOUD_PROBLEMS['sign-in-denied']]: 'The sign-in was declined, so nothing was connected.',
  [CLOUD_PROBLEMS['sign-in-unavailable']]: 'Monstera could not start the sign-in in your browser.',
  [CLOUD_PROBLEMS.unauthorised]: 'The provider no longer accepts this sign-in. Sign in again.',
  [CLOUD_PROBLEMS.unreachable]: 'The provider could not be reached. Check your connection.',
  [CLOUD_PROBLEMS.rejected]: 'The provider refused the request.',
  [CLOUD_PROBLEMS['unexpected-answer']]: 'The provider’s answer could not be read.',
  [CLOUD_PROBLEMS['changed-elsewhere']]:
    'The file changed in cloud storage since you opened it, so it was not overwritten. Your changes are saved on this computer.',
  [CLOUD_PROBLEMS['too-large']]: 'The document is too large to send in one piece.',
  [CLOUD_PROBLEMS['not-a-pdf']]: 'That file is not a PDF Monstera can open.',
  // BUILD-PROMPT E5's FIRST-RUN STEP. Skip is said to be fine, because it is: nothing but the
  // assistant needs a key.
  [AI_SETUP_TITLE]: 'Set up the AI assistant',
  [AI_SETUP_COMMAND_TITLE]: 'Set up AI…',
  [AI_SETUP_INTRO]:
    'The assistant answers questions about your documents using an AI provider you choose, with your own key. Everything else in Monstera works without one, so you can skip this and add a key later in Settings.',
  [AI_SETUP_PROVIDER]: 'Provider',
  [AI_SETUP_KEY]: 'API key',
  [AI_SETUP_ENDPOINT]: 'Azure OpenAI endpoint',
  [AI_SETUP_CHECK]: 'Check and save',
  [AI_SETUP_SKIP]: 'Skip',
  [AI_SETUP_STORAGE_UNAVAILABLE]:
    'This computer cannot store a key securely right now, so none can be saved. You can skip this and try again later.',
  [AI_SETUP_UNAUTHORISED]: 'The provider did not accept that key, so it was not saved. Check it and try again.',
  [AI_SETUP_UNREACHABLE]: 'The provider could not be reached, so the key was not saved. Check your connection and try again.',
  [AI_SETUP_REJECTED]: 'The provider refused the check, so the key was not saved.',
  [AI_SETUP_UNREADABLE]: 'The provider’s answer could not be read, so the key was not saved.',
  [AI_SETUP_NOT_STORED]: 'The key could not be stored securely on this computer, so it was not saved.',
  [AI_SETUP_AT_START_TITLE]: 'Offer AI setup when Monstera starts',
  [AI_SAVE_HISTORY_TITLE]: 'Save chat history',
  [ASSISTANT_ABOUT_NOTHING]: 'Nothing from the document',
  // WHO RECEIVES IT AND WHEN, which is BUILD-PROMPT's consent sentence: document content goes
  // to a provider only on an explicit action, and the panel says which provider.
  [ASSISTANT_ABOUT_SENDS]: 'Sent to {provider} only when you press Send.',
  [ASSISTANT_SENT_PAGE]: 'Sent page {page} of {count}',
  [ASSISTANT_SENT_PAGES]: 'Sent pages {first} to {last} of {count}',
  [ASSISTANT_SENT_CUT]: '— cut short at {characters} characters',
  [ASSISTANT_SENT_NOTHING]: 'No text was found to send',
  [ASSISTANT_CITATION]: 'Go to page {page}',
  [ASSISTANT_CITATION_RIGHT]: 'Go to page {page} of the document on the right',
  // THE OWNER'S THREE WORDS, for two documents side by side (ADR-0089).
  [ASSISTANT_SIDES_LABEL]: 'Which document',
  [ASSISTANT_SIDE_LEFT]: 'Left',
  [ASSISTANT_SIDE_RIGHT]: 'Right',
  [ASSISTANT_SIDE_BOTH]: 'Both',
  [ASSISTANT_SIDES_NEEDED]: 'Two documents are side by side. Choose Left, Right or Both, then send.',
  [ASSISTANT_SENT_LEFT]: 'Left: {sent}',
  [ASSISTANT_SENT_RIGHT]: 'Right: {sent}',
  [ASSISTANT_QUICK_LABEL]: 'Start with',
  [ASSISTANT_QUICK_SUMMARISE]: 'Summarise this document',
  [ASSISTANT_QUICK_DATES]: 'List the dates and deadlines in this document',
  [ASSISTANT_QUICK_EXPLAIN_PAGE]: 'Explain this page',
  [ASK_AI_SELECTION_TITLE]: 'Ask AI',
  [EXPLAIN_SELECTION_TITLE]: 'Explain',
  [SUMMARISE_SELECTION_TITLE]: 'Summarise',
  [TRANSLATE_SELECTION_TITLE]: 'Translate',
  [DRAFT_REPLY_TITLE]: 'Draft a reply with AI',
  [ASSISTANT_PROMPT_EXPLAIN]: 'Explain the selected text in plain language.',
  [ASSISTANT_PROMPT_SUMMARISE]: 'Summarise the selected text.',
  // THE CATALOGUE'S OWN LANGUAGE: a French catalogue says French, so the translation lands in
  // the language the person reads the application in.
  [ASSISTANT_PROMPT_TRANSLATE]: 'Translate the selected text into English.',
  [ASSISTANT_PROMPT_DRAFT_REPLY]: 'Draft a short, polite reply to this comment. Answer with the reply alone.',
  [ASSISTANT_POST_REPLY]: 'Post as a reply',
  [CONTEXT_PANEL_RESIZE]: 'Resize the properties panel',
  [CONTEXT_PANEL_COLLAPSE]: 'Collapse the properties panel',
  [CONTEXT_PANEL_REOPEN]: 'Show the properties panel',
  [CONTEXT_PANEL_OPEN_TITLE]: 'Show the properties panel',
  [QUICK_TOOLBAR_OPEN_TITLE]: 'Show the floating toolbar',
  [QUICK_TOOLBAR_EDGE_TITLE]: 'Floating toolbar side',
  [QUICK_TOOLBAR_EDGE_START]: 'Left side of the pages',
  [QUICK_TOOLBAR_EDGE_END]: 'Right side of the pages',
  [QUICK_TOOLBAR_TOGGLE_TITLE]: 'Show or hide the floating toolbar',
  [DOCUMENT_PANEL_TOGGLE_TITLE]: 'Show or hide the document panel',
  [CONTEXT_PANEL_TOGGLE_TITLE]: 'Show or hide the properties panel',
  [CONTEXT_PANEL_WIDTH_TITLE]: 'Properties panel width',
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
  [SETTINGS_SECRET_NOT_STORED]:
    '{setting} was not saved. Whatever was stored before is unchanged.',
  [SETTINGS_COMMAND_TITLE]: 'Settings',
  [SETTINGS_TITLE]: 'Settings',
  [SETTINGS_SAVE]: 'Save',
  [SETTINGS_INVALID]: '{setting} holds a value it does not accept.',
  [SETTINGS_SECRET_STORED]: 'A key is stored. Type a new one to replace it.',
  [SETTINGS_SECRET_PLACEHOLDER]: '••••••••',
  [SETTINGS_SECRET_REMOVE]: 'Remove the stored key',
  [SETTINGS_SECRET_UNAVAILABLE]:
    'This computer has no secure place to keep a key, so one cannot be saved here.',
  [SETTINGS_CATEGORY_TITLES.general]: 'General',
  [SETTINGS_CATEGORY_TITLES.appearance]: 'Appearance',
  [SETTINGS_CATEGORY_TITLES.viewing]: 'Viewing',
  [SETTINGS_CATEGORY_TITLES.editing]: 'Editing defaults',
  [SETTINGS_CATEGORY_TITLES.privacy]: 'Privacy',
  [SETTINGS_CATEGORY_TITLES.advanced]: 'Advanced',
  [SETTINGS_CATEGORY_TITLES.rendering]: 'Rendering',
  [SETTINGS_SEARCH]: 'Search settings',
  [THEME_DESCRIPTION]: 'Light, dark, or whatever Windows is set to. High contrast follows Windows on its own.',
  [LAYOUT_MODE_DESCRIPTION]: 'Ribbon shows every tool; Studio keeps a compact strip; Focus hides the chrome.',
  [RULERS_DESCRIPTION]: 'Rulers along the top and left of the page.',
  [DARK_PAGE_DESCRIPTION]: 'Draws the page itself dark. The document is not changed.',
  [LOUPE_DESCRIPTION]: 'A magnifier that follows the pointer.',
  [GRID_DESCRIPTION]: 'A grid over the page, for lining marks up.',
  [RULER_UNIT_DESCRIPTION]: 'The unit the rulers and the measuring tools show.',
  [AI_SETUP_AT_START_DESCRIPTION]: 'Offers the one-step setup while no provider key is stored.',
  [AI_SAVE_HISTORY_DESCRIPTION]:
    'Off by default. Conversations are discarded when the document closes; saved ones are encrypted on this computer.',
  [AI_AZURE_OPENAI_ENDPOINT_DESCRIPTION]: 'Your own Azure OpenAI resource address. Needed only for that provider.',
  [INTEGRATIONS_DOCUSIGN_KEY_DESCRIPTION]: 'Write-only. Stored in the Windows credential vault.',
  [INTEGRATIONS_DOCUSIGN_ENVIRONMENT_DESCRIPTION]: 'Which DocuSign account the signing requests go to.',
  [ACCENT_PRESET_THEME]: 'The theme’s own',
  [ACCENT_PRESET_GREEN]: 'Green',
  [ACCENT_PRESET_BLUE]: 'Blue',
  [ACCENT_PRESET_VIOLET]: 'Violet',
  [ACCENT_PRESET_ORANGE]: 'Orange',
  // WHAT THE CODE ACTUALLY CHECKS (`accentUsable`): the accent as a FILL against this theme's
  // surfaces. It used to say *cannot carry readable text*, which described the rule the measurement
  // withdrew — text on the accent is solved per theme and never fails.
  [ACCENT_REJECTED]: '{colour} is too close to this theme’s background to stand out, so it is not offered.',
  [ACCENT_DESCRIPTION]:
    'Used for selection, active states and the primary button. A colour that would not stand out against this theme is not offered; text on it is worked out to stay readable.',
  [SETTINGS_PAGES_LABEL]: 'Settings pages',
  [SETTINGS_NO_MATCH]: 'Nothing matches “{query}”.',
  [SETTINGS_FOOTER_NOTE]: 'Changes save as you make them. Secrets are never exported.',
  [SETTINGS_EXPORT]: 'Export settings…',
  [SETTINGS_RESET]: 'Reset to defaults',
  [SETTINGS_DONE]: 'Done',
  [SETTINGS_AI_PROVIDER]: 'Provider',
  [SETTINGS_AI_PROVIDER_DESCRIPTION]: 'Document content is sent only when you press Send.',
  [SETTINGS_AI_PROVIDER_STORED]: '{provider} — key stored',
  [SETTINGS_ACTION_CLEAR_HISTORY]: 'Clear chat history',
  [SETTINGS_ACTION_CLEAR_HISTORY_DESCRIPTION]: 'Removes every saved conversation from this computer.',
  [SETTINGS_ACTION_CLEARED]: 'Saved conversations were cleared.',
  [SETTINGS_KEYBOARD_NOTE]: 'Press F1 for the full list of shortcuts, or open the command palette with Ctrl+K.',
  [SETTINGS_UPDATES_NOTE]:
    'Monstera is installed from the Microsoft Store, and Windows updates it. Monstera never installs anything itself.',
  // EVERY PAGE INTRODUCES ITSELF, as the owner's settings.png does. Each says what the page is
  // about in a person's words — never how it is built, which is the sentence settings2.png shows
  // as the thing that must not ship.
  [SETTINGS_APPEARANCE_NOTE]: 'Theme, accent colour and how much the window shows at once.',
  [SETTINGS_VIEWING_NOTE]: 'How pages are laid out and what you see as you move through a document.',
  [SETTINGS_RENDERING_NOTE]: 'How pages are drawn. Change these only if something looks wrong.',
  [SETTINGS_EDITING_NOTE]: 'What a new comment, highlight or shape looks like before you change it.',
  [SETTINGS_OCR_NOTE]: 'Reading text in scanned pages. Recognition runs on this computer.',
  [SETTINGS_AI_NOTE]:
    'Providers and keys. A key is kept in the Windows credential vault, and is never exported or written to the log.',
  [SETTINGS_INTEGRATIONS_NOTE]: 'Other services Monstera can send a document to, and the keys they need.',
  [SETTINGS_PRIVACY_NOTE]: 'What Monstera keeps on this computer, and how to clear it.',
  [SETTINGS_CATEGORY_TITLES.saving]: 'Saving',
  [SETTINGS_CATEGORY_TITLES.ocr]: 'OCR',
  [SETTINGS_CATEGORY_TITLES.keyboard]: 'Keyboard',
  [SETTINGS_CATEGORY_TITLES.updates]: 'Updates',
  [THEME_OPTION_TITLES.system]: 'Match the system',
  [THEME_OPTION_TITLES.light]: 'Light',
  [THEME_OPTION_TITLES.dark]: 'Dark',
  [UNIT_TITLES.pt]: 'Points',
  [UNIT_TITLES.mm]: 'Millimetres',
  [UNIT_TITLES.cm]: 'Centimetres',
  [UNIT_TITLES.m]: 'Metres',
  [UNIT_TITLES.in]: 'Inches',
  [UNIT_TITLES.ft]: 'Feet',
  [IMAGE_PAGES_TITLES.this]: 'This page only',
  [IMAGE_PAGES_TITLES.all]: 'Every page',
  [SETTINGS_CATEGORY_AI]: 'AI',
  [AI_ANTHROPIC_KEY_TITLE]: 'Anthropic API key',
  [AI_OPENAI_KEY_TITLE]: 'OpenAI API key',
  [AI_GEMINI_KEY_TITLE]: 'Google Gemini API key',
  [AI_MISTRAL_KEY_TITLE]: 'Mistral API key',
  [AI_XAI_KEY_TITLE]: 'xAI API key',
  [AI_AZURE_OPENAI_KEY_TITLE]: 'Azure OpenAI key',
  [AI_AZURE_OPENAI_ENDPOINT_TITLE]: 'Azure OpenAI endpoint',
  [AI_OPENROUTER_KEY_TITLE]: 'OpenRouter API key',
  [AI_GROQ_KEY_TITLE]: 'Groq API key',
  [AI_PERPLEXITY_KEY_TITLE]: 'Perplexity API key',
  [AI_DEEPSEEK_KEY_TITLE]: 'DeepSeek API key',
  [SETTINGS_CATEGORY_INTEGRATIONS]: 'Integrations',
  [INTEGRATIONS_DOCUSIGN_KEY_TITLE]: 'DocuSign integration key',
  [DOCUSIGN_SEND_COMMAND_TITLE]: 'Send to DocuSign',
  [DOCUSIGN_RETRIEVE_COMMAND_TITLE]: 'Save signed copy from DocuSign',
  [DOCUSIGN_SEND_TITLE]: 'Send to DocuSign',
  [DOCUSIGN_SEND_SUBJECT]: 'Email subject',
  [DOCUSIGN_SEND_SIGNER_NAME]: 'Signer name',
  [DOCUSIGN_SEND_SIGNER_EMAIL]: 'Signer email',
  [DOCUSIGN_SEND_ADD_SIGNER]: 'Add signer',
  [DOCUSIGN_SEND_REMOVE_SIGNER]: 'Remove signer',
  // SAYS WHAT LEAVES THE MACHINE, beside the button that sends it.
  [DOCUSIGN_SEND_NOTE]:
    'Sending uploads this document to DocuSign, and DocuSign emails each signer. You sign in to DocuSign in your web browser.',
  [DOCUSIGN_SEND_APPLY]: 'Send',
  [DOCUSIGN_NOTICE_TITLE]: 'DocuSign',
  [DOCUSIGN_NOTICE_NO_INTEGRATION_KEY]:
    'No DocuSign integration key is saved. Add one in Settings, under Integrations.',
  [DOCUSIGN_NOTICE_SECRETS_UNAVAILABLE]:
    'This computer has no secure place to keep a DocuSign sign-in, so nothing was sent.',
  [DOCUSIGN_NOTICE_SIGN_IN_CANCELLED]: 'The DocuSign sign-in was cancelled, so nothing was sent.',
  [DOCUSIGN_NOTICE_SIGN_IN_TIMED_OUT]:
    'The DocuSign sign-in was not finished within five minutes, so nothing was sent. Try again.',
  [DOCUSIGN_NOTICE_SIGN_IN_DENIED]:
    'DocuSign did not allow this application to sign in. Check the integration key and that its redirect address is registered.',
  [DOCUSIGN_NOTICE_SIGN_IN_UNAVAILABLE]:
    'The DocuSign sign-in could not be started on this computer, so nothing was sent.',
  [DOCUSIGN_NOTICE_UNAUTHORISED]:
    'DocuSign refused the sign-in. Try again, and you will be asked to sign in afresh.',
  [DOCUSIGN_NOTICE_REJECTED]: 'DocuSign refused the request, so nothing was sent.',
  [DOCUSIGN_NOTICE_UNREACHABLE]:
    'DocuSign could not be reached. Check your internet connection and try again.',
  [DOCUSIGN_NOTICE_UNEXPECTED_ANSWER]:
    'DocuSign answered in a way this application does not understand, so the answer was not used.',
  [DOCUSIGN_NOTICE_NO_ACCOUNT]:
    'Your DocuSign sign-in has no account this application can send from.',
  [DOCUSIGN_NOTICE_SENT]: 'Sent. DocuSign is emailing each signer now.',
  [DOCUSIGN_NOTICE_NOTHING_SENT]:
    'This document has not been sent to DocuSign since the application started, so there is no signed copy to save.',
  [DOCUSIGN_NOTICE_NOT_COMPLETED]:
    'DocuSign has not finished this document yet. Its status is: {status}.',
  [INTEGRATIONS_DOCUSIGN_ENVIRONMENT_TITLE]: 'DocuSign environment',
  [DOCUSIGN_ENVIRONMENT_PRODUCTION_TITLE]: 'Production',
  [DOCUSIGN_ENVIRONMENT_DEMO_TITLE]: 'Developer demo',
  [CLAUDE_REGION_TOOL_TITLE]: 'Send a box to Claude to recognise',
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
  [FIND_REPLACE_WITH]: 'Replace with',
  // SAYS THE SCOPE IN THE LABEL. A button reading "Replace" beside a per-page
  // match list would read as *replace this match*, and this command changes
  // every occurrence in the document — on pages the person is not looking at.
  // The scope is the one thing they cannot see, so it is the one thing the label
  // has to carry.
  [FIND_REPLACE_ALL]: 'Replace everywhere',
  // WHAT IT DID, AND WHAT IT COULD NOT. The limitation is real and measured —
  // `FPDFText_SetText` replaces an object's whole string, so a word a PDF drew
  // in two pieces is in neither piece — and a person who finds one survivor
  // afterwards needs to know it is a known shape rather than a failed run. The
  // count is deliberately absent: the command answers a version, not a tally,
  // and inventing one here would be a number nothing produced.
  [FIND_REPLACED]:
    'Replaced throughout the document. A word a PDF drew in separate pieces is left as it was — edit those a line at a time.',
  [UNDO_TITLE]: 'Undo',
  [REDO_TITLE]: 'Redo',
  [SAVE_TITLE]: 'Save',
  // "Save a copy" and NOT "Save as". They are different operations and the
  // label is the only thing telling the user which one this is: the document
  // does not move, so a person who picks this and closes the original is still
  // prompted about unsaved work. Naming it "Save as" would promise a move this
  // command deliberately does not make.
  [SAVE_COPY_TITLE]: 'Save a copy…',
  // THREE ENTRIES AND NOT ONE WITH A DIALOG. The format is the whole of the
  // decision, so a dialog whose only field is a three-way choice is a click
  // spent on something the menu can say. The name of each format is what a
  // person receiving the file will be told to expect, so it is the label.
  [EXPORT_FORM_DATA_JSON_TITLE]: 'Export form data as JSON…',
  [EXPORT_FORM_DATA_XFDF_TITLE]: 'Export form data as XFDF…',
  [EXPORT_FORM_DATA_FDF_TITLE]: 'Export form data as FDF…',
  // THREE EACH WAY. It was two for one commit, while XFDF had no reader — the
  // menu says what works, and an entry whose command refuses is the
  // display-only defect one layer below the surface.
  [IMPORT_FORM_DATA_JSON_TITLE]: 'Import form data from JSON…',
  [IMPORT_FORM_DATA_XFDF_TITLE]: 'Import form data from XFDF…',
  [IMPORT_FORM_DATA_FDF_TITLE]: 'Import form data from FDF…',
  [IMPORT_FORM_DATA_PROBLEM_TITLE]: 'That form data was not imported',
  // NAMES ALL THREE CAUSES, because this build genuinely cannot tell them
  // apart: the refusal happens inside the engine host and an apply's reason
  // does not cross that boundary. Claiming one of the three would be a guess
  // wearing a diagnosis's clothes, and the reader would act on it.
  [IMPORT_FORM_DATA_UNREADABLE]:
    'Nothing was changed. The file may not be form data in that format, it may name fields this document does not have, or it may hold a value one of those fields will not take.',
  [IMPORT_FORM_DATA_TOO_LARGE]:
    'Nothing was changed. Monstera reads form data files up to {megabytes} MB, and that one is larger.',
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
  // NO ELLIPSIS, because nothing is asked. The ellipsis in this file means *a
  // dialog opens next*, and this command runs on the pages themselves — it has
  // no angle to collect and no scope to choose.
  [DESKEW_PAGES_COMMAND_TITLE]: 'Straighten crooked pages',
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
  [IMPORT_PAGE_AS_LAYER_COMMAND_TITLE]: 'Import page as layer…',
  [IMPORT_PAGE_AS_LAYER_TITLE]: 'Import a page as a layer',
  [IMPORT_PAGE_AS_LAYER_LABEL]: 'Take the first page of',
  // SAYS WHICH PAGE, AND THAT IT IS THE FIRST: the renderer knows no other document's page
  // count, so the dialog cannot offer a choice of source page and must not imply one.
  [IMPORT_PAGE_AS_LAYER_WHICH]:
    'The first page of the document you choose is placed on page {page} as a layer you can show and hide.',
  [IMPORT_PAGE_AS_LAYER_APPLY]: 'Import as layer',
  [EXTRACT_PAGES_COMMAND_TITLE]: 'Extract pages…',
  [EDIT_PAGE_EXTERNALLY_COMMAND_TITLE]: 'Edit page in another app…',
  [REIMPORT_EXTERNAL_EDIT_TITLE]: 'Put the edited page back?',
  // NAMES THE PAGE, because putting it back replaces one, and says the document is still
  // unchanged, because nothing happens until the answer is yes.
  [REIMPORT_EXTERNAL_EDIT_SAVED]:
    'Page {page} was saved in the other app. Put it back in place of page {page}? Your document has not changed yet.',
  [REIMPORT_EXTERNAL_EDIT_APPLY]: 'Put it back',
  [EXTERNAL_EDIT_PROBLEM_TITLE]: 'That page could not go to or come back from the other app',
  [EXTERNAL_EDIT_PROBLEM_NOT_PDF]:
    'The file name you chose does not end in .pdf, so nothing was written. Choose a name that ends in .pdf. Your document has not changed.',
  [EXTERNAL_EDIT_PROBLEM_LAUNCH_FAILED]:
    'The page was saved where you chose, but no app on this computer opened it, so it is not being watched for changes. Your document has not changed.',
  [EXTERNAL_EDIT_PROBLEM_NOT_WATCHABLE]:
    'The page was saved, but that folder cannot be watched for changes, so it was not opened for editing. Choose another folder. Your document has not changed.',
  [EXTERNAL_EDIT_PROBLEM_DOCUMENT_CHANGED]:
    'This document changed after the page was sent out, so the edit was not put back — it could have replaced the wrong page. Your document has not changed, and the edited file is still where you saved it.',
  [EXTERNAL_EDIT_PROBLEM_OPEN_ELSEWHERE]:
    'The edited file is already open in a tab, and that tab shows it as it was when it was opened. Close that tab and try again. Your document has not changed.',
  [EXTERNAL_EDIT_PROBLEM_ABSENT]:
    'The edited file is no longer where it was saved, so nothing was put back. Your document has not changed.',
  [EXTERNAL_EDIT_PROBLEM_AT_CAPACITY]:
    'The edited file is too large to open alongside the documents already open, so nothing was put back. Close a document and try again. Your document has not changed.',
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
  [EXPORT_PAGE_IMAGES_COMMAND_TITLE]: 'Export pages as images…',
  [EXPORT_PAGE_IMAGES_TITLE]: 'Export pages as images',
  [EXPORT_WORD_COMMAND_TITLE]: 'Export to Word…',
  [EXPORT_POWERPOINT_COMMAND_TITLE]: 'Export to PowerPoint…',
  [EXPORT_WORD_TITLE]: 'Export to Word',
  [EXPORT_WORD_MODE]: 'What to keep',
  [EXPORT_WORD_RICH]: 'Text and its fonts — editable, flows like a normal document',
  [EXPORT_WORD_LAYOUT]: 'The page layout — each line where it sits on the page',
  [EXPORT_WORD_TEXT]: 'Just the words',
  [EXPORT_WORD_APPLY]: 'Choose where to save…',
  [EXPORT_PDFA_COMMAND_TITLE]: 'Export as PDF/A…',
  [PDFA_REMOVALS_TITLE]: 'Saved as PDF/A',
  [OPTIMIZE_COMMAND_TITLE]: 'Save a smaller copy…',
  [OPTIMIZE_TITLE]: 'Save a smaller copy',
  [OPTIMIZE_QUALITY]: 'Image quality',
  [OPTIMIZE_HIGH]: 'High',
  [OPTIMIZE_MEDIUM]: 'Medium',
  [OPTIMIZE_LOW]: 'Low — the smallest file',
  [OPTIMIZE_MEASURE]: 'Check the size',
  [OPTIMIZE_SIZES]: 'Now {before}. The copy would be {after}, {percent}% smaller.',
  [OPTIMIZE_NOT_SMALLER]: 'Now {before}. The copy would be {after}, which is not smaller, so it would not be saved.',
  [OPTIMIZE_SAVE]: 'Choose where to save…',
  [OPTIMIZE_KEEPS]: 'The open document is not changed. Only pictures are made smaller.',
  [PDFA_REMOVALS_SAVED]: 'The PDF/A file was saved. To meet the archival standard, some things were left out of it.',
  [PDFA_REMOVALS_CONVERTER_WORDS]: 'In the words of the converter, Ghostscript:',
  [PDFA_REMOVALS_TAGS]: 'This document had tags that let screen readers follow it. The PDF/A file does not keep them.',
  [PRINT_COMMAND_TITLE]: 'Print…',
  [EMAIL_COMMAND_TITLE]: 'Email…',
  [PRINT_TITLE]: 'Print',
  [PRINT_DPI]: 'Print quality',
  [PRINT_DPI_150]: 'Draft — 150 dots per inch',
  [PRINT_DPI_300]: 'Standard — 300 dots per inch',
  [PRINT_DPI_600]: 'High — up to 600 dots per inch, lower on a large page',
  [PRINT_APPLY]: 'Choose a printer…',
  [GROUP_COMPARE]: 'Compare',
  [GROUP_COMMENT_FILES]: 'Comment files',
  [ACCESSIBILITY_COMMAND_TITLE]: 'Accessibility check',
  [ACCESSIBILITY_TITLE]: 'Accessibility check',
  [ACCESSIBILITY_SUMMARY]:
    '{failed, plural, =0 {None of the automatic checks failed.} one {One automatic check failed.} other {# automatic checks failed.}} {undetermined, plural, =0 {} one {One could not be decided.} other {# could not be decided.}}',
  [ACCESSIBILITY_NOT_CONFORMANCE]:
    'These are the PDF/UA checks a computer can make from the file. They do not show the document is accessible: the checks below need a person.',
  [ACCESSIBILITY_REFUSED]: 'The document could not be checked. It may be busy or no longer open.',
  [ACCESSIBILITY_MACHINE_HEADING]: 'Automatic checks',
  [ACCESSIBILITY_PERSON_HEADING]: 'Checks for a person',
  [ACCESSIBILITY_PAGES]: 'Pages {pages}',
  [ACCESSIBILITY_VERDICT_PASSED]: 'Passed',
  [ACCESSIBILITY_VERDICT_FAILED]: 'Failed',
  [ACCESSIBILITY_VERDICT_NOT_APPLICABLE]: 'Does not apply',
  [ACCESSIBILITY_VERDICT_NOT_DETERMINED]: 'Could not be decided',
  [ACCESSIBILITY_RULE_5_1]: 'The file says it follows PDF/UA',
  [ACCESSIBILITY_RULE_6_2_1]: 'The file is marked as tagged',
  [ACCESSIBILITY_RULE_7_1_4]: 'The tags are not marked as suspect',
  [ACCESSIBILITY_RULE_7_1_5]: 'Every custom tag maps to a standard one',
  [ACCESSIBILITY_RULE_7_1_8]: 'The file has document metadata',
  [ACCESSIBILITY_RULE_7_1_9]: 'The metadata gives the document a title',
  [ACCESSIBILITY_RULE_7_1_10]: 'Viewers show the title, not the file name',
  [ACCESSIBILITY_RULE_7_1_11]: 'The file has a tag tree',
  [ACCESSIBILITY_RULE_7_3_1]: 'Every figure has alternative text',
  [ACCESSIBILITY_RULE_7_16_1]: 'Encryption still lets assistive technology read the text',
  [ACCESSIBILITY_RULE_7_18_1_2]: 'Every comment and mark has a description',
  [ACCESSIBILITY_RULE_7_18_1_3]: 'Every form field has a description',
  [ACCESSIBILITY_RULE_7_18_3_1]: 'Pages with comments or fields follow the tag order for Tab',
  [ACCESSIBILITY_RULE_7_18_5_2]: 'Every link has a description',
  [ACCESSIBILITY_RULE_7_21_4_1_1]: 'Every font is embedded in the file',
  [ACCESSIBILITY_RULE_UNKNOWN]: 'Rule {clause} test {test}',
  [ACCESSIBILITY_HUMAN_READING_ORDER]: 'The reading order follows the page as it is meant to be read',
  [ACCESSIBILITY_HUMAN_ALT_TEXT]: 'Alternative text describes what each figure shows',
  [ACCESSIBILITY_HUMAN_HEADINGS]: 'Headings match the document’s real sections',
  [ACCESSIBILITY_HUMAN_TABLES]: 'Table headers are the right cells',
  [ACCESSIBILITY_HUMAN_COLOUR]: 'Colour is never the only way something is shown',
  [ACCESSIBILITY_HUMAN_LANGUAGE]: 'Passages in another language are marked as such',
  [ACCESSIBILITY_HUMAN_LINKS]: 'Link text says where each link goes',
  [EXPORT_ANNOTATIONS_JSON_TITLE]: 'Export comments as JSON…',
  [EXPORT_ANNOTATIONS_XFDF_TITLE]: 'Export comments as XFDF…',
  [EXPORT_ANNOTATIONS_FDF_TITLE]: 'Export comments as FDF…',
  [IMPORT_ANNOTATIONS_JSON_TITLE]: 'Import comments from JSON…',
  [IMPORT_ANNOTATIONS_XFDF_TITLE]: 'Import comments from XFDF…',
  [IMPORT_ANNOTATIONS_FDF_TITLE]: 'Import comments from FDF…',
  [IMPORT_ANNOTATIONS_PROBLEM_TITLE]: 'Those comments were not imported',
  // NAMES EVERY CAUSE, for the form data message's reason: the refusal happens in the engine host
  // and its reason does not cross, so naming one would be a guess.
  [IMPORT_ANNOTATIONS_UNREADABLE]:
    'Nothing was added. The file may not be comments in that format, it may carry no kind of comment Monstera imports, it may place a comment on a page this document does not have, or one of its comments may be incomplete.',
  [IMPORT_ANNOTATIONS_TOO_LARGE]:
    'Nothing was added. Monstera reads comment files up to {megabytes} MB, and that one is larger.',
  [COMPARE_COMMAND_TITLE]: 'Compare documents…',
  [COMPARE_PROGRESS]: 'Comparing pages',
  [OPTIMIZE_CHECKING]: 'Checking the size of a smaller copy',
  [COMPARE_DOCUMENTS_TITLE]: 'Compare documents',
  [COMPARE_DOCUMENTS_LABEL]: 'Compare this document with',
  [COMPARE_DOCUMENTS_APPLY]: 'Compare',
  [COMPARE_RESULT_TITLE]: 'Differences',
  [COMPARE_RESULT_NONE]: 'Open the other document in a tab first, then compare.',
  [COMPARE_RESULT_REFUSED]: 'The documents could not be compared. One of them may be busy or no longer open.',
  [COMPARE_RESULT_WHAT]:
    'This compares the words on each page with the page at the same number in {name}. Pictures and layout are not compared, and a page added in the middle shifts every page after it.',
  [COMPARE_RESULT_SUMMARY]:
    '{count, plural, =0 {No lines differ in the {pages} pages both documents have.} one {One line differs in the {pages} pages both documents have.} other {# lines differ in the {pages} pages both documents have.}}',
  [COMPARE_RESULT_PARTIAL]:
    'Compared {counted} of {total} pages. A document changed during the comparison, so the rest were not compared.',
  [COMPARE_RESULT_EXTRA_HERE]:
    '{count, plural, one {This document has one more page, which was not compared.} other {This document has # more pages, which were not compared.}}',
  [COMPARE_RESULT_EXTRA_OTHER]:
    '{count, plural, one {{name} has one more page, which was not compared.} other {{name} has # more pages, which were not compared.}}',
  [COMPARE_RESULT_CLIPPED]:
    '{count, plural, one {One page has more text than can be read at once, so some of its lines may be missing from the comparison.} other {# pages have more text than can be read at once, so some of their lines may be missing from the comparison.}}',
  [COMPARE_RESULT_TRUNCATED]: 'There are more differences than can be listed. Only the first ones are shown.',
  [COMPARE_RESULT_PAGE]: 'Page {page}',
  [COMPARE_RESULT_REMOVED]: 'Only in this document',
  [COMPARE_RESULT_ADDED]: 'Only in {name}',
  [READ_BARCODES_COMMAND_TITLE]: 'Read barcodes',
  [PLACE_BARCODE_TOOL_TITLE]: 'Add a barcode',
  [PAGE_BARCODES_TITLE]: 'Barcodes on this page',
  [PAGE_BARCODES_FOUND]: '{count, plural, one {One barcode on page {page}.} other {# barcodes on page {page}.}}',
  [PAGE_BARCODES_NONE]: 'No barcodes were found on page {page}.',
  [PAGE_BARCODES_TRUNCATED]: 'This page has more barcodes than can be listed. Only the first ones are shown.',
  [PAGE_BARCODES_REFUSED]: 'The barcodes on page {page} could not be read. The document may be busy or no longer open.',
  [PAGE_BARCODES_TYPE]: 'Type',
  [PAGE_BARCODES_CONTENT]: 'What it says',
  [PLACE_BARCODE_TITLE]: 'Add a barcode',
  [PLACE_BARCODE_TEXT]: 'Text or link',
  [PLACE_BARCODE_FORMAT]: 'Barcode type',
  [PLACE_BARCODE_QR]: 'QR Code',
  [PLACE_BARCODE_DATA_MATRIX]: 'Data Matrix',
  [PLACE_BARCODE_AZTEC]: 'Aztec',
  [PLACE_BARCODE_PDF417]: 'PDF417',
  [PLACE_BARCODE_CODE128]: 'Code 128',
  [PLACE_BARCODE_EAN13]: 'EAN-13 — up to 13 digits; a shorter number gets leading zeros',
  [PLACE_BARCODE_REFUSED]:
    'That barcode type cannot hold this text, so nothing was added. Change the text or choose another type.',
  [PLACE_BARCODE_APPLY]: 'Add to the page',
  [EXPORT_EXCEL_COMMAND_TITLE]: 'Export tables to Excel…',
  [EXPORT_EXCEL_TITLE]: 'Export tables to Excel',
  [EXPORT_EXCEL_LAYOUT]: 'Where the tables go',
  [EXPORT_EXCEL_ENGINE]: 'Read the tables with',
  [EXPORT_EXCEL_ENGINE_AUTOMATIC]: 'This PDF’s own text',
  [EXPORT_EXCEL_ENGINE_AZURE]: 'Azure Document Intelligence',
  [EXPORT_EXCEL_ENGINE_CLAUDE]: 'Claude',
  // SAID BEFORE ANYTHING IS SENT (ADR-0086 Decision 4): what leaves this computer, and where to.
  // No cost is stated, which is the row's rule for every service string.
  [EXPORT_EXCEL_SENDS_AZURE]:
    '{count, plural, one {This document’s page} other {All # pages of this document}} will be sent to Azure Document Intelligence to find its tables. Each copy is deleted from Azure after it is read.',
  [EXPORT_EXCEL_SENDS_CLAUDE]:
    '{count, plural, one {This document’s page} other {All # pages of this document}} will be sent to Anthropic’s Claude to find its tables.',
  [EXCEL_SERVICE_REFUSED]: 'Page {page} could not be read, so nothing was written. {detail}',
  [SERVICE_REFUSED_TITLE]: 'The tables were not read',
  [EXPORT_EXCEL_SHEET_PER_PAGE]: 'A sheet for each page that has tables',
  [EXPORT_EXCEL_ONE_SHEET]: 'Every table on one sheet',
  [EXPORT_EXCEL_APPLY]: 'Choose where to save…',
  [EXPORT_EXCEL_PAGE]: 'Page {page} of {count}',
  [EXPORT_EXCEL_PREVIOUS_PAGE]: 'Previous page',
  [EXPORT_EXCEL_NEXT_PAGE]: 'Next page',
  [EXPORT_EXCEL_NO_TABLES_HERE]: 'No tables were found on this page.',
  [EXPORT_EXCEL_TABLE]: 'Table {table}',
  [EXPORT_EXCEL_CELL]: 'Table {table}, row {row}, column {column}',
  [EXPORT_EXCEL_CLIPPED]: 'This cell is too long to show whole, so it cannot be changed here.',
  [EXPORT_EXCEL_TRUNCATED]: 'This page has more cells than can be shown. The ones not shown are exported as found.',
  [EXPORT_PAGE_IMAGES_ALL]: 'Every page',
  [EXPORT_PAGE_IMAGES_RANGES]: 'These pages',
  [EXPORT_PAGE_IMAGES_LABEL]: 'Pages',
  [EXPORT_PAGE_IMAGES_EMPTY]: 'Type the pages to export, for example 1-3, 5.',
  [EXPORT_PAGE_IMAGES_FORMAT]: 'Format',
  [EXPORT_PAGE_IMAGES_PNG]: 'PNG — exact, larger files',
  [EXPORT_PAGE_IMAGES_JPEG]: 'JPEG — smaller files, some detail lost',
  [EXPORT_PAGE_IMAGES_WEBP]: 'WebP — smaller still, some detail lost',
  [EXPORT_PAGE_IMAGES_DPI]: 'Resolution (dots per inch)',
  [EXPORT_PAGE_IMAGES_QUALITY]: 'Quality (1–100)',
  // THE BOUNDS ARE IN THE MESSAGE, because a disabled button with no reason is a
  // control that looks broken.
  [EXPORT_PAGE_IMAGES_OUT_OF_BOUNDS]:
    'Resolution must be a whole number from {minDpi} to {maxDpi}, and quality from {minQuality} to {maxQuality}.',
  [EXPORT_PAGE_IMAGES_FILES]:
    'This document is not changed. One image for each page: {files} files will be written.',
  [EXPORT_TEXT_COMMAND_TITLE]: 'Export text…',
  [EXPORT_LAYOUT_TEXT_COMMAND_TITLE]: 'Export text with layout…',
  [INSERT_IMAGE_COMMAND_TITLE]: 'Insert image…',
  [INSERT_IMAGE_PROBLEM_TITLE]: 'That image could not be added',
  [INSERT_IMAGE_UNREADABLE]:
    'The file you chose is not a JPEG or PNG this app can read. Your document has not changed.',
  [INSERT_IMAGE_TOO_LARGE]:
    'That image is larger than {megabytes} MB, which is the most this app will make a page from. ' +
    'Your document has not changed.',
  [INSERT_IMAGE_TOO_MANY_PIXELS]:
    'That picture has more than {megapixels} megapixels, which is the most this app will make a ' +
    'page from. Try a smaller copy of it. Your document has not changed.',
  [GROUP_CREATE]: 'Create',
  [NEW_FROM_MARKDOWN_COMMAND_TITLE]: 'New PDF from Markdown…',
  [APPEND_MARKDOWN_COMMAND_TITLE]: 'Add pages from Markdown…',
  [NEW_FROM_CSV_COMMAND_TITLE]: 'New PDF table from CSV…',
  [NEW_FROM_IMAGES_COMMAND_TITLE]: 'New PDF from images…',
  [OPEN_FROM_URL_COMMAND_TITLE]: 'Open from web address…',
  [NEW_FROM_CAMERA_COMMAND_TITLE]: 'New PDF from camera…',
  [CAMERA_CAPTURE_TITLE]: 'Take pictures',
  [CAMERA_CAPTURE_TAKE]: 'Take picture',
  [CAMERA_CAPTURE_DONE]: 'Make PDF',
  [CAMERA_CAPTURE_COUNT]: 'Pictures taken: {count}',
  [CAMERA_CAPTURE_PREVIEW]: 'What the camera sees',
  [CAMERA_CAPTURE_STARTING]: 'Starting the camera…',
  // THE REMEDY IS WINDOWS', not this app's: the camera is refused at the operating system
  // or by the person, and this app cannot grant itself one.
  [CAMERA_CAPTURE_DENIED]:
    'This app is not allowed to use the camera. Allow it in Windows camera privacy settings, then try again.',
  [CAMERA_CAPTURE_ABSENT]: 'No camera was found.',
  [CAMERA_CAPTURE_FAILED]: 'The camera could not be started. Another app may be using it.',
  [CAMERA_CAPTURE_FULL]: 'That is as many pictures as one PDF can take. Make the PDF, then start another.',
  [OPEN_FROM_URL_TITLE]: 'Open a PDF from a web address',
  [OPEN_FROM_URL_LABEL]: 'Address',
  [OPEN_FROM_URL_APPLY]: 'Open',
  [OPEN_FROM_URL_EMPTY]: 'Type the address of the PDF to open.',
  [OPEN_FROM_URL_TOO_LONG]: 'That address is too long.',
  // NAMES WHAT IS ACCEPTED, the link dialog's reason: the person is about to type again.
  [OPEN_FROM_URL_SCHEME]: 'Only secure addresses can be opened: start with https://.',
  [URL_OPEN_PROBLEM_TITLE]: 'The PDF could not be opened',
  [URL_OPEN_NOT_HTTPS]:
    'Only secure web addresses, starting with https://, can be opened — and that includes any address the website sends this app on to. Nothing was saved.',
  [URL_OPEN_CREDENTIALS]:
    'That address contains a user name or password, which this app will not send. Nothing was saved.',
  // THE REMEDY IS NOT "TRY AGAIN": the refusal is deliberate, and the sentence says what
  // the address points at so a person does not keep retrying a link someone sent them.
  [URL_OPEN_BLOCKED_ADDRESS]:
    'That address points inside your own computer or network, which this app will not open. Nothing was saved.',
  [URL_OPEN_UNRESOLVABLE]: 'That website could not be found. Check the address and try again.',
  [URL_OPEN_TOO_MANY_REDIRECTS]:
    'That address sent this app on to too many other addresses. Nothing was saved.',
  [URL_OPEN_HTTP_ERROR]: 'The website did not return a document at that address. Nothing was saved.',
  [URL_OPEN_UNREACHABLE]:
    'The website could not be reached, or stopped responding. Nothing was saved.',
  [URL_OPEN_TOO_LARGE]: 'That document is larger than this app can open. Nothing was saved.',
  [URL_OPEN_NOT_A_PDF]: 'That address did not return a PDF. Nothing was saved.',
  [URL_OPEN_CONTESTED]:
    'That file is open in this app, so nothing was written there. Close it, or choose another name.',
  [URL_OPEN_WRITE_FAILED]: 'The PDF could not be saved there. Nothing was opened.',
  [URL_OPEN_ABSENT]: 'The PDF was saved, but the file was gone before it could be opened.',
  [URL_OPEN_AT_CAPACITY]:
    'The PDF was saved, but there is not enough room to open it beside the documents already ' +
    'open. Close one, then open the PDF from where you saved it.',
  // NOT "THAT MARKDOWN FILE": three imports open this dialog, and a title naming one
  // format told a person who picked a CSV or a folder of scans the wrong thing.
  [MARKDOWN_IMPORT_PROBLEM_TITLE]: 'The import did not finish',
  [MARKDOWN_IMPORT_UNREADABLE]: 'The file you chose could not be read. Nothing was imported.',
  [MARKDOWN_IMPORT_TOO_LARGE]:
    'That file is larger than {megabytes} MB, which is the most this app will import. ' +
    'Nothing was imported.',
  [MARKDOWN_IMPORT_NOT_UTF8]:
    'That file is not UTF-8 text, so it cannot be read as Markdown. Nothing was imported.',
  [MARKDOWN_IMPORT_UNENCODABLE]:
    'The file has a character the built-in fonts cannot draw. Nothing was imported.',
  [MARKDOWN_IMPORT_UNENCODABLE_LINE]:
    'Line {line} has a character the built-in fonts cannot draw. Nothing was imported.',
  [MARKDOWN_IMPORT_NOTHING_TO_DRAW]: 'That file has no text to put on a page. Nothing was imported.',
  // THE REMEDY IS THE PERSON'S: close the document holding that file, or pick another
  // name. `saveCopy`'s contested sentence is the same situation.
  [MARKDOWN_IMPORT_CONTESTED]:
    'That file is open in this app, so nothing was written there. Close it, or choose another name.',
  [MARKDOWN_IMPORT_WRITE_FAILED]: 'The PDF could not be saved there. Nothing was imported.',
  [MARKDOWN_IMPORT_MALFORMED_CSV]:
    'Line {line} is not valid CSV — a quote is out of place or never closed. Nothing was imported.',
  [MARKDOWN_IMPORT_TOO_MANY_COLUMNS]:
    'The table that starts on line {line} has more columns than fit across a page. Nothing was imported.',
  [MARKDOWN_IMPORT_MALFORMED_CSV_NO_LINE]:
    'The file is not valid CSV — a quote is out of place or never closed. Nothing was imported.',
  [MARKDOWN_IMPORT_TOO_MANY_COLUMNS_NO_LINE]:
    'A table in the file has more columns than fit across a page. Nothing was imported.',
  [MARKDOWN_IMPORT_ABSENT]:
    'The PDF was saved, but the file was gone before it could be opened.',
  [MARKDOWN_IMPORT_AT_CAPACITY]:
    'The PDF was saved, but there is not enough room to open it beside the documents already ' +
    'open. Close one, then open the PDF from where you saved it.',
  [MARKDOWN_IMPORT_IMAGE_UNREADABLE]:
    '{file} could not be read as a JPEG or PNG picture. Nothing was imported.',
  [MARKDOWN_IMPORT_IMAGE_UNREADABLE_NO_FILE]:
    'One of the pictures could not be read as a JPEG or PNG. Nothing was imported.',
  // TWO BOUNDS, ONE SENTENCE: a PNG too large on its own and the one that takes the set
  // past its total have the same remedy — fewer or smaller pictures.
  [MARKDOWN_IMPORT_TOO_MANY_PIXELS]:
    '{file} is too large a picture, or takes the pictures past the most one import holds. ' +
    'Choose fewer or smaller pictures. Nothing was imported.',
  [MARKDOWN_IMPORT_TOO_MANY_PIXELS_NO_FILE]:
    'The pictures are larger than one import holds. Choose fewer or smaller pictures. ' +
    'Nothing was imported.',
  [MARKDOWN_IMPORT_TOO_MANY_IMAGES]:
    'You chose more than {limit} pictures, which is the most one import takes. Nothing was imported.',
  [MARKDOWN_IMPORT_IMAGES_TOO_LARGE]:
    'The pictures you chose come to more than {megabytes} MB together, which is the most one ' +
    'import takes. Nothing was imported.',
  [GENERATE_TOC_COMMAND_TITLE]: 'Table of contents',
  [GENERATE_TOC_PROBLEM_TITLE]: 'There is nothing to tabulate',
  // NAMES WHAT IS MISSING AND WHERE IT COMES FROM. "No bookmarks" alone reads
  // as a failure of the app; a person who has never met the word needs to know
  // it is something the document either carries or does not.
  [GENERATE_TOC_NO_OUTLINE]:
    'This document has no bookmarks, so there are no headings to build a table of contents ' +
    'from. Your document has not changed.',
  [DOCUMENT_TOOLS_LABEL]: 'Document tools',
  [RIBBON_RAIL_LABEL]: 'Sections',
  [RIBBON_TOOLS_LABEL]: 'Tools',
  // A WORD, not a bare ellipsis glyph: the button that holds the tools which did not fit is a named
  // control, and `⋯` alone would be an icon-only one needing a tooltip to say the same thing.
  [RIBBON_MORE]: 'More',
  [SECTION_HOME]: 'Home',
  [SECTION_COMMENT]: 'Comment',
  [SECTION_EDIT]: 'Edit',
  [SECTION_ORGANIZE]: 'Organize',
  [SECTION_FORMS]: 'Forms',
  [SECTION_REVIEW]: 'Review',
  [SECTION_PROTECT]: 'Protect',
  [SECTION_TOOLS]: 'Tools',
  [GROUP_FILE]: 'File',
  [GROUP_FIND]: 'Find',
  [GROUP_PAGES]: 'Pages',
  [GROUP_ENCRYPTION]: 'Encryption',
  [GROUP_REDACT]: 'Redact',
  [PROTECT_DOCUMENT_COMMAND_TITLE]: 'Password and permissions',
  [PROTECT_DOCUMENT_TITLE]: 'Password and permissions',
  [PROTECT_DOCUMENT_SCHEME]: 'Encryption',
  [PROTECT_DOCUMENT_SCHEME_NONE]: 'None — remove the password',
  [PROTECT_DOCUMENT_SCHEME_AES256]: 'AES-256 (recommended)',
  [PROTECT_DOCUMENT_SCHEME_AES128]: 'AES-128',
  [PROTECT_DOCUMENT_SCHEME_RC4128]: 'RC4 128-bit (old readers)',
  [PROTECT_DOCUMENT_SCHEME_RC440]: 'RC4 40-bit (very old readers)',
  [PROTECT_DOCUMENT_USER]: 'Password to open (optional)',
  [PROTECT_DOCUMENT_OWNER]: 'Password to change permissions (optional)',
  [PROTECT_DOCUMENT_PERMISSIONS]: 'Allow without the permissions password',
  [PROTECT_DOCUMENT_APPLY]: 'Protect document',
  [PROTECT_DOCUMENT_REMOVE]: 'Remove protection',
  [PROTECT_DOCUMENT_NEEDS_A_PASSWORD]: 'Set at least one password, or choose None.',
  [PROTECT_DOCUMENT_EXPLAINS]:
    'Protection is applied when the document is saved. Permissions are honoured by readers that choose to; they are not enforced by the file.',
  [PROTECT_DOCUMENT_REMOVES]:
    'Saving will write this document with no password and no permission limits.',
  [PERMISSION_PRINT]: 'Print',
  [PERMISSION_MODIFY]: 'Change the document',
  [PERMISSION_COPY]: 'Copy text and images',
  [PERMISSION_ANNOTATE]: 'Add comments and markup',
  [PERMISSION_FILL_FORMS]: 'Fill in form fields',
  [PERMISSION_ASSEMBLE]: 'Insert, delete and rotate pages',
  [PERMISSION_PRINT_HIGH_QUALITY]: 'Print at full resolution',

  [APPLY_REDACTIONS_COMMAND_TITLE]: 'Apply redactions',
  [APPLY_REDACTIONS_TITLE]: 'Apply redactions',
  // THE TITLE CAME OUT OF THIS SENTENCE when the checkbox below it arrived
  // (2026-09-21). It read "title, author and other properties are removed too",
  // which is a compound claim whose first clause the new control can falsify —
  // the half-true sentence nobody flags, in the one dialog where being wrong
  // about what is removed is the whole risk. The title is the checkbox's to
  // describe, and it does.
  [APPLY_REDACTIONS_WARNS]:
    'The marked content is removed from the document, not covered over, with any comments and form fields under the marks. The document’s author, subject and other properties are removed too. The only way back is Undo, in this session.',
  [APPLY_REDACTIONS_SCOPE]: 'Apply to',
  [APPLY_REDACTIONS_SCOPE_PAGE]: 'Page {page}',
  [APPLY_REDACTIONS_SCOPE_ALL]: 'Every page',
  [APPLY_REDACTIONS_COVER]: 'Leave behind',
  [APPLY_REDACTIONS_COVER_SOLID]: 'A filled box',
  [APPLY_REDACTIONS_COVER_NONE]: 'Nothing',
  [APPLY_REDACTIONS_IMAGES]: 'Images under a mark',
  [APPLY_REDACTIONS_IMAGES_PIXELS]: 'Blank only the covered part',
  [APPLY_REDACTIONS_IMAGES_REMOVE]: 'Remove the whole image',
  // THE LABEL NAMES THE RISK, not the field. *Keep the title* describes a
  // setting; this describes a decision, which is what an off-by-default box
  // beside an irreversible act has to do.
  [APPLY_REDACTIONS_KEEP_TITLE]: 'Keep the document’s title',
  [APPLY_REDACTIONS_KEEP_TITLE_WARNS]:
    'A title can itself contain what you are redacting — or say it in other words. Everything else about the document is removed either way.',
  [APPLY_REDACTIONS_APPLY]: 'Apply redactions',

  [REDACT_MATCHES_COMMAND_TITLE]: 'Mark matches for redaction',
  [REDACT_MATCHES_TITLE]: 'Mark matches for redaction',
  [REDACT_MATCHES_LABEL]: 'Find',
  [REDACT_MATCHES_SCOPE]: 'Search',
  [REDACT_MATCHES_SCOPE_ALL]: 'Every page',
  [REDACT_MATCHES_SCOPE_PAGE]: 'Page {page}',
  [REDACT_MATCHES_EXPLAINS]:
    'Every match is marked. Nothing is removed until you choose Apply redactions, so you can check the marks and delete any you did not mean. The search ignores capitalisation.',
  [REDACT_MATCHES_EMPTY]: 'Type the text to mark.',
  [REDACT_MATCHES_TOO_LONG]: 'That is longer than this search will carry.',
  [REDACT_MATCHES_APPLY]: 'Mark matches',

  [SANITIZE_DOCUMENT_COMMAND_TITLE]: 'Sanitize document',
  [SANITIZE_DOCUMENT_TITLE]: 'Sanitize document',
  [SANITIZE_DOCUMENT_EXPLAINS]: 'Remove from this document:',
  [SANITIZE_DOCUMENT_EMPTY]: 'Choose at least one thing to remove.',
  [SANITIZE_DOCUMENT_APPLY]: 'Sanitize',
  [SANITIZE_PART_JAVASCRIPT]: 'Embedded JavaScript and automatic actions',
  [SANITIZE_PART_EMBEDDED_FILES]: 'Attached files',
  [SANITIZE_PART_EXTERNAL_ACTIONS]: 'Actions that submit or fetch data',
  [SANITIZE_PART_FLATTEN]: 'Form fields and comments, flattened into the page',

  [GROUP_SIGNATURES]: 'Signatures',
  [SIGN_DOCUMENT_COMMAND_TITLE]: 'Sign document',
  [SIGN_DOCUMENT_TITLE]: 'Sign document',
  [SIGN_DOCUMENT_EXPLAINS]:
    'You will be asked for your certificate file (.p12 or .pfx) after this. The certificate never leaves this computer.',
  [SIGN_DOCUMENT_PASSPHRASE]: 'Certificate password (leave empty if it has none)',
  [SIGN_DOCUMENT_NAME]: 'Signed by (optional)',
  [SIGN_DOCUMENT_REASON]: 'Reason (optional)',
  [SIGN_DOCUMENT_LOCATION]: 'Location (optional)',
  [SIGN_DOCUMENT_CONTACT]: 'Contact (optional)',
  [SIGN_DOCUMENT_TOO_LONG]: 'One of these is longer than the document can carry.',
  [SIGN_DOCUMENT_APPLY]: 'Choose certificate and sign',
  [SIGN_DOCUMENT_CERTIFY]: 'This signature says',
  [SIGN_DOCUMENT_CERTIFY_NONE]: 'I approve this document',
  [SIGN_DOCUMENT_CERTIFY_LOCKED]: 'I am the author — nothing may be changed',
  [SIGN_DOCUMENT_CERTIFY_FORMS]: 'I am the author — forms may be filled in',
  [SIGN_DOCUMENT_CERTIFY_COMMENTS]:
    'I am the author — forms may be filled in and comments added',
  [SIGN_DOCUMENT_TIMESTAMP]: 'Timestamp',
  [SIGN_DOCUMENT_TIMESTAMP_NONE]: 'No timestamp',
  [SIGN_DOCUMENT_TIMESTAMP_DIGICERT]: 'DigiCert',
  [SIGN_DOCUMENT_TIMESTAMP_GLOBALSIGN]: 'GlobalSign',
  [SIGN_DOCUMENT_TIMESTAMP_SECTIGO]: 'Sectigo',
  [SIGN_DOCUMENT_TIMESTAMP_NOTE]:
    'A timestamp proves when the document was signed. Only a fingerprint of the signature is sent to the service, never the document. These services are reached without encryption, so someone watching the network could see that a timestamp was requested.',
  [SIGN_PROBLEM_TITLE]: 'The document was not signed',
  [SIGN_PROBLEM_WRONG_PASSPHRASE]:
    'That password did not open the certificate. Nothing has been changed.',
  [SIGN_PROBLEM_UNREADABLE]:
    'That file is not a certificate this application can read. Nothing has been changed.',
  [SIGN_PROBLEM_UNENCODABLE_TEXT]:
    'The signature has a character that font cannot draw. Try another font or plain letters. Nothing has been changed.',
  [SIGN_PROBLEM_IMAGE_UNREADABLE]:
    'That picture could not be read. Choose a PNG or JPEG file. Nothing has been changed.',
  [SIGN_PROBLEM_IMAGE_TOO_LARGE]: 'That picture is too large to place. Nothing has been changed.',
  [SIGN_PROBLEM_SIGNATURE_TOO_LARGE]:
    'The signature is too large to fit in the document. A certificate with a long chain can cause this. Nothing has been changed.',
  [SIGN_PROBLEM_TIMESTAMP_UNREACHABLE]:
    'The timestamp service could not be reached, so the document was not signed. Try again, choose another service, or sign without a timestamp. Nothing has been changed.',
  [SIGN_PROBLEM_TIMESTAMP_REFUSED]:
    'The timestamp service refused the request, so the document was not signed. Choose another service or sign without a timestamp. Nothing has been changed.',
  [SIGN_PROBLEM_TIMESTAMP_UNVERIFIABLE]:
    'The timestamp service answered with a timestamp this application could not verify, so it was not used and the document was not signed. Nothing has been changed.',
  [SIGN_DOCUMENT_LOOK]: 'How the signature looks',
  [SIGN_DOCUMENT_LOOK_TYPED]: 'Type it',
  [SIGN_DOCUMENT_LOOK_DRAWN]: 'Draw it',
  [SIGN_DOCUMENT_LOOK_IMAGE]: 'Use a picture of it',
  [SIGN_DOCUMENT_TEXT]: 'Signature',
  [SIGN_DOCUMENT_FONT]: 'Font',
  [SIGN_DOCUMENT_FONT_HELVETICA]: 'Helvetica',
  [SIGN_DOCUMENT_FONT_TIMES]: 'Times',
  [SIGN_DOCUMENT_FONT_TIMES_ITALIC]: 'Times Italic',
  [SIGN_DOCUMENT_FONT_COURIER]: 'Courier',
  [SIGN_DOCUMENT_PAD]: 'Draw your signature here',
  [SIGN_DOCUMENT_CLEAR]: 'Clear',
  [SIGN_DOCUMENT_IMAGE_NOTE]:
    'You will be asked for a PNG or JPEG picture of your signature first, then for your certificate.',
  [SIGN_DOCUMENT_MARK_MISSING]: 'Type or draw the signature first.',
  [PLACE_SIGNATURE_TOOL_TITLE]: 'Place a visible signature',

  [SIGNATURES_COMMAND_TITLE]: 'Check signatures',
  [SIGNATURES_TITLE]: 'Signatures',
  [SIGNATURES_NONE]: 'This document is not signed.',
  [SIGNATURES_UNREADABLE]:
    'This document carries a signature this application could not read. That is not the same as an invalid one — nothing here can say whether it is good.',
  [SIGNATURES_INTACT]: 'Unchanged since it was signed',
  [SIGNATURES_CHANGED]: 'The document has changed since this signature was made',
  [SIGNATURES_APPENDED]:
    'Intact, but something was added to the document afterwards that this signature does not cover',
  [SIGNATURES_VALID_BETWEEN]: 'Certificate valid from {from} to {to}',
  [SIGNATURES_NOT_TRUSTED]:
    'These checks compare the signature against the bytes it covers. They do not say whether the certificate itself is one you should trust.',

  [GROUP_MARKS]: 'Marks',
  [GROUP_TEXT]: 'Text',
  [GROUP_PROOFING]: 'Proofing',
  [GROUP_MARKUP]: 'Markup',
  [GROUP_SHAPES]: 'Shapes',
  [GROUP_STAMPS]: 'Stamps',
  [GROUP_MEASURE]: 'Measure',
  [GROUP_LINKS]: 'Links',
  [GROUP_LANGUAGE]: 'Language',
  [SHOW_COMMENTS_TITLE]: 'Comments list',
  [SHOW_FIELDS_TITLE]: 'Fields list',
  [MOVE_PAGE_EARLIER_TITLE]: 'Move page up',
  [MOVE_PAGE_LATER_TITLE]: 'Move page down',
  [GROUP_FIELDS]: 'Fields',
  [GROUP_QUICK_TOOLS]: 'Quick tools',
  [RIBBON_SHARE]: 'Share…',
  [RIBBON_OPEN]: 'Open…',
  [RIBBON_SELECT]: 'Select',
  [RIBBON_HIGHLIGHT]: 'Highlight',
  [RIBBON_COMMENT]: 'Comment',
  [HAND_TOOL_TITLE]: 'Hand — drag to move the pages',
  [RIBBON_HAND]: 'Hand',
  [SELECT_TEXT_TITLE]: 'Select text',
  [RIBBON_TEXT]: 'Text',
  [RIBBON_COMPARE]: 'Compare…',
  [RIBBON_FORM_DATA_EXPORT]: 'Export',
  [RIBBON_FORM_DATA_IMPORT]: 'Import',
  [RIBBON_DETECT_FIELDS]: 'Detect…',
  [RIBBON_FLATTEN_FORM]: 'Flatten',
  [GROUP_EXPORT]: 'Export',
  [GROUP_COMBINE]: 'Combine',
  [GROUP_ADJUST]: 'Adjust',
  [GROUP_MANAGE]: 'Manage',
  [GROUP_DATA]: 'Data',
  [GROUP_DISPLAY]: 'Display',
  [GROUP_NAVIGATE]: 'Navigate',
  [GROUP_APPLICATION]: 'Application',
  [GROUP_OCR]: 'OCR',
  [GROUP_ACCESSIBILITY]: 'Accessibility',
  [WORD_COUNT_PROGRESS]: 'Counting words',
  [SPELL_CHECK_PROGRESS]: 'Checking spelling',
  [OCR_PROGRESS]: 'Recognising text',
  // NAMES THE READ, which is what the bar actually counts: *looking for scans*.
  [ENHANCE_PROGRESS]: 'Looking for scanned pages',
  // THE LABEL FIRST, so a screen reader announces what is running before the
  // numbers. "12 of 400" alone is the shape a progress region most often has
  // and the one that says least.
  [TASK_PROGRESS]: '{label} — {done} of {total}',
  [TASK_CANCEL]: 'Cancel',
  // "Not saved" and never "Save failed". Invariant 18's whole subject is that
  // the work survives a save that did not happen, and a title naming a failure
  // invites the reading that something was lost.
  [SAVE_PROBLEM_TITLE]: 'The document was not saved',
  // THE LOAD-BEARING SENTENCE, and it is the reason this dialog exists rather
  // than a toast. Invariant 18: *"never by a dialog whose only option discards
  // their edits"* — a user meeting a refusal needs to know first that their
  // work is still there, before anything about why.
  [SAVE_WORK_INTACT]: 'Your changes are still open and unsaved. Nothing has been lost.',
  [CLOSE_TAB_TITLE]: 'Close tab',
  [CLOSE_OTHERS_TITLE]: 'Close other tabs',
  // WHAT IT DOES, not where it puts it. *Open side by side* is the owner's
  // wording and it is also what a reader is asking for — the second pane is an
  // implementation of the request, not the request.
  [OPEN_SIDE_BY_SIDE_TITLE]: 'Open side by side',

  // RIBBON CAPTIONS. Each one abbreviates the title above it, and the title is
  // the tooltip — so the caption may be a word the sentence explains, and may
  // never be a word that contradicts it.
  [RIBBON_SAVE_COPY]: 'Save copy…',
  [RIBBON_EXPORT_LAYOUT_TEXT]: 'Layout text…',
  [RIBBON_EXPORT_WORD]: 'Word…',
  [RIBBON_EXPORT_POWERPOINT]: 'PowerPoint…',
  [RIBBON_EXPORT_EXCEL]: 'Excel…',
  [RIBBON_EXPORT_PDFA]: 'PDF/A…',
  // WHAT IT DOES, not what it is called elsewhere: *Save a smaller copy* is the
  // sentence, and the one word for it is the one people search for.
  [RIBBON_OPTIMIZE]: 'Compress…',
  [RIBBON_SNAPSHOT]: 'Snapshot',
  [RIBBON_STRIKEOUT]: 'Strikethrough',
  [RIBBON_REDACT_MARK]: 'Redact',
  [RIBBON_LINK_ADDRESS]: 'Web link',
  [RIBBON_LINK_PAGE]: 'Page link',
  [RIBBON_PLACE_IMAGE]: 'Image',
  [RIBBON_OCR_REGION]: 'Recognise',
  [RIBBON_CLOUD_REGION]: 'Azure OCR',
  [RIBBON_CLAUDE_REGION]: 'Claude OCR',
  [RIBBON_EDIT_TEXT]: 'Edit text',
  [RIBBON_EDIT_OBJECT]: 'Edit object',
  [RIBBON_ROTATE_180]: 'Rotate 180°',
  [RIBBON_ROTATE_270]: 'Rotate 270°',
  [RIBBON_DESKEW]: 'Straighten',
  [RIBBON_PAGE_TRANSITION]: 'Transitions',
  [RIBBON_PLACE_BARCODE]: 'Barcode',
  [RIBBON_INSERT_BLANK]: 'Blank page',
  [RIBBON_INSERT_FROM_PDF]: 'Insert PDF…',
  [RIBBON_GENERATE_TOC]: 'Contents',
  [RIBBON_PAGE_BACKGROUND]: 'Background',
  [RIBBON_HEADER_FOOTER]: 'Headers…',
  [RIBBON_EXPORT_PAGE_IMAGES]: 'Image…',
  [RIBBON_MERGE]: 'Merge…',
  [RIBBON_IMPORT_LAYER]: 'As layer…',
  [RIBBON_EDIT_EXTERNALLY]: 'External edit…',
  [RIBBON_FIND_DUPLICATES]: 'Duplicates…',
  [RIBBON_FORM_EXPORT_JSON]: 'Export JSON…',
  [RIBBON_FORM_EXPORT_XFDF]: 'Export XFDF…',
  [RIBBON_FORM_EXPORT_FDF]: 'Export FDF…',
  [RIBBON_FORM_IMPORT_JSON]: 'Import JSON…',
  [RIBBON_FORM_IMPORT_XFDF]: 'Import XFDF…',
  [RIBBON_FORM_IMPORT_FDF]: 'Import FDF…',
  [RIBBON_FIELD_TEXT]: 'Text field',
  [RIBBON_FIELD_CHECKBOX]: 'Tick box',
  [RIBBON_FIELD_RADIO]: 'Radio option',
  [RIBBON_FIELD_DROPDOWN]: 'Dropdown',
  [RIBBON_FIELD_LISTBOX]: 'List box',
  [RIBBON_COMMENTS_IMPORT_XFDF]: 'Import XFDF…',
  [RIBBON_COMMENTS_IMPORT_FDF]: 'Import FDF…',
  [RIBBON_COMMENTS_IMPORT_JSON]: 'Import JSON…',
  [RIBBON_COMMENTS_EXPORT_XFDF]: 'Export XFDF…',
  [RIBBON_COMMENTS_EXPORT_FDF]: 'Export FDF…',
  [RIBBON_COMMENTS_EXPORT_JSON]: 'Export JSON…',
  [RIBBON_PROTECT_DOCUMENT]: 'Permissions…',
  [RIBBON_REDACT_MATCHES]: 'Redact matches…',
  [RIBBON_PLACE_SIGNATURE]: 'Signature',
  [RIBBON_DIAGNOSTICS]: 'Diagnostics',
  [RIBBON_NEW_FROM_MARKDOWN]: 'From Markdown…',
  [RIBBON_APPEND_MARKDOWN]: 'Append Markdown…',
  [RIBBON_NEW_FROM_CSV]: 'From CSV…',
  [RIBBON_NEW_FROM_IMAGES]: 'From images…',
  [RIBBON_OPEN_FROM_URL]: 'From URL…',
  [RIBBON_NEW_FROM_CAMERA]: 'From camera…',
  [RIBBON_OCR]: 'OCR pages',
  [RIBBON_OCR_EXPORT]: 'Searchable copy',
  [RIBBON_ENHANCE]: 'Clean up',
  [RIBBON_STRAIGHTEN_PHOTOS]: 'Deskew photos',
  [COPY_SELECTION_TITLE]: 'Copy',
  [HIGHLIGHT_SELECTION_TITLE]: 'Highlight',
  [UNDERLINE_SELECTION_TITLE]: 'Underline',
  [STRIKEOUT_SELECTION_TITLE]: 'Strikethrough',
  // ADD, because the item opens a box to write in rather than turning something on. "Comment"
  // alone reads as a state a person might be toggling off the second time they meet it.
  [COMMENT_SELECTION_TITLE]: 'Add comment',
  // MARK, and the word is the point: the words are still in the file until the burn-in runs, and a
  // label reading "Redact" would tell a reader they are gone.
  [REDACT_SELECTION_TITLE]: 'Mark for redaction',
  [SEARCH_SELECTION_TITLE]: 'Search for this',
  [CLOSE_UNSAVED_TITLE]: 'Unsaved changes',
  // THE DOCUMENT BY NAME, because quitting asks once per document and the name is what says
  // which one this is. The buttons name their actions, so no answer depends on reading this.
  [CLOSE_UNSAVED_QUESTION]: '“{name}” has changes that are not saved. Save them before closing?',
  [CLOSE_UNSAVED_SAVE]: 'Save',
  [CLOSE_UNSAVED_DISCARD]: 'Don’t save',
  [CLOSE_UNSAVED_CANCEL]: 'Cancel',
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
  // NAMES THE TWO FORMATS THAT WORK, because the action here is choosing a
  // different one and a message saying only what failed leaves the reader
  // guessing which. XFDF is XML and XML has no way to write a control
  // character at all — not even escaped.
  [SAVE_REFUSED_UNREPRESENTABLE]: 'A field in this form holds a character XFDF cannot store. Export as FDF or JSON instead, which both keep it.',
  [SAVE_WRITE_FAILED]: 'The file could not be written. Check that it is not open in another application, and that there is room on the disk.',
  [SAVE_LAYOUT_UNAVAILABLE]: 'Text with layout needs a component that is not installed with this copy of Monstera. Export text… still works.',
  [SAVE_LAYOUT_FAILED]: 'The text could not be read with its layout from this document, so no file was written. Export text… may still work.',
  [SAVE_NO_TABLES]: 'No tables with ruled lines were found in this document, so no file was written.',
  [SAVE_PDFA_UNAVAILABLE]: 'PDF/A export needs a component that is not installed with this copy of Monstera, so no file was written.',
  [SAVE_PDFA_FAILED]: 'This document could not be converted to PDF/A, so no file was written. Save a copy… still works.',
  [SAVE_OPTIMIZE_UNAVAILABLE]: 'Saving a smaller copy needs a component that is not installed with this copy of Monstera, so no file was written.',
  [SAVE_OPTIMIZE_UNREADABLE]: 'This document could not be read to make a smaller copy — a password-protected document is one reason — so no file was written.',
  [SAVE_OPTIMIZE_CHANGED]: 'The document changed after its size was checked, so no file was written. Check the size again.',
  [SAVE_PRINT_UNAVAILABLE]: 'Printing needs the system print dialog, which this copy of Monstera cannot open here, so nothing was printed.',
  [SAVE_PRINT_FAILED]: 'The printer did not accept the document, so it was cancelled and nothing more was sent. Check the printer, then print again.',
  [SAVE_EMAIL_UNAVAILABLE]: 'Emailing uses the Windows Share sheet, which this copy of Monstera cannot open here, so nothing was shared.',
  [SAVE_EMAIL_FAILED]: 'The Windows Share sheet could not be opened for this document, so nothing was shared. Save a copy… and attach it from your mail app instead.',
  [SAVE_REVIEW_CHANGED]: 'The document changed while its tables were being reviewed, so no file was written. Export tables to Excel… again to review the tables as they are now.',
  [SAVE_NO_TABLES_NO_TEXT]: 'No tables were found, so no file was written. Some pages are pictures of text with no text to read; recognise their text first with Tools › OCR, then export again.',
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
    'What you were looking at was out of date, so nothing was changed. The document moved on while it was open — have another look and try again.',
  // NAMES NO ENGINE AND ASKS FOR NOTHING. Which component is missing is main's
  // business, and the person reading this cannot install it — a Store build
  // ships what it ships. So the sentence says the document is safe, says the
  // feature is not available in this copy, and stops; an instruction the reader
  // cannot follow is worse than none.
  [PROBLEM_ENGINE_UNAVAILABLE]:
    'This copy of Monstera cannot edit text in place. Your document is unchanged, and everything else still works.',
  // AN ACTION THE READER CAN TAKE, which is exactly what separates this from the
  // one above it. That sentence stops because there is nothing a person can do
  // about a missing component; this one names zooming out, because the size the
  // renderer asked for is a consequence of the zoom and the reader controls it.
  [PROBLEM_RASTER_TOO_LARGE]:
    'This page is too large to draw with the other renderer at this zoom. Zoom out, or turn the setting off.',
  // WHAT CAN BE DONE, since the person chose these marks on purpose: which kinds do not travel,
  // and that the rest of a mixed selection still would.
  [PROBLEM_NOT_COPYABLE]:
    'These marks can’t be copied. Image stamps and some annotations from other applications don’t copy; comments, shapes, drawings and highlights do.',
  // A SERVICE'S ANSWER TO A REGION, each naming what the reader can do; out of credit is the
  // assistant's own sentence, because it is one account whichever door it was met from.
  [PROBLEM_SERVICE_NO_KEY]: 'No key is stored for this service. Add it in Settings; nothing was changed.',
  [PROBLEM_SERVICE_UNAUTHORISED]: 'The service did not accept the stored key. Check it in Settings; nothing was changed.',
  [PROBLEM_SERVICE_UNAVAILABLE]:
    'The service could not be reached or is busy. Nothing was changed — try again in a moment.',
  [PROBLEM_SERVICE_REFUSED]: 'The service did not read this area, so nothing was changed.',
  [COPY_ANNOTATIONS_TITLE]: 'Copy',
  [PASTE_ANNOTATIONS_TITLE]: 'Paste annotations',
  [PROBLEM_INTERNAL]: 'Something went wrong inside Monstera. Your document is unchanged.',
  // A label, not a sentence: the value beside it is an opaque id, and ADR-0009
  // §9 is why it is the only thing about the diagnostic that crosses.
  [PROBLEM_REFERENCE_LABEL]: 'Reference',
};
