import { writeFile } from 'node:fs/promises';

import type { ByteImage } from './engineSeam.js';

/**
 * `CheckpointWriter.serialiseInto` for a writer whose session is bytes in `main`: serialise, and write them
 * ([ADR-0121](../../../docs/DECISIONS/0121-main-never-holds-two-images.md)).
 *
 * One definition, so the writers that have to write — pdf-lib's, signing's, PDFium's byte-image session, a local
 * MuPDF in a test — cannot each spell the count differently from what landed.
 */
export function serialiseIntoFile<TSession>(
  serialise: (session: TSession) => Promise<ByteImage>,
): (session: TSession, destination: string) => Promise<number> {
  return async (session, destination) => {
    const bytes = await serialise(session);
    await writeFile(destination, bytes);
    return bytes.byteLength;
  };
}
