import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
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

/**
 * Writes `source`'s first `end` bytes to `destination`: BESIDE it first, then renamed over it, so the destination is
 * whole at every moment, never half a signed version. A failure removes the partial file and is thrown.
 */
export async function writePrefix(source: string, end: number, destination: string): Promise<void> {
  const writing = `${destination}.${randomBytes(8).toString('hex')}.writing`;
  try {
    await pipeline(createReadStream(source, { start: 0, end: end - 1 }), createWriteStream(writing, { flags: 'wx' }));
    if ((await stat(writing)).size !== end) throw new Error(`the signed version was cut short: ${String(end)} bytes asked for`);
    await rename(writing, destination);
  } catch (error) {
    await rm(writing, { force: true });
    throw error;
  }
}
