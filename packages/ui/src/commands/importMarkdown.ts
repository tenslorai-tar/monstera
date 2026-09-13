import type { ChannelResult, ComposeRefusal } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';

import { HISTORY_TRIMMED_DIALOG_ID } from '../dialogs/historyTrimmed.js';
import {
  MARKDOWN_IMPORT_PROBLEM_DIALOG_ID,
  type MarkdownImportProblem,
} from '../dialogs/markdownImportProblem.js';
import {
  APPEND_MARKDOWN_COMMAND_TITLE,
  GROUP_CREATE,
  NEW_FROM_CSV_COMMAND_TITLE,
  NEW_FROM_IMAGES_COMMAND_TITLE,
  NEW_FROM_MARKDOWN_COMMAND_TITLE,
} from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import { type DocumentCommandDeps, hasDocument, reportProblem } from './documentCommands.js';

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
    | ChannelResult<'document.newFromImages'>,
): MarkdownImportProblem | null {
  switch (answer.kind) {
    case 'unreadable':
      return { reason: 'unreadable' };
    case 'too-large':
      return { reason: 'too-large', limitBytes: answer.limitBytes };
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
    // `cancelled` is a person changing their mind; `opened`, `already-open` and
    // `appended` are the document they asked for. Named rather than defaulted, so an
    // outcome a channel gains later is a lint error here instead of a silence.
    case 'cancelled':
    case 'opened':
    case 'already-open':
    case 'appended':
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
    case 'unencodable-text':
      return { reason: 'unencodable-text', line };
    case 'malformed-csv':
      return { reason: 'malformed-csv', line };
    case 'too-many-columns':
      return { reason: 'too-many-columns', line };
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
  readonly onOpened: (opened: OpenedDocument) => void;
  readonly onAlreadyOpen: (docId: DocId) => void;
}): UiCommand {
  return {
    id: 'document.new-from-markdown',
    title: NEW_FROM_MARKDOWN_COMMAND_TITLE,
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_CREATE, order: 10 }],
    run: async (): Promise<void> => {
      const answer = await deps.client['document.newFromMarkdown']({});
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      const result = answer.value;
      if (result.kind === 'opened') {
        deps.onOpened({
          docId: result.docId,
          version: result.version,
          byteLength: result.byteLength,
          name: result.name,
        });
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
 * A new PDF table from a CSV file, opened as a tab.
 *
 * {@link newFromMarkdownCommand}'s shape and callbacks exactly: it needs no document,
 * the ask is nothing, and every answer is one the Markdown import also gives, so the
 * same mapping and the same dialog tell the person what happened.
 */
export function newFromCsvCommand(deps: {
  readonly client: DocumentCommandDeps['client'];
  readonly ask: DocumentCommandDeps['ask'];
  readonly onOpened: (opened: OpenedDocument) => void;
  readonly onAlreadyOpen: (docId: DocId) => void;
}): UiCommand {
  return {
    id: 'document.new-from-csv',
    title: NEW_FROM_CSV_COMMAND_TITLE,
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_CREATE, order: 30 }],
    run: async (): Promise<void> => {
      const answer = await deps.client['document.newFromCsv']({});
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      const result = answer.value;
      if (result.kind === 'opened') {
        deps.onOpened({
          docId: result.docId,
          version: result.version,
          byteLength: result.byteLength,
          name: result.name,
        });
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
 * A new PDF with one page per picked image, opened as a tab.
 *
 * {@link newFromCsvCommand}'s shape and callbacks exactly. The two outcomes only a set of
 * files has — too many, or too large together — go to the same dialog, which states them.
 */
export function newFromImagesCommand(deps: {
  readonly client: DocumentCommandDeps['client'];
  readonly ask: DocumentCommandDeps['ask'];
  readonly onOpened: (opened: OpenedDocument) => void;
  readonly onAlreadyOpen: (docId: DocId) => void;
}): UiCommand {
  return {
    id: 'document.new-from-images',
    title: NEW_FROM_IMAGES_COMMAND_TITLE,
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_CREATE, order: 40 }],
    run: async (): Promise<void> => {
      const answer = await deps.client['document.newFromImages']({});
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      const result = answer.value;
      if (result.kind === 'opened') {
        deps.onOpened({
          docId: result.docId,
          version: result.version,
          byteLength: result.byteLength,
          name: result.name,
        });
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
    readonly onOpened: (opened: OpenedDocument) => void;
    readonly onActivate: (docId: DocId) => void;
  },
): UiCommand {
  return {
    id: 'document.append-markdown',
    title: APPEND_MARKDOWN_COMMAND_TITLE,
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_CREATE, order: 20 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.pageCount === undefined) return;
      const target = context.docId;

      const answer = await deps.client['document.appendMarkdown']({
        docId: target,
        at: context.pageCount,
      });
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
        return;
      }
      const problem = markdownImportProblem(result);
      if (problem !== null) void deps.ask(MARKDOWN_IMPORT_PROBLEM_DIALOG_ID, problem);
    },
  };
}
