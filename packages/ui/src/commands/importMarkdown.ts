import type { BoxedCharacter, ChannelResult, ComposeRefusal, ImportSkippedPart } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';

import { BOXED_CHARACTERS_DIALOG_ID } from '../dialogs/boxedCharacters.js';
import { CAMERA_CAPTURE_DIALOG_ID, CAMERA_CAPTURE_RESULT } from '../dialogs/cameraCapture.js';
import { COMPONENT_CANNOT_START_DIALOG_ID } from '../dialogs/componentCannotStart.js';
import { fileTooLargeProblem } from '../dialogs/fileTooLarge.js';
import { HISTORY_TRIMMED_DIALOG_ID } from '../dialogs/historyTrimmed.js';
import { IMPORT_SKIPPED_DIALOG_ID } from '../dialogs/importSkipped.js';
import { INSERT_MARKDOWN_DIALOG_ID } from '../dialogs/insertMarkdown.js';
import type { InsertMarkdownAnswer } from '../dialogs/insertMarkdownResult.js';
import { INSERT_IMAGES_DIALOG_ID } from '../dialogs/insertImages.js';
import { NEW_FROM_TEXT_DIALOG_ID } from '../dialogs/newFromText.js';
import { NEW_FROM_TEXT_RESULT, type NewFromTextAnswer } from '../dialogs/newFromTextResult.js';
import type { InsertImagesAnswer } from '../dialogs/insertImagesResult.js';
import { WORKBOOK_INCOMPLETE_DIALOG_ID } from '../dialogs/workbookIncomplete.js';
import {
  MARKDOWN_IMPORT_PROBLEM_DIALOG_ID,
  type MarkdownImportProblem,
} from '../dialogs/markdownImportProblem.js';
import {
  APPEND_MARKDOWN_COMMAND_TITLE,
  CAMERA_CONVERTING,
  CSV_CONVERTING,
  GROUP_CREATE,
  IMAGES_CONVERTING,
  IMAGES_INSERTING,
  MARKDOWN_CONVERTING,
  MARKDOWN_INSERTING,
  OFFICE_CONVERTING,
  GROUP_PAGES,
  INSERT_IMAGE_COMMAND_TITLE,
  NEW_FROM_CAMERA_COMMAND_TITLE,
  NEW_FROM_CSV_COMMAND_TITLE,
  NEW_FROM_IMAGES_COMMAND_TITLE,
  NEW_FROM_MARKDOWN_COMMAND_TITLE,
  NEW_FROM_OFFICE_COMMAND_TITLE,
  RIBBON_NEW_FROM_MARKDOWN,
  RIBBON_NEW_FROM_CSV,
  RIBBON_NEW_FROM_OFFICE,
  RIBBON_NEW_FROM_IMAGES,
  RIBBON_NEW_FROM_CAMERA,
  RIBBON_APPEND_MARKDOWN,
} from '../messages/en.js';
import { targetPages, type UiCommand, VISIBLE } from '../registries/commands.js';
import { fontListOf } from '../fontList.js';
import type { TrackTask } from '../runningTask.js';
import { type DocumentCommandDeps, hasPages, reportProblem } from './documentCommands.js';
import { withWorkProgress } from './workProgress.js';

/**
 * D9's Markdown row: a new PDF from a Markdown file, or its pages added to the
 * document being read
 * ([ADR-0060](../../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## THEY SEND NOTHING BUT WHERE
 *
 * Main runs both pickers, reads the file, has the compose host set it and writes the
 * PDF. `insertImageCommand`'s shape: the ask is nothing, or a document and an index,
 * and what returns is outcomes.
 */

/** A document the renderer adds as a tab. `openDocumentCommand`'s `onOpened` shape. */
export interface OpenedDocument {
  readonly docId: DocId;
  readonly version: DocVersion;
  readonly byteLength: number;
  readonly name: string;
}

/**
 * What the person is told for an answer that produced no document, or `null` for the
 * answers that need no sentence.
 *
 * One mapping for both channels, because their import outcomes are the same members:
 * a second copy would be two opinions about what each sentence is for (B3a).
 */
