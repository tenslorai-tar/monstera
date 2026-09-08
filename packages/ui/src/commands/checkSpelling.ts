import { MAX_TEXT_LAYER_LINES, type ContractClient } from '@monstera/contract';

import { SPELL_CHECK_DIALOG_ID } from '../dialogs/spellCheck.js';
import { SPELL_CHECK_RESULT } from '../dialogs/spellCheckResult.js';
import {
  GROUP_PROOFING,
  SPELL_CHECK_COMMAND_TITLE,
  SPELL_CHECK_PROGRESS,
} from '../messages/en.js';
import type { TrackTask } from '../runningTask.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import { PERSONAL_DICTIONARY_SETTING } from '../settings/editing.js';
import type { SettingsStore } from '../settingsStore.js';
import { type Misspelling, buildChecker, collectMisspellings } from '../spelling/checker.js';
import { activeLanguage } from '../spelling/languages.js';
import { hasDocument } from './documentCommands.js';

/**
 * Checks the document's spelling and shows what it found.
 *
 * ## THE WALK IS PER PAGE, and it reuses the text layer's channel
 *
 * `document.pageTextLayer` already carries one page's lines, bounded by the
 * caller — it is what the transparent selection layer is built from. Spell
 * check needs exactly that and nothing else, so it needs **no new channel for
 * the text**: the same shape `showWordCount` walks, and for
 * [ADR-0035](../../../../docs/DECISIONS/0035-extracted-text-is-never-resident-in-main.md)'s
 * reason — extracted text is 3.59× a document's bytes and is never held.
 *
 * What did need a channel is the **dictionary**, and that is the half
 * `docs/FEATURES.md`' row did not have: `dictionary-en` reads its files with
 * `node:fs/promises` and this package may never import Node.
 *
 * ## The checker is built ONCE, before the walk
 *
 * Measured: 401 ms and +23.95 MB to build, 0.76 ms to check a 600-word page. So
 * the build is hoisted out of the loop — inside it, a forty-page document would
 * cost sixteen seconds of construction and thirty milliseconds of work.
 *
 * It is also built **here rather than at startup**, which is the laziness the
 * measurement asks for: a reader who never opens spell check never pays.
 *
 * ## A dictionary that will not load is `available: false`, not an empty list
 *
 * Zero misspellings is what a correctly spelt document produces and it is also
 * what a checker that was never built produces. Reporting the second as the
 * first would tell a reader their document is clean on a build that shipped
 * without its dependency — the failure that looks exactly like the feature
 * working.
 *
 * ## The version is checked on every page, as the word count's walk is
 *
 * A command applied while this walks moves the version, and pages checked
 * either side of it describe two documents. The first answer's version is the
 * one this list is about.
 *
 * ## Progress and cancellation, inherited from `showWordCount` as they were
 *
 * This section said there were none. Both landed 2026-09-08 on the same seam —
 * `runningTask.ts` over the status bar — and the reason it took a surface is
 * written there: a dialog's props are validated at the `ask` call, so a dialog
 * is where a walk ends and cannot be where it reports.
 *
 * **A cancelled walk publishes nothing**, and here that is sharper than for a
 * count: a list of eleven misspellings from forty of four hundred pages reads
 * exactly like the document's whole answer, and a reader who cancelled would
 * have no way to tell.
 *
 * ## What this still does NOT have
 *
 * No squiggles under the words. The substrate reports a **line** with a box and
 * no per-word geometry, so underlining a word would need either the substrate
 * to carry character boxes — which is ADR-0034's module and its own amendment —
 * or this build to divide a line's width by its characters, which is a made-up
 * metric that is wrong for every proportional font. A list with page numbers is
 * what the substrate can honestly support today; the trigger for the other is
 * the substrate gaining character geometry.
 */
