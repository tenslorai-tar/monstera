import { ABOUT_DIALOG } from '../dialogs/about.js';
import { ACCESSIBILITY_DIALOG } from '../dialogs/accessibilityCheck.js';
import { AI_SETUP_DIALOG } from '../dialogs/aiSetup.js';
import { ANNOTATION_EDIT_DIALOG } from '../dialogs/annotationEdit.js';
import { LINK_ADDRESS_DIALOG, LINK_PAGE_DIALOG } from '../dialogs/annotationLink.js';
import { ANNOTATION_NOTE_DIALOG } from '../dialogs/annotationNote.js';
import { ANNOTATION_REPLY_DIALOG } from '../dialogs/annotationReply.js';
import { ANNOTATION_TEXT_DIALOG } from '../dialogs/annotationText.js';
import { APPLY_REDACTIONS_DIALOG } from '../dialogs/applyRedactions.js';
import { BATES_NUMBER_DIALOG } from '../dialogs/batesNumber.js';
import { CALLOUT_DIALOG } from '../dialogs/callout.js';
import { CAMERA_CAPTURE_DIALOG } from '../dialogs/cameraCapture.js';
import { CLOSE_UNSAVED_DIALOG } from '../dialogs/closeUnsaved.js';
import { CLOUD_OUTCOME_DIALOG } from '../dialogs/cloudOutcome.js';
import { CLOUD_DIALOG } from '../dialogs/cloudStorage.js';
import { CLOUD_VIEW_ONLY_DIALOG } from '../dialogs/cloudViewOnly.js';
import { COMMAND_PROBLEM_DIALOG } from '../dialogs/commandProblem.js';
import { COMPONENTS_DIALOG } from '../dialogs/components.js';
import { CROP_PAGES_DIALOG } from '../dialogs/cropPages.js';
import { DELETE_PAGES_DIALOG } from '../dialogs/deletePages.js';
import { DOCUMENT_PASSWORD_DIALOG } from '../dialogs/documentPassword.js';
import { DOCUSIGN_NOTICE_DIALOG } from '../dialogs/docusignNotice.js';
import { DOCUSIGN_SEND_DIALOG } from '../dialogs/docusignSend.js';
import { DONATE_DIALOG } from '../dialogs/donate.js';
import { DUPLICATE_PAGES_DIALOG } from '../dialogs/duplicatePages.js';
import { EDIT_PAGE_OBJECT_DIALOG } from '../dialogs/editPageObject.js';
import { ENHANCE_OUTCOME_DIALOG } from '../dialogs/enhanceOutcome.js';
import { EXPORT_EXCEL_DIALOG } from '../dialogs/exportExcel.js';
import { EXPORT_PAGE_IMAGES_DIALOG } from '../dialogs/exportPageImages.js';
import { EXPORT_WORD_DIALOG } from '../dialogs/exportWord.js';
import { EXTERNAL_EDIT_PROBLEM_DIALOG } from '../dialogs/externalEditProblem.js';
import { EXTRACT_PAGES_DIALOG } from '../dialogs/extractPages.js';
import { FLAT_FIELDS_DIALOG } from '../dialogs/flatFields.js';
import { FORM_FIELD_DIALOGS } from '../dialogs/formField.js';
import { GENERATE_TOC_PROBLEM_DIALOG } from '../dialogs/generateTocProblem.js';
import { HEADER_FOOTER_DIALOG } from '../dialogs/headerFooter.js';
import { HELP_DIALOG } from '../dialogs/help.js';
import { HISTORY_TRIMMED_DIALOG } from '../dialogs/historyTrimmed.js';
import { IMPORT_ANNOTATIONS_PROBLEM_DIALOG } from '../dialogs/importAnnotationsProblem.js';
import { IMPORT_FORM_DATA_PROBLEM_DIALOG } from '../dialogs/importFormDataProblem.js';
import { IMPORT_PAGE_AS_LAYER_DIALOG } from '../dialogs/importPageAsLayer.js';
import { INSERT_FROM_PDF_DIALOG } from '../dialogs/insertFromPdf.js';
import { INSERT_IMAGE_PROBLEM_DIALOG } from '../dialogs/insertImageProblem.js';
import { HELD_COPIES_DIALOG } from '../dialogs/heldCopies.js';
import { KEPT_BACKUPS_DIALOG } from '../dialogs/keptBackups.js';
import { KEYBOARD_SHORTCUTS_DIALOG } from '../dialogs/keyboardShortcuts.js';
import { MARKDOWN_IMPORT_PROBLEM_DIALOG } from '../dialogs/markdownImportProblem.js';
import { MERGE_DOCUMENT_DIALOG } from '../dialogs/mergeDocument.js';
import { MERGE_DOCUMENT_NONE_DIALOG } from '../dialogs/mergeDocumentNone.js';
import { OCR_DIALOG } from '../dialogs/ocr.js';
import { OCR_OUTCOME_DIALOG } from '../dialogs/ocrOutcome.js';
import { OPEN_FROM_URL_DIALOG } from '../dialogs/openFromUrl.js';
import { OPTIMIZE_DIALOG } from '../dialogs/optimize.js';
import { PAGE_BARCODES_DIALOG } from '../dialogs/pageBarcodes.js';
import { PAGE_STRUCTURE_DIALOG } from '../dialogs/pageStructure.js';
import { PAGE_TRANSITION_DIALOG } from '../dialogs/pageTransition.js';
import { PDFA_REMOVALS_DIALOG } from '../dialogs/pdfaRemovals.js';
import { PENDING_REDACTIONS_DIALOG } from '../dialogs/pendingRedactions.js';
import { PLACE_BARCODE_DIALOG } from '../dialogs/placeBarcode.js';
import { PRINT_DIALOG } from '../dialogs/print.js';
import { PROTECT_DOCUMENT_DIALOG } from '../dialogs/protectDocument.js';
import { REDACT_MATCHES_DIALOG } from '../dialogs/redactMatches.js';
import { REIMPORT_EXTERNAL_EDIT_DIALOG } from '../dialogs/reimportExternalEdit.js';
import { REPLACE_PAGE_DIALOG } from '../dialogs/replacePage.js';
import { RESIZE_PAGES_DIALOG } from '../dialogs/resizePages.js';
import { SANITIZE_DOCUMENT_DIALOG } from '../dialogs/sanitizeDocument.js';
import { SAVE_PROBLEM_DIALOG } from '../dialogs/saveProblem.js';
import { SCAN_OUTCOME_DIALOG } from '../dialogs/scanOutcome.js';
import { SECURITY_UPDATE_DIALOG } from '../dialogs/securityUpdate.js';
import { SERVICE_REFUSED_DIALOG } from '../dialogs/serviceRefused.js';
import { SETTINGS_DIALOG } from '../dialogs/settings.js';
import { SETTINGS_PROBLEM_DIALOG } from '../dialogs/settingsProblem.js';
import { SIGN_DOCUMENT_DIALOG } from '../dialogs/signDocument.js';
import { SIGN_PROBLEM_DIALOG } from '../dialogs/signProblem.js';
import { SIGNATURE_DIALOG } from '../dialogs/signature.js';
import { SIGNATURE_BREAK_DIALOG } from '../dialogs/signatureBreak.js';
import { SIGNATURE_PROBLEM_DIALOG } from '../dialogs/signatureProblem.js';
import { SIGNATURES_DIALOG } from '../dialogs/signatures.js';
import { SPELL_CHECK_DIALOG } from '../dialogs/spellCheck.js';
import { SPLIT_DOCUMENT_DIALOG } from '../dialogs/splitDocument.js';
import { STAMP_DIALOG } from '../dialogs/stamp.js';
import { TRANSLATE_PAGE_DIALOG } from '../dialogs/translatePage.js';
import { TYPEWRITER_DIALOG } from '../dialogs/typewriter.js';
import { URL_OPEN_PROBLEM_DIALOG } from '../dialogs/urlOpenProblem.js';
import { WATERMARK_PAGES_DIALOG } from '../dialogs/watermarkPages.js';
import { WORD_COUNT_DIALOG } from '../dialogs/wordCount.js';
import { WORKBOOK_INCOMPLETE_DIALOG } from '../dialogs/workbookIncomplete.js';
import type { RegisteredDialog } from './dialogs.js';

