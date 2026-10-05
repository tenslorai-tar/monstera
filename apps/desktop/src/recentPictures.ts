import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MAX_RECENT_PREVIEW_BYTES } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import { replaceWithRetry } from './settingsFile.js';

/** Where the pictures are kept: one file per recent entry, named by a digest of its path. */
export interface PictureFiles {
  write(name: string, bytes: Uint8Array): void;
  read(name: string): Uint8Array<ArrayBuffer> | null;
  remove(name: string): void;
  names(): readonly string[];
}

/** What the recent list's pictures do (ADR-0100). */
export interface RecentPictures {
  /**
   * A document has opened and its engine session is ready: keep a picture of its first page, unless the
   * Privacy setting is off. Never throws; a picture that could not be made is reported and not kept, and
   * the card shows the placeholder.
   */
  capture(docId: DocId, path: string): Promise<void>;
  /**
   * A removal's save has written the document: its kept picture shows the page as it was, so it is deleted FIRST and
   * then captured again, so a picture that cannot be made leaves the placeholder rather than the old one (ADR-0164).
   * Never throws, as {@link capture}.
   */
  retake(docId: DocId, path: string): Promise<void>;
  /** The kept picture of a listed path, or `null` — always `null` while the setting is off. */
  read(path: string): Uint8Array<ArrayBuffer> | null;
  /** Deletes the pictures of entries that left the list. */
  drop(paths: readonly string[]): void;
  /** The settings were written: with the setting off, every picture is deleted now. */
  settingsWritten(): void;
}

/** The directory's own file names end in this; anything else there is not ours and is left alone. */
const SUFFIX = '.jpg';

/**
 * A picture's file name: the SHA-256 of its entry's path, so the file names say nothing about the files
 * they picture — the chat history's key, for the same reason (ADR-0093). Exported for the cases.
 */
export function pictureName(path: string): string {
  return `${createHash('sha256').update(path, 'utf8').digest('hex')}${SUFFIX}`;
}

/**
 * The recent list's pictures of first pages (ADR-0100).
 *
 * ## A picture is made from a document already open, and never from a file on disk
 *
 * `capture` runs after the engine session a person's own open created, through `picture` — the host's
 * page image, in the document's lane. Nothing here parses a file to draw a menu.
 *
 * ## It never outlives its entry, including one that left while it was being made
 *
 * The recent store tells {@link RecentPictures.drop} every path that leaves. A capture still drawing when
 * its entry left would write a picture nobody deletes, so `capture` asks `listed` AFTER the picture is made
 * and keeps it only for a path still on the list.
 *
 * ## The setting is read at the moment it matters
 *
 * Before a capture, before a read, and after every settings write — which is when *off* deletes them all.
 */
export function createRecentPictures(deps: {
  readonly files: PictureFiles;
  /**
   * Page 1 of an open document as a JPEG: `DocumentCommands.firstPagePicture`. `none` for a document that keeps no
   * picture — a file that opens only with a password — whose kept picture is then deleted.
   */
  readonly picture: (docId: DocId) => Promise<Uint8Array | 'none'>;
  /** Whether the Privacy setting allows pictures, read from the settings file each time. */
  readonly enabled: () => boolean;
  /** Whether a path is on the recent list now. */
  readonly listed: (path: string) => boolean;
  /**
   * Where a picture that was not kept is reported: the shell log. The detail is a system error's CODE, an
   * error's NAME or a byte count — never a message, which may carry the path this module exists to keep off
   * the page.
   */
  readonly notKept: (reason: 'too-large' | 'failed', detail: string) => void;
}): RecentPictures {
  const dropAll = (): void => {
    for (const name of deps.files.names()) if (name.endsWith(SUFFIX)) deps.files.remove(name);
  };
  const pictures: RecentPictures = {
    retake: async (docId, path) => {
      try {
        deps.files.remove(pictureName(path));
      } catch (cause) {
        // THE OLD PICTURE COULD NOT BE DELETED, so nothing is drawn over it either: a write would meet the same
        // refusal, and the log says which. Reported, never thrown, for `capture`'s reason.
        deps.notKept('failed', errorCode(cause));
        return;
      }
      await pictures.capture(docId, path);
    },
    capture: async (docId, path) => {
      if (!deps.enabled()) return;
      let jpeg: Uint8Array | 'none';
      try {
        jpeg = await deps.picture(docId);
      } catch (cause) {
        // AN OUTCOME, not a fault this build can repair: a poisoned document, a host that died, a page that
        // draws nothing. The card shows the placeholder, which is what a failed picture means to a person,
        // and the log says which of those it was.
        deps.notKept('failed', errorCode(cause));
        return;
      }
      // A DOCUMENT THAT KEEPS NO PICTURE loses the one it had, where a failed picture keeps it: a file protected since its
      // picture was taken, here or by another program, must not go on showing its page (CR-DOC-11).
      if (jpeg === 'none') {
        try {
          deps.files.remove(pictureName(path));
        } catch (cause) {
          deps.notKept('failed', errorCode(cause));
        }
        return;
      }
      if (jpeg.length > MAX_RECENT_PREVIEW_BYTES) {
        deps.notKept('too-large', String(jpeg.length));
        return;
      }
      // CHECKED AGAIN AFTER THE AWAIT: the entry may have been cleared, or the setting turned off, while the
      // page was drawing — and a picture written then is one nothing would ever delete.
      if (!deps.enabled() || !deps.listed(path)) return;
      // A WRITE THAT FAILS IS REPORTED HERE TOO (CR-COR-02): a full disk or a locked folder, and the card shows the
      // placeholder. The caller does not await a capture and is told it reports its own failure, so a throw from here
      // was a rejection nothing handled.
      try {
        deps.files.write(pictureName(path), jpeg);
      } catch (cause) {
        deps.notKept('failed', errorCode(cause));
      }
    },
    read: (path) => (deps.enabled() ? deps.files.read(pictureName(path)) : null),
    drop: (paths) => {
      for (const path of paths) deps.files.remove(pictureName(path));
    },
    settingsWritten: () => {
      if (!deps.enabled()) dropAll();
    },
  };
  return pictures;
}

/** What a failure is called in the log: a system error's code (`ENOSPC`), else its name. Never its message. */
function errorCode(cause: unknown): string {
  if (!(cause instanceof Error)) return typeof cause;
  const { code } = cause as NodeJS.ErrnoException;
  return typeof code === 'string' ? code : cause.name;
}

/**
 * Pictures that are never made: what a graph with no folder to keep them in is given — the composition
 * root's position when `entry.ts` passed none, and a handler graph built for some OTHER channel — so it
 * neither draws a page nor needs a document service that can. Every card it answers for shows the placeholder.
 */
export const NO_RECENT_PICTURES: RecentPictures = {
  capture: () => Promise.resolve(),
  retake: () => Promise.resolve(),
  read: () => null,
  drop: () => undefined,
  settingsWritten: () => undefined,
};

/** The pictures' directory on disk, created on the first write. */
export function pictureDirectory(directory: string): PictureFiles {
  return {
    write: (name, bytes) => {
      mkdirSync(directory, { recursive: true });
      const target = join(directory, name);
      const writing = `${target}.writing`;
      writeFileSync(writing, bytes);
      replaceWithRetry(writing, target);
    },
    read: (name) => {
      try {
        return new Uint8Array(readFileSync(join(directory, name)));
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw cause;
      }
    },
    remove: (name) => {
      rmSync(join(directory, name), { force: true });
    },
    names: () => {
      try {
        return readdirSync(directory);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw cause;
      }
    },
  };
}
