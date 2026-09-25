import { channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok, type MessageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_PROBLEM_UNAUTHORISED,
  TOAST_NOTHING_TO_TRANSLATE,
  TOAST_PAGE_TRANSLATED,
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
  docId: DOC,
  version: asDocVersion(4),
  hasSelection: false,
  dirty: false,
  // NOT PAGE 0, so a command that sent a literal would be caught.
  page: 2,
  pageCount: 5,
  openDocuments: [],
};
const BLOCKS = [{ lines: [[3]], text: 'Facture' }];

interface Run {
  readonly sent: { id: string; params: unknown }[];
  readonly asked: { id: string; props: unknown }[];
  readonly said: { kind: string; message: MessageKey }[];
  readonly applied: unknown[];
}

async function run(options: {
  readonly answers?: Readonly<Record<string, unknown>>;
  readonly failures?: Readonly<Record<string, string>>;
  readonly dialog?: unknown;
  readonly stored?: readonly string[];
  readonly cancelled?: boolean;
}): Promise<Run> {
  const sent: { id: string; params: unknown }[] = [];
  const asked: { id: string; props: unknown }[] = [];
  const said: { kind: string; message: MessageKey }[] = [];
  const applied: unknown[] = [];
  const answers: Readonly<Record<string, unknown>> = {
    'ai.models': { source: 'fetched', models: [{ id: 'first-model', label: 'First', capabilities: { vision: null, streaming: null } }] },
    'ai.translatePage': { kind: 'translated', version: 4, blocks: BLOCKS },
    'document.execute': { version: asDocVersion(5), byteLength: 900, historyDropped: 0 },
    ...options.answers,
  };
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    const code = options.failures?.[id];
    if (code !== undefined) return Promise.resolve(err({ code }));
    return Promise.resolve(ok(answers[id]));
  });
  const controller = new AbortController();
  if (options.cancelled === true) controller.abort();
  const task: TrackedTask = { signal: controller.signal, step: () => undefined, end: () => undefined };
  await translatePageCommand({
    client,
    onApplied: (a) => applied.push(a),
    stamp: () => ({ author: 'A. Tester', created: '2026-09-24T09:38:00.000Z' }),
    ask: (id, props) => {
      asked.push({ id, props });
      // `in`, not `??`: a DISMISSAL is `undefined`, and a case must be able to pass exactly that.
      const answer = 'dialog' in options ? options.dialog : { language: 'fr', provider: 'openai' };
      return Promise.resolve(id === 'dialog.translate-page' ? answer : undefined);
    },
    toast: (kind, message) => said.push({ kind, message }),
    track: () => task,
    storedSecrets: () => options.stored ?? ['ai.openai-key'],
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
          command: { kind: 'editTextBlock', page: 2, blocks: [{ lines: [[3]], text: 'Facture', fit: 'shrink' }], version: 4 },
        },
      },
    ]);
    expect(said).toStrictEqual([{ kind: 'done', message: TOAST_PAGE_TRANSLATED }]);
    expect(applied).toHaveLength(1);
  });

  it('offers the dialog ONLY the providers with a stored key', async () => {
    const { asked } = await run({ stored: ['ai.mistral-key', 'ai.anthropic-key', 'docusign.integration-key'] });
    expect(asked[0]).toStrictEqual({ id: 'dialog.translate-page', props: { providers: ['anthropic', 'mistral'] } });
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
    const { asked, said, applied } = await run({ failures: { 'document.execute': 'text-not-writable' } });
    expect(said).toStrictEqual([{ kind: 'problem', message: TOAST_TRANSLATE_NOT_WRITABLE }]);
    expect(asked.map((entry) => entry.id)).toStrictEqual(['dialog.translate-page']);
    expect(applied).toStrictEqual([]);
  });

  it('CANCELLED while waiting: the answer is not written', async () => {
    const { sent } = await run({ cancelled: true });
    // ASKED, because cancel came after the send — and the call NOT made is the write.
    expect(sent.map((call) => call.id)).toStrictEqual(['ai.models', 'ai.translatePage']);
  });
});
