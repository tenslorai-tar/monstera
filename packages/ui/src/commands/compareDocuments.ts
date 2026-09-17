import { MAX_TEXT_LAYER_LINES, type ContractClient } from '@monstera/contract';
import { type DocId, diffLines, type LineChange } from '@monstera/shared';

import {
  COMPARE_DOCUMENTS_DIALOG_ID,
  COMPARE_RESULT_DIALOG_ID,
  type CompareDocumentsAnswer,
  MAX_COMPARE_CHANGES,
} from '../dialogs/compareDocuments.js';
import { COMPARE_COMMAND_TITLE, COMPARE_PROGRESS, GROUP_COMPARE } from '../messages/en.js';
import { pdfjsPageOf } from '../pageNumbering.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import type { TrackTask } from '../runningTask.js';
import { hasDocument } from './documentCommands.js';

/**
 * Review › Compare — what the words of this document and another open one differ in (D8).
 *
 * ## The renderer walks both documents a page at a time, and main holds no text
 *
 * `checkSpellingCommand`'s shape for ADR-0035's reason: extracted text is 3.59× a document's
 * bytes and `main` never holds it, so the walk reads each page through `document.pageTextLayer`,
 * the channel spell check and the selection layer already use, and compares page *i* of this
 * document with page *i* of the other by `diffLines`. At any moment two pages' lines are held,
 * here, and nothing new crosses the contract.
 *
 * ## PAGE BY NUMBER, and the dialog says what that cannot see
 *
 * A page inserted in the middle of one document shifts every page after it, and every one of
 * them then differs. Aligning pages by their content is a second matching rule with its own
 * thresholds, which the record does not ask for; the dialog states the rule instead, beside
 * pages only one side has.
 *
 * ## Both versions are checked on every page, and a cancelled walk publishes nothing
 *
 * The word count's and spell check's rules: pages compared either side of a command describe
 * two documents, so the walk stops there and says how far it got; and a cancelled comparison
 * opens nothing, because a part reads exactly like the whole.
 */
export function compareDocumentsCommand(deps: {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  /** Reports progress and carries the cancel. */
  readonly track: TrackTask;
}): UiCommand {
  return {
    id: 'document.compare',
    icon: 'Columns2',
    title: COMPARE_COMMAND_TITLE,
    placements: [{ surface: 'ribbon', section: 'review', group: GROUP_COMPARE, order: 10 }],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      const { docId } = context;
      if (docId === undefined) return;

      const choices = context.openDocuments
        .filter((document) => document.docId !== docId)
        .map((document) => ({ docId: document.docId, name: document.name }));
      if (choices.length === 0) {
        void deps.ask(COMPARE_RESULT_DIALOG_ID, { kind: 'none' });
        return;
      }

      const answer = (await deps.ask(COMPARE_DOCUMENTS_DIALOG_ID, { choices })) as
        | CompareDocumentsAnswer
        | undefined;
      if (answer === undefined) return;
      const other = choices.find((choice) => choice.docId === answer.other);
      if (other === undefined) return;

      const found = await compareOpenDocuments(deps, docId, other.docId);
      if (found === 'cancelled') return;
      void deps.ask(
        COMPARE_RESULT_DIALOG_ID,
        found === 'refused' ? { kind: 'refused' } : { kind: 'compared', otherName: other.name, ...found },
      );
    },
  };
}

/** What a finished walk found, as the result dialog's props carry it. */
export interface Comparison {
  readonly shared: number;
  readonly compared: number;
  readonly extraPages: number;
  readonly changedLines: number;
  readonly clippedPages: number;
  readonly pages: readonly { readonly page: number; readonly changes: readonly LineChange[] }[];
}

/**
 * Walks both documents' shared pages and diffs each pair. Exported so its cases drive the walk
 * against a client without a dialog in the way.
 */
export async function compareOpenDocuments(
  deps: { readonly client: ContractClient; readonly track: TrackTask },
  here: DocId,
  other: DocId,
): Promise<Comparison | 'refused' | 'cancelled'> {
  const [hereModel, otherModel] = await Promise.all([
    deps.client['document.viewModel']({ docId: here, pages: [0] }),
    deps.client['document.viewModel']({ docId: other, pages: [0] }),
  ]);
  if (!hereModel.ok || !otherModel.ok) return 'refused';
  const shared = Math.min(hereModel.value.pageCount, otherModel.value.pageCount);
  const expected = { here: hereModel.value.version, other: otherModel.value.version };

  const pages: { page: number; changes: LineChange[] }[] = [];
  let listed = 0;
  let changedLines = 0;
  let clippedPages = 0;
  let compared = 0;

  const task = deps.track(COMPARE_PROGRESS, shared);
  // A FUNCTION, for `checkSpellingCommand`'s reason: the signal moves during the awaits, and a
  // property read twice is one the compiler narrows as though it could not.
  const aborted = (): boolean => task.signal.aborted;
  try {
    for (let page = 0; page < shared; page += 1) {
      if (aborted()) return 'cancelled';
      const [left, right] = await Promise.all([
        deps.client['document.pageTextLayer']({ docId: here, page, limit: MAX_TEXT_LAYER_LINES }),
        deps.client['document.pageTextLayer']({ docId: other, page, limit: MAX_TEXT_LAYER_LINES }),
      ]);
      if (aborted()) return 'cancelled';
      // A REFUSED READ REFUSES THE COMPARISON, where a moved version stops it: the first says
      // nothing about how the documents differ, and the second is a real partial answer.
      if (!left.ok || !right.ok) return 'refused';
      if (left.value.version !== expected.here || right.value.version !== expected.other) break;

      if (left.value.truncated || right.value.truncated) clippedPages += 1;
      const changes = diffLines(
        left.value.lines.map((line) => line.text),
        right.value.lines.map((line) => line.text),
      );
      changedLines += changes.length;
      const room = MAX_COMPARE_CHANGES - listed;
      if (changes.length > 0 && room > 0) {
        const kept = changes.slice(0, room);
        pages.push({ page: pdfjsPageOf(page), changes: kept });
        listed += kept.length;
      }
      compared += 1;
      task.step(compared);
    }
  } finally {
    task.end();
  }

  return {
    shared,
    compared,
    extraPages: hereModel.value.pageCount - otherModel.value.pageCount,
    changedLines,
    clippedPages,
    pages,
  };
}
