import { type DocId, asDocId } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { autosaveEvery, createAutosave } from './autosave.js';
import { AUTOSAVE_SETTING } from './settings/saving.js';

const A = asDocId('00000000-0000-4000-8000-00000000000a');
const B = asDocId('00000000-0000-4000-8000-00000000000b');

function harness(answers: Partial<Record<DocId, boolean>> = {}) {
  let dirty: DocId[] = [];
  const saved: DocId[] = [];
  const autosave = createAutosave({
    dirty: () => dirty,
    save: (docId) => {
      saved.push(docId);
      return Promise.resolve(answers[docId] ?? true);
    },
  });
  return {
    autosave,
    saved,
    setDirty: (next: DocId[]) => {
      dirty = next;
    },
  };
}

describe('autosave', () => {
  it('is off unless chosen, and an interval is whole minutes', () => {
    expect(autosaveEvery('off')).toBeNull();
    expect(autosaveEvery('1min')).toBe(60_000);
    expect(autosaveEvery('10min')).toBe(600_000);
    expect(autosaveEvery('30min')).toBe(1_800_000);
  });

  it('offers the founding record’s six choices, OFF FIRST, in its order (BUILD-PROMPT.md:617)', () => {
    // THE LITERAL IS THE ANCHOR: a list derived from the schema would agree with any list the schema held, which is
    // how two of the six went missing unnoticed. And the ORDER is what the dialog draws — with bare numbers zod read
    // `['1', '5', '10', 'off']`, so *Off* was drawn last.
    expect(AUTOSAVE_SETTING.schema.options).toStrictEqual(['off', '1min', '2min', '5min', '10min', '30min']);
  });

  it('reads a value stored before the rename as the same choice, and anything else as unchanged', () => {
    const migrate = AUTOSAVE_SETTING.migrate;
    expect(['1', '5', '10'].map((stored) => migrate?.(stored))).toStrictEqual(['1min', '5min', '10min']);
    // CONTROL: a current value passes untouched, so the migration cannot turn a new choice into an old one.
    expect(['off', '2min', '30min'].map((stored) => migrate?.(stored))).toStrictEqual(['off', '2min', '30min']);
  });

  // THE *ONLY* IS THE APP'S: this unit is handed the dirty list, so it saves exactly what that list names; that a clean
  // document is not on it is `App.test.tsx`'s AUTOSAVE case, third row.
  it('saves every document the dirty list names, and nothing else', async () => {
    const { autosave, saved, setDirty } = harness();
    setDirty([A]);
    await autosave.tick();
    // B is open and clean: autosave writes nothing a person did not change.
    expect(saved).toStrictEqual([A]);
  });

  it('a REFUSED save pauses that document — the next pass does not reopen its dialog', async () => {
    const { autosave, saved, setDirty } = harness({ [A]: false });
    setDirty([A, B]);
    await autosave.tick();
    await autosave.tick();
    // A asked once; B, which saved, is asked each time it is dirty.
    expect(saved).toStrictEqual([A, B, B]);
  });

  it('a paused document is saved again once it has been clean', async () => {
    const answers: Partial<Record<DocId, boolean>> = { [A]: false };
    const { autosave, saved, setDirty } = harness(answers);
    setDirty([A]);
    await autosave.tick();
    // A MANUAL SAVE THAT WORKED makes it clean, which is what lifts the pause.
    setDirty([]);
    await autosave.tick();
    answers[A] = true;
    setDirty([A]);
    await autosave.tick();
    expect(saved).toStrictEqual([A, A]);
  });

  it('a pass that starts while one is running does nothing', async () => {
    let release: () => void = () => undefined;
    const saved: DocId[] = [];
    const autosave = createAutosave({
      dirty: () => [A],
      save: (docId) => {
        saved.push(docId);
        return new Promise((done) => {
          release = () => {
            done(true);
          };
        });
      },
    });
    const first = autosave.tick();
    await autosave.tick();
    release();
    await first;
    // Two overlapping passes would save the same document twice at once.
    expect(saved).toStrictEqual([A]);
  });
});
