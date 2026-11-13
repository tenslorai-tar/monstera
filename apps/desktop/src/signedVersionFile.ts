import { EngineDocumentLocked, EngineOpenFailed } from '@monstera/kernel';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * A file's first `end` bytes, the document as one signature signed it
 * ([ADR-0291](../../../docs/DECISIONS/0291-a-certified-document-is-locked-to-what-its-certifier-allowed-and-worked-on-as-a-copy.md)
 * Decision 7). A signature's `/ByteRange` ends at the file it signed, and a file appended to afterwards holds that file
 * as its first bytes, measured in `signedVersion.test.ts`; so the cut is a byte copy and nothing here reads a PDF.
 *
 * STREAMED, never read whole into `main`: a signed file is as large as any other.
 */

/** Whether `path` holds at least `end` bytes, so a cut there is a prefix of it and not a guess past its end. */
export async function holdsPrefix(path: string, end: number): Promise<boolean> {
  return end > 0 && (await stat(path)).size >= end;
}

/** The SHA-256 of a cut, as {@link writePrefix} answers it: the name of exactly the bytes one read of the file held. */
export interface PrefixDigest {
  readonly sha256: string;
}

/**
 * {@link writePrefix} refused: the file no longer holds the cut it was asked for, its bytes not the ones `expect` names
 * or fewer than `end` of them, so it changed since it was checked or measured.
 */
export class PrefixChangedError extends Error {
  constructor(readonly end: number) {
    super(`the file's first ${String(end)} bytes are not the ones that were checked`);
    this.name = 'PrefixChangedError';
  }
}

/**
 * Whose failure a check of a signed version that threw was (HHHHHHHHH-18; {@link idReadFailure}'s shape). The FILE's —
 * the cut not a document the engine opens, one that asks for a password, the file changed under the read, or the file
 * itself refused — is `not-found`: there is no signed version there to offer. Anything else is the checking's, a host
 * that did not start or ended, which says nothing of the file and is thrown, so it is never kept as an answer.
 *
 * @param source the signed file, whose own refusal is told from the area's by the path Node's error names
 */
export function cutFailure(thrown: unknown, source: string): 'not-found' | 'not-checked' {
  if (thrown instanceof EngineOpenFailed || thrown instanceof EngineDocumentLocked || thrown instanceof PrefixChangedError) return 'not-found';
  return thrown instanceof Error && 'path' in thrown && thrown.path === source ? 'not-found' : 'not-checked';
}

/**
 * Writes `source`'s first `end` bytes to `destination`: BESIDE it first, then renamed over it, so the destination is
 * whole at every moment, never half a signed version. A failure removes the partial file and is thrown.
 *
 * Answers the digest of the bytes it wrote. `expect` names the bytes the write must be: a cut that was checked is read
 * again from the file when it is written, and a file saved in between holds other bytes there, so the write is refused
 * with {@link PrefixChangedError} and nothing reaches `destination`. `'unchecked'` is the read that does the checking.
 */
export async function writePrefix(
  source: string,
  end: number,
  destination: string,
  expect: PrefixDigest | 'unchecked',
): Promise<PrefixDigest> {
  const writing = `${destination}.${randomBytes(8).toString('hex')}.writing`;
  const hash = createHash('sha256');
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(createReadStream(source, { start: 0, end: end - 1 }), hashing, createWriteStream(writing, { flags: 'wx' }));
    // FEWER BYTES THAN ASKED: the file shrank after it was measured, which is a change to it like any other.
    if ((await stat(writing)).size !== end) throw new PrefixChangedError(end);
    const written = { sha256: hash.digest('hex') };
    if (expect !== 'unchecked' && expect.sha256 !== written.sha256) throw new PrefixChangedError(end);
    await rename(writing, destination);
    return written;
  } catch (error) {
    await rm(writing, { force: true });
    throw error;
  }
}