export function markdownImportProblem(
  // `document.newFromCsv` IS NOT A SECOND MEMBER HERE: it answers the contract's one
  // declared import-outcome union, so its result type is this first member exactly.
  answer:
    | ChannelResult<'document.newFromMarkdown'>
    | ChannelResult<'document.appendMarkdown'>
    | ChannelResult<'document.insertImage'>
    | ChannelResult<'document.newFromImages'>
    | ChannelResult<'document.newFromOffice'>,
): MarkdownImportProblem | null {
  switch (answer.kind) {
    case 'conversion-failed':
      return { reason: 'conversion-failed' };
    case 'unreadable':
      return { reason: 'unreadable' };
    case 'too-large':
      return fileTooLargeProblem(answer);
    case 'composition-refused':
      return refusalProblem(answer.reason, answer.line, answer.file);
    case 'too-many-images':
      return { reason: 'too-many-images', limit: answer.limit };
    case 'images-too-large':
      return { reason: 'images-too-large', limitBytes: answer.limitBytes };
    case 'destination-contested':
      return { reason: 'destination-contested', openElsewhere: answer.openElsewhere };
    case 'write-failed':
      return { reason: 'write-failed' };
    case 'absent':
      return { reason: 'absent' };
    case 'at-capacity':
      return { reason: 'at-capacity' };
    case 'busy':
    case 'denied':
      return { reason: answer.kind };
    // `cancelled` is a person changing their mind; `opened`, `already-open` and
    // `appended` are the document they asked for. Named rather than defaulted, so an
    // outcome a channel gains later is a lint error here instead of a silence. And
    // `opened-incomplete` OPENED too, so it is no problem of the import's: the rows it
    // lacks have their own dialog, which the Office command opens (decision C). So did
    // `opened-with-boxes`, whose boxed characters the text imports name (ADR-0172), and `opened-with-skips`, which
    // opened with every other part and whose parts left out the import names.
    // A PART OF MONSTERA THAT COULD NOT START has its own dialog, which says the file is not the problem; this one would
    // say the opposite. `newFromOfficeCommand` asks it before reaching here.
    case 'component-cannot-start':
    case 'opened-incomplete':
    case 'opened-with-boxes':
    case 'opened-with-skips':
    case 'cancelled':
    case 'opened':
    case 'already-open':
    case 'appended':
    case 'inserted':
      return null;
  }
}

/**
 * The sentence a composer's refusal gets, by reason.
 *
 * A SWITCH, and exhaustive, in a function of its own. It was an if/else whose last
 * branch was `nothing-to-draw`, so a reason added to `COMPOSE_REFUSALS` fell into it
 * in silence — `malformed-csv` would have told a person their file was empty. A
 * function rather than a nested switch because `no-fallthrough` reads a nested
 * switch's returns as a fall-through out of the case around it.
 */
function refusalProblem(
  reason: ComposeRefusal,
  line: number | null,
  file: string | null,
): MarkdownImportProblem {
  switch (reason) {
    case 'image-unreadable':
      return { reason: 'image-unreadable', file };
    case 'too-many-pixels':
      return { reason: 'too-many-pixels', file };
    case 'malformed-csv':
      return { reason: 'malformed-csv', line };
    case 'not-utf8':
      return { reason: 'not-utf8' };
    case 'nothing-to-draw':
      return { reason: 'nothing-to-draw' };
  }
}

/**
 * A new PDF from a Markdown file, opened as a tab.
 *
 * Needs no document, so it declares no `when`: importing is a way to START with a
 * document. `openDocumentCommand`'s callbacks, for its outcomes — the composed file is
 * opened through the same route a picked one is.
 */
export function newFromMarkdownCommand(deps: {
  readonly client: DocumentCommandDeps['client'];
  readonly ask: DocumentCommandDeps['ask'];
  /** Where the conversion is shown from the chosen file until the tab opens (ADR-0234). */
  readonly track: TrackTask;
  readonly onOpened: (opened: OpenedDocument) => void;
  readonly onAlreadyOpen: (docId: DocId) => void;
}): UiCommand {
  return {
    id: 'document.new-from-markdown',
    // THE NEW DOCUMENT OPENS IN A TAB, like every `new-from` command here.
    feedback: VISIBLE,
    icon: 'FileCode',
    title: NEW_FROM_MARKDOWN_COMMAND_TITLE,
    ribbonTitle: RIBBON_NEW_FROM_MARKDOWN,
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_CREATE, order: 10, size: 'small' }],
    run: async (): Promise<void> => {
      const chosen = await chosenFont(deps);
      if (chosen === undefined) return;
      const answer = await withWorkProgress(deps, MARKDOWN_CONVERTING, (work) =>
        deps.client['document.newFromMarkdown']({ family: chosen.family, work }),
      );
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      const result = answer.value;
      if (openedText(deps, result)) return;
      if (result.kind === 'already-open') {
        deps.onAlreadyOpen(result.docId);
        return;
      }
      const problem = markdownImportProblem(result);
      if (problem !== null) void deps.ask(MARKDOWN_IMPORT_PROBLEM_DIALOG_ID, problem);
    },
  };
}

