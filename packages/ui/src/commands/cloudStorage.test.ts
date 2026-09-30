import { type ContractClient, channels, createClient } from '@monstera/contract';
import { type DocId, type DocVersion, asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CLOUD_OUTCOME_DIALOG_ID } from '../dialogs/cloudOutcome.js';
import { CLOUD_DIALOG_ID, type CloudAnswer } from '../dialogs/cloudStorage.js';
import { CLOUD_VIEW_ONLY_DIALOG_ID } from '../dialogs/cloudViewOnly.js';
import type { ShowBusy } from '../busyNote.js';
import { CLOUD_CHOOSING, CLOUD_DOWNLOADING_FILE, TOAST_CLOUD_COPY_SAVED, TOAST_SAVED_BACK } from '../messages/en.js';
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

/** A busy note nobody is looking at, for the cases about something else. */
const NO_BUSY: ShowBusy = () => () => undefined;
/** A toast nobody reads, likewise. */
const NO_TOAST: ShowToast = () => undefined;
/** A file the person may change, as `cloud.access` answers it — the ordinary case, which asks nothing more. */
const EDITABLE = { kind: 'from-cloud', provider: 'onedrive', canEdit: true };

describe('Cloud storage…', () => {
  it('SHOW MY PDFS lists them in the dialog, and OPEN makes the file a tab through the open callback', async () => {
    const { client: built, sent } = client({
      'cloud.status': STATUS,
      'cloud.list': { kind: 'listed', files: [{ id: 'f1', name: 'contract.pdf', size: 9, modified: 1 }] },
      'cloud.open': { kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: 9, name: 'contract.pdf' },
      'cloud.access': EDITABLE,
    });
    const { ask, shown } = dialogs([
      { kind: 'list', provider: 'onedrive' },
      { kind: 'open', provider: 'onedrive', fileId: 'f1' },
    ]);
    const opened: unknown[] = [];
    await cloudStorageCommand({ client: built, ask, onOpened: (document) => opened.push(document), onAlreadyOpen: () => undefined, busy: NO_BUSY, toast: NO_TOAST }).run(START);

    expect(sent.filter((call) => call.id !== 'cloud.status').map((call) => [call.id, call.params])).toStrictEqual([
      ['cloud.list', { provider: 'onedrive' }],
      ['cloud.open', { provider: 'onedrive', fileId: 'f1' }],
      ['cloud.access', { docId: DOC }],
    ]);
    // AN EDITABLE FILE ASKS NOTHING MORE: no view-only notice after the two showings of the dialog.
    expect(shown).toHaveLength(2);
    expect((shown[1]?.props as { listing?: unknown }).listing).toStrictEqual({
      provider: 'onedrive',
      files: [{ id: 'f1', name: 'contract.pdf', size: 9, modified: 1 }],
    });
    expect(opened).toStrictEqual([{ docId: DOC, version: asDocVersion(1), byteLength: 9, name: 'contract.pdf' }]);
  });

  it('says the download is UNDER WAY for exactly as long as cloud.open runs, naming the file', async () => {
    // THE ORDER is the property: raised before the request goes, ended after its answer. A note raised after
    // the answer, or never ended, reads the same in a case that only asks whether one was raised.
    const log: string[] = [];
    const built = createClient(channels, (id) => {
      if (id === 'cloud.open') log.push('cloud.open sent');
      const answers: Record<string, unknown> = {
        'cloud.status': STATUS,
        'cloud.list': { kind: 'listed', files: [{ id: 'f1', name: 'contract.pdf', size: 9, modified: 1 }] },
        'cloud.open': { kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: 9, name: 'contract.pdf' },
        'cloud.access': EDITABLE,
      };
      return Promise.resolve(ok(answers[id]));
    });
    const { ask } = dialogs([
      { kind: 'list', provider: 'onedrive' },
      { kind: 'open', provider: 'onedrive', fileId: 'f1' },
    ]);
    await cloudStorageCommand({
      client: built,
      ask,
      toast: NO_TOAST,
      onOpened: () => log.push('opened'),
      onAlreadyOpen: () => undefined,
      busy: (message, values) => {
        log.push(`raised ${message === CLOUD_DOWNLOADING_FILE ? 'file' : 'other'} ${values['name'] ?? ''}`);
        return () => log.push('ended');
      },
    }).run(START);

    expect(log).toStrictEqual(['raised file contract.pdf', 'cloud.open sent', 'ended', 'opened']);
  });

  it('CHOOSE A FILE IN GOOGLE DRIVE sends cloud.pick, says it is WAITING before it goes, and opens the chosen file as a tab', async () => {
    const log: string[] = [];
    const built = createClient(channels, (id, params) => {
      if (id === 'cloud.pick') log.push(`cloud.pick sent ${JSON.stringify(params)}`);
      const answers: Record<string, unknown> = {
        'cloud.status': { providers: [{ provider: 'onedrive', state: 'not-configured' }, { provider: 'google-drive', state: 'signed-out' }] },
        'cloud.pick': { kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: 9, name: 'chosen.pdf' },
        'cloud.access': { kind: 'from-cloud', provider: 'google-drive', canEdit: true },
      };
      return Promise.resolve(ok(answers[id]));
    });
    const { ask } = dialogs([{ kind: 'pick', provider: 'google-drive' }]);
    await cloudStorageCommand({
      client: built,
      ask,
      toast: NO_TOAST,
      onOpened: (document) => log.push(`opened ${document.name}`),
      onAlreadyOpen: () => undefined,
      busy: (message) => {
        log.push(`raised ${message === CLOUD_CHOOSING ? 'choosing' : 'other'}`);
        return () => log.push('ended');
      },
    }).run(START);

    expect(log).toStrictEqual([
      'raised choosing',
      'cloud.pick sent {"provider":"google-drive"}',
      'ended',
      'opened chosen.pdf',
    ]);
  });

  it('a Picker that chose NOTHING is said on the next showing, and opens nothing', async () => {
    const { client: built } = client({
      'cloud.status': STATUS,
      'cloud.pick': { kind: 'refused', reason: 'nothing-picked' },
    });
    const { ask, shown } = dialogs([{ kind: 'pick', provider: 'google-drive' }, undefined]);
    const opened: unknown[] = [];
    await cloudStorageCommand({ client: built, ask, onOpened: (document) => opened.push(document), onAlreadyOpen: () => undefined, busy: NO_BUSY, toast: NO_TOAST }).run(START);
    expect((shown[1]?.props as { problem?: string }).problem).toBe('nothing-picked');
    expect(opened).toStrictEqual([]);
  });

  it('a refused sign-in is SAID on the next showing, by name', async () => {
    const { client: built } = client({ 'cloud.status': STATUS, 'cloud.signIn': { kind: 'refused', reason: 'sign-in-cancelled' } });
    const { ask, shown } = dialogs([{ kind: 'sign-in', provider: 'onedrive' }, undefined]);
    await cloudStorageCommand({ client: built, ask, onOpened: () => undefined, onAlreadyOpen: () => undefined, busy: NO_BUSY, toast: NO_TOAST }).run(START);
    expect((shown[1]?.props as { problem?: string }).problem).toBe('sign-in-cancelled');
  });

  it('a VIEW-ONLY file is said the moment it opens, BEFORE any edit, and its copy can be asked for there', async () => {
    const { client: built, sent } = client({
      'cloud.status': STATUS,
      'cloud.list': { kind: 'listed', files: [{ id: 'f1', name: 'shared.pdf', size: 9, modified: 1 }] },
      'cloud.open': { kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: 9, name: 'shared.pdf' },
      'cloud.access': { kind: 'from-cloud', provider: 'onedrive', canEdit: false },
      'cloud.uploadCopy': { kind: 'done' },
    });
    const queue: unknown[] = [{ kind: 'list', provider: 'onedrive' }, { kind: 'open', provider: 'onedrive', fileId: 'f1' }];
    const shown: { id: string; props: unknown }[] = [];
    const log: string[] = [];
    const ask = (id: string, props: unknown): Promise<unknown> => {
      shown.push({ id, props });
      if (id === CLOUD_VIEW_ONLY_DIALOG_ID) log.push('told view-only');
      return Promise.resolve(id === CLOUD_DIALOG_ID ? queue.shift() : { kind: 'save-copy' });
    };
    const said: string[] = [];
    await cloudStorageCommand({
      client: built,
      ask,
      toast: (_kind, message) => said.push(message),
      onOpened: () => log.push('tab'),
      onAlreadyOpen: () => undefined,
      busy: NO_BUSY,
    }).run(START);

    expect(log).toStrictEqual(['tab', 'told view-only']);
    expect(shown.at(-1)).toStrictEqual({ id: CLOUD_VIEW_ONLY_DIALOG_ID, props: { provider: 'onedrive', moment: 'opened' } });
    expect(sent.at(-1)).toStrictEqual({ id: 'cloud.uploadCopy', params: { docId: DOC, provider: 'onedrive' } });
    expect(said).toStrictEqual([TOAST_CLOUD_COPY_SAVED]);
  });

  it('CONTROL: a file whose access the provider did not say (null) is NOT called view-only', async () => {
    const { client: built } = client({
      'cloud.status': STATUS,
      'cloud.list': { kind: 'listed', files: [{ id: 'f1', name: 'x.pdf', size: 9, modified: 1 }] },
      'cloud.open': { kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: 9, name: 'x.pdf' },
      'cloud.access': { kind: 'from-cloud', provider: 'onedrive', canEdit: null },
    });
    const { ask, shown } = dialogs([
      { kind: 'list', provider: 'onedrive' },
      { kind: 'open', provider: 'onedrive', fileId: 'f1' },
    ]);
    await cloudStorageCommand({ client: built, ask, onOpened: () => undefined, onAlreadyOpen: () => undefined, busy: NO_BUSY, toast: NO_TOAST }).run(START);
    expect(shown.map((entry) => entry.id)).toStrictEqual([CLOUD_DIALOG_ID, CLOUD_DIALOG_ID]);
  });

  it('UPLOAD is offered with a document open and sends it; CONTROL: on the start screen it is not offered', async () => {
    const { client: built, sent } = client({ 'cloud.status': STATUS, 'cloud.uploadCopy': { kind: 'done' } });
    const withDoc = dialogs([{ kind: 'upload', provider: 'onedrive' }, undefined]);
    await cloudStorageCommand({ client: built, ask: withDoc.ask, onOpened: () => undefined, onAlreadyOpen: () => undefined, busy: NO_BUSY, toast: NO_TOAST }).run(WITH_DOCUMENT);
    expect((withDoc.shown[0]?.props as { documentOpen: boolean }).documentOpen).toBe(true);
    expect(sent.find((call) => call.id === 'cloud.uploadCopy')?.params).toStrictEqual({ docId: DOC, provider: 'onedrive' });
    expect((withDoc.shown[1]?.props as { note?: string }).note).toBe('uploaded');

    const atStart = dialogs([undefined]);
    await cloudStorageCommand({ client: built, ask: atStart.ask, onOpened: () => undefined, onAlreadyOpen: () => undefined, busy: NO_BUSY, toast: NO_TOAST }).run(START);
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

  /**
   * A FILE SHARED WITH THE PERSON TO VIEW (the owner's 0.1.6.0 run, decision A): Save back's refusal is not a problem
   * to report but a copy to offer — and the copy is exactly `cloud.uploadCopy` for this document and provider.
   */
  for (const reason of ['read-only', 'forbidden'] as const) {
    it(`a ${reason} refusal OFFERS A COPY in the person's own storage, and the copy is what it sends`, async () => {
      const { client: built, sent } = client({
        'cloud.saveBack': { kind: 'refused', reason, version: asDocVersion(4) },
        'cloud.access': { kind: 'from-cloud', provider: 'google-drive', canEdit: reason === 'read-only' ? false : true },
        'cloud.uploadCopy': { kind: 'done' },
      });
      const shown: { id: string; props: unknown }[] = [];
      const ask = (id: string, props: unknown): Promise<unknown> => {
        shown.push({ id, props });
        return Promise.resolve(id === CLOUD_VIEW_ONLY_DIALOG_ID ? { kind: 'save-copy' } : undefined);
      };
      const { toast, onSaved, said, wrote } = saving();
      await saveBackCommand({ client: built, ask, toast, onSaved }).run(WITH_DOCUMENT);

      expect(wrote).toStrictEqual([{ docId: DOC, version: asDocVersion(4) }]);
      expect(shown).toStrictEqual([{ id: CLOUD_VIEW_ONLY_DIALOG_ID, props: { provider: 'google-drive', moment: reason } }]);
      expect(sent.map((call) => call.id)).toStrictEqual(['cloud.saveBack', 'cloud.access', 'cloud.uploadCopy']);
      expect(sent[2]?.params).toStrictEqual({ docId: DOC, provider: 'google-drive' });
      expect(said).toStrictEqual([{ kind: 'done', message: TOAST_CLOUD_COPY_SAVED }]);
    });
  }

  it('CONTROL: an UNAUTHORISED refusal is still "sign in again" — no view-only notice, no copy', async () => {
    const { client: built, sent } = client({
      'cloud.saveBack': { kind: 'refused', reason: 'unauthorised', version: asDocVersion(4) },
    });
    const { ask, shown } = dialogs([]);
    const { toast, onSaved } = saving();
    await saveBackCommand({ client: built, ask, toast, onSaved }).run(WITH_DOCUMENT);
    expect(shown).toStrictEqual([{ id: CLOUD_OUTCOME_DIALOG_ID, props: { outcome: 'unauthorised' } }]);
    expect(sent.map((call) => call.id)).toStrictEqual(['cloud.saveBack']);
  });

  it('CONTROL: a view-only notice DISMISSED sends no copy', async () => {
    const { client: built, sent } = client({
      'cloud.saveBack': { kind: 'refused', reason: 'read-only', version: asDocVersion(4) },
      'cloud.access': { kind: 'from-cloud', provider: 'onedrive', canEdit: false },
    });
    const { ask } = dialogs([]);
    const { toast, onSaved, said } = saving();
    await saveBackCommand({ client: built, ask, toast, onSaved }).run(WITH_DOCUMENT);
    expect(sent.map((call) => call.id)).toStrictEqual(['cloud.saveBack', 'cloud.access']);
    expect(said).toStrictEqual([]);
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
