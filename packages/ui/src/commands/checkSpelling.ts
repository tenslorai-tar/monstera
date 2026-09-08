import { MAX_TEXT_LAYER_LINES, type ContractClient } from '@monstera/contract';

import { SPELL_CHECK_DIALOG_ID } from '../dialogs/spellCheck.js';
import { SPELL_CHECK_RESULT } from '../dialogs/spellCheckResult.js';
import { GROUP_PROOFING, SPELL_CHECK_COMMAND_TITLE } from '../messages/en.js';
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
 * ## What this does NOT have, stated rather than left to be discovered
 *
 * No progress and no cancellation, and it inherits that from `showWordCount`
 * unchanged — a four-hundred-page document is four hundred round trips with no
 * feedback. Giving it both is a surface question, not a missing `await`, and it
 * is recorded on the FEATURES row rather than half-built.
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

      for (let page = 0; page < pageCount; page += 1) {
        const answer = await deps.client['document.pageTextLayer']({
          docId,
          page,
          limit: MAX_TEXT_LAYER_LINES,
        });
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
