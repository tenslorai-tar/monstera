import { AI_PROVIDERS, AI_PROVIDER_IDS, type ChannelResult } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import { TRANSLATE_PAGE_DIALOG_ID, type TranslatePageAnswer } from '../dialogs/translatePage.js';
import {
  ANTHROPIC_OUT_OF_CREDIT,
  ASSISTANT_NO_KEY,
  ASSISTANT_PROBLEM_UNAUTHORISED,
  ASSISTANT_PROBLEM_UNREACHABLE,
  GROUP_LANGUAGE,
  RIBBON_TRANSLATE_PAGE,
  TOAST_NOTHING_TO_TRANSLATE,
  TOAST_PAGE_TRANSLATED,
  TOAST_TRANSLATE_NOT_WRITABLE,
  TOAST_TRANSLATE_NO_MODEL,
  TOAST_TRANSLATE_REJECTED,
  TOAST_TRANSLATE_UNREADABLE,
  TRANSLATE_PAGE_PROGRESS,
  TRANSLATE_PAGE_TITLE,
} from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
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
} as const satisfies Record<Extract<ChannelResult<'ai.translatePage'>, { kind: 'refused' }>['problem'], MessageKey>;

export interface TranslatePageDeps extends DocumentCommandDeps {
  readonly toast: ShowToast;
  readonly track: TrackTask;
  /** The secret settings stored, read when the command runs — which providers have a key. */
  readonly storedSecrets: () => readonly string[];
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
    icon: 'Languages',
    title: TRANSLATE_PAGE_TITLE,
    ribbonTitle: RIBBON_TRANSLATE_PAGE,
    // 310 ON EDIT: the owner's Text · Find · Proofing · Language, after Proofing's 210.
    placements: [{ surface: 'ribbon', section: 'edit', group: GROUP_LANGUAGE, order: 310 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      const { docId, page } = context;
      if (docId === undefined || page === undefined) return;
      const stored = deps.storedSecrets();
      const providers = AI_PROVIDER_IDS.filter((id) => stored.includes(AI_PROVIDERS[id].keySetting));
      // THE NARROWING `ask`'S `unknown` LEAVES: the answer has been through the dialog's own result
      // schema, which is the only thing that can produce it.
      const answer = (await deps.ask(TRANSLATE_PAGE_DIALOG_ID, { providers })) as TranslatePageAnswer | undefined;
      if (answer === undefined) return;

      const task = deps.track(TRANSLATE_PAGE_PROGRESS, 1);
      try {
        const listed = await deps.client['ai.models']({ provider: answer.provider });
        const model = listed.ok ? listed.value.models[0]?.id : undefined;
        if (model === undefined) {
          deps.toast('problem', TOAST_TRANSLATE_NO_MODEL);
          return;
        }
        const translated = await deps.client['ai.translatePage']({
          docId,
          page,
          provider: answer.provider,
          model,
          language: answer.language,
        });
        if (task.signal.aborted) return;
        if (!translated.ok) {
          reportProblem(deps, translated.error);
          return;
        }
        const result = translated.value;
        if (result.kind === 'refused') {
          deps.toast('problem', REFUSALS[result.problem]);
          return;
        }
        if (result.kind === 'nothing-to-translate') {
          deps.toast('done', TOAST_NOTHING_TO_TRANSLATE);
          return;
        }
        const kept = { unwritable: false };
        const applied = await applyDocumentCommand(
          deps,
          docId,
          {
            kind: 'editTextBlock',
            page,
            // SHRINK: a translation keeps the page's layout — each block fitted to the box it had.
            blocks: result.blocks.map((block) => ({ ...block, fit: 'shrink' as const })),
            version: result.version,
          },
          {
            keep: (error) => {
              kept.unwritable = error.code === 'text-not-writable';
              return kept.unwritable;
            },
          },
        );
        if (applied) deps.toast('done', TOAST_PAGE_TRANSLATED);
        else if (kept.unwritable) deps.toast('problem', TOAST_TRANSLATE_NOT_WRITABLE);
      } finally {
        task.step(1);
        task.end();
      }
    },
  };
}
