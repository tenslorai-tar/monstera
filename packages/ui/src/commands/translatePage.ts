import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  type AiProviderId,
  type ChannelResult,
  MAX_TRANSLATE_TEXT,
  type TranslationLanguage,
} from '@monstera/contract';
import type { DocId, MessageKey } from '@monstera/shared';

import { TRANSLATE_PAGE_DIALOG_ID, type TranslatePageAnswer } from '../dialogs/translatePage.js';
import {
  ANTHROPIC_OUT_OF_CREDIT,
  ASSISTANT_SEARCHES_THE_WEB,
  ASSISTANT_NO_KEY,
  ASSISTANT_PROBLEM_NOT_THE_SERVICE,
  ASSISTANT_PROBLEM_UNAUTHORISED,
  ASSISTANT_PROBLEM_UNREACHABLE,
  GROUP_LANGUAGE,
  RIBBON_TRANSLATE_PAGE,
  TOAST_NOTHING_SELECTED,
  TOAST_NOTHING_TO_TRANSLATE,
  TOAST_PAGES_TRANSLATED,
  TOAST_PAGES_TRANSLATED_PARTLY,
  TOAST_PAGE_TRANSLATED,
  TOAST_TEXT_TRANSLATED,
  TRANSLATE_PAGES_PROGRESS,
  TOAST_TRANSLATE_NOT_WRITABLE,
  TOAST_TRANSLATE_NO_MODEL,
  TOAST_TRANSLATE_REJECTED,
  TOAST_TRANSLATE_UNREADABLE,
  TRANSLATE_PAGE_PROGRESS,
  TRANSLATE_PAGE_TITLE,
} from '../messages/en.js';
import { TOASTS, type UiCommand } from '../registries/commands.js';
import { confirmDone } from './confirmWritten.js';
import type { TrackTask } from '../runningTask.js';
import type { ShowToast } from '../toasts.js';
import { type DocumentCommandDeps, applyDocumentCommand, hasDocument, reportProblem } from './documentCommands.js';

/** What a provider's refusal says here — the assistant's sentence where it fits a translation too. */
const REFUSALS = {
  'no-key': ASSISTANT_NO_KEY,
  unauthorised: ASSISTANT_PROBLEM_UNAUTHORISED,
  unreachable: ASSISTANT_PROBLEM_UNREACHABLE,
  'out-of-credit': ANTHROPIC_OUT_OF_CREDIT,
  rejected: TOAST_TRANSLATE_REJECTED,
  unreadable: TOAST_TRANSLATE_UNREADABLE,
  'not-the-service': ASSISTANT_PROBLEM_NOT_THE_SERVICE,
  // A translation never uses the web, so a model that always searches is refused before the page is sent (ADR-0108).
  'searches-the-web': ASSISTANT_SEARCHES_THE_WEB,
} as const satisfies Record<Extract<ChannelResult<'ai.translatePage'>, { kind: 'refused' }>['problem'], MessageKey>;

export interface TranslatePageDeps extends DocumentCommandDeps {
  readonly toast: ShowToast;
  readonly track: TrackTask;
  /** The secret settings stored, read when the command runs — which providers have a key. */
  readonly storedSecrets: () => readonly string[];
  /** The words selected on the page, read when the command runs; the browser's selection where absent. */
  readonly selectedText?: (() => string) | undefined;
}

/**
 * *Translate this page* — Edit › Language (ADR-0097).
 *
 * ## Three steps, and only the last one writes
 *
 * The dialog chooses a language and a provider with a key; `ai.translatePage` reads the page in
 * `main`, asks, and answers the blocks that changed; `editTextBlock` writes them as ONE command, so
 * one Undo puts the page back. The write goes through `applyDocumentCommand`, the dispatcher every
 * edit takes, so the view, the version and invariant 18's history dialog are every edit's.
 *
 * ## The model is the provider's first, as the assistant's is
 *
 * `ai.models` answers the provider's list and the assistant opens on its first entry; a translation
 * asks the same one, so the two do not disagree about which model a provider's key pays for.
 *
 * ## Cancel keeps the page as it was
 *
 * The status bar's cancel ends the wait: an answer arriving after it is not written. The request
 * itself is not recalled — the provider has it by then — and that is why the dialog says, before
 * anything is sent, that the page's text will be.
 */
