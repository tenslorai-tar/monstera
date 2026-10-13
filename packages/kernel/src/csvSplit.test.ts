import { describe, expect, it } from 'vitest';

import { readCsv } from './csvRead.js';
import { splitCsv } from './csvSplit.js';

/**
 * A large CSV cut into parts at record starts, as the one reader reads records (the owner's O10). The property that
 * matters is that the parts, each read with the header in front, give back EXACTLY the file's records in order — no record
 * cut in two, none lost, none twice — so every case reads the parts back through `readCsv` and compares.
 *
 * The CONTROL is a quoted field holding a line break across a cut point: a splitter that cut at line breaks would split
 * that record in two, and the comparison would fail.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The file's records, and the parts' records read the way each part is composed: header first. */
function roundTrip(text: string, maxBytes: number): { whole: string[][]; parts: string[][]; count: number; headerOnce: boolean } {
  const bytes = encoder.encode(text);
  const split = splitCsv(bytes, text, maxBytes);
  const whole = readCsv(text).records.map((record) => [...record.cells]);
  if (split.header === null) return { whole, parts: [], count: 0, headerOnce: true };
  const header = decoder.decode(bytes.subarray(split.header.from, split.header.to));
  const parts: string[][] = [];
  let headerOnce = true;
  parts.push(...readCsv(header).records.map((record) => [...record.cells]));
  for (const part of split.parts) {
    const records = readCsv(header + decoder.decode(bytes.subarray(part.from, part.to))).records;
    // THE HEADER IS EACH PART'S FIRST RECORD, and only its first.
    if (JSON.stringify(records[0]?.cells) !== JSON.stringify(whole[0])) headerOnce = false;
    parts.push(...records.slice(1).map((record) => [...record.cells]));
  }
  return { whole, parts, count: split.parts.length, headerOnce };
}

describe('splitCsv', () => {
  const rows = (count: number): string => Array.from({ length: count }, (_unused, at) => `${String(at)},item ${String(at)},${String(at * 3)}`).join('\n');

  it('cuts a file into several parts that read back as exactly its records, the header in front of each', () => {
    const text = `id,name,total\n${rows(500)}\n`;
    const read = roundTrip(text, 1024);
    expect(read.count).toBeGreaterThan(5);
    expect(read.parts).toStrictEqual(read.whole);
    expect(read.headerOnce).toBe(true);
  });

  it('CONTROL: a quoted field holding line breaks is never cut, wherever the bound falls', () => {
    const quoted = Array.from({ length: 60 }, (_unused, at) => `${String(at)},"line one\nline two\r\nline three",x`).join('\r\n');
    for (const bound of [40, 64, 100, 257]) {
      const read = roundTrip(`a,b,c\r\n${quoted}\r\n`, bound);
      expect(read.parts, `bound ${String(bound)}`).toStrictEqual(read.whole);
    }
  });

  it('a quote never closed is the reader’s skip inside one part, and the lines after it are records in the parts', () => {
    const text = `a,b\n1,2\n3,"open\n5,6\n7,8\n9,10\n`;
    const read = roundTrip(text, 14);
    expect(read.parts).toStrictEqual(read.whole);
  });

  it('CR line ends, an empty line and no final break read back the same', () => {
    const text = `a,b\r1,2\r\r3,4\r5,6`;
    const read = roundTrip(text, 8);
    expect(read.parts).toStrictEqual(read.whole);
    expect(read.count).toBeGreaterThan(1);
  });

  it('a record longer than the bound is a part of its own, whole', () => {
    const long = 'x'.repeat(5000);
    const read = roundTrip(`a,b\n1,${long}\n2,y\n`, 100);
    expect(read.parts).toStrictEqual(read.whole);
  });

  it('a file of one record has the header and no part; an empty file has neither', () => {
    expect(splitCsv(encoder.encode('a,b\n'), 'a,b\n', 100)).toStrictEqual({ header: { from: 0, to: 4, lines: 1 }, parts: [] });
    expect(splitCsv(new Uint8Array(0), '', 100)).toStrictEqual({ header: null, parts: [] });
  });

  it('a part’s line is the source line its first record begins on', () => {
    const text = `h\n1\n2\n3\n4\n`;
    const split = splitCsv(encoder.encode(text), text, 4);
    expect(split.parts.map((part) => part.line)).toStrictEqual([2, 3, 4, 5]);
  });
});
