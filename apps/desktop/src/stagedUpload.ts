import { randomUUID } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { type PdfSource, type StagedImage, placeStaged } from '@monstera/kernel';

/**
 * Sends a staged document from a file, one read at a time: what *Save back* and *Upload a copy* upload from
 * ([ADR-0165](../../../docs/DECISIONS/0165-a-document-past-mains-memory-ceiling-is-held-in-a-file.md)'s named remainder,
 * the owner's Group 10).
 *
 * ## The staged image is MOVED into `directory`, never read into `main`
 *
 * The engine wrote it under a name of its own and nothing writes that name again, so it is moved to a private file here
 * (`placeStaged`, the one spelling of *put the document's bytes in this file*), and `send` reads the ranges it asks for.
 * What `main` holds is a request's bytes, never the document.
 *
 * ## Removed whatever happens
 *
 * The file is a copy of the person's document in `main`'s storage, so it goes when the send ends — sent, refused or
 * failed. The staged image is discarded exactly once: by `placeStaged` when the move is tried, or here when the folder
 * could not be made, so nothing is left in the host's directory either.
 */
export async function sentFromStaged<T>(
  staged: StagedImage,
  directory: string,
  send: (source: PdfSource) => Promise<T>,
): Promise<T> {
  const path = join(directory, '.uploads', `${randomUUID()}.pdf`);
  try {
    await mkdir(join(directory, '.uploads'), { recursive: true });
  } catch (failed) {
    // NEVER MOVED, so the staged image is discarded here; past this point `placeStaged` discards it, once.
    await staged.discard();
    throw failed;
  }
  try {
    const byteLength = await placeStaged(staged, path);
    const handle = await open(path, 'r');
    try {
      // THE ENGINE'S COUNT AGAINST THE FILE: a move that left a different length is refused before anything is sent.
      const { size } = await handle.stat();
      if (size !== byteLength) throw new Error(`the staged document is ${String(size)} bytes where the engine wrote ${String(byteLength)}`);
      return await send({
        byteLength,
        read: async (offset, end) => {
          const bytes = new Uint8Array(end - offset);
          let at = 0;
          while (at < bytes.byteLength) {
            const { bytesRead } = await handle.read(bytes, at, bytes.byteLength - at, offset + at);
            if (bytesRead === 0) throw new Error(`the staged document ended at byte ${String(offset + at)} of ${String(byteLength)}`);
            at += bytesRead;
          }
          return bytes;
        },
      });
    } finally {
      await handle.close();
    }
  } finally {
    await rm(path, { force: true });
  }
}
