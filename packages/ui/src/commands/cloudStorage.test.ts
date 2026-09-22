import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CLOUD_OUTCOME_DIALOG_ID } from '../dialogs/cloudOutcome.js';
import { CLOUD_DIALOG_ID, type CloudAnswer } from '../dialogs/cloudStorage.js';
import type { CommandContext } from '../registries/commands.js';
import { cloudStorageCommand, saveBackCommand } from './cloudStorage.js';

/**
 * Cloud storage's UI half (ADR-0091): what the commands send and what the dialog is shown next.
 * `main`'s half — the sign-in, the working copy, the check on Save back — is `cloudSession.test.ts`'
 * and `cloudStorage.test.ts`'.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000d1');
const START = { docId: undefined } as unknown as CommandContext;
const WITH_DOCUMENT = { docId: DOC } as unknown as CommandContext;

interface Sent {
  readonly id: string;
  readonly params: unknown;
}

function client(answers: Readonly<Record<string, unknown>>): { client: ContractClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const built = createClient(channels, (id, params) => {
    sent.push({ id, params });
    const answer = answers[id];
    if (answer === undefined) throw new Error(`this case does not answer ${id}`);
    return Promise.resolve(ok(answer));
  });
  return { client: built, sent };
}

function dialogs(answers: readonly (CloudAnswer | undefined)[]): { ask: (id: string, props: unknown) => Promise<unknown>; shown: { id: string; props: unknown }[] } {
  const queue = [...answers];
  const shown: { id: string; props: unknown }[] = [];
  return {
    shown,
    ask: (id, props) => {
      shown.push({ id, props });
      return Promise.resolve(id === CLOUD_DIALOG_ID ? queue.shift() : undefined);
    },
  };
}

const STATUS = { providers: [{ provider: 'onedrive', state: 'signed-in' }, { provider: 'google-drive', state: 'not-configured' }] };

describe('Cloud storage…', () => {
  it('SHOW MY PDFS lists them in the dialog, and OPEN makes the file a tab through the open callback', async () => {
    const { client: built, sent } = client({
      'cloud.status': STATUS,
      'cloud.list': { kind: 'listed', files: [{ id: 'f1', name: 'contract.pdf', size: 9, modified: 1 }] },
      'cloud.open': { kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: 9, name: 'contract.pdf' },
    });
    const { ask, shown } = dialogs([
      { kind: 'list', provider: 'onedrive' },
      { kind: 'open', provider: 'onedrive', fileId: 'f1' },
    ]);
    const opened: unknown[] = [];
    await cloudStorageCommand({ client: built, ask, onOpened: (document) => opened.push(document), onAlreadyOpen: () => undefined }).run(START);

    expect(sent.filter((call) => call.id !== 'cloud.status').map((call) => [call.id, call.params])).toStrictEqual([
      ['cloud.list', { provider: 'onedrive' }],
      ['cloud.open', { provider: 'onedrive', fileId: 'f1' }],
    ]);
    expect((shown[1]?.props as { listing?: unknown }).listing).toStrictEqual({
      provider: 'onedrive',
      files: [{ id: 'f1', name: 'contract.pdf', size: 9, modified: 1 }],
    });
    expect(opened).toStrictEqual([{ docId: DOC, version: asDocVersion(1), byteLength: 9, name: 'contract.pdf' }]);
  });

  it('a refused sign-in is SAID on the next showing, by name', async () => {
    const { client: built } = client({ 'cloud.status': STATUS, 'cloud.signIn': { kind: 'refused', reason: 'sign-in-cancelled' } });
    const { ask, shown } = dialogs([{ kind: 'sign-in', provider: 'onedrive' }, undefined]);
    await cloudStorageCommand({ client: built, ask, onOpened: () => undefined, onAlreadyOpen: () => undefined }).run(START);
    expect((shown[1]?.props as { problem?: string }).problem).toBe('sign-in-cancelled');
  });

  it('UPLOAD is offered with a document open and sends it; CONTROL: on the start screen it is not offered', async () => {
    const { client: built, sent } = client({ 'cloud.status': STATUS, 'cloud.uploadCopy': { kind: 'done' } });
    const withDoc = dialogs([{ kind: 'upload', provider: 'onedrive' }, undefined]);
    await cloudStorageCommand({ client: built, ask: withDoc.ask, onOpened: () => undefined, onAlreadyOpen: () => undefined }).run(WITH_DOCUMENT);
    expect((withDoc.shown[0]?.props as { documentOpen: boolean }).documentOpen).toBe(true);
    expect(sent.find((call) => call.id === 'cloud.uploadCopy')?.params).toStrictEqual({ docId: DOC, provider: 'onedrive' });
    expect((withDoc.shown[1]?.props as { note?: string }).note).toBe('uploaded');

    const atStart = dialogs([undefined]);
    await cloudStorageCommand({ client: built, ask: atStart.ask, onOpened: () => undefined, onAlreadyOpen: () => undefined }).run(START);
    expect((atStart.shown[0]?.props as { documentOpen: boolean }).documentOpen).toBe(false);
  });
});

describe('Save back to cloud', () => {
  it('sends the document and SAYS what happened — success included', async () => {
    const { client: built, sent } = client({ 'cloud.saveBack': { kind: 'saved-back' } });
    const { ask, shown } = dialogs([]);
    await saveBackCommand({ client: built, ask }).run(WITH_DOCUMENT);
    expect(sent).toStrictEqual([{ id: 'cloud.saveBack', params: { docId: DOC } }]);
    expect(shown).toStrictEqual([{ id: CLOUD_OUTCOME_DIALOG_ID, props: { outcome: 'saved-back' } }]);
  });

  it('a file CHANGED ELSEWHERE is said as that, and a local document is told how to get there', async () => {
    const changed = client({ 'cloud.saveBack': { kind: 'refused', reason: 'changed-elsewhere' } });
    const first = dialogs([]);
    await saveBackCommand({ client: changed.client, ask: first.ask }).run(WITH_DOCUMENT);
    expect(first.shown[0]?.props).toStrictEqual({ outcome: 'changed-elsewhere' });

    const local = client({ 'cloud.saveBack': { kind: 'not-from-cloud' } });
    const second = dialogs([]);
    await saveBackCommand({ client: local.client, ask: second.ask }).run(WITH_DOCUMENT);
    expect(second.shown[0]?.props).toStrictEqual({ outcome: 'not-from-cloud' });
  });
});
