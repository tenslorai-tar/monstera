import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '../registries/commands.js';
import {
  appendMarkdownCommand,
  newFromCsvCommand,
  newFromImagesCommand,
  newFromMarkdownCommand,
} from './importMarkdown.js';

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

/** Every callback a command can make, recorded in order. */
function callbacks(): {
  readonly calls: { name: string; value: unknown }[];
  readonly record: (name: string) => (value: unknown) => void;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
} {
  const calls: { name: string; value: unknown }[] = [];
  const record = (name: string) => (value: unknown) => {
    calls.push({ name, value });
  };
  return {
    calls,
    record,
    ask: (id, props) => {
      calls.push({ name: 'ask', value: { id, props } });
      return Promise.resolve(undefined);
    },
  };
}

describe('newFromMarkdownCommand', () => {
  it('SENDS NOTHING and adds the composed document as a tab', async () => {
    const { client, sent } = recording({
      'document.newFromMarkdown': ok({
        kind: 'opened',
        docId: COMPOSED,
        version: asDocVersion(1),
        byteLength: 4096,
        name: 'notes.pdf',
      }),
    });
    const { calls, record, ask } = callbacks();

    await newFromMarkdownCommand({
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([{ id: 'document.newFromMarkdown', params: {} }]);
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

    await newFromMarkdownCommand({
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    expect(calls).toStrictEqual([]);
  });

  it('NAMES THE LINE of a character the fonts cannot draw', async () => {
    const { client } = recording({
      'document.newFromMarkdown': ok({
        kind: 'composition-refused',
        reason: 'unencodable-text',
        line: 12,
        file: null,
      }),
    });
    const { calls, record, ask } = callbacks();

    await newFromMarkdownCommand({
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    expect(calls).toStrictEqual([
      {
        name: 'ask',
        value: {
          id: 'dialog.markdown-import-problem',
          props: { reason: 'unencodable-text', line: 12 },
        },
      },
    ]);
  });

  it('REPORTS an installation with no compose host as a refusal, not silence', async () => {
    const { client } = recording({
      'document.newFromMarkdown': err({ code: 'engine-unavailable' }),
    });
    const { calls, record, ask } = callbacks();

    await newFromMarkdownCommand({
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
      }),
    });
    const { calls, record, ask } = callbacks();

    await appendMarkdownCommand({
      client,
      ask,
      onApplied: record('applied'),
      onOpened: record('opened'),
      onActivate: record('activate'),
    }).run(CONTEXT);

    // `at: 10`, the page count, and not 4: the pages go at the END.
    expect(sent).toStrictEqual([{ id: 'document.appendMarkdown', params: { docId: DOC, at: 10 } }]);
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

  it('CONTROL: a file past the bound rebuilds nothing and carries the limit', async () => {
    const { client } = recording({
      'document.appendMarkdown': ok({ kind: 'too-large', limitBytes: 4_194_304 }),
    });
    const { calls, record, ask } = callbacks();

    await appendMarkdownCommand({
      client,
      ask,
      onApplied: record('applied'),
      onOpened: record('opened'),
      onActivate: record('activate'),
    }).run(CONTEXT);

    expect(calls).toStrictEqual([
      {
        name: 'ask',
        value: {
          id: 'dialog.markdown-import-problem',
          props: { reason: 'too-large', limitBytes: 4_194_304 },
        },
      },
    ]);
  });

  it('SAYS THE PDF WAS SAVED when it was written and could not be opened', async () => {
    const { client } = recording({
      'document.appendMarkdown': ok({ kind: 'at-capacity', wouldHold: 10, ceiling: 5 }),
    });
    const { calls, record, ask } = callbacks();

    await appendMarkdownCommand({
      client,
      ask,
      onApplied: record('applied'),
      onOpened: record('opened'),
      onActivate: record('activate'),
    }).run(CONTEXT);

    expect(calls).toStrictEqual([
      { name: 'ask', value: { id: 'dialog.markdown-import-problem', props: { reason: 'at-capacity' } } },
    ]);
  });
});

describe('newFromCsvCommand', () => {
  it('SENDS NOTHING on its OWN channel and adds the composed table as a tab', async () => {
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
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([{ id: 'document.newFromCsv', params: {} }]);
    expect(calls).toStrictEqual([
      { name: 'opened', value: { docId: COMPOSED, version: 1, byteLength: 2048, name: 'table.pdf' } },
    ]);
  });

  it('NAMES THE LINE of a malformed record, and CONTROL: a too-wide table is its own reason', async () => {
    // TWO REASONS added for CSV, each asserted, because the mapping this command
    // shares used to send every reason it did not name to `nothing-to-draw`.
    for (const reason of ['malformed-csv', 'too-many-columns'] as const) {
      const { client } = recording({
        'document.newFromCsv': ok({ kind: 'composition-refused', reason, line: 7, file: null }),
      });
      const { calls, record, ask } = callbacks();

      await newFromCsvCommand({
        client,
        ask,
        onOpened: record('opened'),
        onAlreadyOpen: record('already-open'),
      }).run(CONTEXT);

      expect(calls).toStrictEqual([
        { name: 'ask', value: { id: 'dialog.markdown-import-problem', props: { reason, line: 7 } } },
      ]);
    }
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

    await newFromImagesCommand({
      client,
      ask,
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([{ id: 'document.newFromImages', params: {} }]);
    expect(calls).toStrictEqual([
      { name: 'opened', value: { docId: COMPOSED, version: 1, byteLength: 8192, name: 'scans.pdf' } },
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

      await newFromImagesCommand({
        client,
        ask,
        onOpened: record('opened'),
        onAlreadyOpen: record('already-open'),
      }).run(CONTEXT);

      expect(calls).toStrictEqual([{ name: 'ask', value: { id: 'dialog.markdown-import-problem', props } }]);
    }
  });
});
