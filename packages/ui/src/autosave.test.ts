import { type DocId, asDocId } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { autosaveEvery, createAutosave } from './autosave.js';

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
    expect(autosaveEvery('1')).toBe(60_000);
    expect(autosaveEvery('10')).toBe(600_000);
  });

  it('saves every document with unsaved changes, and ONLY those', async () => {
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
