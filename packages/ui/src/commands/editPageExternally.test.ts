import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '../registries/commands.js';
import { editPageExternallyCommand } from './editPageExternally.js';

/**
 * The UI half of D9's *Edit page in external app & reimport*: what the control sends, in
 * what order, and where each answer goes (ADR-0062).
 *
 * ## Every case asserts CALLS, and each channel answers from a QUEUE that refuses when empty
 *
 * `openFromUrl.test.ts`' reason for calls: a dismissal and a failure both leave the screen as
 * it was. The queue is what this command adds: it waits in a loop, so *the loop stopped* is
 * only observable as a call that was NOT made — and a queue that throws on an extra call turns
 * that into a failing case rather than a hang or a silent pass.
 */

const DOC = asDocId('doc-1');
const EDITED = asDocId('doc-edited');

/** A document on screen, on page 3 (zero-based), read at version 7. NOT page 0, the rotate's lesson. */
const CONTEXT: CommandContext = {
  docId: DOC,
  version: asDocVersion(7),
  hasSelection: false,
  dirty: false,
  page: 3,
  pageCount: 10,
  openDocuments: [],
};

const REIMPORTED = ok({
  kind: 'reimported',
  version: asDocVersion(8),
  byteLength: 2048,
  historyDropped: 0,
  opened: { docId: EDITED, version: asDocVersion(1), byteLength: 512, name: 'report page 4.pdf' },
});

/** A client answering each channel from its own queue, refusing any call past the queue. */
function recording(queues: Readonly<Record<string, readonly unknown[]>>): {
  readonly client: ContractClient;
  readonly sent: { id: string; params: unknown }[];
} {
  const remaining = new Map(Object.entries(queues).map(([id, answers]) => [id, [...answers]]));
  const sent: { id: string; params: unknown }[] = [];
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    const answer = remaining.get(id)?.shift();
    if (answer === undefined) throw new Error(`this case has no further answer for ${id}`);
    return Promise.resolve(answer);
  });
  return { client, sent };
}

/** Callbacks recorded in order, with the reimport question answering `reply`. */
function callbacks(reply: unknown): {
  readonly calls: { name: string; value: unknown }[];
  readonly deps: Omit<Parameters<typeof editPageExternallyCommand>[0], 'client'>;
} {
  const calls: { name: string; value: unknown }[] = [];
  const record = (name: string) => (value: unknown) => {
    calls.push({ name, value });
  };
  return {
    calls,
    deps: {
      ask: (id, props) => {
        calls.push({ name: 'ask', value: { id, props } });
        return Promise.resolve(id === 'dialog.reimport-external-edit' ? reply : undefined);
      },
      onApplied: record('applied'),
      onOpened: record('opened'),
      onActivate: record('activate'),
      stamp: () => ({ author: 'A. Tester', created: '2026-09-24T09:38:00.000Z' }),
    },
  };
}

const SEND = { id: 'document.editPageExternally', params: { docId: DOC, page: 3, version: 7 } };
const WAIT = { id: 'document.awaitExternalEdit', params: { docId: DOC } };
const REIMPORT = { id: 'document.reimportExternalEdit', params: { docId: DOC } };