/**
 * The font a new PDF from text is set in, asked before main's picker (the owner's L4): the session's one held font list
 * (`fontListOf`, W5) in the one font row. `undefined` where the dialog was closed unanswered, which is a change of mind:
 * nothing is picked or written.
 */
async function chosenFont(deps: {
  readonly client: DocumentCommandDeps['client'];
  readonly ask: DocumentCommandDeps['ask'];
}): Promise<NewFromTextAnswer | undefined> {
  const fonts = await fontListOf(deps.client);
  const answer = NEW_FROM_TEXT_RESULT.safeParse(await deps.ask(NEW_FROM_TEXT_DIALOG_ID, { fonts }));
  return answer.success ? answer.data : undefined;
}

/**
 * A new PDF table from a CSV file, opened as a tab.
 *
 * {@link newFromMarkdownCommand}'s shape and callbacks exactly: it needs no document,
 * the ask is the font, and every answer is one the Markdown import also gives, so the
 * same mapping and the same dialog tell the person what happened.
 */
export function newFromCsvCommand(deps: {
  readonly client: DocumentCommandDeps['client'];
  readonly ask: DocumentCommandDeps['ask'];
  /** Where the conversion is shown while it runs, with its Cancel (`withWorkProgress`, the owner's O9 and O10). */
  readonly track: TrackTask;
  readonly onOpened: (opened: OpenedDocument) => void;
  readonly onAlreadyOpen: (docId: DocId) => void;
}): UiCommand {
  return {
    id: 'document.new-from-csv',
    feedback: VISIBLE,
    icon: 'Sheet',
    title: NEW_FROM_CSV_COMMAND_TITLE,
    ribbonTitle: RIBBON_NEW_FROM_CSV,
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_CREATE, order: 30, size: 'small' }],
    run: async (): Promise<void> => {
      const chosen = await chosenFont(deps);
      if (chosen === undefined) return;
      // ON SCREEN FROM THE CHOSEN FILE ON, with a Cancel where it is composed in parts: a large file takes minutes.
      const answer = await withWorkProgress(deps, CSV_CONVERTING, (work) =>
        deps.client['document.newFromCsv']({ family: chosen.family, work }),
      );
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      const result = answer.value;
      if (openedText(deps, result)) return;
      if (result.kind === 'already-open') {
        deps.onAlreadyOpen(result.docId);
        return;
      }
      const problem = markdownImportProblem(result);
      if (problem !== null) void deps.ask(MARKDOWN_IMPORT_PROBLEM_DIALOG_ID, problem);
    },
  };
}

/**
 * A new PDF from a Word, Excel or PowerPoint file, opened as a tab
 * ([ADR-0120](../../../../docs/DECISIONS/0120-office-import-is-onlyoffices-x2t-contained.md)).
 *
 * {@link newFromCsvCommand}'s shape and callbacks exactly. Main picks the file, the contained `x2t`
 * converts it, and one answer is this import's own — the converter produced no PDF — which the same
 * dialog states.
 */
