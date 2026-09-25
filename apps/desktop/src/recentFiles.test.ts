import { MAX_RECENT_ENTRIES } from '@monstera/contract';
import { asDocId } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { MAX_RECENT, createRecentFiles } from './recentFiles.js';
import type { SettingsSurface } from './settingsFile.js';

/**
 * A JSON surface over a variable, so a case can outlive one store and open a
 * second over the same document — which is what *the previous run* means here.
 */
function aFile(initial: Readonly<Record<string, unknown>> = {}): SettingsSurface & {
  readonly held: () => Readonly<Record<string, unknown>>;
} {
  let stored: Readonly<Record<string, unknown>> = initial;
  return {
    read: () => stored,
    write: (values) => {
      stored = values;
    },
    held: () => stored,
  };
}

/** Two instants a fixed clock answers, a day apart. */
const AT = new Date('2026-09-24T08:00:00.000Z');
const LATER = new Date('2026-09-25T08:00:00.000Z');

describe('the recent list', () => {
  it('AGREES WITH THE BOUNDARY about how many entries may cross', () => {
    // FOUND BY THE STAGE AUDIT of `87540a5..HEAD`, and the finding is the
    // sentence rather than the numbers. `MAX_RECENT_ENTRIES`' own comment says
    // *"The two agreeing is asserted by a case rather than by the type, which
    // is the honest arrangement"* — and there was no such case. The constant
    // was named in exactly two places, both inside `channels.ts`, so the
    // mechanism the comment described did not exist and reading the comment was
    // what made it look covered.
    //
    // Restated rather than imported for the reason that comment gives: the
    // contract may not import `apps/desktop`. So the store's cap and the
    // boundary's bound are two numbers, and this is the only thing that can
    // notice them parting. Raise one alone and every recent-files read is
    // refused at the boundary, at run time, with nothing red at build time.
    expect(MAX_RECENT).toBe(MAX_RECENT_ENTRIES);
  });

  it('keeps what was recorded, newest first', () => {
    const recent = createRecentFiles(aFile());

    recent.record({ path: 'C:/a.pdf', name: 'a.pdf' });
    recent.record({ path: 'C:/b.pdf', name: 'b.pdf' });

    expect(recent.list().map((entry) => entry.name)).toStrictEqual(['b.pdf', 'a.pdf']);
  });

  it('MOVES a repeat to the front rather than adding a second row', () => {
    // Reopening one file must not fill the list with it, and *moved* rather
    // than *ignored* is what makes the list useful: the thing you opened last
    // is what you are most likely to want.
    const recent = createRecentFiles(aFile());

    recent.record({ path: 'C:/a.pdf', name: 'a.pdf' });
    recent.record({ path: 'C:/b.pdf', name: 'b.pdf' });
    recent.record({ path: 'C:/a.pdf', name: 'a.pdf' });

    expect(recent.list().map((entry) => entry.name)).toStrictEqual(['a.pdf', 'b.pdf']);
  });

  it('takes the NEWER name for a path that was renamed', () => {
    // The same file opened by a new name: one row, and the name a reader will
    // recognise. Keeping the first name would show them a file that no longer
    // exists under that name.
    const recent = createRecentFiles(aFile(), () => AT);

    recent.record({ path: 'C:/a.pdf', name: 'draft.pdf' });
    recent.record({ path: 'C:/a.pdf', name: 'final.pdf' });

    expect(recent.list()).toStrictEqual([{ path: 'C:/a.pdf', name: 'final.pdf', openedAt: AT.toISOString() }]);
  });

  it('STAMPS each opening with the time it happened, and a reopening with the newer time (ADR-0100)', () => {
    let now = AT;
    const recent = createRecentFiles(aFile(), () => now);

    recent.record({ path: 'C:/a.pdf', name: 'a.pdf' });
    now = LATER;
    recent.record({ path: 'C:/a.pdf', name: 'a.pdf' });

    // THE SECOND TIME, not the first: *last opened here* is what the card says.
    expect(recent.list()).toStrictEqual([{ path: 'C:/a.pdf', name: 'a.pdf', openedAt: LATER.toISOString() }]);
  });

  it('reads an entry an OLDER build wrote, with no time, as no time rather than dropping it', () => {
    // And a time that is not an instant the channel accepts is no time either: the entry keeps its place.
    const recent = createRecentFiles(
      aFile({
        entries: [
          { path: 'C:/old.pdf', name: 'old.pdf' },
          { path: 'C:/odd.pdf', name: 'odd.pdf', openedAt: 'last Tuesday' },
        ],
      }),
    );

    expect(recent.list()).toStrictEqual([
      { path: 'C:/old.pdf', name: 'old.pdf', openedAt: null },
      { path: 'C:/odd.pdf', name: 'odd.pdf', openedAt: null },
    ]);
  });

  it('is bounded, and drops the OLDEST', () => {
    const recent = createRecentFiles(aFile());

    for (let index = 0; index <= MAX_RECENT; index += 1) {
      recent.record({ path: `C:/${String(index)}.pdf`, name: `${String(index)}.pdf` });
    }

    const names = recent.list().map((entry) => entry.name);
    expect(names).toHaveLength(MAX_RECENT);
    // BOTH ENDS. The length alone passes for a list that kept the first ten and
    // ignored everything after, which is the bound applied backwards.
    expect(names[0]).toBe(`${String(MAX_RECENT)}.pdf`);
    expect(names.at(-1)).toBe('1.pdf');
  });

  it('forgets one by path, and leaves the rest', () => {
    const recent = createRecentFiles(aFile());
    recent.record({ path: 'C:/a.pdf', name: 'a.pdf' });
    recent.record({ path: 'C:/b.pdf', name: 'b.pdf' });

    recent.forget('C:/a.pdf');

    expect(recent.list().map((entry) => entry.name)).toStrictEqual(['b.pdf']);
  });

  it('says WHICH PATHS LEFT, however they left: forgotten, cleared, or pushed past the cap (ADR-0100)', () => {
    const recent = createRecentFiles(aFile());
    const left: string[][] = [];
    recent.onDropped((paths) => left.push([...paths]));

    for (let index = 0; index <= MAX_RECENT; index += 1) {
      recent.record({ path: `C:/${String(index)}.pdf`, name: `${String(index)}.pdf` });
    }
    recent.forget('C:/5.pdf');
    // A path not on the list leaves nothing, so nothing is said.
    recent.forget('C:/never.pdf');
    const cleared = recent.clear();

    expect(left).toStrictEqual([
      // THE OLDEST, pushed out by the eleventh: the quiet way to leave, and the one easiest to miss.
      ['C:/0.pdf'],
      ['C:/5.pdf'],
      ['C:/10.pdf', 'C:/9.pdf', 'C:/8.pdf', 'C:/7.pdf', 'C:/6.pdf', 'C:/4.pdf', 'C:/3.pdf', 'C:/2.pdf', 'C:/1.pdf'],
    ]);
    expect(cleared).toBe(MAX_RECENT - 1);
    expect(recent.list()).toStrictEqual([]);
  });

  it('knows whether a path is on the list', () => {
    const recent = createRecentFiles(aFile());
    recent.record({ path: 'C:/a.pdf', name: 'a.pdf' });
    expect([recent.has('C:/a.pdf'), recent.has('C:/b.pdf')]).toStrictEqual([true, false]);
  });

  it('SURVIVES A RESTART, which is the whole point of the file', () => {
    const file = aFile();
    createRecentFiles(file, () => AT).record({ path: 'C:/a.pdf', name: 'a.pdf' });

    // A second store over the same document is what a second launch is — and the time comes back with it.
    expect(createRecentFiles(file).list()).toStrictEqual([{ path: 'C:/a.pdf', name: 'a.pdf', openedAt: AT.toISOString() }]);
  });

  describe('the clean-exit marker', () => {
    it('reports the PREVIOUS run, not this one', () => {
      const file = aFile();
      const first = createRecentFiles(file);
      first.record({ path: 'C:/a.pdf', name: 'a.pdf' });
      first.markCleanExit();

      expect(createRecentFiles(file).lastExitClean()).toBe(true);
    });

    it('is FALSE after a run that never marked its exit', () => {
      // The control for the case above, and the state a crash produces: the
      // store cleared the marker on construction and nothing set it again.
      const file = aFile();
      createRecentFiles(file).record({ path: 'C:/a.pdf', name: 'a.pdf' });

      expect(createRecentFiles(file).lastExitClean()).toBe(false);
    });

    it('is TRUE on a first launch, where there is no previous run at all', () => {
      // `=== true` would answer false here, and an application would offer to
      // recover from a crash that never happened, on an empty list, to somebody
      // who has just installed it.
      expect(createRecentFiles(aFile()).lastExitClean()).toBe(true);
    });

    it('answers about the previous run for the WHOLE of this one', () => {
      // The marker is cleared immediately, so a live read would answer *this
      // run has not finished* — which is true and useless. The value is taken
      // once, at construction.
      const file = aFile();
      createRecentFiles(file).markCleanExit();

      const second = createRecentFiles(file);
      expect(second.lastExitClean()).toBe(true);
      second.record({ path: 'C:/a.pdf', name: 'a.pdf' });
      expect(second.lastExitClean()).toBe(true);
    });

    it('CLEARS the marker on the disk immediately, before anything is recorded', () => {
      // The order that makes the whole mechanism work: a process that dies
      // between launch and shutdown leaves the document saying so, and nothing
      // runs during a crash to write it then.
      const file = aFile({ cleanExit: true, entries: [] });

      createRecentFiles(file);

      expect(file.held()['cleanExit']).toBe(false);
    });
  });

  describe('a document this build did not write', () => {
    it('reads nothing from a list that is not an array', () => {
      expect(createRecentFiles(aFile({ entries: 'nonsense' })).list()).toStrictEqual([]);
    });

    it('drops the malformed ROWS and keeps the rest', () => {
      // One corrupt row must not cost the other nine. Rejecting the list whole
      // would make a single bad entry — from an older build, or a truncated
      // write this one no longer performs — erase everything a reader had.
      const file = aFile({
        entries: [
          { path: 'C:/a.pdf', name: 'a.pdf' },
          { path: 42, name: 'b.pdf' },
          { name: 'c.pdf' },
          null,
          { path: 'C:/d.pdf', name: 'd.pdf' },
        ],
      });

      expect(createRecentFiles(file).list().map((entry) => entry.name)).toStrictEqual([
        'a.pdf',
        'd.pdf',
      ]);
    });

    it('bounds a stored list that is longer than the cap', () => {
      // A document written by a build with a larger cap, or edited by hand.
      const entries = Array.from({ length: MAX_RECENT + 5 }, (_, index) => ({
        path: `C:/${String(index)}.pdf`,
        name: `${String(index)}.pdf`,
      }));

      expect(createRecentFiles(aFile({ entries })).list()).toHaveLength(MAX_RECENT);
    });
  });

  describe('the recorded session', () => {
    /**
     * The clause `docs/FEATURES.md`'s crash-recovery row carried: *"that
     * correspondence expires with multi-document tabs, when this must become a
     * recorded session rather than an inference."* Tabs landed, so it is
     * recorded, and these are what say it is recorded rather than derived.
     */
    const DRAFT = asDocId('00000000-0000-4000-8000-0000000000d1');
    const NOTES = asDocId('00000000-0000-4000-8000-0000000000d2');

    it('carries what is OPEN, which is not the head of the recent list', () => {
      // THE TWO LISTS ARE MADE TO DISAGREE, and that is the case rather than
      // colour: a fixture where the session is the newest recent entry cannot
      // tell a recorded session from the inference it replaced.
      const file = aFile();
      const first = createRecentFiles(file);

      first.record({ path: 'C:/annual.pdf', name: 'annual.pdf' });
      first.opened(DRAFT, { path: 'C:/draft.pdf', name: 'draft.pdf' });
      first.opened(NOTES, { path: 'C:/notes.pdf', name: 'notes.pdf' });
      first.record({ path: 'C:/latest.pdf', name: 'latest.pdf' });

      // No `markCleanExit`: this run died.
      const next = createRecentFiles(file);

      expect(next.lastSession().map((entry) => entry.name)).toStrictEqual([
        'draft.pdf',
        'notes.pdf',
      ]);
      // And the recent list's head is a document that was never open, so the
      // two answers are genuinely different values rather than one read twice.
      expect(next.list()[0]?.name).toBe('latest.pdf');
    });

    it('DROPS a document that was closed before the run ended', () => {
      // Without this, `opened` alone would satisfy the case above and the
      // session would grow to every document the run ever showed — which is
      // the recent list with extra steps.
      const file = aFile();
      const first = createRecentFiles(file);

      first.opened(DRAFT, { path: 'C:/draft.pdf', name: 'draft.pdf' });
      first.opened(NOTES, { path: 'C:/notes.pdf', name: 'notes.pdf' });
      first.closed(DRAFT);

      expect(
        createRecentFiles(file)
          .lastSession()
          .map((entry) => entry.name),
      ).toStrictEqual(['notes.pdf']);
    });

    it('CONTROL: a run that ended cleanly leaves nothing to recover', () => {
      // A run that finished has nothing to offer, and the offer is driven by
      // this list rather than by `lastExitClean` alone. `markCleanExit` clears
      // it explicitly, because the shutdown path closes documents through the
      // service rather than through this surface — so the live set is NOT
      // emptied by the closes a clean exit performs.
      const file = aFile();
      const first = createRecentFiles(file);

      first.opened(DRAFT, { path: 'C:/draft.pdf', name: 'draft.pdf' });
      first.markCleanExit();

      expect(createRecentFiles(file).lastSession()).toStrictEqual([]);
    });

    it('is EMPTY on a first launch, where no previous run recorded anything', () => {
      expect(createRecentFiles(aFile()).lastSession()).toStrictEqual([]);
    });
  });
});
