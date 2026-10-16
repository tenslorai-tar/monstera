import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { applyDocumentCommand } from './documentCommands.js';
import { READS_THE_DOCUMENT_OUT, inWriteOrder } from './orderedClient.js';

/**
 * A read that writes a document out is sent only after the commands already sent for that document are answered
 * (`orderedClient.ts`): the marks walk's C4.1, where Save a copy pressed after Bates numbering wrote a copy without it.
 */
const DOC = asDocId('d1');
const OTHER = asDocId('d2');

/** A transport whose command answers wait until the case releases them, recording the order calls reached main. */
function held(): { readonly client: ContractClient; readonly reached: string[]; readonly release: () => void } {
  const reached: string[] = [];
  let release = (): void => undefined;
  const gate = new Promise<void>((settle) => {
    release = settle;
  });
  const client = createClient(channels, async (id, params) => {
    const docId = (params as { readonly docId?: string }).docId ?? '';
    reached.push(`${id} ${docId}`);
    if (id === 'document.execute') {
      await gate;
      reached.push(`answered ${docId}`);
      // A REFUSAL IS AN ANSWER: the lane moves on either way, and this case asks only about order.
      return err({ code: 'document-busy' });
    }
    return ok({ kind: 'cancelled' });
  });
  return { client, reached, release };
}

const deps = (client: ContractClient) => ({
  client,
  onApplied: () => undefined,
  ask: () => Promise.resolve(undefined),
  stamp: () => ({ author: '', created: '2026-10-16T00:00:00.000Z' }),
  signatures: { warn: () => true, onOpened: () => undefined },
  toast: () => undefined,
});

describe('inWriteOrder', () => {
  it('sends a save copy only once the command already sent for that document is answered', async () => {
    const { client, reached, release } = held();
    const ordered = inWriteOrder(client);
    const command = applyDocumentCommand(deps(ordered), DOC, { kind: 'rotatePages', pages: [0], degrees: 90 });
    const copy = ordered['document.saveCopy']({ docId: DOC });
    await Promise.resolve();
    await Promise.resolve();
    expect(reached).toStrictEqual(['document.execute d1']);
    release();
    await command;
    await copy;
    expect(reached).toStrictEqual(['document.execute d1', 'answered d1', 'document.saveCopy d1']);
  });

  it('another document’s copy does not wait for this one’s command', async () => {
    const { client, reached, release } = held();
    const ordered = inWriteOrder(client);
    const command = applyDocumentCommand(deps(ordered), DOC, { kind: 'rotatePages', pages: [0], degrees: 90 });
    await ordered['document.saveCopy']({ docId: OTHER });
    expect(reached).toStrictEqual(['document.execute d1', 'document.saveCopy d2']);
    release();
    await command;
  });

  it('CONTROL: through the client it was given, the copy overtakes the command, which is the copy C4.1 saved', async () => {
    const { client, reached, release } = held();
    const command = applyDocumentCommand(deps(client), DOC, { kind: 'rotatePages', pages: [0], degrees: 90 });
    await client['document.saveCopy']({ docId: DOC });
    // SENT BEFORE THE COMMAND WAS ANSWERED — here before it was even sent, since the lane starts it a turn later.
    expect(reached).toContain('document.saveCopy d1');
    expect(reached).not.toContain('answered d1');
    release();
    await command;
  });

  it('every channel whose name says it saves, exports, prints, emails or optimises a document is ordered', () => {
    const named = Object.keys(channels).filter((id) => /^document\.(?:save(?!Barcode)|export|print|email|optimize)/u.test(id));
    expect(named.length).toBeGreaterThan(10);
    expect(named.filter((id) => !(READS_THE_DOCUMENT_OUT as readonly string[]).includes(id))).toStrictEqual([]);
  });
});