export function newFromOfficeCommand(deps: {
  readonly client: DocumentCommandDeps['client'];
  readonly ask: DocumentCommandDeps['ask'];
  /** Where the conversion is shown from the chosen file until the tab opens (ADR-0234). */
  readonly track: TrackTask;
  readonly onOpened: (opened: OpenedDocument) => void;
  readonly onAlreadyOpen: (docId: DocId) => void;
}): UiCommand {
  return {
    id: 'document.new-from-office',
    feedback: VISIBLE,
    icon: 'FileText',
    title: NEW_FROM_OFFICE_COMMAND_TITLE,
    ribbonTitle: RIBBON_NEW_FROM_OFFICE,
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_CREATE, order: 5, size: 'small' }],
    run: async (): Promise<void> => {
      const answer = await withWorkProgress(deps, OFFICE_CONVERTING, (work) => deps.client['document.newFromOffice']({ work }));
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      const result = answer.value;
      // OPENED EITHER WAY — the tab first, then what did not arrive, so the person reads the list beside the document.
      if (result.kind === 'opened' || result.kind === 'opened-incomplete') {
        deps.onOpened({
          docId: result.docId,
          version: result.version,
          byteLength: result.byteLength,
          name: result.name,
        });
        if (result.kind === 'opened-incomplete') {
          void deps.ask(WORKBOOK_INCOMPLETE_DIALOG_ID, { missing: result.missing, more: result.more });
        }
        return;
      }
      if (result.kind === 'already-open') {
        deps.onAlreadyOpen(result.docId);
        return;
      }
      // THE CONVERTER COULD NOT START, said for EVERY request: main's pushed notice is once per component per run, so a
      // second request answered nothing at all. Where the notice is also asked, the two are the same informational
      // dialog with the same props, and closing one closes both (`informs`), so the first request still shows one.
      if (result.kind === 'component-cannot-start') {
        void deps.ask(COMPONENT_CANNOT_START_DIALOG_ID, {});
        return;
      }
      const problem = markdownImportProblem(result);
      if (problem !== null) void deps.ask(MARKDOWN_IMPORT_PROBLEM_DIALOG_ID, problem);
    },
  };
}

/**
 * A new PDF with one page per picked image, opened as a tab.
 *
 * {@link newFromCsvCommand}'s shape and callbacks exactly. The two outcomes only a set of
 * files has — too many, or too large together — go to the same dialog, which states them.
 */
export function newFromImagesCommand(deps: {
  readonly client: DocumentCommandDeps['client'];
  readonly ask: DocumentCommandDeps['ask'];
  /** Where the conversion is shown from the chosen pictures until the tab opens (ADR-0234). */
  readonly track: TrackTask;
  readonly onOpened: (opened: OpenedDocument) => void;
  readonly onAlreadyOpen: (docId: DocId) => void;
}): UiCommand {
  return {
    id: 'document.new-from-images',
    feedback: VISIBLE,
    icon: 'Images',
    title: NEW_FROM_IMAGES_COMMAND_TITLE,
    ribbonTitle: RIBBON_NEW_FROM_IMAGES,
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_CREATE, order: 40, size: 'small' }],
    run: async (): Promise<void> => {
      const answer = await withWorkProgress(deps, IMAGES_CONVERTING, (work) => deps.client['document.newFromImages']({ work }));
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      const result = answer.value;
      if (result.kind === 'opened' || result.kind === 'opened-with-skips') {
        deps.onOpened({
          docId: result.docId,
          version: result.version,
          byteLength: result.byteLength,
          name: result.name,
        });
        // THE PICTURES LEFT OUT, by file name, beside the document that holds the rest.
        if (result.kind === 'opened-with-skips') tellSkipped(deps, result.skipped, result.skippedMore);
        return;
      }
      if (result.kind === 'already-open') {
        deps.onAlreadyOpen(result.docId);
        return;
      }
      const problem = markdownImportProblem(result);
      if (problem !== null) void deps.ask(MARKDOWN_IMPORT_PROBLEM_DIALOG_ID, problem);
    },
  };
}

/**
 * A new PDF from pictures taken with the camera, opened as a tab.
 *
 * {@link newFromImagesCommand}'s callbacks, with one step before the channel: the capture
 * dialog, whose answer is the channel's own frame schema. A dismissal answers nothing that
 * schema accepts, so it sends nothing (ADR-0038).
 */
