import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DIAGNOSTIC_HEAD_BYTES, readDiagnosticHead } from './diagnosticHead.js';

const scratch = mkdtempSync(join(tmpdir(), 'monstera-diagnostic-head-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function aLog(name: string, text: string): string {
  const path = join(scratch, name);
  writeFileSync(path, text, 'utf8');
  return path;
}

describe('a contained program\'s diagnostic log is read to its head and no further (CR-SEC-12)', () => {
  it('reads a log within the bound whole, as the program wrote it', () => {
    const said = 'Error: Cannot find module \'hostEntry.js\'\n    at Module._resolveFilename';
    expect(readDiagnosticHead(aLog('short.log', `${said}\n`))).toBe(said);
  });

  it('reads only the head of a log past the bound, and says how much it did not read', () => {
    // THE HEAD IS DISTINCT FROM THE TAIL, so a reader that read the whole file and cut the end would still show the
    // tail's marker somewhere in a result this size, and one that read the end would show no head.
    const head = 'Error: the runtime could not read its ICU data\n';
    const tail = 'TAIL-THAT-MUST-NOT-BE-READ';
    const filler = 'x'.repeat(DIAGNOSTIC_HEAD_BYTES * 4);
    const path = aLog('long.log', `${head}${filler}${tail}`);
    const size = Buffer.byteLength(`${head}${filler}${tail}`, 'utf8');

    const read = readDiagnosticHead(path);

    expect(read?.startsWith(head.trim())).toBe(true);
    expect(read).not.toContain(tail);
    expect(read).toContain(`the first ${String(DIAGNOSTIC_HEAD_BYTES)} of its ${String(size)} bytes`);
    // THE BOUND ON WHAT REACHES A FAILURE'S DETAIL: the head plus the one sentence saying it is a head.
    expect(read?.length).toBeLessThan(DIAGNOSTIC_HEAD_BYTES + 100);
  });

  it('answers null for a log that is absent or holds only whitespace', () => {
    expect(readDiagnosticHead(join(scratch, 'never-written.log'))).toBeNull();
    expect(readDiagnosticHead(aLog('blank.log', '\n  \n'))).toBeNull();
  });

  it('CONTROL: a log of exactly the bound is whole, and one byte more is a head', () => {
    const exact = 'y'.repeat(64);
    expect(readDiagnosticHead(aLog('exact.log', exact), 64)).toBe(exact);
    expect(readDiagnosticHead(aLog('over.log', `${exact}z`), 64)).toBe(
      `${exact} … (the first 64 of its 65 bytes; the rest was not read)`,
    );
  });
});
