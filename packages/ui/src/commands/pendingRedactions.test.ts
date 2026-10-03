import { type AnnotationStamp, type ContractClient, channels, createClient } from '@monstera/contract';
import { type DocId, asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { PENDING_REDACTIONS_DIALOG_ID, type PendingRedactionOccasion } from '../dialogs/pendingRedactions.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import { saveBackCommand } from './cloudStorage.js';
import {
  docusignSendCommand,
  emailCommand,
  exportExcelCommand,
  exportLayoutTextCommand,
  exportPageImagesCommand,
  exportPdfaCommand,
  exportPowerPointCommand,
  exportTextCommand,
  exportWordCommand,
  extractPagesCommand,
  optimizeCommand,
  printCommand,
  saveCommand,
  saveCopyCommand,
  splitDocumentCommand,
} from './documentCommands.js';
import { countPendingRedactions, settlePendingRedactions } from './pendingRedactions.js';
import { exportSearchableCommand } from './recogniseText.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { SettingsStore } from '../settingsStore.js';

/**
 * Redaction marks nobody applied, asked about before the document leaves (the owner's item N1).
 *
 * ## Every case asserts the CALLS
 *
 * The question's job is to stop a write, or to burn in before one, and both a correct question and an absent one can
 * leave the same document on screen. So what is asserted is the channel calls, in order: whether `document.execute`
 * carried the burn-in, and whether the save or the export was sent at all (CLAUDE.md item 4: a decision's observable
 * is the call).
 */

const DOC = asDocId('doc-n1');
const stamp = (): AnnotationStamp => ({ author: 'A. Tester', created: '2026-10-02T09:00:00.000Z' });

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: DOC,
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 3,
  pageCount: 10,
  openDocuments: [{ docId: DOC, version: asDocVersion(1), byteLength: 20, name: 'This one' }],
};

/** One annotation as `document.annotations` lists it. */
function listed(kind: 'redact' | 'square', page: number, index: number): unknown {
  return {
    page,
    index,
    rect: { x0: 10, y0: 10, x1: 50, y1: 30 },
    inReplyTo: null,
    kind,
    style: { colour: [0, 0, 0], opacity: 1, borderWidth: null },
    contents: '',
    authored: true,
    author: '',
    created: null,
    blend: 'normal',
  };
}

/**
 * A client over a document carrying `marks` Redact marks — on TWO PAGES and IN TWO PARTS, beside a square — that
 * records every call, answers a burn-in, and answers every other channel through `others`.
 *
 * The square and the second part are both controls built into the fixture: a count of every annotation, or of the
 * first part only, gives a number the cases below would see as wrong.
 */
function documentWith(
  marks: number,
  others: (id: string) => unknown = () => {
    throw new Error('this fixture answers no other channel');
  },
  options: { readonly refuseRead?: boolean; readonly refuseApply?: boolean } = {},
): { readonly client: ContractClient; readonly sent: { id: string; params: unknown }[] } {
  const sent: { id: string; params: unknown }[] = [];
  const first = Math.floor(marks / 2);
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'document.annotations') {
      if (options.refuseRead === true) return Promise.resolve(err({ code: 'document-busy' }));
      const from = (params as { from: number }).from;
      return Promise.resolve(
        ok(
          from === 0
            ? {
                version: asDocVersion(1),
                annotations: [
                  listed('square', 0, 0),
                  ...Array.from({ length: first }, (_unused, at) => listed('redact', 0, at + 1)),
                ],
                next: 1 + first,
                truncated: false,
              }
            : {
                version: asDocVersion(1),
                annotations: Array.from({ length: marks - first }, (_unused, at) => listed('redact', 4, at)),
                next: null,
                truncated: false,
              },
        ),
      );
    }
    if (id === 'document.execute') {
      if (options.refuseApply === true) return Promise.resolve(err({ code: 'document-busy' }));
      return Promise.resolve(ok({ version: asDocVersion(2), byteLength: 4096, historyDropped: 0 }));
    }
    return Promise.resolve(ok(others(id)));
  });
  return { client, sent };
}

