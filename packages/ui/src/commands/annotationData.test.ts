import { channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { IMPORT_ANNOTATIONS_PROBLEM_DIALOG_ID } from '../dialogs/importAnnotationsProblem.js';
import { SAVE_PROBLEM_DIALOG_ID } from '../dialogs/saveProblem.js';
import { GROUP_COMMENT_FILES } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import {
  exportAnnotationsFdfCommand,
  exportAnnotationsJsonCommand,
  exportAnnotationsXfdfCommand,
  importAnnotationsFdfCommand,
  importAnnotationsJsonCommand,
  importAnnotationsXfdfCommand,
  pasteAnnotationsCommand,
} from './annotationData.js';

/**
 * The six comment-file commands against a validating client. The kernel half — that a file's
 * comments land on the page and survive a save — is `annotationInterchange.test.ts` and
 * `documentCommands.test.ts`' lane cases; this half is that each control sends its OWN format and
 * that every outcome reaches a person.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000aa');
const CONTEXT = { docId: DOC, version: asDocVersion(1), hasSelection: false, dirty: false, page: 0, pageCount: 1 } as CommandContext;

function harness(answer: unknown): {
  deps: Parameters<typeof importAnnotationsJsonCommand>[0];
  sent: { id: string; params: unknown }[];
  opened: { id: string; props: unknown }[];
  applied: unknown[];
} {
  const sent: { id: string; params: unknown }[] = [];
  const opened: { id: string; props: unknown }[] = [];
  const applied: unknown[] = [];
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    return Promise.resolve(ok(answer as never));
  });
  return {
    deps: {
      client,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
      onApplied: (value) => {
        applied.push(value);
      },
    },
    sent,
    opened,
    applied,
  };
}

describe('the comment-file commands', () => {
  it('each sends its own format on its own channel', async () => {
    const pairs = [
      [importAnnotationsXfdfCommand, 'document.importAnnotations', 'xfdf'],
      [importAnnotationsFdfCommand, 'document.importAnnotations', 'fdf'],
      [importAnnotationsJsonCommand, 'document.importAnnotations', 'json'],
      [exportAnnotationsXfdfCommand, 'document.exportAnnotations', 'xfdf'],
      [exportAnnotationsFdfCommand, 'document.exportAnnotations', 'fdf'],
      [exportAnnotationsJsonCommand, 'document.exportAnnotations', 'json'],
    ] as const;
    for (const [factory, channel, format] of pairs) {
      const { deps, sent } = harness({ kind: 'cancelled' });
      await factory(deps).run(CONTEXT);
      expect(sent).toStrictEqual([{ id: channel, params: { docId: DOC, format } }]);
    }
  });

  it('an import that added comments reports the new version, and opens nothing', async () => {
    const { deps, opened, applied } = harness({ kind: 'imported', version: 2, byteLength: 900, historyDropped: 0 });
    await importAnnotationsXfdfCommand(deps).run(CONTEXT);
    expect(applied).toStrictEqual([{ version: 2, byteLength: 900 }]);
    expect(opened).toStrictEqual([]);
  });

  it('an import that added nothing SAYS so, and applies nothing', async () => {
    const { deps, opened, applied } = harness({ kind: 'unreadable' });
    await importAnnotationsFdfCommand(deps).run(CONTEXT);
    expect(opened).toStrictEqual([{ id: IMPORT_ANNOTATIONS_PROBLEM_DIALOG_ID, props: { reason: 'unreadable' } }]);
    expect(applied).toStrictEqual([]);
  });

  it('an XFDF export XML cannot carry names the format as the problem', async () => {
    const { deps, opened } = harness({ kind: 'unrepresentable' });
    await exportAnnotationsXfdfCommand(deps).run(CONTEXT);
    expect(opened).toStrictEqual([{ id: SAVE_PROBLEM_DIALOG_ID, props: { outcome: 'unrepresentable' } }]);
  });

  it('CONTROL: a copied export opens nothing', async () => {
    const { deps, opened } = harness({ kind: 'copied', bytes: 120 });
    await exportAnnotationsJsonCommand(deps).run(CONTEXT);
    expect(opened).toStrictEqual([]);
  });

  it('sits in Review › Comment files, imports first', () => {
    const { deps } = harness({ kind: 'cancelled' });
    expect(importAnnotationsXfdfCommand(deps).placements).toStrictEqual([
      { surface: 'ribbon', section: 'review', group: GROUP_COMMENT_FILES, order: 10 },
    ]);
    expect(exportAnnotationsJsonCommand(deps).placements).toStrictEqual([
      { surface: 'ribbon', section: 'review', group: GROUP_COMMENT_FILES, order: 15 },
    ]);
  });
});

describe('pasteAnnotationsCommand — main mints the import from the clipboard it holds', () => {
  it('sends the PAGE and nothing else, and a paste reaches the shell as an applied change', async () => {
    const { deps, sent, applied } = harness({
      kind: 'pasted',
      version: asDocVersion(2),
      byteLength: 4096,
      historyDropped: 0,
    });
    // THE PAGE IS THE CONTEXT'S — 3 here, not the fixture's usual 0, so a command that hard-wired
    // the first page would be caught — and no record crosses: the renderer never held any.
    await pasteAnnotationsCommand({ ...deps, hasCopied: () => true }).run({ ...CONTEXT, page: 3, pageCount: 5 });
    expect(sent).toStrictEqual([{ id: 'document.pasteAnnotations', params: { docId: DOC, page: 3 } }]);
    expect(applied).toStrictEqual([{ version: asDocVersion(2), byteLength: 4096 }]);
  });

  it('a REFUSED paste reaches a person, through the import problem dialog', async () => {
    const { deps, opened, applied } = harness({ kind: 'refused' });
    await pasteAnnotationsCommand({ ...deps, hasCopied: () => true }).run(CONTEXT);
    expect(opened).toStrictEqual([{ id: IMPORT_ANNOTATIONS_PROBLEM_DIALOG_ID, props: { reason: 'unreadable' } }]);
    expect(applied).toStrictEqual([]);
  });

  it('CONTROL: hidden until something has been copied, and shown once it has', () => {
    const { deps } = harness(undefined);
    expect(pasteAnnotationsCommand({ ...deps, hasCopied: () => false }).when?.(CONTEXT)).toBe(false);
    expect(pasteAnnotationsCommand({ ...deps, hasCopied: () => true }).when?.(CONTEXT)).toBe(true);
  });

  it('sits in the PAGE menu and claims NO chord — a claimed Ctrl+V would take the key from every text field', () => {
    const { deps } = harness(undefined);
    const command = pasteAnnotationsCommand({ ...deps, hasCopied: () => true });
    expect(command.placements).toStrictEqual([{ surface: 'context-menu', context: 'page', order: 25 }]);
    expect(command.shortcut).toBeUndefined();
  });
});