export function newFromCaptureCommand(deps: {
  readonly client: DocumentCommandDeps['client'];
  readonly ask: DocumentCommandDeps['ask'];
  /** Where the conversion is shown from the pictures taken until the tab opens (ADR-0234). */
  readonly track: TrackTask;
  readonly onOpened: (opened: OpenedDocument) => void;
  readonly onAlreadyOpen: (docId: DocId) => void;
  /** Whether Media Foundation is on this computer (`app.info`), or `undefined` before it has answered. */
  readonly mediaFoundation: () => boolean | undefined;
}): UiCommand {
  return {
    id: 'document.new-from-camera',
    feedback: VISIBLE,
    icon: 'Webcam',
    title: NEW_FROM_CAMERA_COMMAND_TITLE,
    ribbonTitle: RIBBON_NEW_FROM_CAMERA,
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_CREATE, order: 60, size: 'small' }],
    run: async (): Promise<void> => {
      // NOT YET ANSWERED READS AS PRESENT: the dialog then tries the camera, and the platform answers for itself.
      const taken = CAMERA_CAPTURE_RESULT.safeParse(
        await deps.ask(CAMERA_CAPTURE_DIALOG_ID, { mediaFoundation: deps.mediaFoundation() ?? true }),
      );
      if (!taken.success) return;

      const answer = await withWorkProgress(deps, CAMERA_CONVERTING, (work) =>
        deps.client['document.newFromCapture']({ frames: taken.data.frames, work }),
      );
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      const result = answer.value;
      if (result.kind === 'opened' || result.kind === 'opened-with-skips') {
        deps.onOpened({
          docId: result.docId,
          version: result.version,
          byteLength: result.byteLength,
          name: result.name,
        });
        // THE PICTURES LEFT OUT, by file name, beside the document that holds the rest.
        if (result.kind === 'opened-with-skips') tellSkipped(deps, result.skipped, result.skippedMore);
        return;
      }
      if (result.kind === 'already-open') {
        deps.onAlreadyOpen(result.docId);
        return;
      }
      const problem = markdownImportProblem(result);
      if (problem !== null) void deps.ask(MARKDOWN_IMPORT_PROBLEM_DIALOG_ID, problem);
    },
  };
}

/**
 * A Markdown file's pages added at the end of the document being read.
 *
 * ## TWO THINGS MOVE, and both are told
 *
 * The merge changed this document, so `onApplied` rebuilds its view. The composed
 * document is open as its own tab (ADR-0060's correction), so `onOpened` adds it —
 * and `onActivate` then brings THIS document back to the front, because the person
 * asked to add pages to what they were reading and should see where they went.
 *
 * ## At the end
 *
 * `context.pageCount`, `mergeDocumentCommand`'s position and its reason: *add pages
 * from a file* appends.
 */
export function appendMarkdownCommand(
  deps: DocumentCommandDeps & {
    /** Where the conversion is shown from the chosen file until the pages are in (ADR-0234). */
    readonly track: TrackTask;
    readonly onOpened: (opened: OpenedDocument) => void;
    readonly onActivate: (docId: DocId) => void;
  },
): UiCommand {
  return {
    id: 'document.append-markdown',
    feedback: VISIBLE,
    icon: 'ListPlus',
    title: APPEND_MARKDOWN_COMMAND_TITLE,
    ribbonTitle: RIBBON_APPEND_MARKDOWN,
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_CREATE, order: 20, size: 'small' }],
    when: hasPages,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.pageCount === undefined) return;
      const target = context.docId;

      // WHERE FIRST, then the file (the owner's 2026-10-07 recording): at the start, at the end or after a page, the whole
      // converted content going there. Closed unanswered is a change of mind, and nothing is picked or written.
      // THE FONTS THE PICKER OFFERS (D1), the session's one held list (`fontListOf`, W5); a failed read is `listed: false`,
      // which the picker says it could not read.
      const fonts = await fontListOf(deps.client);
      const where = (await deps.ask(INSERT_MARKDOWN_DIALOG_ID, {
        pageCount: context.pageCount,
        page: context.page ?? 0,
        fonts,
      })) as InsertMarkdownAnswer | undefined;
      if (where === undefined) return;

      const answer = await withWorkProgress(deps, MARKDOWN_INSERTING, (work) =>
        deps.client['document.appendMarkdown']({ docId: target, at: where.at, family: where.family, work }),
      );
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      const result = answer.value;
      if (result.kind === 'appended') {
        deps.onApplied({ version: result.version, byteLength: result.byteLength });
        deps.onOpened(result.opened);
        deps.onActivate(target);
        // INVARIANT 18, after `onApplied` and guarded on a positive count for
        // `applyDocumentCommand`'s reason: the dialog's schema refuses zero.
        if (result.historyDropped > 0) {
          void deps.ask(HISTORY_TRIMMED_DIALOG_ID, { dropped: result.historyDropped });
        }
        tellBoxed(deps, result.boxed, result.more);
        return;
      }
      const problem = markdownImportProblem(result);
      if (problem !== null) void deps.ask(MARKDOWN_IMPORT_PROBLEM_DIALOG_ID, problem);
    },
  };
}

