import { readCsv } from './csvRead.js';

/**
 * Where a large CSV file is cut into parts that are each composed on their own and joined (the owner's O10: a CSV over
 * the one-part bound was refused, *Nothing was imported*).
 *
 * ## The cut is at a RECORD's first line, as the one reader reads records
 *
 * `readCsv` is the one answer to where a record begins (B3a): a quoted field may hold a line break, and a quote never
 * closed is skipped as the one line it opened on. A second scanner of the bytes would agree with it on every ordinary file
 * and differ on exactly those, so the parts are cut at the lines `readCsv` reports records starting on, and a part is the
 * bytes from one such line to another. A record the reader skips lies inside a part, where the part's own reading skips it
 * again and names it.
 *
 * ## The first record goes in front of every part
 *
 * The composer sets the first record of its source as the table's header (`csvCompose.ts`), so each part is composed from
 * the header's bytes and its own, and every part's table carries the header as one composition would.
 *
 * Runs in the COMPOSE HOST: reading records is parsing (ADR-0060).
 */

/** A stretch of the file's bytes, `from` included and `to` not. */
export interface ByteRange {
  readonly from: number;
  readonly to: number;
}

/** How a file is cut: its header's bytes, and each part's bytes with the source line it begins on. */
export interface CsvSplit {
  /** The first record's lines, or `null` for a file with no record. */
  readonly header: (ByteRange & { readonly lines: number }) | null;
  readonly parts: readonly (ByteRange & { readonly line: number })[];
}

/** The byte offset each one-based physical line begins at, by the reader's line-break rule: CRLF, LF or CR. */
function lineStarts(bytes: Uint8Array): number[] {
  const starts = [0];
  for (let at = 0; at < bytes.length; at += 1) {
    const byte = bytes[at];
    if (byte === 0x0a) starts.push(at + 1);
    else if (byte === 0x0d) {
      if (bytes[at + 1] === 0x0a) {
        starts.push(at + 2);
        at += 1;
      } else starts.push(at + 1);
    }
  }
  return starts;
}

/**
 * Cuts `bytes` into parts of at most `maxBytes` each, besides the header, at record starts. A single record longer than
 * that is a part of its own: it is the file's, and it is composed whole.
 *
 * @param text the file decoded as UTF-8, which the caller has already refused where it is not
 */
export function splitCsv(bytes: Uint8Array, text: string, maxBytes: number): CsvSplit {
  const { records } = readCsv(text);
  const starts = lineStarts(bytes);
  const at = (line: number): number => starts[line - 1] ?? bytes.length;
  const first = records[0];
  if (first === undefined) return { header: null, parts: [] };
  const second = records[1];
  const headerEnd = second === undefined ? bytes.length : at(second.line);
  const header = { from: at(first.line), to: headerEnd, lines: (second?.line ?? starts.length) - first.line };
  // EACH PART'S OWN ROOM: the bound less the header it is composed with.
  const room = maxBytes - (header.to - header.from);
  const parts: (ByteRange & { line: number })[] = [];
  let open: { from: number; line: number } | undefined;
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined) continue;
    const begins = at(record.line);
    const next = records[index + 1];
    const ends = next === undefined ? bytes.length : at(next.line);
    // CLOSED BEFORE THE RECORD THAT WOULD CARRY IT PAST ITS ROOM; a part always holds at least one record.
    if (open !== undefined && ends - open.from > room) {
      parts.push({ from: open.from, to: begins, line: open.line });
      open = undefined;
    }
    open ??= { from: begins, line: record.line };
  }
  if (open !== undefined) parts.push({ from: open.from, to: bytes.length, line: open.line });
  return { header, parts };
}