describe('editPageExternallyCommand', () => {
  it('SENDS the page on screen at its version, and on a save plus YES sends exactly the reimport', async () => {
    const { client, sent } = recording({
      'document.editPageExternally': [ok({ kind: 'sent' })],
      'document.awaitExternalEdit': [ok({ kind: 'changed' }), ok({ kind: 'ended' })],
      'document.reimportExternalEdit': [REIMPORTED],
    });
    const { calls, deps } = callbacks({ reimport: true });

    await editPageExternallyCommand({ client, ...deps }).run(CONTEXT);

    expect(sent).toStrictEqual([SEND, WAIT, REIMPORT, WAIT]);
    expect(calls).toStrictEqual([
      // THE QUESTION NAMES THE PAGE SENT OUT, the zero-based index the replace uses.
      { name: 'ask', value: { id: 'dialog.reimport-external-edit', props: { page: 3 } } },
      { name: 'applied', value: { version: 8, byteLength: 2048 } },
      { name: 'opened', value: { docId: EDITED, version: 1, byteLength: 512, name: 'report page 4.pdf' } },
      { name: 'activate', value: DOC },
    ]);
  });

  it('CONTROL: a dismissed question sends NO reimport, and the next wait still goes out', async () => {
    // THE DECISION IS THE CALL NOT MADE. A command that reimported on every `changed` would
    // put the page back without asking, and leave the same calls to `ask`.
    const { client, sent } = recording({
      'document.editPageExternally': [ok({ kind: 'sent' })],
      'document.awaitExternalEdit': [ok({ kind: 'changed' }), ok({ kind: 'ended' })],
    });
    const { calls, deps } = callbacks(undefined);

    await editPageExternallyCommand({ client, ...deps }).run(CONTEXT);

    expect(sent).toStrictEqual([SEND, WAIT, WAIT]);
    expect(calls).toStrictEqual([
      { name: 'ask', value: { id: 'dialog.reimport-external-edit', props: { page: 3 } } },
    ]);
  });

  it('an UNCHANGED wait asks the person nothing and waits again', async () => {
    const { client, sent } = recording({
      'document.editPageExternally': [ok({ kind: 'sent' })],
      'document.awaitExternalEdit': [ok({ kind: 'unchanged' }), ok({ kind: 'ended' })],
    });
    const { calls, deps } = callbacks({ reimport: true });

    await editPageExternallyCommand({ client, ...deps }).run(CONTEXT);

    expect(sent).toStrictEqual([SEND, WAIT, WAIT]);
    expect(calls).toStrictEqual([]);
  });

  it('a REFUSED write opens the save problem dialog and waits for nothing', async () => {
    const { client, sent } = recording({
      'document.editPageExternally': [ok({ kind: 'refused', openElsewhere: 1 })],
    });
    const { calls, deps } = callbacks(undefined);

    await editPageExternallyCommand({ client, ...deps }).run(CONTEXT);

    expect(sent).toStrictEqual([SEND]);
    expect(calls).toStrictEqual([
      { name: 'ask', value: { id: 'dialog.save-problem', props: { outcome: 'contested' } } },
    ]);
  });

  it('a name not ending .pdf opens the external-edit problem dialog and waits for nothing', async () => {
    const { client, sent } = recording({ 'document.editPageExternally': [ok({ kind: 'not-pdf' })] });
    const { calls, deps } = callbacks(undefined);

    await editPageExternallyCommand({ client, ...deps }).run(CONTEXT);

    expect(sent).toStrictEqual([SEND]);
    expect(calls).toStrictEqual([
      { name: 'ask', value: { id: 'dialog.external-edit-problem', props: { reason: 'not-pdf' } } },
    ]);
  });

  it('a DOCUMENT THAT MOVED is told, and ENDS the loop: no further wait is sent', async () => {
    // The queue holds a second wait answer; the case fails if the command asks for it.
    const { client, sent } = recording({
      'document.editPageExternally': [ok({ kind: 'sent' })],
      'document.awaitExternalEdit': [ok({ kind: 'changed' }), ok({ kind: 'ended' })],
      'document.reimportExternalEdit': [ok({ kind: 'document-changed' })],
    });
    const { calls, deps } = callbacks({ reimport: true });

    await editPageExternallyCommand({ client, ...deps }).run(CONTEXT);

    expect(sent).toStrictEqual([SEND, WAIT, REIMPORT]);
    expect(calls.at(-1)).toStrictEqual({
      name: 'ask',
      value: { id: 'dialog.external-edit-problem', props: { reason: 'document-changed' } },
    });
  });

  it('CONTROL: a file OPEN ELSEWHERE is told, and the loop KEEPS waiting', async () => {
    const { client, sent } = recording({
      'document.editPageExternally': [ok({ kind: 'sent' })],
      'document.awaitExternalEdit': [ok({ kind: 'changed' }), ok({ kind: 'ended' })],
      'document.reimportExternalEdit': [ok({ kind: 'open-elsewhere' })],
    });
    const { calls, deps } = callbacks({ reimport: true });

    await editPageExternallyCommand({ client, ...deps }).run(CONTEXT);

    expect(sent).toStrictEqual([SEND, WAIT, REIMPORT, WAIT]);
    expect(calls.at(-1)).toStrictEqual({
      name: 'ask',
      value: { id: 'dialog.external-edit-problem', props: { reason: 'open-elsewhere' } },
    });
  });

  it('with no document on screen, sends nothing', async () => {
    const { client, sent } = recording({});
    const { calls, deps } = callbacks(undefined);

    await editPageExternallyCommand({ client, ...deps }).run({
      ...CONTEXT,
      docId: undefined,
      version: undefined,
      page: undefined,
    });

    expect(sent).toStrictEqual([]);
    expect(calls).toStrictEqual([]);
  });
});
