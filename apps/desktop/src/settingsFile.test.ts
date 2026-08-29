import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  SETTINGS_FILE,
  createEphemeralSettings,
  createSettingsFile,
  replaceWithRetry,
} from './settingsFile.js';

/**
 * The claim under test is **survives a restart**, and nothing here asserts a
 * write.
 *
 * A setting that resets every launch and a setting that persists produce the
 * identical observation at the moment of writing: the call returned. So every
 * case that matters here builds a **second surface over the same directory** —
 * which is what a relaunch is, with the process boundary removed — and reads
 * through it. That is the difference the FEATURES row asks for in the words it
 * asks for it in.
 */

const directories: string[] = [];

/** A fresh directory, and the surface over it. */
function freshArea(): { directory: string; surface: ReturnType<typeof createSettingsFile> } {
  const directory = mkdtempSync(join(tmpdir(), 'monstera-settings-'));
  directories.push(directory);
  return { directory, surface: createSettingsFile(directory) };
}

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe('the settings file', () => {
  it('a value written by one surface is read by a DIFFERENT one over the same directory', () => {
    const { directory, surface } = freshArea();

    surface.write({ 'appearance.theme': 'dark' });

    // THE RESTART. A second surface shares nothing with the first but the
    // directory, so this cannot pass on anything held in memory — which is
    // exactly what the ephemeral surface below demonstrates by failing it.
    expect(createSettingsFile(directory).read()).toStrictEqual({ 'appearance.theme': 'dark' });
  });

  it('CONTROL: the ephemeral surface does NOT survive being rebuilt', () => {
    // Without this, the case above passes for a surface that persists nothing
    // and happens to be consulted through the same object — and the whole file
    // would then be asserting that a Map works. This is the same claim, made
    // against something known not to persist, so the two readings separate.
    const held = createEphemeralSettings();
    held.write({ 'appearance.theme': 'dark' });

    expect(held.read()).toStrictEqual({ 'appearance.theme': 'dark' });
    expect(createEphemeralSettings().read()).toStrictEqual({});
  });

  it('a rewrite REPLACES rather than merges, so a removed setting leaves', () => {
    const { directory, surface } = freshArea();

    surface.write({ 'appearance.theme': 'dark', 'editing.autosave': true });
    surface.write({ 'appearance.theme': 'light' });

    // The channel sends the whole object precisely so that what is on disk has
    // one answer. A merge here would make the file the sum of every write it
    // ever received, and a setting removed from the registry could never leave.
    expect(createSettingsFile(directory).read()).toStrictEqual({ 'appearance.theme': 'light' });
  });

  it('a first launch reads as no settings rather than as an error', () => {
    const { directory } = freshArea();
    expect(createSettingsFile(directory).read()).toStrictEqual({});
  });

  it('a corrupt file reads as no settings, because the user cannot act on it', () => {
    const { directory } = freshArea();
    writeFileSync(join(directory, SETTINGS_FILE), '{ this is not json', 'utf8');

    expect(createSettingsFile(directory).read()).toStrictEqual({});
  });

  it('a top-level ARRAY is refused, and is not read as settings named 0 and 1', () => {
    const { directory } = freshArea();
    writeFileSync(join(directory, SETTINGS_FILE), '["dark", "light"]', 'utf8');

    // An array is an object to `typeof`, so without the explicit exclusion this
    // hydrates as ids "0" and "1" — which the registry then drops one at a time
    // while nothing anywhere says the file was corrupt. The reassuring answer
    // arriving through a shape check that was almost right.
    expect(createSettingsFile(directory).read()).toStrictEqual({});
  });

  it('a value this build cannot interpret is CARRIED, not dropped at the file', () => {
    const { directory } = freshArea();
    writeFileSync(
      join(directory, SETTINGS_FILE),
      JSON.stringify({ 'from.a.newer.build': { shape: 'nobody here knows' } }),
      'utf8',
    );

    // THE FILE VALIDATES NOTHING, and that is the boundary deferring rather than
    // being lax. What a settings file holds is whatever a previous build wrote,
    // so a schema here would be this build's opinion about last build's data —
    // and `SettingsRegistry.read` is the writer of record for what a stored
    // value means (B3a). A file that dropped what it could not parse would take
    // that decision away from the one component that can migrate it.
    expect(createSettingsFile(directory).read()).toStrictEqual({
      'from.a.newer.build': { shape: 'nobody here knows' },
    });
  });

  it('a rename that fails TRANSIENTLY is retried, and the write succeeds', () => {
    const { directory } = freshArea();
    const from = join(directory, 'source');
    const to = join(directory, 'destination');
    writeFileSync(from, 'payload\n', 'utf8');

    // Fails the way Windows fails — EPERM from a handle another process holds —
    // and then stops, which is what a scanner releasing its handle looks like.
    // Injected because the real condition happened once and cannot be summoned:
    // waiting for it would leave the retry as an untested branch guarding the
    // only failure it will ever see.
    let attempts = 0;
    replaceWithRetry(from, to, (source, target) => {
      attempts += 1;
      if (attempts <= 2) {
        const transient: NodeJS.ErrnoException = new Error('EPERM: operation not permitted');
        transient.code = 'EPERM';
        throw transient;
      }
      renameSync(source, target);
    });

    expect(attempts).toBe(3);
    expect(readFileSync(to, 'utf8')).toBe('payload\n');
  });

  it('a rename that keeps failing is REPORTED, and takes its temporary with it', () => {
    const { directory } = freshArea();
    const from = join(directory, 'source');
    writeFileSync(from, 'payload\n', 'utf8');

    let attempts = 0;
    expect(() => {
      replaceWithRetry(from, join(directory, 'destination'), () => {
        attempts += 1;
        const held: NodeJS.ErrnoException = new Error('EPERM: operation not permitted');
        held.code = 'EPERM';
        throw held;
      });
    }).toThrow(/was not stored/u);

    // BOUNDED, and the number matters: a retry with no ceiling would hang the
    // main process on a settings file something has locked open.
    expect(attempts).toBe(5);
    // And the temporary is gone, because one left behind accumulates per failure
    // in the directory whose whole job is to hold exactly one document.
    expect(() => readFileSync(from, 'utf8')).toThrow();
  });

  it('a failure that is NOT transient is reported on the first attempt', () => {
    const { directory } = freshArea();
    const from = join(directory, 'source');
    writeFileSync(from, 'payload\n', 'utf8');

    // THE CONTROL FOR THE RETRY, and its direction is what makes it one. Every
    // case above asserts that failures are tried again; without this one they
    // are all satisfied by a loop that retries EVERYTHING, which would turn a
    // cross-device rename or a missing source — both ours, both permanent — into
    // five attempts and a fifth of a second before saying so.
    let attempts = 0;
    expect(() => {
      replaceWithRetry(from, join(directory, 'destination'), () => {
        attempts += 1;
        const ours: NodeJS.ErrnoException = new Error('EXDEV: cross-device link not permitted');
        ours.code = 'EXDEV';
        throw ours;
      });
    }).toThrow(/was not stored/u);

    expect(attempts).toBe(1);
  });

  it('the write leaves no temporary file behind', () => {
    const { directory, surface } = freshArea();

    surface.write({ 'appearance.theme': 'dark' });

    // The rename is what makes the write atomic — a reader sees the old
    // document or the new one, never half of either — and a rename that had
    // silently become a copy would leave this file. Asserting the ABSENCE of the
    // temporary is the only observation on this side that separates the two,
    // since both leave a correct settings file behind.
    expect(() => readFileSync(join(directory, `${SETTINGS_FILE}.writing`), 'utf8')).toThrow();
  });
});