export function translatePageCommand(deps: TranslatePageDeps): UiCommand {
  return {
    id: 'edit.translate-page',
    feedback: TOASTS,
    icon: 'Languages',
    title: TRANSLATE_PAGE_TITLE,
    ribbonTitle: RIBBON_TRANSLATE_PAGE,
    // 310 ON EDIT: the owner's Text · Find · Proofing · Language, after Proofing's 210.
    placements: [{ surface: 'ribbon', section: 'edit', group: GROUP_LANGUAGE, order: 310 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      const { docId, page } = context;
      if (docId === undefined || page === undefined) return;
      // THE WORDS SELECTED, read BEFORE the dialog opens: a dialog takes focus and a selection goes with it.
      const selected = (deps.selectedText ?? selectedTextOnPage)().trim().slice(0, MAX_TRANSLATE_TEXT);
      const stored = deps.storedSecrets();
      const providers = AI_PROVIDER_IDS.filter((id) => stored.includes(AI_PROVIDERS[id].keySetting));
      // THE NARROWING `ask`'S `unknown` LEAVES: the answer has been through the dialog's own result
      // schema, which is the only thing that can produce it.
      const answer = (await deps.ask(TRANSLATE_PAGE_DIALOG_ID, {
        providers,
        pageCount: context.pageCount ?? 1,
        hasSelection: selected !== '',
      })) as TranslatePageAnswer | undefined;
      if (answer === undefined) return;

      const pages = answer.what.scope === 'pages' ? answer.what.pages : [page];
      const task = deps.track(answer.what.scope === 'pages' ? TRANSLATE_PAGES_PROGRESS : TRANSLATE_PAGE_PROGRESS, pages.length);
      try {
        const listed = await deps.client['ai.models']({ provider: answer.provider });
        const model = listed.ok ? listed.value.models[0]?.id : undefined;
        if (model === undefined) {
          deps.toast('problem', TOAST_TRANSLATE_NO_MODEL);
          return;
        }

        if (answer.what.scope === 'selection') {
          const chosen = { provider: answer.provider, model, language: answer.language };
          // IN PLACE FIRST: the blocks that hold the selected words are translated and written by the page's own per-page
          // command, one undo step. Only where NO block holds them — a selection that crosses blocks, or text in a form
          // field — is it translated and COPIED, as before, so a person is never left with nothing.
          if (selected !== '') {
            const outcome = await translateOne(deps, docId, page, chosen, task.signal, true, selected);
            if (outcome !== 'nothing') return;
          }
          await translateSelection(deps, task.signal, selected, chosen);
          return;
        }

        // PAGE BY PAGE through the one per-page command (`ai.translatePage` and its `editTextBlock`), so the writers are
        // exactly what *Translate this page* uses and none is changed here. Each page is read at ITS OWN version, since
        // the write before it moved the document's.
        let written = 0;
        for (const each of pages) {
          if (task.signal.aborted) break;
          const outcome = await translateOne(
            deps,
            docId,
            each,
            { provider: answer.provider, model, language: answer.language },
            task.signal,
            answer.what.scope === 'page',
          );
          task.step(1);
          if (outcome === 'written') written += 1;
          // A REFUSAL STOPS THE RUN, already said: the same provider would refuse the next page and be paid for it.
          if (outcome === 'stopped') break;
        }
        if (answer.what.scope === 'page') return;
        // THE SUMMARY OF A RUN, and what it left: pages already written stay written, each its own step to undo.
        if (written > 0) {
          confirmDone(deps, written === pages.length ? TOAST_PAGES_TRANSLATED : TOAST_PAGES_TRANSLATED_PARTLY);
        }
      } finally {
        task.end();
      }
    },
  };
}

interface Chosen { readonly provider: AiProviderId; readonly model: string; readonly language: TranslationLanguage }

/** What one page's translation came to: written, nothing in it to write, or stopped after saying why. */
type Outcome = 'written' | 'nothing' | 'stopped';

/**
 * One page, by the per-page command: read and translated in `main`, written as ONE `editTextBlock`. On a single page it
 * says what happened; in a run it says only what stops the run, and the summary says the rest.
 */
async function translateOne(
  deps: TranslatePageDeps,
  docId: DocId,
  page: number,
  chosen: Chosen,
  signal: AbortSignal,
  single = false,
  /** The words selected, to translate only the blocks that hold them; absent, the whole page. */
  only?: string,
): Promise<Outcome> {
  const translated = await deps.client['ai.translatePage']({ docId, page, ...chosen, ...(only === undefined ? {} : { only }) });
  if (signal.aborted) return 'stopped';
  if (!translated.ok) {
    reportProblem(deps, translated.error);
    return 'stopped';
  }
  const result = translated.value;
  if (result.kind === 'refused') {
    deps.toast('problem', REFUSALS[result.problem]);
    return 'stopped';
  }
  if (result.kind === 'nothing-to-translate') {
    // NOT SAID FOR A SELECTION: no block held the words, and the caller then translates and copies them instead.
    if (single && only === undefined) confirmDone(deps, TOAST_NOTHING_TO_TRANSLATE);
    return 'nothing';
  }
  const kept = { unwritable: false };
  const applied = await applyDocumentCommand(
    deps,
    docId,
    {
      // THE PAGE'S OWN WRITER (ADR-0181 Decision 10): main read which command writes this page, as it does for an
      // edit by hand, so a page printed with a Type 3 font is translated rather than refused for its font.
      kind: result.rewrite === 'operators' ? 'editTextOperators' : 'editTextBlock',
      page,
      // MAIN'S EDIT AS IT CAME, already in the command's wire form (ADR-0142).
      ...result.edit,
      // SHRINK: a translation keeps the page's layout — each block fitted to the box it had.
      fit: 'shrink',
      version: result.version,
    },
    {
      keep: (error) => {
        kept.unwritable = error.code === 'text-not-writable';
        return kept.unwritable;
      },
    },
  );
  if (applied) {
    if (single) confirmDone(deps, TOAST_PAGE_TRANSLATED);
    return 'written';
  }
  // A PAGE ITS FONTS CANNOT CARRY is said on its own and skipped in a run, which goes on to the pages that can be written.
  if (kept.unwritable) {
    if (single) deps.toast('problem', TOAST_TRANSLATE_NOT_WRITABLE);
    return single ? 'stopped' : 'nothing';
  }
  return 'stopped';
}

/**
 * The selected words translated and COPIED. They are not written back: a block's lines are rewritten whole by the in-place
 * editor, which is not this command's to change, so what a selection offers is the translation to paste where it belongs.
 */
async function translateSelection(
  deps: TranslatePageDeps,
  signal: AbortSignal,
  text: string,
  chosen: Chosen,
): Promise<void> {
  if (text === '') {
    deps.toast('problem', TOAST_NOTHING_SELECTED);
    return;
  }
  const translated = await deps.client['ai.translateText']({ text, ...chosen });
  if (signal.aborted) return;
  if (!translated.ok) {
    reportProblem(deps, translated.error);
    return;
  }
  if (translated.value.kind === 'refused') {
    deps.toast('problem', REFUSALS[translated.value.problem]);
    return;
  }
  const copied = await deps.client['window.copyText']({ text: translated.value.text });
  if (copied.ok && copied.value.copied) confirmDone(deps, TOAST_TEXT_TRANSLATED);
}

/** The words selected on the page, from the browser's own selection. A dependency in the tests, which have none. */
function selectedTextOnPage(): string {
  return globalThis.document.getSelection()?.toString() ?? '';
}
