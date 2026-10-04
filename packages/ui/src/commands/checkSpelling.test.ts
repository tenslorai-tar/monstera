import { type DocId, asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { GROUP_PROOFING } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import { checkSpellingCommand } from './checkSpelling.js';

/**
 * The Spell check command is the ribbon's way into a review (ADR-0156 Decision 1): it hands the document and its page
 * count to App's `start`, which opens the Spelling tab and starts the review. The walk itself, which this file used to
 * test through a dialog, is `reviewRun.ts`'s and is tested there.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000fe');

function contextWith(docId: DocId | undefined, pageCount: number | undefined): CommandContext {
  return {
    docId,
    version: docId === undefined ? undefined : asDocVersion(1),
    hasSelection: false,
    dirty: false,
    page: 0,
    pageCount,
  } as CommandContext;
}

function recorded(): { readonly start: (docId: DocId, pageCount: number) => void; readonly started: unknown[] } {
  const started: unknown[] = [];
  return {
    started,
    start: (docId, pageCount) => {
      started.push({ docId, pageCount });
    },
  };
}

describe('the spell check command', () => {
  it('starts a review of the focused document and its pages, and opens no dialog', async () => {
    const { start, started } = recorded();
    await checkSpellingCommand({ start }).run(contextWith(DOC, 3));
    // THE PAGE COUNT IS THE CONTEXT'S, handed through rather than re-read: the review walks exactly the pages the
    // reader's document has.
    expect(started).toStrictEqual([{ docId: DOC, pageCount: 3 }]);
  });

  it('does nothing without a document, and its `when` says so', async () => {
    const { start, started } = recorded();
    const command = checkSpellingCommand({ start });
    await command.run(contextWith(undefined, undefined));
    expect(started).toStrictEqual([]);
    // BOTH, and neither alone. `when` is a predicate about what to SHOW, and a palette can dispatch a command whose
    // `when` is false, so the guard in `run` is what holds, and this asserts they agree.
    expect(command.when?.(contextWith(undefined, undefined))).toBe(false);
  });

  it('CONTROL: a document whose pages are not counted yet starts nothing, rather than a review of none', async () => {
    const { start, started } = recorded();
    await checkSpellingCommand({ start }).run(contextWith(DOC, undefined));
    await checkSpellingCommand({ start }).run(contextWith(DOC, 0));
    expect(started).toStrictEqual([]);
  });
});

describe('spell check is placed in Review as well as Edit', () => {
  /**
   * BUILD-PROMPT lists the pass under D4's editing tools and again under D8's review tools, and
   * it is one command. What this asserts is the REGISTRATION: both ribbon placements, both under
   * Proofing. That a placement lands in its section is projections.test.ts' subject, proven there
   * against a registry it builds, so this does not import a surface to prove it again.
   */
  it('declares a ribbon placement in edit AND in review, both under Proofing', () => {
    const command = checkSpellingCommand(recorded());

    const ribbon = command.placements.flatMap((placement) =>
      placement.surface === 'ribbon' ? [[placement.section, placement.group]] : [],
    );

    expect(ribbon).toStrictEqual([
      ['edit', GROUP_PROOFING],
      ['review', GROUP_PROOFING],
    ]);
  });
});
