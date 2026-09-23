import { type ContractClient, channels, createClient } from '@monstera/contract';
import { type DocId, type DocVersion, asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CLOUD_OUTCOME_DIALOG_ID } from '../dialogs/cloudOutcome.js';
import { CLOUD_DIALOG_ID, type CloudAnswer } from '../dialogs/cloudStorage.js';
import { TOAST_SAVED_BACK } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import type { ShowToast } from '../toasts.js';
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

/**
 * What a save-back RECORDED: the confirmations it gave and the versions it marked saved. The
 * versions are what `App.tsx`' `onSaved` turns into the tab's dot and the bar's words, through the
 * same callback Save uses — so a version recorded here is the dot clearing, and none is it staying.
 */
function saving(): {
  toast: ShowToast;
  onSaved: (docId: DocId, version: DocVersion) => void;
  said: { kind: string; message: string }[];
  wrote: { docId: DocId; version: DocVersion }[];
} {
  const said: { kind: string; message: string }[] = [];
  const wrote: { docId: DocId; version: DocVersion }[] = [];
  return {
    toast: (kind, message) => {
      said.push({ kind, message });
    },
    onSaved: (docId, version) => {
      wrote.push({ docId, version });
    },
    said,
    wrote,
  };
}

describe('Save back to cloud', () => {
  it('sends the document, MARKS IT SAVED at the version main wrote, and confirms without a dialog', async () => {
    const { client: built, sent } = client({ 'cloud.saveBack': { kind: 'saved-back', version: asDocVersion(7) } });
    const { ask, shown } = dialogs([]);
    const { toast, onSaved, said, wrote } = saving();
    await saveBackCommand({ client: built, ask, toast, onSaved }).run(WITH_DOCUMENT);
    expect(sent).toStrictEqual([{ id: 'cloud.saveBack', params: { docId: DOC } }]);
    expect(wrote).toStrictEqual([{ docId: DOC, version: asDocVersion(7) }]);
    expect(said).toStrictEqual([{ kind: 'done', message: TOAST_SAVED_BACK }]);
    expect(shown).toStrictEqual([]);
  });

  it('CONTROL: a save-back that SAVED NOTHING leaves the document unsaved, and says why', async () => {
    for (const kind of ['save-failed', 'not-from-cloud'] as const) {
      const { client: built } = client({ 'cloud.saveBack': { kind } });
      const { ask, shown } = dialogs([]);
      const { toast, onSaved, said, wrote } = saving();
      await saveBackCommand({ client: built, ask, toast, onSaved }).run(WITH_DOCUMENT);
      expect(wrote, kind).toStrictEqual([]);
      expect(said, kind).toStrictEqual([]);
      expect(shown, kind).toStrictEqual([{ id: CLOUD_OUTCOME_DIALOG_ID, props: { outcome: kind } }]);
    }
  });

  it('a refusal ON THE WAY OUT still marks the saved working copy, and says the refusal by name', async () => {
    const { client: built } = client({
      'cloud.saveBack': { kind: 'refused', reason: 'changed-elsewhere', version: asDocVersion(4) },
    });
    const { ask, shown } = dialogs([]);
    const { toast, onSaved, said, wrote } = saving();
    await saveBackCommand({ client: built, ask, toast, onSaved }).run(WITH_DOCUMENT);
    // `document.unsaved` reads clean here — main wrote the working copy before sending — so a tab
    // left dirty would be the disagreement this command exists not to make.
    expect(wrote).toStrictEqual([{ docId: DOC, version: asDocVersion(4) }]);
    expect(said).toStrictEqual([]);
    expect(shown).toStrictEqual([{ id: CLOUD_OUTCOME_DIALOG_ID, props: { outcome: 'changed-elsewhere' } }]);
  });
});
