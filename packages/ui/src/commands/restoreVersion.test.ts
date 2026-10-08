import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { TOAST_LEGACY_MOVED, TOAST_RESTORE_GONE, TOAST_RESTORE_NONE } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import { offerOldBackups, restoreVersionCommand } from './restoreVersion.js';

/**
 * The UI half of ADR-0198's restore and its old-backups offer: which channel each control reaches, with what, and where each
 * answer goes. Every case asserts a CALL, because a dismissal and a failure both leave the screen unchanged.
 */

const DOC = asDocId('doc-1');
const COPY = asDocId('doc-2');

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: DOC,
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 4,
  openDocuments: [{ docId: DOC, version: asDocVersion(1), byteLength: 20, name: 'report.pdf' }],
};

const VERSIONS = [
  { id: '1.pdf', savedAt: '2026-10-08T09:41:00.000Z', bytes: 100 },
  { id: '2.pdf', savedAt: '2026-10-07T16:12:00.000Z', bytes: 90 },
];

function harness(answers: Readonly<Record<string, unknown>>, dialogAnswer: unknown) {
  const sent: { id: string; params: unknown }[] = [];
  const client: ContractClient = createClient(channels, (id, params) => {
    sent.push({ id, params });
    const answer = answers[id];
    if (answer === undefined) throw new Error(`this case does not answer ${id}`);
    return Promise.resolve(answer);
  });
  const asked: { id: string; props: unknown }[] = [];
  const toasts: { kind: string; message: unknown }[] = [];
  const opened: unknown[] = [];
  const deps = {
    client,
    ask: (id: string, props: unknown): Promise<unknown> => {
      asked.push({ id, props });
      return Promise.resolve(dialogAnswer);
    },
    toast: (kind: 'done' | 'problem', message: unknown): void => {
      toasts.push({ kind, message });
    },
    onOpened: (document: unknown): void => {
      opened.push(document);
    },
  };
  return { sent, asked, toasts, opened, deps };
}

const command = (deps: ReturnType<typeof harness>['deps']) =>
  restoreVersionCommand({
    ...deps,
    onApplied: () => undefined,
    stamp: () => ({ author: 'A', created: '2026-10-08T00:00:00.000Z' }),
    signatures: { warn: () => true, onOpened: () => undefined },
  });

describe('restoreVersionCommand', () => {
  it('lists the versions, asks which, and sends THE ID chosen — and opens the copy that comes back', async () => {
    const { sent, asked, opened, deps } = harness(
      {
        'document.listBackups': ok({ kind: 'listed', versions: VERSIONS }),
        'document.restoreBackup': ok({ kind: 'opened', docId: COPY, version: asDocVersion(1), byteLength: 90, name: 'report previous version.pdf' }),
      },
      { id: '2.pdf' },
    );
    await command(deps).run(CONTEXT);
    expect(asked).toStrictEqual([{ id: 'dialog.restore-version', props: { versions: VERSIONS } }]);
    expect(sent).toStrictEqual([
      { id: 'document.listBackups', params: { docId: DOC } },
      { id: 'document.restoreBackup', params: { docId: DOC, id: '2.pdf' } },
    ]);
    expect(opened).toStrictEqual([{ docId: COPY, version: 1, byteLength: 90, name: 'report previous version.pdf' }]);
  });

  it('CONTROL: with no version kept it says so and asks nothing; a closed dialog restores nothing; a version already gone says so', async () => {
    const none = harness({ 'document.listBackups': ok({ kind: 'listed', versions: [] }) }, undefined);
    await command(none.deps).run(CONTEXT);
    expect(none.asked).toStrictEqual([]);
    expect(none.toasts).toStrictEqual([{ kind: 'problem', message: TOAST_RESTORE_NONE }]);

    const closed = harness({ 'document.listBackups': ok({ kind: 'listed', versions: VERSIONS }) }, undefined);
    await command(closed.deps).run(CONTEXT);
    expect(closed.sent.map((call) => call.id)).toStrictEqual(['document.listBackups']);

    const gone = harness(
      { 'document.listBackups': ok({ kind: 'listed', versions: VERSIONS }), 'document.restoreBackup': ok({ kind: 'gone' }) },
      { id: '1.pdf' },
    );
    await command(gone.deps).run(CONTEXT);
    expect(gone.toasts).toStrictEqual([{ kind: 'problem', message: TOAST_RESTORE_GONE }]);
    expect(gone.opened).toStrictEqual([]);
  });
});

describe('offerOldBackups', () => {
  it('asks nothing where main found nothing to offer — the usual open', async () => {
    const { sent, asked, deps } = harness({ 'document.legacyBackups': ok({ kind: 'none' }) }, undefined);
    await offerOldBackups(deps, DOC);
    expect(asked).toStrictEqual([]);
    expect(sent.map((call) => call.id)).toStrictEqual(['document.legacyBackups']);
  });

  it('asks how many Monstera made and how many stay, sends the answer, and says the move — CONTROL: a dismissal is *leave them*, and is still sent so the folder is asked once', async () => {
    const yes = harness(
      { 'document.legacyBackups': ok({ kind: 'found', proven: 2, unproven: 1 }), 'document.moveLegacyBackups': ok({ kind: 'answered', moved: 2, kept: 0 }) },
      { move: true },
    );
    await offerOldBackups(yes.deps, DOC);
    expect(yes.asked).toStrictEqual([{ id: 'dialog.legacy-backups', props: { proven: 2, unproven: 1 } }]);
    expect(yes.sent[1]).toStrictEqual({ id: 'document.moveLegacyBackups', params: { docId: DOC, move: true } });
    expect(yes.toasts).toStrictEqual([{ kind: 'done', message: TOAST_LEGACY_MOVED }]);

    const dismissed = harness(
      { 'document.legacyBackups': ok({ kind: 'found', proven: 2, unproven: 0 }), 'document.moveLegacyBackups': ok({ kind: 'answered', moved: 0, kept: 0 }) },
      undefined,
    );
    await offerOldBackups(dismissed.deps, DOC);
    expect(dismissed.sent[1]).toStrictEqual({ id: 'document.moveLegacyBackups', params: { docId: DOC, move: false } });
    expect(dismissed.toasts).toStrictEqual([]);
  });
});
