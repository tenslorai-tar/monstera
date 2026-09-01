import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOG_NAME, MAX_BYTES, MAX_FILES, createShellLog } from './shellLog.js';

/**
 * The cap is the claim, so every case here is about what happens at or past it.
 *
 * A logger that writes is trivially testable and proves nothing anybody worried
 * about: the failure mode is a log that grows without bound on a user's machine,
 * and the second is a sink that throws while the application is already failing.
 */

let userData: string;
let logs: string;

const AT = new Date('2026-09-01T08:00:00.000Z');

/**
 * The reveal surface for cases that are not about revealing.
 *
 * It THROWS rather than returning `false`, so a case that reaches it by
 * accident says so. A quiet stub would let a future edit route every write
 * through the file manager and nothing here would notice.
 */
const neverRevealed = (): Promise<boolean> => {
  throw new Error('this case does not reveal anything');
};

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'monstera-log-'));
  logs = join(userData, 'logs');
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

/** A line big enough that `count` of them cross the cap. */
const fat = (count: number): string => 'x'.repeat(Math.ceil(MAX_BYTES / count));

describe('createShellLog', () => {
  it('writes a failure with its event, its detail and a timestamp', () => {
    const log = createShellLog(userData, neverRevealed, () => AT);
    log.failures({ event: 'preload-error', detail: 'C:\\app\\preload.cjs: SyntaxError' });

    const written = readFileSync(join(logs, LOG_NAME), 'utf8');
    expect(written).toContain('2026-09-01T08:00:00.000Z');
    expect(written).toContain('FAILURE preload-error');
    // THE PATH SURVIVES. `shellFailure.ts` keeps absolute paths deliberately —
    // this never crosses to a renderer — and the preload path is the single
    // detail that turned a missing bridge into a five-minute fix.
    expect(written).toContain('C:\\app\\preload.cjs');
  });

  /**
   * A detail is peer-supplied on at least one path: `engine-host-gone` carries
   * a code and text the host composed, and the host is hostile by invariant
   * 25's own premise. A newline inside it is that peer writing lines of its own
   * into a file someone reads to diagnose it.
   */
  it('does not let a detail write lines of its own', () => {
    const log = createShellLog(userData, neverRevealed, () => AT);
    log.failures({
      event: 'engine-host-gone',
      detail: 'code=shutdown\n2026-01-01T00:00:00.000Z FAILURE preload-error all is well',
    });

    const lines = readFileSync(join(logs, LOG_NAME), 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it('keeps the live file under the cap by rotating before the write that would cross it', () => {
    const log = createShellLog(userData, neverRevealed, () => AT);
    const line = fat(4);
    for (let index = 0; index < 6; index += 1) log.failures({ event: 'unresponsive', detail: line });

    // ROTATED BEFORE, NOT AFTER. Rotating afterwards leaves the live file over
    // the limit by the size of the line that crossed it, which is the
    // off-by-one that turns a cap into a suggestion — and it is the mutation
    // this assertion catches, since the file would otherwise still exist and
    // still be readable.
    expect(readFileSync(join(logs, LOG_NAME), 'utf8').length).toBeLessThanOrEqual(MAX_BYTES);
    expect(existsSync(join(logs, 'shell.1.log'))).toBe(true);
  });

  it('keeps at most MAX_FILES files however much is written', () => {
    const log = createShellLog(userData, neverRevealed, () => AT);
    const line = fat(2);
    // Enough to rotate many times over: three writes per rotation, twenty times
    // the number of files that may survive.
    for (let index = 0; index < MAX_FILES * 20; index += 1) {
      log.failures({ event: 'unresponsive', detail: line });
    }

    const files = readdirSync(logs);
    expect(files.length).toBeLessThanOrEqual(MAX_FILES);
    // AND THE CONTROL: the cases above are satisfied by a logger that rotated
    // once and then stopped writing. Something must still be arriving.
    expect(readFileSync(join(logs, LOG_NAME), 'utf8').length).toBeGreaterThan(0);
  });

  /**
   * The set of files to delete is derived from the DIRECTORY, not from the
   * constant, so lowering `MAX_FILES` takes effect on the next rotation instead
   * of stranding whatever a previous value left behind. A run that only ever
   * deletes `shell.${MAX_FILES}.log` passes every case above.
   */
  it('removes files a larger MAX_FILES left behind', () => {
    const log = createShellLog(userData, neverRevealed, () => AT);
    log.failures({ event: 'unresponsive', detail: 'first, so the directory exists' });
    for (const stale of ['shell.7.log', 'shell.12.log']) {
      writeFileSync(join(logs, stale), 'left by a build that kept more');
    }

    const line = fat(1);
    log.failures({ event: 'unresponsive', detail: line });
    log.failures({ event: 'unresponsive', detail: line });

    expect(existsSync(join(logs, 'shell.7.log'))).toBe(false);
    expect(existsSync(join(logs, 'shell.12.log'))).toBe(false);
  });

  /**
   * The requirement both sink types carry: they run while a failure is already
   * in progress, so a throwing sink replaces a diagnosable failure with an
   * undiagnosable one.
   *
   * The input is a directory that CANNOT be created — `userData` is a regular
   * file, so `mkdirSync` under it fails on every platform. Asserting against a
   * path that merely does not exist would prove nothing, because the logger
   * creates missing directories on purpose.
   */
  it('does not throw when the log directory cannot be created', () => {
    const asAFile = join(tmpdir(), `monstera-log-file-${String(process.pid)}`);
    writeFileSync(asAFile, 'not a directory');
    try {
      const log = createShellLog(asAFile, neverRevealed, () => AT);
      expect(() => {
        log.failures({ event: 'shutdown-incomplete', detail: 'the engine host would not close' });
      }).not.toThrow();
      expect(() => {
        log.incidents({
          id: 'ab01',
          channel: 'document.save',
          diagnostic: { name: 'Error', message: 'no' },
        });
      }).not.toThrow();
    } finally {
      rmSync(asAFile, { force: true });
    }
  });

  /**
   * The pair, and neither half alone is the claim.
   *
   * *Reveal answered false* is what a stub that does nothing produces, so the
   * second case is what says the first is a decision — the same directory, the
   * same surface, one line written in between.
   */
  it('reveals nothing, and does not ask the platform to, when no log exists', async () => {
    const asked: string[] = [];
    const log = createShellLog(
      userData,
      (directory) => {
        asked.push(directory);
        return Promise.resolve(true);
      },
      () => AT,
    );

    // ASSERT THE CALL THAT WAS NOT MADE. A file manager opened on a directory
    // that is not there and one that was never asked for produce the same
    // `false`, and only the first is a defect.
    await expect(log.reveal()).resolves.toBe(false);
    expect(asked).toEqual([]);
  });

  it('asks the platform for its own directory once a log exists', async () => {
    const asked: string[] = [];
    const log = createShellLog(
      userData,
      (directory) => {
        asked.push(directory);
        return Promise.resolve(true);
      },
      () => AT,
    );
    log.failures({ event: 'unresponsive', detail: 'something to have a log about' });

    await expect(log.reveal()).resolves.toBe(true);
    expect(asked).toEqual([logs]);
  });

  /**
   * The platform's answer is passed through rather than replaced by the fact
   * that a directory exists. A reveal that reported success because the folder
   * was there would be the display-only shape: the command runs, the user sees
   * no window, and nothing anywhere disagrees.
   */
  it('reports the platform refusing to open the directory', async () => {
    const log = createShellLog(userData, () => Promise.resolve(false), () => AT);
    log.failures({ event: 'unresponsive', detail: 'something to have a log about' });

    await expect(log.reveal()).resolves.toBe(false);
  });

  it('records an incident with its id and the channel it was crossing', () => {
    const log = createShellLog(userData, neverRevealed, () => AT);
    log.incidents({
      id: 'ab01',
      channel: 'document.save',
      diagnostic: { name: 'Error', message: 'EPERM on C:\\Users\\me\\doc.pdf' },
    });

    const written = readFileSync(join(logs, LOG_NAME), 'utf8');
    expect(written).toContain('INCIDENT ab01 document.save');
    // THE DIAGNOSTIC, WITH ITS PATH. Only the id crosses to the renderer
    // (invariant 2); this side already knows the path and is the only place it
    // can be read from.
    expect(written).toContain('C:\\\\Users\\\\me\\\\doc.pdf');
  });
});