export function checkSpellingCommand(deps: {
  readonly client: ContractClient;
  readonly settings: SettingsStore;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  /** Reports progress and carries the cancel. `UNTRACKED` where nothing renders one. */
  readonly track: TrackTask;
}): UiCommand {
  return {
    id: 'document.spell-check',
    title: SPELL_CHECK_COMMAND_TITLE,
    // EDIT › PROOFING, beside word count. Both read the whole document's text
    // and both are things a person does to prose, which is what a group is.
    placements: [{ surface: 'ribbon', section: 'edit', group: GROUP_PROOFING, order: 10 }],
    when: hasDocument,
    run: async (context: CommandContext): Promise<void> => {
      const { docId, pageCount } = context;
      if (docId === undefined || pageCount === undefined || pageCount <= 0) return;

      const language = activeLanguage();
      // READ AT RUN TIME rather than captured when the command was built: a
      // word added during this session must count on the next run without the
      // registry being rebuilt.
      const personal = PERSONAL_DICTIONARY_SETTING.schema.parse(
        deps.settings.get(PERSONAL_DICTIONARY_SETTING.id),
      );
      const checker = await buildChecker(deps.client, language, personal);

      if (checker === null) {
        void deps.ask(SPELL_CHECK_DIALOG_ID, {
          available: false,
          language,
          misspellings: [],
          pagesChecked: 0,
          pageCount,
        });
        return;
      }

      const found = new Map<string, Misspelling>();
      let pagesChecked = 0;
      let expected: unknown;

      // TRACKED FROM HERE, not from the top: the dictionary is fetched first
      // and a bar that reported "0 of 400" while a 550 KB word list crossed
      // would be counting one thing and waiting for another.
      const task = deps.track(SPELL_CHECK_PROGRESS, pageCount);
      const aborted = (): boolean => task.signal.aborted;
      try {
        for (let page = 0; page < pageCount; page += 1) {
          if (aborted()) return;
          const answer = await deps.client['document.pageTextLayer']({
            docId,
            page,
            limit: MAX_TEXT_LAYER_LINES,
          });
          // A CANCELLED WALK PUBLISHES NOTHING, and here that means no dialog
          // at all — a list of eleven misspellings from the first forty pages
          // of four hundred reads exactly like the document's whole answer.
          if (aborted()) return;
          if (!answer.ok) break;
          expected ??= answer.value.version;
          if (answer.value.version !== expected) break;

          collectMisspellings(
            checker,
            answer.value.lines.map((line) => line.text),
            page,
            found,
          );
          pagesChecked += 1;
          task.step(pagesChecked);
        }
      } finally {
        task.end();
      }

      // SORTED BY HOW OFTEN, then alphabetically. A list in the order words
      // happened to appear buries the recurring mistake — the one worth fixing
      // — under one-off proper nouns from page 1. The alphabetical tiebreak is
      // what makes the order stable between two runs over the same document.
      const misspellings = [...found.values()].sort(
        (left, right) =>
          right.occurrences - left.occurrences || left.word.localeCompare(right.word),
      );

      const answered = await deps.ask(SPELL_CHECK_DIALOG_ID, {
        available: true,
        language,
        misspellings,
        pagesChecked,
        pageCount,
      });

      // A DISMISSAL ANSWERS NOTHING, which is not the same as answering with an
      // empty list — the first must leave the setting alone and the second is
      // already prevented at the button. Parsed rather than trusted, because
      // what comes back has crossed a registry that types it as `unknown`.
      const parsed = SPELL_CHECK_RESULT.safeParse(answered);
      if (!parsed.success || parsed.data.added.length === 0) return;

      // RE-READ rather than reusing `personal`: the walk above is hundreds of
      // awaits long and the dialog is open for as long as a person reads it, so
      // the value captured before all that is the one thing here guaranteed to
      // be stale.
      const current = PERSONAL_DICTIONARY_SETTING.schema.parse(
        deps.settings.get(PERSONAL_DICTIONARY_SETTING.id),
      );
      const merged = [...current];
      for (const word of parsed.data.added) {
        if (!merged.some((held) => held.toLowerCase() === word.toLowerCase())) merged.push(word);
      }
      deps.settings.set(PERSONAL_DICTIONARY_SETTING.id, merged);
    },
  };
}
