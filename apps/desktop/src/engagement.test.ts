import { describe, expect, it } from 'vitest';

import { MAX_PROMPTS, createEngagement, reviewPrompt } from './engagement.js';
import type { SettingsSurface } from './settingsFile.js';

const DAY = 86_400_000;
const INSTALL = Date.UTC(2026, 8, 1);

/** A JSON document over a variable, so a second store over it is a second launch. */
function aFile(): SettingsSurface & { readonly held: () => Readonly<Record<string, unknown>> } {
  let stored: Readonly<Record<string, unknown>> = {};
  return {
    read: () => stored,
    write: (values) => {
      stored = values;
    },
    held: () => stored,
  };
}

/** Launches the application `times` times over one record, at `day` days after install, answering the last. */
function launched(file: SettingsSurface, day: number, enabled = true) {
  return createEngagement(file, { now: () => new Date(INSTALL + day * DAY), enabled: () => enabled });
}

describe('the rating prompt’s record (E3)', () => {
  it('is NOT due on the first session, even long after install', () => {
    // INSTALLED TEN DAYS AGO WITH NO SESSION COUNTED: this launch is the first, so real use has not happened.
    const file = aFile();
    file.write({ installDate: INSTALL, sessions: 0 });
    expect(launched(file, 10).due()).toBe(false);
    // CONTROL: the next launch is the second, and the same day count is due.
    expect(launched(file, 10).due()).toBe(true);
  });

  it('is NOT due before three days, with the sessions there', () => {
    const file = aFile();
    launched(file, 0);
    expect(launched(file, 2.9).due()).toBe(false);
  });

  it('IS due after three days and two sessions — and a yes counts as the prompt shown', () => {
    const file = aFile();
    launched(file, 0);
    const second = launched(file, 3);
    expect(second.due()).toBe(true);
    // THE SAME LAUNCH ASKING AGAIN is not asked again: the yes was the prompt.
    expect(second.due()).toBe(false);
    expect(file.read()['promptCount']).toBe(1);
  });

  it('waits three more days after a prompt, then asks again', () => {
    const file = aFile();
    launched(file, 0);
    expect(launched(file, 3).due()).toBe(true);
    expect(launched(file, 5.9).due()).toBe(false);
    expect(launched(file, 6).due()).toBe(true);
  });

  it(`stops after ${String(MAX_PROMPTS)} prompts in total`, () => {
    const file = aFile();
    launched(file, 0);
    const answers = [3, 6, 9, 12, 15, 18].map((day) => launched(file, day).due());
    expect(answers).toStrictEqual([true, true, true, true, true, false]);
  });

  it('never asks again once reviewed', () => {
    const file = aFile();
    launched(file, 0);
    launched(file, 1).reviewed();
    expect(launched(file, 30).due()).toBe(false);
  });

  it('LATER starts the three days again from the answer, not from the prompt', () => {
    const file = aFile();
    launched(file, 0);
    expect(launched(file, 3).due()).toBe(true);
    launched(file, 5).later();
    // Six days after install is three after the prompt, and only one after Later.
    expect(launched(file, 6).due()).toBe(false);
    expect(launched(file, 8).due()).toBe(true);
  });

  it('asks nothing while the Settings toggle is off, and records nothing as shown', () => {
    const file = aFile();
    launched(file, 0);
    expect(launched(file, 10, false).due()).toBe(false);
    expect(file.read()['promptCount']).toBe(0);
    // CONTROL: the same record with the toggle on is due, so the refusal above was the toggle's.
    expect(launched(file, 10).due()).toBe(true);
  });

  it('RATE records a review only when the Store page OPENED — a build with nowhere to send it keeps asking', async () => {
    const file = aFile();
    launched(file, 0);
    const refused = reviewPrompt(launched(file, 3), () => Promise.resolve(false));
    expect(await refused.answer('rate')).toBe(false);
    expect(file.read()['reviewedAt']).toBeNull();

    const opened = reviewPrompt(launched(file, 4), () => Promise.resolve(true));
    expect(await opened.answer('rate')).toBe(true);
    expect(typeof file.read()['reviewedAt']).toBe('number');
  });

  it('ALREADY REVIEWED records it and opens nothing; LATER opens nothing either', async () => {
    let asked = 0;
    const open = (): Promise<boolean> => {
      asked += 1;
      return Promise.resolve(true);
    };
    const file = aFile();
    launched(file, 0);
    expect(await reviewPrompt(launched(file, 1), open).answer('later')).toBe(false);
    expect(await reviewPrompt(launched(file, 2), open).answer('reviewed')).toBe(false);
    expect(asked).toBe(0);
    expect(launched(file, 30).due()).toBe(false);
  });

  it('a record that is not what this build writes starts again rather than throwing', () => {
    const file = aFile();
    file.write({ installDate: 'yesterday', sessions: -3, promptCount: 1.5 });
    const engagement = launched(file, 0);
    expect(engagement.due()).toBe(false);
    expect(file.read()['sessions']).toBe(1);
  });
});
