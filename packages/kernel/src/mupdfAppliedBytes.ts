import type { MupdfSession } from './engineSeam.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * A MuPDF-writer apply run on a document's bytes, answering the bytes it leaves: the session opened, the command applied,
 * the document serialised as the bus would, the session closed. For a proof of a command that draws onto pages, which
 * reads its result back from the bytes with a reader that is not the writer.
 */
export async function appliedTo<C>(
  image: Uint8Array,
  apply: (session: MupdfSession, command: C) => Promise<void>,
  command: C,
): Promise<Uint8Array> {
  const session = await mupdfWriter.open(image);
  try {
    await apply(session, command);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}