/** An `ask` answering the pending-redactions question with `answer`, and every other dialog with `rest`. */
function asking(
  answer: 'apply' | 'without' | undefined,
  rest: (id: string) => unknown = () => undefined,
): { readonly ask: (id: string, props: unknown) => Promise<unknown>; readonly asked: { id: string; props: unknown }[] } {
  const asked: { id: string; props: unknown }[] = [];
  return {
    asked,
    ask: (id, props) => {
      asked.push({ id, props });
      return Promise.resolve(id === PENDING_REDACTIONS_DIALOG_ID ? answer : rest(id));
    },
  };
}

/** The burn-in *Apply* sends: every page, with the Apply redactions dialog's starting choices. */
const BURN_IN = {
  docId: DOC,
  command: { kind: 'applyRedactions', pages: 'all', cover: 'solid', images: 'pixels', keepTitle: false },
};

function ids(sent: readonly { id: string }[]): readonly string[] {
  return sent.map((call) => call.id).filter((id) => id !== 'document.annotations');
}

describe('countPendingRedactions', () => {
  it('counts the Redact marks across every PART of the list, and nothing else', async () => {
    // THREE: one on the first part, two on the second. A count of the first part would say 1; a count of every
    // annotation would say 4.
    const { client } = documentWith(3);
    expect(await countPendingRedactions(client, DOC)).toBe(3);
  });

  it('answers undefined where main refused the read, rather than a count nothing supports', async () => {
    const { client } = documentWith(3, undefined, { refuseRead: true });
    expect(await countPendingRedactions(client, DOC)).toBeUndefined();
  });
});

describe('settlePendingRedactions', () => {
  async function settle(
    marks: number,
    answer: 'apply' | 'without' | undefined,
    occasion: PendingRedactionOccasion = 'save',
    options: { readonly refuseRead?: boolean; readonly refuseApply?: boolean } = {},
  ): Promise<{
    readonly settled: string;
    readonly sent: readonly { id: string; params: unknown }[];
    readonly asked: readonly { id: string; props: unknown }[];
    readonly moved: readonly unknown[];
  }> {
    const { client, sent } = documentWith(marks, undefined, options);
    const { ask, asked } = asking(answer);
    const moved: unknown[] = [];
    const settled = await settlePendingRedactions(
      { client, ask, stamp, onApplied: (applied) => moved.push(applied) },
      DOC,
      occasion,
    );
    return { settled, sent, asked, moved };
  }

  it('CONTROL: a document with no marks asks nothing and burns in nothing', async () => {
    const { settled, sent, asked } = await settle(0, 'apply');
    expect(asked).toStrictEqual([]);
    expect(ids(sent)).toStrictEqual([]);
    expect(settled).toBe('none');
  });

  it('asks with the COUNT and the OCCASION, so the middle answer can name the action', async () => {
    const { asked } = await settle(3, 'without', 'export');
    expect(asked).toStrictEqual([{ id: PENDING_REDACTIONS_DIALOG_ID, props: { count: 3, occasion: 'export' } }]);
  });

  it('Apply burns in every page’s marks through the one dispatcher, and the view moves', async () => {
    const { settled, sent, moved } = await settle(3, 'apply');
    expect(sent.filter((call) => call.id === 'document.execute').map((call) => call.params)).toStrictEqual([BURN_IN]);
    expect(moved).toStrictEqual([{ version: 2, byteLength: 4096, historyDropped: 0 }]);
    expect(settled).toBe('applied');
  });

  it('the middle answer goes ahead WITHOUT burning in', async () => {
    const { settled, sent } = await settle(3, 'without');
    expect(ids(sent)).toStrictEqual([]);
    expect(settled).toBe('kept');
  });

  it('Cancel — or the ×, or Escape — stops, burning in nothing', async () => {
    const { settled, sent } = await settle(3, undefined);
    expect(ids(sent)).toStrictEqual([]);
    expect(settled).toBe('stopped');
  });

  it('an Apply main REFUSED stops too, and the refusal is reported — going ahead would write the marks', async () => {
    const { settled, asked } = await settle(3, 'apply', 'save', { refuseApply: true });
    expect(settled).toBe('stopped');
    expect(asked.map((open) => open.id)).toStrictEqual([PENDING_REDACTIONS_DIALOG_ID, 'dialog.command-problem']);
  });

  it('a refused count asks nothing, and the action goes on to meet the refusal itself', async () => {
    const { settled, asked } = await settle(3, 'apply', 'save', { refuseRead: true });
    expect(asked).toStrictEqual([]);
    expect(settled).toBe('none');
  });
});

