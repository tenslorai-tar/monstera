import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '../registries/commands.js';
import { CONVERT_SCAN_TARGETS, convertScanCommand } from './convertScan.js';

/**
 * Convert scan goes to the REGISTERED command each outcome names, with the context it was given — and to none when the
 * dialog is dismissed. Every case asserts a CALL.
 */

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: asDocId('doc-1'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 1,
  pageCount: 3,
  openDocuments: [{ docId: asDocId('doc-1'), version: asDocVersion(1), byteLength: 20, name: 'scan.pdf' }],
};

function run(answer: unknown): { readonly ran: { id: string; context: CommandContext }[]; readonly asked: string[] } {
  const ran: { id: string; context: CommandContext }[] = [];
  const asked: string[] = [];
  void convertScanCommand({
    ask: (id) => {
      asked.push(id);
      return Promise.resolve(answer);
    },
    runCommand: (id, context) => {
      ran.push({ id, context });
    },
  }).run(CONTEXT);
  return { ran, asked };
}

describe('convertScanCommand', () => {
  for (const [outcome, target] of Object.entries(CONVERT_SCAN_TARGETS)) {
    it(`${outcome} goes to ${target}, with this command's own context`, async () => {
      const { ran, asked } = run({ outcome });
      await Promise.resolve();
      await Promise.resolve();
      expect(asked).toStrictEqual(['dialog.convert-scan']);
      expect(ran).toStrictEqual([{ id: target, context: CONTEXT }]);
    });
  }

  it('CONTROL: a dismissed dialog, and an answer the schema does not accept, run NOTHING', async () => {
    for (const answer of [undefined, { outcome: 'pdf' }, 'word']) {
      const { ran } = run(answer);
      await Promise.resolve();
      await Promise.resolve();
      expect(ran).toStrictEqual([]);
    }
  });

  // THAT EVERY TARGET IS REGISTERED is asserted where the registry is built, in App.test.tsx's checklist case.
});
