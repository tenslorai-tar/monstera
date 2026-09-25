import type { AnnotationDataFormat } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import { HISTORY_TRIMMED_DIALOG_ID } from '../dialogs/historyTrimmed.js';
import { IMPORT_ANNOTATIONS_PROBLEM_DIALOG_ID } from '../dialogs/importAnnotationsProblem.js';
import { SAVE_PROBLEM_DIALOG_ID } from '../dialogs/saveProblem.js';
import {
  EXPORT_ANNOTATIONS_FDF_TITLE,
  EXPORT_ANNOTATIONS_JSON_TITLE,
  EXPORT_ANNOTATIONS_XFDF_TITLE,
  GROUP_COMMENT_FILES,
  IMPORT_ANNOTATIONS_FDF_TITLE,
  IMPORT_ANNOTATIONS_JSON_TITLE,
  IMPORT_ANNOTATIONS_XFDF_TITLE,
  RIBBON_COMMENTS_IMPORT_XFDF,
  RIBBON_COMMENTS_IMPORT_FDF,
  RIBBON_COMMENTS_IMPORT_JSON,
  RIBBON_COMMENTS_EXPORT_XFDF,
  RIBBON_COMMENTS_EXPORT_FDF,
  RIBBON_COMMENTS_EXPORT_JSON,
  PASTE_ANNOTATIONS_TITLE,
} from '../messages/en.js';
import type { IconName } from '../primitives/icons.js';
import type { UiCommand } from '../registries/commands.js';
import { type DocumentCommandDeps, hasDocument, reportProblem } from './documentCommands.js';

/**
 * Review › Comment files — the document's comments to a file, and a file's comments into the
 * document (D8's *annotation import / export*, ADR-0077).
 *
 * `exportFormDataCommand`'s and `importFormDataCommand`'s shapes and reasons: a command per
 * format rather than a dialog whose only control is the format, the copy route's outcomes on the
 * way out, and a mutation's on the way in. All three formats import, unlike form data's history:
 * the XFDF reader reads `<annots>` as well as `<fields>`.
 */
function exportAnnotationsCommand(
  format: AnnotationDataFormat,
  id: string,
  title: MessageKey,
  /** The ribbon's own caption, two words; the full title becomes its tooltip. */
  ribbonTitle: MessageKey,
  order: number,
  icon: IconName,
): (deps: DocumentCommandDeps) => UiCommand {
  return (deps) => ({
    id,
    title,
    ribbonTitle,
    icon,
    placements: [{ surface: 'ribbon', section: 'review', group: GROUP_COMMENT_FILES, order }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined) return;
      const answer = await deps.client['document.exportAnnotations']({ docId: context.docId, format });
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      if (answer.value.kind === 'copied' || answer.value.kind === 'cancelled') return;
      void deps.ask(SAVE_PROBLEM_DIALOG_ID, {
        outcome:
          answer.value.kind === 'write-failed'
            ? 'write-failed'
            : answer.value.kind === 'unrepresentable'
              ? 'unrepresentable'
              : 'contested',
      });
    },
  });
}

function importAnnotationsCommand(
  format: AnnotationDataFormat,
  id: string,
  title: MessageKey,
  /** The ribbon's own caption, two words; the full title becomes its tooltip. */
  ribbonTitle: MessageKey,
  order: number,
): (deps: DocumentCommandDeps) => UiCommand {
  return (deps) => ({
    id,
    title,
    ribbonTitle,
    icon: 'FileUp',
    placements: [{ surface: 'ribbon', section: 'review', group: GROUP_COMMENT_FILES, order }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined) return;
      const answer = await deps.client['document.importAnnotations']({ docId: context.docId, format });
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      if (answer.value.kind === 'cancelled') return;
      if (answer.value.kind === 'unreadable') {
        void deps.ask(IMPORT_ANNOTATIONS_PROBLEM_DIALOG_ID, { reason: 'unreadable' });
        return;
      }
      if (answer.value.kind === 'too-large') {
        void deps.ask(IMPORT_ANNOTATIONS_PROBLEM_DIALOG_ID, {
          reason: 'too-large',
          limitBytes: answer.value.limitBytes,
        });
        return;
      }
      deps.onApplied({ version: answer.value.version, byteLength: answer.value.byteLength });
      // INVARIANT 18, after `onApplied`, for `importFormDataCommand`'s reason.
      if (answer.value.historyDropped > 0) {
        void deps.ask(HISTORY_TRIMMED_DIALOG_ID, { dropped: answer.value.historyDropped });
      }
    },
  });
}