/**
 * THE COMMANDS, composed with the real question as `App.tsx` composes it — so these cases name both ends: the button
 * the person pressed and the channel that wrote.
 */
describe('Save, with marks nobody applied', () => {
  function save(marks: number, answer: 'apply' | 'without' | undefined) {
    const { client, sent } = documentWith(marks, (id) => {
      if (id === 'document.save') return { kind: 'saved', version: asDocVersion(3), cleared: null };
      throw new Error(`no ${id}`);
    });
    const { ask, asked } = asking(answer);
    const deps = { client, ask, stamp, onApplied: () => undefined };
    const command = saveCommand({
      client,
      ask,
      toast: () => undefined,
      onSaved: () => undefined,
      warnSignatureBreak: () => true,
      settleMarks: async (docId, occasion) =>
        (await settlePendingRedactions(deps, docId, occasion)) !== 'stopped',
    });
    return { command, sent, asked };
  }

  it('CONTROL: with none, saves without a question', async () => {
    const { command, sent, asked } = save(0, 'apply');
    await command.run(CONTEXT);
    expect(asked).toStrictEqual([]);
    expect(ids(sent)).toStrictEqual(['document.save']);
  });

  it('Apply burns in, THEN saves', async () => {
    const { command, sent, asked } = save(2, 'apply');
    await command.run(CONTEXT);
    expect(asked[0]).toStrictEqual({ id: PENDING_REDACTIONS_DIALOG_ID, props: { count: 2, occasion: 'save' } });
    expect(ids(sent)).toStrictEqual(['document.execute', 'document.save']);
  });

  it('Save without applying saves, burning in nothing', async () => {
    const { command, sent } = save(2, 'without');
    await command.run(CONTEXT);
    expect(ids(sent)).toStrictEqual(['document.save']);
  });

  it('Cancel neither burns in nor saves', async () => {
    const { command, sent } = save(2, undefined);
    await command.run(CONTEXT);
    expect(ids(sent)).toStrictEqual([]);
  });
});

describe('an export, with marks nobody applied', () => {
  // SAVE A COPY: the one export whose channel answers with no dialog of its own first, so the calls are the question's.
  function exportCopy(marks: number, answer: 'apply' | 'without' | undefined) {
    const { client, sent } = documentWith(marks, (id) => {
      if (id === 'document.saveCopy') return { kind: 'cancelled' };
      throw new Error(`no ${id}`);
    });
    const { ask } = asking(answer);
    const deps = { client, ask, stamp, onApplied: () => undefined };
    const command = saveCopyCommand({
      ...deps,
      toast: () => undefined,
      settleMarks: async (docId, occasion) =>
        (await settlePendingRedactions(deps, docId, occasion)) !== 'stopped',
    });
    return { command, sent };
  }

  it('CONTROL: with none, exports without a question', async () => {
    const { command, sent } = exportCopy(0, undefined);
    await command.run(CONTEXT);
    expect(ids(sent)).toStrictEqual(['document.saveCopy']);
  });

  it('Apply burns in, THEN exports', async () => {
    const { command, sent } = exportCopy(2, 'apply');
    await command.run(CONTEXT);
    expect(ids(sent)).toStrictEqual(['document.execute', 'document.saveCopy']);
  });

  it('Export without applying exports, burning in nothing', async () => {
    const { command, sent } = exportCopy(2, 'without');
    await command.run(CONTEXT);
    expect(ids(sent)).toStrictEqual(['document.saveCopy']);
  });

  it('Cancel neither burns in nor exports', async () => {
    const { command, sent } = exportCopy(2, undefined);
    await command.run(CONTEXT);
    expect(ids(sent)).toStrictEqual([]);
  });
});

/**
 * EVERY COMMAND THAT CARRIES THE DOCUMENT OUT asks first, with the occasion its button names — and a stop sends
 * nothing at all, not even its own dialog.
 *
 * A LIST, and that is the limit of it: an export added tomorrow that does not take `SettlesMarksFirst` cannot be
 * found from here. The type is what reaches it — such a command, composed in `App.tsx` beside these, is a review
 * question this table names the answer to.
 */