/**
 * Inserts pictures as pages, one each, where the person chooses (the owner's O3): {@link appendMarkdownCommand}'s
 * route — where first, then `main`'s picker, which composes the pictures as `document.newFromImages` does and merges
 * them in ONE `mergeDocument`, so every picture is one undo step.
 *
 * It sends two numbers and cannot send an image even by mistake: the picker is `main`'s, and the channel's ask is a
 * document and a position. The dialog opens after the last of `targetPages` (ADR-0104), the page on show when nothing
 * is ticked, because a person on page 3 inserting a picture means *after this one*.
 */
export function insertImageCommand(
  deps: DocumentCommandDeps & {
    /** Where the insert is shown from the chosen pictures until the pages are in (ADR-0234). */
    readonly track: TrackTask;
    readonly onOpened: (opened: OpenedDocument) => void;
    readonly onActivate: (docId: DocId) => void;
  },
): UiCommand {
  return {
    id: 'document.insert-image',
    feedback: VISIBLE,
    icon: 'ImagePlus',
    title: INSERT_IMAGE_COMMAND_TITLE,
    placements: [{ surface: 'ribbon', section: 'organize', group: GROUP_PAGES, order: 16, size: 'small' }],
    when: hasPages,
    run: async (context): Promise<void> => {
      const last = targetPages(context).at(-1);
      if (context.docId === undefined || context.pageCount === undefined || last === undefined) return;
      const target = context.docId;
      // Closed unanswered is a change of mind, and nothing is picked or written.
      const where = (await deps.ask(INSERT_IMAGES_DIALOG_ID, { pageCount: context.pageCount, page: last })) as
        | InsertImagesAnswer
        | undefined;
      if (where === undefined) return;

      const answer = await withWorkProgress(deps, IMAGES_INSERTING, (work) =>
        deps.client['document.insertImage']({ docId: target, at: where.at, work }),
      );
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      const result = answer.value;
      if (result.kind === 'inserted') {
        deps.onApplied({ version: result.version, byteLength: result.byteLength });
        deps.onOpened(result.opened);
        // THE PERSON STAYS ON THE DOCUMENT THEY INSERTED INTO, `appendMarkdownCommand`'s order.
        deps.onActivate(target);
        // INVARIANT 18, after `onApplied` and guarded on a positive count: the dialog's schema refuses zero.
        if (result.historyDropped > 0) void deps.ask(HISTORY_TRIMMED_DIALOG_ID, { dropped: result.historyDropped });
        // THE PICTURES LEFT OUT, by file name, beside the pages that went in.
        tellSkipped(deps, result.skipped, result.skippedMore);
        return;
      }
      const problem = markdownImportProblem(result);
      if (problem !== null) void deps.ask(MARKDOWN_IMPORT_PROBLEM_DIALOG_ID, problem);
    },
  };
}

/**
 * Opens the boxed-characters dialog for a text import that drew any character as the box, and nothing for one that
 * drew none — the dialog's schema refuses an empty list, as the history dialog's refuses zero.
 */
function tellBoxed(
  deps: { readonly ask: DocumentCommandDeps['ask'] },
  boxed: readonly BoxedCharacter[],
  more: number,
): void {
  if (boxed.length > 0) void deps.ask(BOXED_CHARACTERS_DIALOG_ID, { from: 'import', boxed: [...boxed], more });
}

/**
 * The tab a text import opened, and the boxed characters it holds where it holds any: the tab first, then the list,
 * so the person reads the list beside the document — the Office import's order. `true` where it opened a tab.
 */
function openedText(
  deps: {
    readonly ask: DocumentCommandDeps['ask'];
    readonly onOpened: (opened: OpenedDocument) => void;
  },
  result: ChannelResult<'document.newFromMarkdown'>,
): boolean {
  if (result.kind !== 'opened' && result.kind !== 'opened-with-boxes' && result.kind !== 'opened-with-skips') return false;
  deps.onOpened({ docId: result.docId, version: result.version, byteLength: result.byteLength, name: result.name });
  if (result.kind === 'opened-with-boxes') tellBoxed(deps, result.boxed, result.more);
  if (result.kind !== 'opened') tellSkipped(deps, result.skipped, result.skippedMore);
  return true;
}

/** The parts an import left out, named beside the document it opened (Codex's importer audit); nothing where none was. */
function tellSkipped(deps: { readonly ask: DocumentCommandDeps['ask'] }, skipped: readonly ImportSkippedPart[], more: number): void {
  if (skipped.length > 0) void deps.ask(IMPORT_SKIPPED_DIALOG_ID, { skipped: [...skipped], more });
}