/** Import first in the group, each format's import beside its export: 10–15. */
/**
 * Pastes the annotation clipboard onto a page — §7's page menu and the palette.
 *
 * ## Main holds the clipboard, so this sends a PAGE and nothing else
 *
 * A paste is an `importAnnotations`, which carries bytes and is withheld from the renderer (B5).
 * So the renderer never held the marks; it asks main to paste what main copied, and is answered
 * exactly as a file import is — which is why this sits beside that command and handles the same
 * outcomes the same way.
 *
 * ## Which page is the CONTEXT's
 *
 * From the page menu that is the page right-clicked; from the palette it is the page on show.
 * `when` hides the item until something has been copied in this run, because a paste of nothing
 * is a control that does nothing — and it is `hasCopied` that is asked, not main, since the
 * renderer is told the count by every copy it made.
 *
 * ## Ctrl+V, and why it takes nothing from a text field
 *
 * `useShortcuts` listens on the document, and a claimed Ctrl+V used to take the key from every
 * input in the application. Since 2026-09-23 the dispatcher leaves a text field the keys it answers
 * itself (`fieldOwnsChord`, Ctrl+V among them). The choice that remained — Ctrl+V on the page meaning
 * *paste the marks I copied* — was the owner's, taken 2026-09-25. With nothing copied `when` hides the
 * command, the chord is unclaimed, and the browser keeps the key.
 */
export function pasteAnnotationsCommand(
  deps: DocumentCommandDeps & { readonly hasCopied: () => boolean },
): UiCommand {
  return {
    id: 'annotate.paste',
    title: PASTE_ANNOTATIONS_TITLE,
    shortcut: 'Ctrl+V',
    placements: [{ surface: 'context-menu', context: 'page', order: 25 }],
    when: (context) => hasDocument(context) && deps.hasCopied(),
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.page === undefined) return;
      const answer = await deps.client['document.pasteAnnotations']({ docId: context.docId, page: context.page });
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      if (answer.value.kind === 'empty') return;
      if (answer.value.kind === 'refused') {
        void deps.ask(IMPORT_ANNOTATIONS_PROBLEM_DIALOG_ID, { reason: 'unreadable' });
        return;
      }
      deps.onApplied({ version: answer.value.version, byteLength: answer.value.byteLength });
      if (answer.value.historyDropped > 0) {
        void deps.ask(HISTORY_TRIMMED_DIALOG_ID, { dropped: answer.value.historyDropped });
      }
    },
  };
}

export const importAnnotationsXfdfCommand = importAnnotationsCommand(
  'xfdf',
  'document.import-annotations-xfdf',
  IMPORT_ANNOTATIONS_XFDF_TITLE,
  RIBBON_COMMENTS_IMPORT_XFDF,
  10,
);
export const importAnnotationsFdfCommand = importAnnotationsCommand(
  'fdf',
  'document.import-annotations-fdf',
  IMPORT_ANNOTATIONS_FDF_TITLE,
  RIBBON_COMMENTS_IMPORT_FDF,
  11,
);
export const importAnnotationsJsonCommand = importAnnotationsCommand(
  'json',
  'document.import-annotations-json',
  IMPORT_ANNOTATIONS_JSON_TITLE,
  RIBBON_COMMENTS_IMPORT_JSON,
  12,
);
export const exportAnnotationsXfdfCommand = exportAnnotationsCommand(
  'xfdf',
  'document.export-annotations-xfdf',
  EXPORT_ANNOTATIONS_XFDF_TITLE,
  RIBBON_COMMENTS_EXPORT_XFDF,
  13,
  'FileCode',
);
export const exportAnnotationsFdfCommand = exportAnnotationsCommand(
  'fdf',
  'document.export-annotations-fdf',
  EXPORT_ANNOTATIONS_FDF_TITLE,
  RIBBON_COMMENTS_EXPORT_FDF,
  14,
  'FileDown',
);
export const exportAnnotationsJsonCommand = exportAnnotationsCommand(
  'json',
  'document.export-annotations-json',
  EXPORT_ANNOTATIONS_JSON_TITLE,
  RIBBON_COMMENTS_EXPORT_JSON,
  15,
  'Braces',
);
