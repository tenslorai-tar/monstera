/**
 * A strict RFC 4180 reader, for a CSV file picked for import
 * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## It runs in the COMPOSE HOST, and a reader is written here rather than taken
 *
 * The file's bytes were chosen by whoever produced it (threat model §1.9). RFC 4180's
 * grammar is flat and fixed — fields, commas, record breaks, and a quoted field with
 * `""` as its one escape — with nothing to nest and no entity to expand. That is
 * ADR-0046's argument for a strict XFDF reader, which transfers: a general parser's
 * value is dialects, delimiter sniffing and type coercion, and every one of those is
 * a behaviour this import does not want. No CSV library was measured, because a
 * download needs the owner's say; the reader carries its refusals as cases instead.
 *
 * ## What is strict, and what a record that breaks it costs
 *
 * - A quote is legal only as the first character of a field. A quote anywhere else
 *   in an unquoted field, text after a closing quote, and a quoted field never
 *   closed are each a record RFC 4180 does not allow — a leading space before a quote
 *   included, because RFC 4180 makes spaces part of a field.
 * - **Such a record is SKIPPED AND NAMED, never the whole file refused** (Codex's
 *   importer audit, the owner's *a user is never refused because of their document*):
 *   the reader answers it in `skipped` with its line and what was wrong, and goes on
 *   at the next line. A quoted field never closed would otherwise swallow every line
 *   after it, so it is skipped as the one line it opened on and the reading resumes
 *   on the line after: the lines it swallowed are read as the records they look like.
 * - Records end at CRLF, LF or CR. RFC 4180 says CRLF; a file saved on another system
 *   is still that file, and the three cannot be confused with a field's content.
 * - A physically empty line is no record, and a trailing line break adds none. A line
 *   holding only `,` is a record of two empty fields.
 * - The delimiter is a comma, and nothing is sniffed.
 *
 * ## Linear
 *
 * One pass over the text with one character of lookahead; a resume after an unclosed
 * quote re-reads the lines that quote swallowed once, so a crafted file costs at most
 * twice its length.
 */

/** One CSV record: its fields, and the one-based line it begins on. */
export interface CsvRecord {
  readonly cells: readonly string[];
  readonly line: number;
}

/** A record the reader left out: the one-based line it begins on, and what RFC 4180 does not allow in it. */
export interface CsvSkipped {
  readonly line: number;
  readonly what: CsvFault;
}

/** What a record that breaks RFC 4180 has wrong. */
export type CsvFault = 'quote-inside-field' | 'text-after-quote' | 'quote-never-closed';

/** What a CSV text holds: the records it reads, and those it left out. */
export interface CsvRead {
  readonly records: readonly CsvRecord[];
  readonly skipped: readonly CsvSkipped[];
}

/** The index just past the line break that ends the physical line `at` is on, or the text's end. */
function nextLineStart(text: string, at: number): number {
  let index = at;
  while (index < text.length && text.charAt(index) !== '\r' && text.charAt(index) !== '\n') index += 1;
  if (index >= text.length) return text.length;
  return text.charAt(index) === '\r' && text.charAt(index + 1) === '\n' ? index + 2 : index + 1;
}

/** The records in a CSV text, and every record it left out with why. */
export function readCsv(text: string): CsvRead {
  const records: CsvRecord[] = [];
  const skipped: CsvSkipped[] = [];
  let cells: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  // WHETHER THIS RECORD HAS ANY CHARACTER AT ALL. An empty line has none and is
  // skipped; a line of `""` has one empty field and is a record.
  let touched = false;
  let at = 0;

  const finishRecord = (): void => {
    if (touched) {
      cells.push(field);
      records.push({ cells, line: recordLine });
    }
    cells = [];
    field = '';
    touched = false;
  };
  /** Leaves the record begun at `recordLine` out, and goes on at the start of the physical line after `from`. */
  const skipRecord = (what: CsvFault, from: number, resumeLine: number): void => {
    skipped.push({ line: recordLine, what });
    cells = [];
    field = '';
    touched = false;
    at = nextLineStart(text, from);
    line = at >= text.length ? resumeLine : resumeLine + 1;
    recordLine = line;
  };

  while (at < text.length) {
    const char = text.charAt(at);

    if (char === '\r' || char === '\n') {
      finishRecord();
      at += char === '\r' && text.charAt(at + 1) === '\n' ? 2 : 1;
      line += 1;
      recordLine = line;
      continue;
    }

    touched = true;

    if (char === ',') {
      cells.push(field);
      field = '';
      at += 1;
      continue;
    }

    if (char !== '"') {
      field += char;
      at += 1;
      continue;
    }

    if (field !== '') {
      skipRecord('quote-inside-field', at, line);
      continue;
    }

    const opened = line;
    const openedAt = at;
    at += 1;
    let closed = false;
    while (at < text.length) {
      const inner = text.charAt(at);
      if (inner === '"') {
        if (text.charAt(at + 1) === '"') {
          field += '"';
          at += 2;
          continue;
        }
        at += 1;
        closed = true;
        break;
      }
      if (inner === '\r' || inner === '\n') {
        // A LINE BREAK INSIDE QUOTES is the field's content, and it is kept as one
        // `\n` whatever the file used. The physical line still advances, so a later
        // refusal names the line a person would find it on.
        at += inner === '\r' && text.charAt(at + 1) === '\n' ? 2 : 1;
        field += '\n';
        line += 1;
        continue;
      }
      field += inner;
      at += 1;
    }
    if (!closed) {
      // THE LINE IT OPENED ON, and no more: what it swallowed is read again as what it looks like.
      skipRecord('quote-never-closed', openedAt, opened);
      continue;
    }

    const next = text.charAt(at);
    if (next !== '' && next !== ',' && next !== '\r' && next !== '\n') skipRecord('text-after-quote', at, line);
  }

  finishRecord();
  return { records, skipped };
}
