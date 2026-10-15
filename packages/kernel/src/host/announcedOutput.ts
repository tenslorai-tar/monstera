import { constants } from 'node:fs';
import { copyFile, type FileHandle, open, rename, rm } from 'node:fs/promises';

import type { ByteImage } from '../engineSeam.js';
import type { StagedImage } from '../savePipeline.js';
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

/**
 * A file `main` owns, read and written in place a range at a time, and given up as a staged image or removed: what a
 * signature is made in ([ADR-0248](../../../../docs/DECISIONS/0248-a-signature-is-made-over-a-digest-read-from-the-prepared-file.md)).
 */
export interface WorkingFile {
  readonly byteLength: number;
  /** Exactly `end - offset` bytes from `offset`, or a throw. */
  readonly read: (offset: number, end: number) => Promise<Uint8Array>;
  /** Writes `bytes` at `offset`, in place; never past the end. */
  readonly write: (offset: number, bytes: Uint8Array) => Promise<void>;
  /** The file as a staged image, placed by a move and discarded by removal. Ends reads and writes. */
  readonly staged: () => StagedImage;
}

/** How many bytes {@link copyAnnounced} moves at a time. */
const COPY_BYTES = 16 * 1_048_576;

/**
 * Copies a file a contained host wrote into `destination`, `main`'s own storage, holding it to the announced count as
 * {@link readAnnounced} does, and answers it as a {@link WorkingFile}: the taker for output `main` must work on but
 * should not hold whole (ADR-0248).
 *
 * **Copied, never moved.** A move keeps the file the host made, and a host still holding a handle on it could write into
 * it after `main` checked it. The copy is read from the handle opened and checked here, never from the path again, so
 * a name swapped after the check copies nothing new; and `destination` is in storage granted to no container. A file
 * that grew past the count while it was copied is refused, as a read is.
 *
 * **The host's file is removed on every path**, copied or refused, and so is a refused copy.
 */
export async function copyAnnounced(path: string, announced: number, destination: string): Promise<WorkingFile> {
  try {
    const source = await open(path, 'r');
    try {
      const facts = await source.stat();
      if (!facts.isFile() || facts.size !== announced) throw new EngineSerialiseMismatch(announced, facts.size);
      const target = await open(destination, 'wx');
      try {
        const part = new Uint8Array(Math.min(COPY_BYTES, Math.max(announced, 1)));
        for (let at = 0; at < announced; ) {
          const { bytesRead } = await source.read(part, 0, Math.min(part.byteLength, announced - at), at);
          if (bytesRead === 0) throw new EngineSerialiseMismatch(announced, at);
          await target.write(part, 0, bytesRead, at);
          at += bytesRead;
        }
        const { bytesRead: past } = await source.read(new Uint8Array(1), 0, 1, announced);
        if (past !== 0) throw new EngineSerialiseMismatch(announced, announced + past);
      } catch (refused) {
        await target.close();
        await rm(destination, { force: true });
        throw refused;
      }
      await target.close();
    } finally {
      await source.close();
    }
  } finally {
    await rm(path, { recursive: true, force: true });
  }
  return workingFile(destination, announced);
}

/** A {@link WorkingFile} over `path`, opened for reading and writing on first use and closed before it is given up. */
function workingFile(path: string, byteLength: number): WorkingFile {
  let handle: FileHandle | undefined;
  let ended = false;
  const opened = async (): Promise<FileHandle> => {
    if (ended) throw new Error('this working file has been given up');
    handle ??= await open(path, 'r+');
    return handle;
  };
  const end = async (): Promise<void> => {
    ended = true;
    await handle?.close();
    handle = undefined;
  };
  return {
    byteLength,
    read: async (offset, endAt) => {
      if (offset < 0 || endAt < offset || endAt > byteLength) throw new Error(`no range ${String(offset)} to ${String(endAt)} in ${String(byteLength)} bytes`);
      const bytes = new Uint8Array(endAt - offset);
      const file = await opened();
      for (let at = 0; at < bytes.byteLength; ) {
        const { bytesRead } = await file.read(bytes, at, bytes.byteLength - at, offset + at);
        if (bytesRead === 0) throw new EngineSerialiseMismatch(byteLength, offset + at);
        at += bytesRead;
      }
      return bytes;
    },
    write: async (offset, bytes) => {
      if (offset < 0 || offset + bytes.byteLength > byteLength) throw new Error(`a write at ${String(offset)} runs past ${String(byteLength)} bytes`);
      const file = await opened();
      for (let at = 0; at < bytes.byteLength; ) {
        const { bytesWritten } = await file.write(bytes, at, bytes.byteLength - at, offset + at);
        at += bytesWritten;
      }
    },
    staged: () => ({
      byteLength,
      place: async (destination) => {
        await end();
        try {
          await rename(path, destination);
        } catch (error) {
          // ACROSS VOLUMES a move is a copy and a delete, streamed by the operating system (`moveOutput`'s reason).
          if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
          await copyFile(path, destination, constants.COPYFILE_EXCL);
          await rm(path, { force: true });
        }
      },
      discard: async () => {
        await end();
        await rm(path, { force: true });
      },
    }),
  };
}
