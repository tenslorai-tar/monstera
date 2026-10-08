import { blockEditOf, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok, type MessageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_PROBLEM_UNAUTHORISED,
  TOAST_NOTHING_SELECTED,
  TOAST_NOTHING_TO_TRANSLATE,
  TOAST_PAGES_TRANSLATED,
  TOAST_PAGES_TRANSLATED_PARTLY,
  TOAST_PAGE_TRANSLATED,
  TOAST_TEXT_TRANSLATED,
  TOAST_TRANSLATE_NOT_WRITABLE,
} from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import type { TrackedTask } from '../runningTask.js';
import { translatePageCommand } from './translatePage.js';

/**
 * *Translate this page* (ADR-0097), as the calls it makes — the dialog, the model list, the
 * translation, and the ONE write — and as the calls it does not make on every other ending.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000c1');
const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: DOC,
  version: asDocVersion(4),
  hasSelection: false,
  dirty: false,
  // NOT PAGE 0, so a command that sent a literal would be caught.
  page: 2,
  pageCount: 5,
  openDocuments: [],
};
const BLOCKS = [{ lines: [[3]], soft: [false], text: 'Facture' }];

interface Run {
  readonly sent: { id: string; params: unknown }[];
  readonly asked: { id: string; props: unknown }[];
  readonly said: { kind: string; message: MessageKey }[];
  readonly applied: unknown[];
}

async function run(options: {
  readonly answers?: Readonly<Record<string, unknown>>;
  /** A channel's failure, as the wire carries it: a code, and the detail a code declares one for (ADR-0169). */
  readonly failures?: Readonly<Record<string, { readonly code: string; readonly detail?: unknown }>>;
  readonly dialog?: unknown;
  readonly stored?: readonly string[];
  readonly cancelled?: boolean;
  /** Cancels the task as this channel is called, so the answer arrives after the cancel. */
  readonly cancelOn?: string;
  /** The words selected on the page when the command runs. */
  readonly selected?: string;
  /** Per-call answers for one channel, in order, the last repeated — a run's pages answer differently. */
  readonly sequences?: Readonly<Record<string, readonly unknown[]>>;
  /** Cancels the task after this many `step`s, as the status bar's cancel does mid-run. */
  readonly cancelAfterSteps?: number;
}): Promise<Run> {
  const sent: { id: string; params: unknown }[] = [];
  const asked: { id: string; props: unknown }[] = [];
  const said: { kind: string; message: MessageKey }[] = [];
  const applied: unknown[] = [];
  const answers: Readonly<Record<string, unknown>> = {
    'ai.models': { source: 'fetched', models: [{ id: 'first-model', label: 'First', capabilities: { vision: null, streaming: null } }] },
    'ai.translatePage': { kind: 'translated', version: 4, edit: blockEditOf(BLOCKS), rewrite: 'objects' },
    'document.execute': { version: asDocVersion(5), byteLength: 900, historyDropped: 0, boxed: [], more: 0, unsealedCopies: [] },
    ...options.answers,
  };
  const calls = new Map<string, number>();
  const controller = new AbortController();
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    // THE STATUS BAR'S CANCEL, pressed while this call is in flight.
    if (id === options.cancelOn) controller.abort();
    const failure = options.failures?.[id];
    if (failure !== undefined) return Promise.resolve(err(failure));
    const sequence = options.sequences?.[id];
    if (sequence !== undefined) {
      const at = calls.get(id) ?? 0;
      calls.set(id, at + 1);
      return Promise.resolve(ok(sequence[Math.min(at, sequence.length - 1)]));
    }
    return Promise.resolve(ok(answers[id]));
  });
  if (options.cancelled === true) controller.abort();
  let steps = 0;
  const task: TrackedTask = {
    signal: controller.signal,
    step: () => {
      steps += 1;
      if (steps === options.cancelAfterSteps) controller.abort();
    },
    end: () => undefined,
  };
  await translatePageCommand({
    client,
    onApplied: (a) => applied.push(a),
    stamp: () => ({ author: 'A. Tester', created: '2026-09-24T09:38:00.000Z' }),
    // NOT SIGNED (ADR-0149): a copy opened for this translation is a defect of the case.
    signatures: {
      warn: () => true,
      onOpened: () => {
        throw new Error('the case opened a copy for an edit without asking for one');
      },
    },
    ask: (id, props) => {
      asked.push({ id, props });
      // `in`, not `??`: a DISMISSAL is `undefined`, and a case must be able to pass exactly that.
      const answer = 'dialog' in options ? options.dialog : { language: 'fr', provider: 'openai', what: { scope: 'page' } };
      return Promise.resolve(id === 'dialog.translate-page' ? answer : undefined);
    },
    toast: (kind, message) => said.push({ kind, message }),
    track: () => task,
    storedSecrets: () => options.stored ?? ['ai.openai-key'],
    selectedText: () => options.selected ?? '',
  }).run(CONTEXT);
  return { sent, asked, said, applied };
}

