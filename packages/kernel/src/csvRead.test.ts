import { describe, expect, it } from 'vitest';

import { ComposeRefused } from './composeLayout.js';
import { readCsv } from './csvRead.js';

/** How long the crafted-input case may take — its claim that reading is linear, in milliseconds. */
const LINEAR_BOUND_MS = 10_000;

describe('readCsv', () => {
  it('reads fields and records, each with the line it begins on', () => {
    expect(readCsv('name,qty\nApples,3\nPears,12\n')).toStrictEqual([
      { cells: ['name', 'qty'], line: 1 },
      { cells: ['Apples', '3'], line: 2 },
      { cells: ['Pears', '12'], line: 3 },
    ]);
  });

  it('reads a quoted comma, an escaped quote and a line break inside quotes', () => {
    const records = readCsv('a,b\n"one, two","say ""hi"""\n"first\nsecond",x\nlast,y\n');
    expect(records).toStrictEqual([
      { cells: ['a', 'b'], line: 1 },
      { cells: ['one, two', 'say "hi"'], line: 2 },
      { cells: ['first\nsecond', 'x'], line: 3 },
      // THE LINE AFTER A MULTI-LINE FIELD is 5, not 4. A reader that counted records
      // instead of physical lines would name the wrong line in every later refusal.
      { cells: ['last', 'y'], line: 5 },
    ]);
  });

  it('ends records at CRLF, LF or CR alike', () => {
    const expected = [
      { cells: ['a', 'b'], line: 1 },
      { cells: ['c', 'd'], line: 2 },
    ];
    expect(readCsv('a,b\r\nc,d\r\n')).toStrictEqual(expected);
    expect(readCsv('a,b\nc,d\n')).toStrictEqual(expected);
    expect(readCsv('a,b\rc,d\r')).toStrictEqual(expected);
  });

  it('skips an empty line and a trailing break — CONTROL: a comma or a quoted empty field is a record', () => {
    expect(readCsv('a\n\n\nb\n')).toStrictEqual([
      { cells: ['a'], line: 1 },
      { cells: ['b'], line: 4 },
    ]);
    expect(readCsv(',\n""\n')).toStrictEqual([
      { cells: ['', ''], line: 1 },
      { cells: [''], line: 2 },
    ]);
  });

  it('refuses a quoted field that is never closed, naming the line it OPENED on', () => {
    let thrown: unknown;
    try {
      readCsv('a,b\nc,"open\nstill open\n');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ComposeRefused);
    expect(thrown).toMatchObject({ reason: 'malformed-csv', line: 2 });
  });

  it('refuses text after a closing quote, and a quote inside an unquoted field', () => {
    expect(() => readCsv('a,"b"c\n')).toThrow(ComposeRefused);
    expect(() => readCsv('a,"b"c\n')).toThrow(/line 1/u);
    expect(() => readCsv('ok\nab"c,d\n')).toThrow(/line 2 has a quote inside an unquoted field/u);
    // A LEADING SPACE makes the quote part of an unquoted field, per RFC 4180.
    expect(() => readCsv('a, "b"\n')).toThrow(/quote inside an unquoted field/u);
  });

  it(
    'reads a four-mebibyte quoted field, and refuses an unclosed one of that size, in bounded time',
    () => {
      // LINEAR, asserted on the shapes a crafted file would use: one enormous field,
      // and the same field left open so the reader runs to the end looking for a quote.
      const big = 'x'.repeat(4 * 1024 * 1024);
      const started = performance.now();
      expect(readCsv(`"${big}"\n`)[0]?.cells[0]?.length).toBe(big.length);
      expect(() => readCsv(`"${big}\n`)).toThrow(/never closed/u);
      expect(performance.now() - started).toBeLessThan(LINEAR_BOUND_MS);
    },
    // THE CASE'S OWN BOUND DECIDES, not the runner's. Vitest's default limit is 5 s, below this case's 10 s claim,
    // so under a full suite's load the runner killed it before its own measurement could pass or fail (the pre-push
    // run of 2026-09-26: "Test timed out in 5000ms"; alone it takes under 2 s).
    LINEAR_BOUND_MS * 2,
  );
});
