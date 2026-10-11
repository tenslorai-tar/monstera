import { describe, expect, it } from 'vitest';

import { readCsv } from './csvRead.js';

/** How long the crafted-input case may take — its claim that reading is linear, in milliseconds. */
const LINEAR_BOUND_MS = 10_000;

/** The records alone, for the cases about reading what is well formed. @param text the CSV */
const recordsOf = (text: string) => readCsv(text).records;

describe('readCsv', () => {
  it('reads fields and records, each with the line it begins on, and leaves nothing out of a well-formed file', () => {
    expect(readCsv('name,qty\nApples,3\nPears,12\n')).toStrictEqual({
      records: [
        { cells: ['name', 'qty'], line: 1 },
        { cells: ['Apples', '3'], line: 2 },
        { cells: ['Pears', '12'], line: 3 },
      ],
      skipped: [],
    });
  });

  it('reads a quoted comma, an escaped quote and a line break inside quotes', () => {
    expect(recordsOf('a,b\n"one, two","say ""hi"""\n"first\nsecond",x\nlast,y\n')).toStrictEqual([
      { cells: ['a', 'b'], line: 1 },
      { cells: ['one, two', 'say "hi"'], line: 2 },
      { cells: ['first\nsecond', 'x'], line: 3 },
      // THE LINE AFTER A MULTI-LINE FIELD is 5, not 4. A reader that counted records
      // instead of physical lines would name the wrong line in every later skip.
      { cells: ['last', 'y'], line: 5 },
    ]);
  });

  it('ends records at CRLF, LF or CR alike', () => {
    const expected = [
      { cells: ['a', 'b'], line: 1 },
      { cells: ['c', 'd'], line: 2 },
    ];
    expect(recordsOf('a,b\r\nc,d\r\n')).toStrictEqual(expected);
    expect(recordsOf('a,b\nc,d\n')).toStrictEqual(expected);
    expect(recordsOf('a,b\rc,d\r')).toStrictEqual(expected);
  });

  it('skips an empty line and a trailing break — CONTROL: a comma or a quoted empty field is a record', () => {
    expect(recordsOf('a\n\n\nb\n')).toStrictEqual([
      { cells: ['a'], line: 1 },
      { cells: ['b'], line: 4 },
    ]);
    expect(recordsOf(',\n""\n')).toStrictEqual([
      { cells: ['', ''], line: 1 },
      { cells: [''], line: 2 },
    ]);
  });

  it('SKIPS a quoted field never closed as the line it OPENED on, and reads the lines it would have swallowed', () => {
    // NOT THE WHOLE FILE (Codex's importer audit): the records before and after it are read.
    expect(readCsv('a,b\nc,"open\nstill,here\nlast,one\n')).toStrictEqual({
      records: [
        { cells: ['a', 'b'], line: 1 },
        { cells: ['still', 'here'], line: 3 },
        { cells: ['last', 'one'], line: 4 },
      ],
      skipped: [{ line: 2, what: 'quote-never-closed' }],
    });
  });

  it('SKIPS text after a closing quote and a quote inside an unquoted field, naming each line, and reads the rest', () => {
    expect(readCsv('a,"b"c\nfine,row\n')).toStrictEqual({
      records: [{ cells: ['fine', 'row'], line: 2 }],
      skipped: [{ line: 1, what: 'text-after-quote' }],
    });
    expect(readCsv('ok\nab"c,d\nnext\n')).toStrictEqual({
      records: [
        { cells: ['ok'], line: 1 },
        { cells: ['next'], line: 3 },
      ],
      skipped: [{ line: 2, what: 'quote-inside-field' }],
    });
    // A LEADING SPACE makes the quote part of an unquoted field, per RFC 4180.
    expect(readCsv('a, "b"\n').skipped).toStrictEqual([{ line: 1, what: 'quote-inside-field' }]);
  });

  it('CONTROL: a skipped record after a multi-line field is named by its PHYSICAL line', () => {
    expect(readCsv('"one\ntwo",x\nbad"q\n').skipped).toStrictEqual([{ line: 3, what: 'quote-inside-field' }]);
  });

  it(
    'reads a four-mebibyte quoted field, and skips an unclosed one of that size, in bounded time',
    () => {
      // LINEAR, asserted on the shapes a crafted file would use: one enormous field,
      // and the same field left open so the reader runs to the end looking for a quote.
      const big = 'x'.repeat(4 * 1024 * 1024);
      const started = performance.now();
      expect(recordsOf(`"${big}"\n`)[0]?.cells[0]?.length).toBe(big.length);
      expect(readCsv(`"${big}\n`).skipped).toStrictEqual([{ line: 1, what: 'quote-never-closed' }]);
      expect(performance.now() - started).toBeLessThan(LINEAR_BOUND_MS);
    },
    // THE CASE'S OWN BOUND DECIDES, not the runner's. Vitest's default limit is 5 s, below this case's 10 s claim,
    // so under a full suite's load the runner killed it before its own measurement could pass or fail (the pre-push
    // run of 2026-09-26: "Test timed out in 5000ms"; alone it takes under 2 s).
    LINEAR_BOUND_MS * 2,
  );
});
