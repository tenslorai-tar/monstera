import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/**
 * How much of a contained program's stderr log main reads.
 *
 * A DECISION, not a measurement (CR-SEC-12). The log is the one file a contained host or converter writes that main
 * read with no byte bound: a program that printed gigabytes before failing made main allocate all of it, then quote it
 * into a failure's detail. What a reader of that detail needs is the head, where a runtime that could not start says
 * why: a module it could not resolve, a file its token could not read. A Node stack trace for that is a few kilobytes,
 * and four times that leaves room for the lines before it.
 */
export const DIAGNOSTIC_HEAD_BYTES = 16 * 1024;

/**
 * The head of a contained program's diagnostic log, at most {@link DIAGNOSTIC_HEAD_BYTES}, saying so when there was
 * more.
 *
 * The length is read from the open file, then at most that many bytes from its start, so a log still growing while
 * this reads is cut at what it held when it was opened rather than read to wherever the writer has got to.
 *
 * @returns the text, or `null` when the file is absent, empty or cannot be read: what the program said is a
 *   diagnostic beside a failure that is reported anyway, never a second failure of its own.
 */
export function readDiagnosticHead(path: string, limit: number = DIAGNOSTIC_HEAD_BYTES): string | null {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  try {
    const size = fstatSync(fd).size;
    const head = new Uint8Array(Math.min(size, limit));
    let filled = 0;
    while (filled < head.byteLength) {
      const read = readSync(fd, head, filled, head.byteLength - filled, filled);
      if (read === 0) break;
      filled += read;
    }
    const text = new TextDecoder().decode(head.subarray(0, filled)).trim();
    if (text.length === 0) return null;
    return size > limit
      ? `${text} … (the first ${String(limit)} of its ${String(size)} bytes; the rest was not read)`
      : text;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
