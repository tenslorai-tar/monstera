import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '../registries/commands.js';
import { UNTRACKED } from '../runningTask.js';
import {
  appendMarkdownCommand,
  insertImageCommand,
  newFromCaptureCommand,
  newFromCsvCommand,
  newFromImagesCommand,
  newFromMarkdownCommand,
  newFromOfficeCommand,
} from './importMarkdown.js';
import { namedWorkSetAside } from './namedWorkSetAside.js';

/**
 * The UI half of D9's Markdown row: which channel each control reaches, with what,
 * and where each answer goes.
 *
 * Every case asserts a CALL, for `documentCommands.test.ts`' reason: a dismissal and
 * a failure both leave the screen unchanged, so the state tells nothing apart.
 */

const DOC = asDocId('doc-1');
const COMPOSED = asDocId('doc-9');

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: DOC,
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  // THE PAGE IS NOT THE END. An append that sent `page + 1` instead of the count
  // would pass a fixture where the two agree.
  page: 3,
  pageCount: 10,
  openDocuments: [{ docId: DOC, version: asDocVersion(1), byteLength: 20, name: 'This one' }],
};

/** A client that records every call and answers each channel from a table. */
/** The computer's fonts as main lists them, which the insert question is handed for its picker (D1). */
const FONTS = {
  listed: true,
  families: [{ name: 'Tinos', origin: 'bundled' as const, embedding: 'subset' as const, bold: true, italic: true, looksLike: 'Times New Roman' }],
  more: 0,
};

function recording(answers: Readonly<Record<string, unknown>>): {
  readonly client: ContractClient;
  readonly sent: { id: string; params: unknown }[];
} {
  const sent: { id: string; params: unknown }[] = [];
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    const answer = id === 'app.fontFamilies' && answers[id] === undefined ? ok(FONTS) : answers[id];
    if (answer === undefined) throw new Error(`this case does not answer ${id}`);
    return Promise.resolve(answer);
  });
  return { client, sent };
}

/** Every callback a command can make, recorded in order. */
const STAMP = () => ({ author: 'A. Tester', created: '2026-09-24T09:38:00.000Z' });
/** No document here is signed (ADR-0149), so a copy opened for an edit is a defect of the case. */
const signatures = {
  warn: () => true,
  onOpened: () => {
    throw new Error('a case opened a copy for an edit without asking for one');
  },
};

function callbacks(
  position: unknown = { at: 10, family: 'Tinos' },
  // A DEFAULT PARAMETER CANNOT SAY *CLOSED*: an explicit `undefined` takes the default, so the closed question is its own flag.
  closed = false,
): {
  readonly calls: { name: string; value: unknown }[];
  readonly where: { id: string; props: unknown }[];
  readonly record: (name: string) => (value: unknown) => void;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
} {
  const calls: { name: string; value: unknown }[] = [];
  const where: { id: string; props: unknown }[] = [];
  const record = (name: string) => (value: unknown) => {
    calls.push({ name, value });
  };
  return {
    calls,
    where,
    record,
    ask: (id, props) => {
      // THE POSITION QUESTION IS ANSWERED AND KEPT APART, so every case about what comes after it reads the same list as
      // before: it asks where first, and `position` is what the person answered (the end, as the command always did).
      if (id === 'dialog.insert-markdown' || id === 'dialog.insert-images') {
        where.push({ id, props });
        return Promise.resolve(closed ? undefined : position);
      }
      // THE NEW DOCUMENT'S FONT (the owner's L4) is the same kind of question, asked first and kept apart, answered with a
      // family that is not the default so a command that sent Arimo whatever was chosen fails.
      if (id === 'dialog.new-from-text') {
        where.push({ id, props });
        return Promise.resolve(closed ? undefined : { family: 'Tinos' });
      }
      calls.push({ name: 'ask', value: { id, props } });
      return Promise.resolve(undefined);
    },
  };
}

