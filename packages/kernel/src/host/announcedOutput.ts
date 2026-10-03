import { open, rm } from 'node:fs/promises';

import type { ByteImage } from '../engineSeam.js';
import { EngineSerialiseMismatch } from './remoteLifecycle.js';

/**
 * Reads back a file a contained host wrote, holding it to the count the host announced BEFORE anything is read.
 *
 * The host is hostile by invariant 25's own premise, and the file is in a directory it writes. Reading the file whole
 * and comparing its length afterwards let the host decide how much `main` allocates: whatever it wrote was read into
 * memory first, and the comparison refused it only once it was there. So the size is read from the open file and
 * compared first, a file of another size is never read, and the read itself stops one byte past the count, so a file
 * that grows after the size was read is refused rather than followed.
 *
 * **A regular file**: what was opened must be one, so a name the host turned into a directory or a device is refused
 * rather than read. A link is followed by the open and judged by what it reaches; refusing one is the containment's
 * job (the host cannot reach a file it was not handed), not this read's.
 *
 * **The file is removed on every path**, read or refused: each one is another whole copy of the person's document in
 * a directory the contained host may read.
 *
 * @param path the output file main named, inside the session's granted output directory
 * @param announced the byte count the host's answer carries
 * @param files injected so a case can see which reads were made, which is the property; the application passes none
 * @returns exactly `announced` bytes, in an allocation of exactly that size
 * @throws EngineSerialiseMismatch when the file is not `announced` bytes long
 */
export async function readAnnounced(
  path: string,
  announced: number,
  files: { readonly open: typeof open; readonly rm: typeof rm } = { open, rm },
): Promise<ByteImage> {
  try {
    const handle = await files.open(path, 'r');
    try {
      const facts = await handle.stat();
      if (!facts.isFile() || facts.size !== announced) throw new EngineSerialiseMismatch(announced, facts.size);
      // EXACTLY THE COUNT, so the answer is its own allocation and no second image is made of it (ADR-0121's
      // addendum), and nothing past it is ever asked for.
      const bytes = new Uint8Array(announced);
      let read = 0;
      while (read < announced) {
        const { bytesRead } = await handle.read(bytes, read, announced - read, read);
        if (bytesRead === 0) throw new EngineSerialiseMismatch(announced, read);
        read += bytesRead;
      }
      // ONE BYTE PAST THE COUNT, so a file that grew since `stat` shows itself without the read following it.
      const { bytesRead: past } = await handle.read(new Uint8Array(1), 0, 1, announced);
      if (past !== 0) throw new EngineSerialiseMismatch(announced, announced + past);
      return bytes;
    } finally {
      await handle.close();
    }
  } finally {
    // RECURSIVE, so a directory the host made under the name goes too rather than throwing over the refusal; a link
    // is removed itself, never what it points at.
    await files.rm(path, { recursive: true, force: true });
  }
}
