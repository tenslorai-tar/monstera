import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { sayWhenUnwritable } from './readOnlyFile.js';

/**
 * The page's half of cloud-4 7b: a document a person opened whose file cannot be saved over is said as it appears,
 * with a copy to work on.
 *
 * Every case asserts the CALLS — what was sent and what was asked — because a writable file and a dismissed offer
 * both leave the screen exactly as it was.
 */

const DOC = asDocId('doc-read-only');
const COPY = asDocId('doc-its-copy');
const COPY_OPENED = { kind: 'opened', docId: COPY, version: asDocVersion(1), byteLength: 2048, name: 'annual (copy).pdf' } as const;

function recording(answers: Readonly<Record<string, unknown>>): {
  readonly client: ContractClient;
  readonly sent: { id: string; params: unknown }[];
} {
  const sent: { id: string; params: unknown }[] = [];
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    const answer = answers[id];
    if (answer === undefined) throw new Error(`this case does not answer ${id}`);
    return Promise.resolve(answer);
  });
  return { client, sent };
}

/** The dialogs asked and the documents opened, in order, with the read-only dialog answering `chosen`. */
function seen(chosen: unknown): {
  readonly calls: { name: string; value: unknown }[];
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  readonly onOpened: (opened: unknown) => void;
} {
  const calls: { name: string; value: unknown }[] = [];
  return {
    calls,
    ask: (id, props) => {
      calls.push({ name: 'ask', value: { id, props } });
      return Promise.resolve(id === 'dialog.read-only-file' ? chosen : undefined);
    },
    onOpened: (opened) => {
      calls.push({ name: 'opened', value: opened });
    },
  };
}

describe('sayWhenUnwritable', () => {
  it('A READ-ONLY FILE IS SAID as it opens, and Save a copy writes the copy and opens it to work on', async () => {
    const { client, sent } = recording({
      'document.fileAccess': ok({ access: 'read-only' }),
      'document.workOnCopy': ok(COPY_OPENED),
    });
    const { calls, ask, onOpened } = seen({ kind: 'save-copy' });

    await sayWhenUnwritable({ client, ask, onOpened }, DOC);

    expect(sent).toStrictEqual([
      { id: 'document.fileAccess', params: { docId: DOC } },
      { id: 'document.workOnCopy', params: { docId: DOC } },
    ]);
    expect(calls).toStrictEqual([
      { name: 'ask', value: { id: 'dialog.read-only-file', props: { access: 'read-only' } } },
      { name: 'opened', value: { docId: COPY, version: 1, byteLength: 2048, name: 'annual (copy).pdf' } },
    ]);
  });

  it('a file ANOTHER PROGRAM HOLDS is said too, with its own reason', async () => {
    const { client } = recording({ 'document.fileAccess': ok({ access: 'held' }) });
    const { calls, ask, onOpened } = seen(undefined);

    await sayWhenUnwritable({ client, ask, onOpened }, DOC);

    expect(calls).toStrictEqual([{ name: 'ask', value: { id: 'dialog.read-only-file', props: { access: 'held' } } }]);
  });

  it('CONTROL: a writable file, and one gone since, are said NOTHING — no dialog before the person has done anything', async () => {
    for (const access of ['writable', 'absent'] as const) {
      const { client, sent } = recording({ 'document.fileAccess': ok({ access }) });
      const { calls, ask, onOpened } = seen({ kind: 'save-copy' });

      await sayWhenUnwritable({ client, ask, onOpened }, DOC);

      expect(sent).toStrictEqual([{ id: 'document.fileAccess', params: { docId: DOC } }]);
      expect(calls).toStrictEqual([]);
    }
  });

  it('a DISMISSED offer keeps reading this file: nothing is copied', async () => {
    const { client, sent } = recording({ 'document.fileAccess': ok({ access: 'read-only' }) });
    const { ask, onOpened } = seen(undefined);

    await sayWhenUnwritable({ client, ask, onOpened }, DOC);

    expect(sent.map((one) => one.id)).toStrictEqual(['document.fileAccess']);
  });

  it('a document closed before the answer came needs no sentence', async () => {
    const { client } = recording({ 'document.fileAccess': err({ code: 'document-not-open' }) });
    const { calls, ask, onOpened } = seen({ kind: 'save-copy' });

    await sayWhenUnwritable({ client, ask, onOpened }, DOC);

    expect(calls).toStrictEqual([]);
  });

  it('a copy NOT WRITTEN is said as Save a copy says it, and one written and not opened as any open says it', async () => {
    const cases = [
      [{ kind: 'cancelled' }, []],
      [{ kind: 'destination-contested', openElsewhere: 1 }, [{ id: 'dialog.save-problem', props: { outcome: 'contested' } }]],
      [{ kind: 'write-failed' }, [{ id: 'dialog.save-problem', props: { outcome: 'write-failed' } }]],
      [{ kind: 'busy' }, [{ id: 'dialog.open-problem', props: { reason: 'busy' } }]],
      [{ kind: 'absent' }, [{ id: 'dialog.open-problem', props: { reason: 'absent' } }]],
    ] as const;
    for (const [answer, asked] of cases) {
      const { client } = recording({ 'document.fileAccess': ok({ access: 'read-only' }), 'document.workOnCopy': ok(answer) });
      const { calls, ask, onOpened } = seen({ kind: 'save-copy' });

      await sayWhenUnwritable({ client, ask, onOpened }, DOC);

      expect(calls.slice(1)).toStrictEqual(asked.map((value) => ({ name: 'ask', value })));
    }
  });
});
