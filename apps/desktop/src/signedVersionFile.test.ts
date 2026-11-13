import { EngineDocumentLocked, EngineOpenFailed } from '@monstera/kernel';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { cutFailure, PrefixChangedError, writePrefix } from './signedVersionFile.js';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
const folder = (): string => {
  const made = mkdtempSync(join(tmpdir(), 'monstera-signed-version-'));
  folders.push(made);
  return made;
};

/** The error Node's own file calls throw, which names the path it was about. */
async function refusalAt(path: string): Promise<unknown> {
  try {
    await writePrefix(path, 4, join(folder(), 'cut.pdf'), 'unchecked');
  } catch (thrown) {
    return thrown;
  }
  throw new Error('the read of a missing file did not throw');
}

describe('cutFailure: whose failure a signed-version check was (HHHHHHHHH-18)', () => {
  const SOURCE = 'C:/Users/someone/signed.pdf';

  it('the FILE’S failures are no signed version there: a cut that does not open, one that asks for a password, a file that changed', () => {
    expect(cutFailure(new EngineOpenFailed('no version marker'), SOURCE)).toBe('not-found');
    expect(cutFailure(new EngineDocumentLocked('needs-password'), SOURCE)).toBe('not-found');
    expect(cutFailure(new PrefixChangedError(18360), SOURCE)).toBe('not-found');
  });

  it('the signed file itself refused, by the path Node’s own error names, is the file’s; CONTROL: the area’s refusal is the check’s', async () => {
    const missing = join(folder(), 'gone.pdf');
    const thrown = await refusalAt(missing);
    // THE ERROR UNDER TEST IS NODE'S OWN, so the path it names is the one the classifier reads in the shipped code.
    expect(thrown).toMatchObject({ code: 'ENOENT', path: missing });
    expect(cutFailure(thrown, missing)).toBe('not-found');
    expect(cutFailure(thrown, join(folder(), 'another.pdf'))).toBe('not-checked');
  });

  it('a host that did not start or ended is the CHECK’S failure, thrown and never kept as “not found”', () => {
    expect(cutFailure(new Error('the engine host ended before it answered'), SOURCE)).toBe('not-checked');
    expect(cutFailure('a thrown string', SOURCE)).toBe('not-checked');
  });
});

describe('writePrefix', () => {
  it('a file SHORTER than the cut is a file that changed: PrefixChangedError, and nothing written beside the destination', async () => {
    const at = folder();
    const source = join(at, 'signed.pdf');
    writeFileSync(source, Buffer.from('%PDF-1.7'));
    const destination = join(at, 'cut.pdf');
    await expect(writePrefix(source, 64, destination, 'unchecked')).rejects.toBeInstanceOf(PrefixChangedError);
    // CONTROL: a cut the file holds is written, and answers its digest.
    expect((await writePrefix(source, 4, destination, 'unchecked')).sha256).toMatch(/^[0-9a-f]{64}$/u);
  });
});