/**
 * Every dialog the application registers, in one list.
 *
 * The shell builds its `DialogRegistry` from this and nothing else, and the dialog gallery
 * (`gallery/dialogGallery.tsx`), which opens each one for review by eye, takes the same list. It
 * was written inline in `App.tsx`, where nothing outside the shell could read it, so any other
 * reader would have had to keep a second copy, which is the defect B3 forbids.
 */
export const APPLICATION_DIALOGS: readonly RegisteredDialog[] = [
  ABOUT_DIALOG,
  COMPONENTS_DIALOG,
  AI_SETUP_DIALOG,
  DONATE_DIALOG,
  SECURITY_UPDATE_DIALOG,
  CLOUD_DIALOG,
  CLOUD_OUTCOME_DIALOG,
  CLOUD_VIEW_ONLY_DIALOG,
  KEYBOARD_SHORTCUTS_DIALOG,
  HELP_DIALOG,
  WORD_COUNT_DIALOG,
  PAGE_STRUCTURE_DIALOG,
  SPELL_CHECK_DIALOG,
  OCR_DIALOG,
  TRANSLATE_PAGE_DIALOG,
  OCR_OUTCOME_DIALOG,
  ENHANCE_OUTCOME_DIALOG,
  SCAN_OUTCOME_DIALOG,
  SAVE_PROBLEM_DIALOG,
  CLOSE_UNSAVED_DIALOG,
  COMMAND_PROBLEM_DIALOG,
  HISTORY_TRIMMED_DIALOG,
  DELETE_PAGES_DIALOG,
  ANNOTATION_TEXT_DIALOG,
  STAMP_DIALOG,
  SIGNATURE_BREAK_DIALOG,
  PENDING_REDACTIONS_DIALOG,
  KEPT_BACKUPS_DIALOG,
  HELD_COPIES_DIALOG,
  ANNOTATION_NOTE_DIALOG,
  ANNOTATION_EDIT_DIALOG,
  ANNOTATION_REPLY_DIALOG,
  DOCUMENT_PASSWORD_DIALOG,
  PROTECT_DOCUMENT_DIALOG,
  APPLY_REDACTIONS_DIALOG,
  REDACT_MATCHES_DIALOG,
  SANITIZE_DOCUMENT_DIALOG,
  SIGN_DOCUMENT_DIALOG,
  SIGNATURE_DIALOG,
  SIGNATURE_PROBLEM_DIALOG,
  SIGN_PROBLEM_DIALOG,
  SIGNATURES_DIALOG,
  DOCUSIGN_SEND_DIALOG,
  DOCUSIGN_NOTICE_DIALOG,
  LINK_ADDRESS_DIALOG,
  LINK_PAGE_DIALOG,
  CALLOUT_DIALOG,
  TYPEWRITER_DIALOG,
  CROP_PAGES_DIALOG,
  WATERMARK_PAGES_DIALOG,
  HEADER_FOOTER_DIALOG,
  BATES_NUMBER_DIALOG,
  PAGE_TRANSITION_DIALOG,
  RESIZE_PAGES_DIALOG,
  FLAT_FIELDS_DIALOG,
  EDIT_PAGE_OBJECT_DIALOG,
  IMPORT_FORM_DATA_PROBLEM_DIALOG,
  IMPORT_ANNOTATIONS_PROBLEM_DIALOG,
  INSERT_IMAGE_PROBLEM_DIALOG,
  MARKDOWN_IMPORT_PROBLEM_DIALOG,
  WORKBOOK_INCOMPLETE_DIALOG,
  OPEN_FROM_URL_DIALOG,
  URL_OPEN_PROBLEM_DIALOG,
  CAMERA_CAPTURE_DIALOG,
  GENERATE_TOC_PROBLEM_DIALOG,
  MERGE_DOCUMENT_DIALOG,
  MERGE_DOCUMENT_NONE_DIALOG,
  INSERT_FROM_PDF_DIALOG,
  REPLACE_PAGE_DIALOG,
  IMPORT_PAGE_AS_LAYER_DIALOG,
  REIMPORT_EXTERNAL_EDIT_DIALOG,
  EXTERNAL_EDIT_PROBLEM_DIALOG,
  EXTRACT_PAGES_DIALOG,
  SPLIT_DOCUMENT_DIALOG,
  EXPORT_PAGE_IMAGES_DIALOG,
  EXPORT_WORD_DIALOG,
  EXPORT_EXCEL_DIALOG,
  SERVICE_REFUSED_DIALOG,
  PRINT_DIALOG,
  PDFA_REMOVALS_DIALOG,
  OPTIMIZE_DIALOG,
  PAGE_BARCODES_DIALOG,
  ACCESSIBILITY_DIALOG,
  PLACE_BARCODE_DIALOG,
  DUPLICATE_PAGES_DIALOG,
  SETTINGS_PROBLEM_DIALOG,
  SETTINGS_DIALOG,
  ...FORM_FIELD_DIALOGS,
];
