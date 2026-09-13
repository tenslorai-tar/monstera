import { ComposeRefused } from './composeLayout.js';

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
 * ## What is strict, and what is not
 *
 * - A quote is legal only as the first character of a field. A quote anywhere else
 *   in an unquoted field, text after a closing quote, and a quoted field never
 *   closed are refused as `malformed-csv`, naming the line — a leading space before
 *   a quote included, because RFC 4180 makes spaces part of a field.
 * - Records end at CRLF, LF or CR. RFC 4180 says CRLF; a file saved on another system
 *   is still that file, and the three cannot be confused with a field's content.
 * - A physically empty line is no record, and a trailing line break adds none. A line
 *   holding only `,` is a record of two empty fields.
 * - The delimiter is a comma, and nothing is sniffed.
 *
 * ## Linear
 *
 * One pass over the text with one character of lookahead, so a crafted file costs
 * its length and nothing more.
 */

/** One CSV record: its fields, and the one-based line it begins on. */
export interface CsvRecord {
  readonly cells: readonly string[];
  readonly line: number;
}

function malformed(line: number, what: string): ComposeRefused {
  return new ComposeRefused('malformed-csv', line, `line ${String(line)} has ${what}`);
}

/**
 * The records in a CSV text.
 *
 * @throws ComposeRefused `malformed-csv` for a record RFC 4180 does not allow
 */
export function readCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
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

    if (field !== '') throw malformed(line, 'a quote inside an unquoted field');

    const opened = line;
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
    if (!closed) throw malformed(opened, 'a quoted field that is never closed');

    const next = text.charAt(at);
    if (next !== '' && next !== ',' && next !== '\r' && next !== '\n') {
      throw malformed(line, 'text after a closing quote');
    }
  }

  finishRecord();
  return records;
}