describe('every save, export, print and send asks before it does anything', () => {
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  const builds: readonly {
    readonly name: string;
    readonly occasion: PendingRedactionOccasion;
    readonly build: (deps: ReturnType<typeof bag>) => UiCommand;
  }[] = [
    { name: 'Save', occasion: 'save', build: (deps) => saveCommand(deps) },
    { name: 'Save back to cloud', occasion: 'save', build: (deps) => saveBackCommand(deps) },
    { name: 'Save a copy', occasion: 'export', build: (deps) => saveCopyCommand(deps) },
    { name: 'Extract pages', occasion: 'export', build: (deps) => extractPagesCommand(deps) },
    { name: 'Split', occasion: 'export', build: (deps) => splitDocumentCommand(deps) },
    { name: 'Export text', occasion: 'export', build: (deps) => exportTextCommand(deps) },
    { name: 'Export text with layout', occasion: 'export', build: (deps) => exportLayoutTextCommand(deps) },
    { name: 'Export to Word', occasion: 'export', build: (deps) => exportWordCommand(deps) },
    { name: 'Export to PowerPoint', occasion: 'export', build: (deps) => exportPowerPointCommand(deps) },
    { name: 'Export to Excel', occasion: 'export', build: (deps) => exportExcelCommand(deps) },
    { name: 'Export PDF/A', occasion: 'export', build: (deps) => exportPdfaCommand(deps) },
    { name: 'Export page images', occasion: 'export', build: (deps) => exportPageImagesCommand(deps) },
    { name: 'Export searchable PDF', occasion: 'export', build: (deps) => exportSearchableCommand(deps) },
    { name: 'Save a smaller copy', occasion: 'export', build: (deps) => optimizeCommand(deps) },
    { name: 'Print', occasion: 'print', build: (deps) => printCommand(deps) },
    { name: 'Email', occasion: 'send', build: (deps) => emailCommand(deps) },
    { name: 'Send to DocuSign', occasion: 'send', build: (deps) => docusignSendCommand(deps) },
  ];

  /** Everything any of them takes, with a client and an `ask` that record — and the question answered `proceed`. */
  function bag(proceed: boolean) {
    const sent: string[] = [];
    const asked: string[] = [];
    const settled: { docId: DocId; occasion: PendingRedactionOccasion }[] = [];
    const client = createClient(channels, (id) => {
      sent.push(id);
      return Promise.resolve(err({ code: 'document-busy' }));
    });
    return {
      sent,
      asked,
      settled,
      client,
      stamp,
      onApplied: () => undefined,
      onSaved: () => undefined,
      toast: () => undefined,
      ask: (id: string) => {
        asked.push(id);
        return Promise.resolve(undefined);
      },
      settleMarks: (docId: DocId, occasion: PendingRedactionOccasion) => {
        settled.push({ docId, occasion });
        return Promise.resolve(proceed);
      },
      warnSignatureBreak: () => true,
      recogniseFirst: () => Promise.resolve(undefined),
      tableEngines: () => ['automatic' as const],
      track: () => ({ signal: new AbortController().signal, step: () => undefined, end: () => undefined }),
      docusignReady: () => true,
      servicesReady: () => false,
      ocrLanguages: () => [],
      settings,
    };
  }

  for (const { name, occasion, build } of builds) {
    it(`${name}: a stop sends nothing and opens nothing`, async () => {
      const deps = bag(false);
      await build(deps).run(CONTEXT);
      expect(deps.settled).toStrictEqual([{ docId: DOC, occasion }]);
      expect(deps.sent).toStrictEqual([]);
      expect(deps.asked).toStrictEqual([]);
    });

    it(`${name}: CONTROL — going ahead reaches the command’s own first step`, async () => {
      // WITHOUT THIS the case above passes for a command whose deps were wrong enough that it never did anything.
      const deps = bag(true);
      await build(deps).run(CONTEXT);
      expect(deps.settled).toStrictEqual([{ docId: DOC, occasion }]);
      expect(deps.sent.length + deps.asked.length).toBeGreaterThan(0);
    });
  }
});