describe('translatePageCommand', () => {
  it('asks, translates with the provider’s first model, and writes the answer as ONE editTextBlock', async () => {
    const { sent, said, applied } = await run({});
    expect(sent).toStrictEqual([
      { id: 'ai.models', params: { provider: 'openai' } },
      {
        id: 'ai.translatePage',
        params: { docId: DOC, page: 2, provider: 'openai', model: 'first-model', language: 'fr' },
      },
      {
        id: 'document.execute',
        // THE VERSION IS THE TRANSLATION'S READ, not the context's — the page the blocks describe.
        // And every block FITTED: a translation keeps the page's layout (ADR-0097 4b).
        params: {
          docId: DOC,
          // MAIN'S EDIT AS IT CAME, with the page, the fit and the version added (ADR-0142).
          command: { kind: 'editTextBlock', page: 2, ...blockEditOf(BLOCKS), fit: 'shrink', version: 4 },
        },
      },
    ]);
    expect(said).toStrictEqual([{ kind: 'done', message: TOAST_PAGE_TRANSLATED }]);
    expect(applied).toHaveLength(1);
  });

  it('writes the translation of a page whose text is in a Type 3 font with editTextOperators, shrunk the same way (ADR-0181)', async () => {
    const { sent } = await run({
      answers: { 'ai.translatePage': { kind: 'translated', version: 4, edit: blockEditOf(BLOCKS), rewrite: 'operators' } },
    });
    expect(sent.at(-1)).toStrictEqual({
      id: 'document.execute',
      params: { docId: DOC, command: { kind: 'editTextOperators', page: 2, ...blockEditOf(BLOCKS), fit: 'shrink', version: 4 } },
    });
    // CONTROL: the page whose writer is PDFium's is still written by `editTextBlock`, so the choice is the page's and
    // not a default that changed.
    const objects = await run({});
    expect(objects.sent.at(-1)).toMatchObject({ params: { command: { kind: 'editTextBlock' } } });
  });

  it('offers the dialog ONLY the providers with a stored key', async () => {
    const { asked } = await run({ stored: ['ai.mistral-key', 'ai.anthropic-key', 'docusign.integration-key'] });
    // THE PAGE COUNT AND WHETHER WORDS ARE SELECTED travel in: the dialog draws *Selected text* disabled without them.
    expect(asked[0]).toStrictEqual({
      id: 'dialog.translate-page',
      props: { providers: ['anthropic', 'mistral'], pageCount: 5, hasSelection: false },
    });
  });

  describe('more than the page on show (ADR-0097\'s per-page command, run for each page)', () => {
    const TWO_PAGES = { language: 'fr', provider: 'openai', what: { scope: 'pages', pages: [0, 3] } };
    const executes = (sent: Run['sent']): unknown[] => sent.filter((call) => call.id === 'document.execute').map((call) => call.params);

    it('translates and writes EACH named page by the per-page command, at the version its own read gave', async () => {
      const { sent, said, applied } = await run({
        dialog: TWO_PAGES,
        sequences: {
          'ai.translatePage': [
            { kind: 'translated', version: 4, edit: blockEditOf(BLOCKS), rewrite: 'objects' },
            { kind: 'translated', version: 5, edit: blockEditOf(BLOCKS), rewrite: 'objects' },
          ],
        },
      });
      expect(sent.filter((call) => call.id === 'ai.translatePage').map((call) => (call.params as { page: number }).page)).toStrictEqual([0, 3]);
      expect(executes(sent)).toStrictEqual([
        { docId: DOC, command: { kind: 'editTextBlock', page: 0, ...blockEditOf(BLOCKS), fit: 'shrink', version: 4 } },
        { docId: DOC, command: { kind: 'editTextBlock', page: 3, ...blockEditOf(BLOCKS), fit: 'shrink', version: 5 } },
      ]);
      expect(applied).toHaveLength(2);
      expect(said).toStrictEqual([{ kind: 'done', message: TOAST_PAGES_TRANSLATED }]);
    });

    it('CONTROL: a single page says its own sentence, not a run’s', async () => {
      const { said } = await run({});
      expect(said).toStrictEqual([{ kind: 'done', message: TOAST_PAGE_TRANSLATED }]);
    });

    it('CANCEL stops the run after the page in hand, and says what stays translated', async () => {
      const { sent, said } = await run({ dialog: { ...TWO_PAGES, what: { scope: 'pages', pages: [0, 1, 2, 3] } }, cancelAfterSteps: 1 });
      // THE FIRST PAGE WAS WRITTEN and the three after it were never sent.
      expect(sent.filter((call) => call.id === 'ai.translatePage')).toHaveLength(1);
      expect(said).toStrictEqual([{ kind: 'done', message: TOAST_PAGES_TRANSLATED_PARTLY }]);
    });

    it('a provider’s refusal STOPS the run — the next page would be refused and paid for — and keeps what was written', async () => {
      const { sent, said } = await run({
        dialog: TWO_PAGES,
        sequences: {
          'ai.translatePage': [
            { kind: 'translated', version: 4, edit: blockEditOf(BLOCKS), rewrite: 'objects' },
            { kind: 'refused', problem: 'unauthorised' },
          ],
        },
      });
      expect(executes(sent)).toHaveLength(1);
      expect(said).toStrictEqual([
        { kind: 'problem', message: ASSISTANT_PROBLEM_UNAUTHORISED },
        { kind: 'done', message: TOAST_PAGES_TRANSLATED_PARTLY },
      ]);
    });

    it('a page with nothing to translate is skipped and the run goes on', async () => {
      const { sent } = await run({
        dialog: TWO_PAGES,
        sequences: {
          'ai.translatePage': [{ kind: 'nothing-to-translate' }, { kind: 'translated', version: 4, edit: blockEditOf(BLOCKS), rewrite: 'objects' }],
        },
      });
      expect(sent.filter((call) => call.id === 'ai.translatePage')).toHaveLength(2);
      expect(executes(sent)).toHaveLength(1);
    });
  });

  describe('selected text', () => {
    const SELECTION = { language: 'fr', provider: 'openai', what: { scope: 'selection' } };

    it('translates the words selected BEFORE the dialog opened, and copies the answer — it writes nothing to the page', async () => {
      const { sent, said, asked } = await run({
        dialog: SELECTION,
        selected: '  Payment is due  ',
        answers: { 'ai.translateText': { kind: 'translated', text: 'Le paiement est dû' }, 'window.copyText': { copied: true } },
      });
      expect((asked[0]?.props as { hasSelection: boolean }).hasSelection).toBe(true);
      expect(sent.map((call) => call.id)).toStrictEqual(['ai.models', 'ai.translateText', 'window.copyText']);
      expect(sent[1]?.params).toStrictEqual({ text: 'Payment is due', provider: 'openai', model: 'first-model', language: 'fr' });
      expect(sent[2]?.params).toStrictEqual({ text: 'Le paiement est dû' });
      expect(said).toStrictEqual([{ kind: 'done', message: TOAST_TEXT_TRANSLATED }]);
    });

    it('with nothing selected it says so and sends nothing', async () => {
      const { sent, said } = await run({ dialog: SELECTION, selected: '' });
      expect(sent.map((call) => call.id)).toStrictEqual(['ai.models']);
      expect(said).toStrictEqual([{ kind: 'problem', message: TOAST_NOTHING_SELECTED }]);
    });
  });

  it('a dismissed dialog sends NOTHING — no page text leaves', async () => {
    const { sent } = await run({ dialog: undefined });
    expect(sent).toStrictEqual([]);
  });

  it('a provider refusal is said by name and nothing is written', async () => {
    const { sent, said } = await run({ answers: { 'ai.translatePage': { kind: 'refused', problem: 'unauthorised' } } });
    expect(sent.map((call) => call.id)).not.toContain('document.execute');
    expect(said).toStrictEqual([{ kind: 'problem', message: ASSISTANT_PROBLEM_UNAUTHORISED }]);
  });

  it('nothing to translate is said, and nothing is written', async () => {
    const { sent, said } = await run({ answers: { 'ai.translatePage': { kind: 'nothing-to-translate' } } });
    expect(sent.map((call) => call.id)).not.toContain('document.execute');
    expect(said).toStrictEqual([{ kind: 'done', message: TOAST_NOTHING_TO_TRANSLATE }]);
  });

  it('a write the page’s fonts refuse is said as a toast, not as the generic problem dialog', async () => {
    const { asked, said, applied } = await run({
      failures: { 'document.execute': { code: 'text-not-writable', detail: { characters: '中' } } },
    });
    expect(said).toStrictEqual([{ kind: 'problem', message: TOAST_TRANSLATE_NOT_WRITABLE }]);
    expect(asked.map((entry) => entry.id)).toStrictEqual(['dialog.translate-page']);
    expect(applied).toStrictEqual([]);
  });

  it('CANCELLED while waiting: the answer is not written', async () => {
    const { sent } = await run({ cancelOn: 'ai.translatePage' });
    // ASKED, because cancel came after the send — and the call NOT made is the write.
    expect(sent.map((call) => call.id)).toStrictEqual(['ai.models', 'ai.translatePage']);
  });

  it('CANCELLED before a page is sent: nothing leaves, so no page text is paid for', async () => {
    const { sent } = await run({ cancelled: true });
    expect(sent.map((call) => call.id)).toStrictEqual(['ai.models']);
  });
});