describe('newFromMarkdownCommand', () => {
  it('SENDS THE FONT CHOSEN AND NOTHING ELSE, and adds the composed document as a tab', async () => {
    const { client, sent } = recording({
      'document.newFromMarkdown': ok({
        kind: 'opened',
        docId: COMPOSED,
        version: asDocVersion(1),
        byteLength: 4096,
        name: 'notes.pdf',
      }),
    });
    const { calls, where, record, ask } = callbacks();

    await newFromMarkdownCommand({ track: UNTRACKED,
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    // THE FONT QUESTION FIRST, handed this computer's list, and its answer is what the channel carries (the owner's L4).
    expect(where).toStrictEqual([{ id: 'dialog.new-from-text', props: { fonts: FONTS } }]);
    expect(namedWorkSetAside(sent)).toStrictEqual([
      { id: 'app.fontFamilies', params: {} },
      { id: 'document.newFromMarkdown', params: { family: 'Tinos' } },
    ]);
    expect(calls).toStrictEqual([
      {
        name: 'opened',
        value: { docId: COMPOSED, version: 1, byteLength: 4096, name: 'notes.pdf' },
      },
    ]);
  });

  it('CONTROL: a dismissal opens nothing and says nothing', async () => {
    const { client } = recording({ 'document.newFromMarkdown': ok({ kind: 'cancelled' }) });
    const { calls, record, ask } = callbacks();

    await newFromMarkdownCommand({ track: UNTRACKED,
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    expect(calls).toStrictEqual([]);
  });

  it('CONTROL: the font question closed unanswered picks no file — the channel is never called', async () => {
    // ASSERTED AS THE CALL NOT MADE: the channel's own picker would also open nothing if dismissed, so an end state could
    // not tell a command that skipped the question's answer from one that honoured it.
    const { client, sent } = recording({});
    const { calls, record, ask } = callbacks(undefined, true);

    await newFromMarkdownCommand({ track: UNTRACKED,
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    expect(sent.map((call) => call.id)).toStrictEqual(['app.fontFamilies']);
    expect(calls).toStrictEqual([]);
  });

  it('OPENS the tab, THEN names every character drawn as a box — CONTROL: a document with none asks nothing', async () => {
    const boxed = [{ character: '中', line: 12, column: 4 }];
    const opened = { docId: COMPOSED, version: 1, byteLength: 2048, name: 'notes.pdf' };
    const { client } = recording({
      'document.newFromMarkdown': ok({ kind: 'opened-with-boxes', ...opened, boxed, more: 3, skipped: [], skippedMore: 0 }),
    });
    const { calls, record, ask } = callbacks();

    await newFromMarkdownCommand({ track: UNTRACKED,
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    // THE ORDER IS THE ASSERTION: the list is read beside the document, so the tab comes first.
    expect(calls).toStrictEqual([
      { name: 'opened', value: opened },
      { name: 'ask', value: { id: 'dialog.boxed-characters', props: { from: 'import', boxed, more: 3 } } },
    ]);

    const plain = recording({ 'document.newFromMarkdown': ok({ kind: 'opened', ...opened }) });
    const after = callbacks();
    await newFromMarkdownCommand({ track: UNTRACKED,
      client: plain.client,
      ask: after.ask,
      onOpened: after.record('opened'),
      onAlreadyOpen: after.record('already-open'),
    }).run(CONTEXT);
    expect(after.calls).toStrictEqual([{ name: 'opened', value: opened }]);
  });

  it('REPORTS an installation with no compose host as a refusal, not silence', async () => {
    const { client } = recording({
      'document.newFromMarkdown': err({ code: 'engine-unavailable' }),
    });
    const { calls, record, ask } = callbacks();

    await newFromMarkdownCommand({ track: UNTRACKED,
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    expect(calls).toStrictEqual([
      {
        name: 'ask',
        value: { id: 'dialog.command-problem', props: { code: 'engine-unavailable' } },
      },
    ]);
  });
});

describe('appendMarkdownCommand', () => {
  it('SENDS THE DOCUMENT AND ITS PAGE COUNT, rebuilds it, adds the tab and returns to it', async () => {
    const { client, sent } = recording({
      'document.appendMarkdown': ok({
        kind: 'appended',
        version: asDocVersion(2),
        byteLength: 8192,
        historyDropped: 0,
        opened: { docId: COMPOSED, version: asDocVersion(1), byteLength: 4096, name: 'notes.pdf' },
        boxed: [],
        more: 0,
      }),
    });
    const { calls, record, ask } = callbacks();

    await appendMarkdownCommand({ track: UNTRACKED,
      client,
      ask,
      stamp: STAMP,
      signatures,
      onApplied: record('applied'),
      onOpened: record('opened'),
      onActivate: record('activate'),
    }).run(CONTEXT);

    // `at: 10`, the page count, and not 4: the pages go at the END. And the FAMILY the question answered, never the default.
    expect(namedWorkSetAside(sent)).toStrictEqual([
      { id: 'app.fontFamilies', params: {} },
      { id: 'document.appendMarkdown', params: { docId: DOC, at: 10, family: 'Tinos' } },
    ]);
    // THE ORDER IS THE DECISION. `applied` names the active document, so it must run
    // before the composed tab is added and activated; `activate` last brings the
    // target back, and a command that skipped it leaves the reader on the new tab.
    expect(calls).toStrictEqual([
      { name: 'applied', value: { version: 2, byteLength: 8192 } },
      {
        name: 'opened',
        value: { docId: COMPOSED, version: 1, byteLength: 4096, name: 'notes.pdf' },
      },
      { name: 'activate', value: DOC },
    ]);
  });

  it('ASKS WHERE FIRST and sends the position chosen: at the start is 0, after page 3 is 3 — CONTROL: closing the question sends nothing', async () => {
    const appended = ok({
      kind: 'appended',
      version: asDocVersion(2),
      byteLength: 8192,
      historyDropped: 0,
      opened: { docId: COMPOSED, version: asDocVersion(1), byteLength: 4096, name: 'notes.pdf' },
      boxed: [],
      more: 0,
    });
    const run = async (
      position: unknown,
      closed = false,
    ): Promise<{ sent: { id: string; params: unknown }[]; where: { id: string; props: unknown }[] }> => {
      const { client, sent } = recording({ 'document.appendMarkdown': appended });
      const { record, ask, where } = callbacks(position, closed);
      await appendMarkdownCommand({ track: UNTRACKED,
        client,
        ask,
        stamp: STAMP,
        signatures,
        onApplied: record('applied'),
        onOpened: record('opened'),
        onActivate: record('activate'),
      }).run(CONTEXT);
      return { sent, where };
    };

    const start = await run({ at: 0, family: 'Arimo' });
    // THE QUESTION CARRIES THE DOCUMENT'S OWN SIZE, THE PAGE ON SHOW AND MAIN'S FONT LIST, which bound and seed its answer.
    expect(start.where).toStrictEqual([{ id: 'dialog.insert-markdown', props: { pageCount: 10, page: 3, fonts: FONTS } }]);
    const appendsOf = (sent: { id: string; params: unknown }[]) =>
      namedWorkSetAside(sent).filter((each) => each.id === 'document.appendMarkdown');
    expect(appendsOf(start.sent)).toStrictEqual([{ id: 'document.appendMarkdown', params: { docId: DOC, at: 0, family: 'Arimo' } }]);
    expect(appendsOf((await run({ at: 3, family: 'Tinos' })).sent)).toStrictEqual([
      { id: 'document.appendMarkdown', params: { docId: DOC, at: 3, family: 'Tinos' } },
    ]);
    // CONTROL: a question closed unanswered is a change of mind. Nothing is picked, composed or written.
    expect(appendsOf((await run(undefined, true)).sent)).toStrictEqual([]);
  });

  it('NAMES the characters the added pages draw as boxes, after the document is back in front', async () => {
    const boxed = [{ character: '中', line: 2, column: null }];
    const { client } = recording({
      'document.appendMarkdown': ok({
        kind: 'appended',
        version: asDocVersion(2),
        byteLength: 8192,
        historyDropped: 0,
        opened: { docId: COMPOSED, version: asDocVersion(1), byteLength: 4096, name: 'notes.pdf' },
        boxed,
        more: 0,
      }),
    });
    const { calls, record, ask } = callbacks();

    await appendMarkdownCommand({ track: UNTRACKED,
      client,
      ask,
      stamp: STAMP,
      signatures,
      onApplied: record('applied'),
      onOpened: record('opened'),
      onActivate: record('activate'),
    }).run(CONTEXT);

    expect(calls.map((call) => call.name)).toStrictEqual(['applied', 'opened', 'activate', 'ask']);
    expect(calls.at(-1)).toStrictEqual({
      name: 'ask',
      value: { id: 'dialog.boxed-characters', props: { from: 'import', boxed, more: 0 } },
    });
  });

  it('CONTROL: a file past the bound rebuilds nothing and carries the limit', async () => {
    const { client } = recording({
      'document.appendMarkdown': ok({ kind: 'too-large', limitBytes: 4_194_304, fileBytes: 5_000_000 }),
    });
    const { calls, record, ask } = callbacks();

    await appendMarkdownCommand({ track: UNTRACKED,
      client,
      ask,
      stamp: STAMP,
      signatures,
      onApplied: record('applied'),
      onOpened: record('opened'),
      onActivate: record('activate'),
    }).run(CONTEXT);

    expect(calls).toStrictEqual([
      {
        name: 'ask',
        value: {
          id: 'dialog.markdown-import-problem',
          props: { reason: 'too-large', limitBytes: 4_194_304, fileBytes: 5_000_000 },
        },
      },
    ]);
  });

  it('SAYS THE PDF WAS SAVED when it was written and could not be opened', async () => {
    const { client } = recording({
      'document.appendMarkdown': ok({ kind: 'at-capacity', wouldHold: 10, ceiling: 5 }),
    });
    const { calls, record, ask } = callbacks();

    await appendMarkdownCommand({ track: UNTRACKED,
      client,
      ask,
      stamp: STAMP,
      signatures,
      onApplied: record('applied'),
      onOpened: record('opened'),
      onActivate: record('activate'),
    }).run(CONTEXT);

    expect(calls).toStrictEqual([
      { name: 'ask', value: { id: 'dialog.markdown-import-problem', props: { reason: 'at-capacity' } } },
    ]);
  });
});

describe('insertImageCommand (O3)', () => {
  const inserted = (skipped: readonly { reason: 'image-unreadable'; line: null; file: string }[] = []) =>
    ok({
      kind: 'inserted',
      version: asDocVersion(2),
      byteLength: 8192,
      historyDropped: 0,
      opened: { docId: COMPOSED, version: asDocVersion(1), byteLength: 4096, name: 'pictures.pdf' },
      skipped,
      skippedMore: 0,
    });
  const run = async (
    answer: unknown,
    position: unknown = { at: 0 },
    closed = false,
    context: CommandContext = CONTEXT,
  ): Promise<ReturnType<typeof callbacks> & { readonly sent: { id: string; params: unknown }[] }> => {
    const { client, sent } = recording({ 'document.insertImage': answer });
    const recorded = callbacks(position, closed);
    await insertImageCommand({ track: UNTRACKED,
      client,
      ask: recorded.ask,
      stamp: STAMP,
      signatures,
      onApplied: recorded.record('applied'),
      onOpened: recorded.record('opened'),
      onActivate: recorded.record('activate'),
    }).run(context);
    return { ...recorded, sent };
  };

  it('ASKS WHERE FIRST, after the page on show, then SENDS TWO NUMBERS AND NO BYTES: the position the question answered', async () => {
    // `at: 0` IS NOT `page + 1` (4), so a command that ignored the answer and kept the old *after this page* fails here.
    const { where, sent, calls } = await run(inserted(), { at: 0 });
    expect(where).toStrictEqual([{ id: 'dialog.insert-images', props: { pageCount: 10, page: 3 } }]);
    expect(namedWorkSetAside(sent)).toStrictEqual([{ id: 'document.insertImage', params: { docId: DOC, at: 0 } }]);
    // REBUILT, THE TAB ADDED, AND THE PERSON BACK ON THE DOCUMENT they inserted into, `appendMarkdownCommand`'s order.
    expect(calls).toStrictEqual([
      { name: 'applied', value: { version: 2, byteLength: 8192 } },
      { name: 'opened', value: { docId: COMPOSED, version: 1, byteLength: 4096, name: 'pictures.pdf' } },
      { name: 'activate', value: DOC },
    ]);
  });

  it('the question opens after the LAST TICKED page (ADR-0104) — CONTROL for the page on show above', async () => {
    const { where } = await run(inserted(), { at: 8 }, false, { ...CONTEXT, selectedPages: [1, 7] });
    expect(where).toStrictEqual([{ id: 'dialog.insert-images', props: { pageCount: 10, page: 7 } }]);
  });

  it('CONTROL: a question closed unanswered picks nothing and sends nothing', async () => {
    const { sent, calls } = await run(inserted(), undefined, true);
    expect(sent).toStrictEqual([]);
    expect(calls).toStrictEqual([]);
  });

  it('NAMES THE PICTURES LEFT OUT, by file, after the document is back in front', async () => {
    const skipped = [{ reason: 'image-unreadable' as const, line: null, file: 'scan 4.png' }];
    const { calls } = await run(inserted(skipped));
    expect(calls.map((call) => call.name)).toStrictEqual(['applied', 'opened', 'activate', 'ask']);
    expect(calls.at(-1)).toStrictEqual({ name: 'ask', value: { id: 'dialog.import-skipped', props: { skipped, more: 0 } } });
  });

  it('REPORTS what an import of pictures can end in — too many, and a picture past the bound — and rebuilds nothing', async () => {
    const tooMany = await run(ok({ kind: 'too-many-images', limit: 500 }));
    expect(tooMany.calls).toStrictEqual([
      { name: 'ask', value: { id: 'dialog.markdown-import-problem', props: { reason: 'too-many-images', limit: 500 } } },
    ]);
    const tooLarge = await run(ok({ kind: 'too-large', limitBytes: 67_108_864, fileBytes: 71_200_000 }));
    expect(tooLarge.calls).toStrictEqual([
      {
        name: 'ask',
        value: { id: 'dialog.markdown-import-problem', props: { reason: 'too-large', limitBytes: 67_108_864, fileBytes: 71_200_000 } },
      },
    ]);
    // CONTROL: a dismissed picker is a change of mind and says nothing.
    expect((await run(ok({ kind: 'cancelled' }))).calls).toStrictEqual([]);
  });
});

describe('newFromCsvCommand', () => {
  it('SENDS THE FONT CHOSEN on its OWN channel and adds the composed table as a tab', async () => {
    // THE CHANNEL IS THE DECISION: a CSV command that dispatched on
    // `document.newFromMarkdown` would open a picker for the wrong format and every
    // outcome below would still read correctly.
    const { client, sent } = recording({
      'document.newFromCsv': ok({
        kind: 'opened',
        docId: COMPOSED,
        version: asDocVersion(1),
        byteLength: 2048,
        name: 'table.pdf',
      }),
    });
    const { calls, record, ask } = callbacks();

    await newFromCsvCommand({
      client,
      ask,
      track: UNTRACKED,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    // THE WORK IS NAMED, so a file composed in parts is shown and can be stopped (`withWorkProgress`), and the table is
    // set in the family the font question answered (the owner's L4).
    expect(sent.map((call) => call.id)).toStrictEqual(['app.fontFamilies', 'document.newFromCsv']);
    expect((sent[1]?.params as { work?: unknown }).work).toMatch(/^[0-9a-f-]{36}$/u);
    expect((sent[1]?.params as { family?: unknown }).family).toBe('Tinos');
    expect(calls).toStrictEqual([
      { name: 'opened', value: { docId: COMPOSED, version: 1, byteLength: 2048, name: 'table.pdf' } },
    ]);
  });

  it('NAMES THE LINE of a malformed record, and CONTROL: an empty file is its own reason, with no line', async () => {
    // EACH REASON asserted, because the mapping this command shares used to send every reason it did not name to
    // `nothing-to-draw`. A table's width is no reason (`composeTable.ts` fits every table), and neither is a
    // character (ADR-0172: one no font draws is a box).
    const cases = [
      { reason: 'malformed-csv', props: { reason: 'malformed-csv', line: 7 } },
      { reason: 'nothing-to-draw', props: { reason: 'nothing-to-draw' } },
    ] as const;
    for (const { reason, props } of cases) {
      const { client } = recording({
        'document.newFromCsv': ok({ kind: 'composition-refused', reason, line: 7, file: null }),
      });
      const { calls, record, ask } = callbacks();

      await newFromCsvCommand({
        client,
        ask,
        track: UNTRACKED,
        onOpened: record('opened'),
        onAlreadyOpen: record('already-open'),
      }).run(CONTEXT);

      expect(calls).toStrictEqual([{ name: 'ask', value: { id: 'dialog.markdown-import-problem', props } }]);
    }
  });

  it('OPENS the table, THEN names the characters it draws as boxes', async () => {
    const boxed = [{ character: '中', line: 4, column: 1 }];
    const opened = { docId: COMPOSED, version: 1, byteLength: 2048, name: 'table.pdf' };
    const { client } = recording({
      'document.newFromCsv': ok({ kind: 'opened-with-boxes', ...opened, boxed, more: 0, skipped: [], skippedMore: 0 }),
    });
    const { calls, record, ask } = callbacks();
    await newFromCsvCommand({ client, ask, track: UNTRACKED, onOpened: record('opened'), onAlreadyOpen: record('already-open') }).run(CONTEXT);
    expect(calls).toStrictEqual([
      { name: 'opened', value: opened },
      { name: 'ask', value: { id: 'dialog.boxed-characters', props: { from: 'import', boxed, more: 0 } } },
    ]);
  });

  it('OPENS the table, THEN names each record it LEFT OUT by its line (Codex’s importer audit)', async () => {
    const skipped = [{ reason: 'quote-never-closed' as const, line: 7, file: null }];
    const opened = { docId: COMPOSED, version: 1, byteLength: 2048, name: 'table.pdf' };
    const { client } = recording({ 'document.newFromCsv': ok({ kind: 'opened-with-skips', ...opened, skipped, skippedMore: 1 }) });
    const { calls, record, ask } = callbacks();
    await newFromCsvCommand({ client, ask, track: UNTRACKED, onOpened: record('opened'), onAlreadyOpen: record('already-open') }).run(CONTEXT);
    expect(calls).toStrictEqual([
      { name: 'opened', value: opened },
      { name: 'ask', value: { id: 'dialog.import-skipped', props: { skipped, more: 1 } } },
    ]);
  });

  it('CONTROL: a table with both boxes and records left out names both, boxes first', async () => {
    const boxed = [{ character: '中', line: 4, column: 1 }];
    const skipped = [{ reason: 'text-after-quote' as const, line: 2, file: null }];
    const opened = { docId: COMPOSED, version: 1, byteLength: 2048, name: 'table.pdf' };
    const { client } = recording({
      'document.newFromCsv': ok({ kind: 'opened-with-boxes', ...opened, boxed, more: 0, skipped, skippedMore: 0 }),
    });
    const { calls, record, ask } = callbacks();
    await newFromCsvCommand({ client, ask, track: UNTRACKED, onOpened: record('opened'), onAlreadyOpen: record('already-open') }).run(CONTEXT);
    expect(calls.map((call) => (call.name === 'ask' ? (call.value as { id: string }).id : call.name))).toStrictEqual([
      'opened',
      'dialog.boxed-characters',
      'dialog.import-skipped',
    ]);
  });
});

describe('newFromOfficeCommand (ADR-0120)', () => {
  it('SENDS NOTHING on its OWN channel and adds the converted PDF as a tab', async () => {
    // THE CHANNEL IS THE DECISION, `newFromCsvCommand`'s reason.
    const { client, sent } = recording({
      'document.newFromOffice': ok({
        kind: 'opened',
        docId: COMPOSED,
        version: asDocVersion(1),
        byteLength: 4096,
        name: 'Budget.pdf',
      }),
    });
    const { calls, record, ask } = callbacks();

    await newFromOfficeCommand({ track: UNTRACKED,
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    expect(namedWorkSetAside(sent)).toStrictEqual([{ id: 'document.newFromOffice', params: {} }]);
    expect(calls).toStrictEqual([
      { name: 'opened', value: { docId: COMPOSED, version: 1, byteLength: 4096, name: 'Budget.pdf' } },
    ]);
  });

  it('OPENS the workbook’s PDF and then NAMES the rows it lacks (decision C)', async () => {
    const missing = [
      { sheet: 'Data', from: 38_251, to: 50_000 },
      { sheet: 'Totals', from: 1, to: 4 },
    ];
    const { client } = recording({
      'document.newFromOffice': ok({
        kind: 'opened-incomplete',
        docId: COMPOSED,
        version: asDocVersion(1),
        byteLength: 4096,
        name: 'Budget.pdf',
        missing,
        more: 3,
      }),
    });
    const { calls, record, ask } = callbacks();

    await newFromOfficeCommand({ track: UNTRACKED,
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    // THE TAB FIRST, THEN THE LIST: the person reads which rows are missing beside the document that lacks them.
    expect(calls).toStrictEqual([
      { name: 'opened', value: { docId: COMPOSED, version: 1, byteLength: 4096, name: 'Budget.pdf' } },
      // ITS OWN DIALOG, since the import finished; and the count past the named ones rides with them.
      { name: 'ask', value: { id: 'dialog.workbook-incomplete', props: { missing, more: 3 } } },
    ]);
  });

  it('TELLS the person when the converter made no PDF — its own reason, not an unreadable file', async () => {
    const { client } = recording({ 'document.newFromOffice': ok({ kind: 'conversion-failed' }) });
    const { calls, record, ask } = callbacks();

    await newFromOfficeCommand({ track: UNTRACKED,
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    expect(calls).toStrictEqual([
      { name: 'ask', value: { id: 'dialog.markdown-import-problem', props: { reason: 'conversion-failed' } } },
    ]);
  });

  it('CONTROL: a dismissal asks nothing', async () => {
    const { client } = recording({ 'document.newFromOffice': ok({ kind: 'cancelled' }) });
    const { calls, record, ask } = callbacks();

    await newFromOfficeCommand({ track: UNTRACKED,
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    expect(calls).toStrictEqual([]);
  });
});

describe('newFromImagesCommand', () => {
  it('SENDS NOTHING on its OWN channel and adds the composed document as a tab', async () => {
    // THE CHANNEL IS THE DECISION, `newFromCsvCommand`'s reason: a command dispatching on
    // another import's channel would open the wrong picker and read correctly here.
    const { client, sent } = recording({
      'document.newFromImages': ok({
        kind: 'opened',
        docId: COMPOSED,
        version: asDocVersion(1),
        byteLength: 8192,
        name: 'scans.pdf',
      }),
    });
    const { calls, record, ask } = callbacks();

    await newFromImagesCommand({ track: UNTRACKED,
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    expect(namedWorkSetAside(sent)).toStrictEqual([{ id: 'document.newFromImages', params: {} }]);
    expect(calls).toStrictEqual([
      { name: 'opened', value: { docId: COMPOSED, version: 1, byteLength: 8192, name: 'scans.pdf' } },
    ]);
  });

  it('OPENS the pages it made, THEN names each picture it LEFT OUT by its file (Codex’s importer audit)', async () => {
    const skipped = [{ reason: 'image-unreadable' as const, line: null, file: 'scan 3.png' }];
    const { client } = recording({
      'document.newFromImages': ok({ kind: 'opened-with-skips', docId: COMPOSED, version: asDocVersion(1), byteLength: 8192, name: 'scans.pdf', skipped, skippedMore: 0 }),
    });
    const { calls, record, ask } = callbacks();
    await newFromImagesCommand({ track: UNTRACKED, client, ask, onOpened: record('opened'), onAlreadyOpen: record('already-open') }).run(CONTEXT);
    expect(calls).toStrictEqual([
      { name: 'opened', value: { docId: COMPOSED, version: 1, byteLength: 8192, name: 'scans.pdf' } },
      { name: 'ask', value: { id: 'dialog.import-skipped', props: { skipped, more: 0 } } },
    ]);
  });

  it('NAMES THE FILE of a per-image refusal, and states the set’s two bounds', async () => {
    // FOUR ANSWERS, FOUR PROPS. The per-image reasons must carry the NAME and not a line —
    // a mapping that reused `line` would hand the dialog `null` and lose the file.
    const cases = [
      [
        { kind: 'composition-refused', reason: 'image-unreadable', line: null, file: 'scan 3.png' },
        { reason: 'image-unreadable', file: 'scan 3.png' },
      ],
      [
        { kind: 'composition-refused', reason: 'too-many-pixels', line: null, file: 'huge.png' },
        { reason: 'too-many-pixels', file: 'huge.png' },
      ],
      [{ kind: 'too-many-images', limit: 500 }, { reason: 'too-many-images', limit: 500 }],
      [
        { kind: 'images-too-large', limitBytes: 268_435_456 },
        { reason: 'images-too-large', limitBytes: 268_435_456 },
      ],
    ] as const;

    for (const [answer, props] of cases) {
      const { client } = recording({ 'document.newFromImages': ok(answer) });
      const { calls, record, ask } = callbacks();

      await newFromImagesCommand({ track: UNTRACKED,
        client,
        ask,
        onOpened: record('opened'),
        onAlreadyOpen: record('already-open'),
      }).run(CONTEXT);

      expect(calls).toStrictEqual([{ name: 'ask', value: { id: 'dialog.markdown-import-problem', props } }]);
    }
  });
});

describe('newFromCaptureCommand', () => {
  const FRAME = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0);

  /** An `ask` answering the capture dialog with `taken`, and recording every ask. */
  function asking(taken: unknown): {
    readonly asked: { id: string; props: unknown }[];
    readonly ask: (id: string, props: unknown) => Promise<unknown>;
  } {
    const asked: { id: string; props: unknown }[] = [];
    return {
      asked,
      ask: (id, props) => {
        asked.push({ id, props });
        return Promise.resolve(id === 'dialog.camera-capture' ? taken : undefined);
      },
    };
  }

  it('SENDS THE FRAMES the capture dialog answered, on its own channel, and adds the tab', async () => {
    const { client, sent } = recording({
      'document.newFromCapture': ok({
        kind: 'opened',
        docId: COMPOSED,
        version: asDocVersion(1),
        byteLength: 1024,
        name: 'camera.pdf',
      }),
    });
    const { asked, ask } = asking({ frames: [FRAME] });
    const opened: unknown[] = [];

    await newFromCaptureCommand({ track: UNTRACKED,
      client,
      ask,
      onOpened: (document) => {
        opened.push(document);
      },
      onAlreadyOpen: () => undefined,
    }).run(CONTEXT);

    expect(asked).toStrictEqual([{ id: 'dialog.camera-capture', props: {} }]);
    expect(namedWorkSetAside(sent)).toStrictEqual([{ id: 'document.newFromCapture', params: { frames: [FRAME] } }]);
    expect(opened).toStrictEqual([{ docId: COMPOSED, version: 1, byteLength: 1024, name: 'camera.pdf' }]);
  });

  it('CONTROL: a dismissed capture dialog, or an answer that is not JPEG, sends NOTHING', async () => {
    // THE SECOND ANSWER IS ONE A LOOSER SCHEMA WOULD SEND: bytes, but not a JPEG's.
    for (const taken of [undefined, { frames: [Uint8Array.of(0x89, 0x50, 0x4e, 0x47)] }]) {
      const { client, sent } = recording({});
      await newFromCaptureCommand({ track: UNTRACKED,
        client,
        ask: asking(taken).ask,
        onOpened: () => undefined,
        onAlreadyOpen: () => undefined,
      }).run(CONTEXT);
      expect(sent).toStrictEqual([]);
    }
  });
});
