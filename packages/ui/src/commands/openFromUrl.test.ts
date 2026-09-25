import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '../registries/commands.js';
import { openFromUrlCommand } from './openFromUrl.js';

/**
 * The UI half of D9's *Open from URL*: what the control sends, and where each answer goes.
 *
 * Every case asserts a CALL, `importMarkdown.test.ts`' reason: a dismissal and a failure
 * both leave the screen as it was.
 */

const FETCHED = asDocId('doc-from-url');

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: undefined,
  version: undefined,
  hasSelection: false,
  dirty: false,
  page: undefined,
  pageCount: undefined,
  openDocuments: [],
};

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

/** Callbacks recorded in order, with the URL dialog answering `typed`. */
function callbacks(typed: unknown): {
  readonly calls: { name: string; value: unknown }[];
  readonly deps: Omit<Parameters<typeof openFromUrlCommand>[0], 'client'>;
} {
  const calls: { name: string; value: unknown }[] = [];
  const record = (name: string) => (value: unknown) => {
    calls.push({ name, value });
  };
  return {
    calls,
    deps: {
      ask: (id, props) => {
        calls.push({ name: 'ask', value: { id, props } });
        return Promise.resolve(id === 'dialog.open-from-url' ? typed : undefined);
      },
      onOpened: record('opened'),
      onAlreadyOpen: record('already-open'),
    },
  };
}

describe('openFromUrlCommand', () => {
  it('SENDS THE TYPED ADDRESS on its own channel and adds the fetched document as a tab', async () => {
    const { client, sent } = recording({
      'document.openFromUrl': ok({
        kind: 'opened',
        docId: FETCHED,
        version: asDocVersion(1),
        byteLength: 4096,
        name: 'report.pdf',
      }),
    });
    const { calls, deps } = callbacks({ text: 'https://example.org/report.pdf' });

    await openFromUrlCommand({ client, ...deps }).run(CONTEXT);

    expect(sent).toStrictEqual([
      { id: 'document.openFromUrl', params: { url: 'https://example.org/report.pdf' } },
    ]);
    expect(calls).toStrictEqual([
      { name: 'ask', value: { id: 'dialog.open-from-url', props: {} } },
      { name: 'opened', value: { docId: FETCHED, version: 1, byteLength: 4096, name: 'report.pdf' } },
    ]);
  });

  it('CONTROL: a dismissed address dialog sends NOTHING', async () => {
    // THE DECISION IS THE CALL NOT MADE: a command that sent an empty address would be
    // refused by the schema and leave the same screen.
    const { client, sent } = recording({});
    const { calls, deps } = callbacks(undefined);

    await openFromUrlCommand({ client, ...deps }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
    expect(calls).toStrictEqual([{ name: 'ask', value: { id: 'dialog.open-from-url', props: {} } }]);
  });

  it('carries the guard’s REASON to the problem dialog, and CONTROL: a cancelled save says nothing', async () => {
    const refused = recording({
      'document.openFromUrl': ok({ kind: 'url-refused', reason: 'blocked-address' }),
    });
    const told = callbacks({ text: 'https://intranet.example/a.pdf' });
    await openFromUrlCommand({ client: refused.client, ...told.deps }).run(CONTEXT);
    expect(told.calls.at(-1)).toStrictEqual({
      name: 'ask',
      value: { id: 'dialog.url-open-problem', props: { reason: 'blocked-address' } },
    });

    const cancelled = recording({ 'document.openFromUrl': ok({ kind: 'cancelled' }) });
    const quiet = callbacks({ text: 'https://example.org/a.pdf' });
    await openFromUrlCommand({ client: cancelled.client, ...quiet.deps }).run(CONTEXT);
    expect(quiet.calls).toStrictEqual([{ name: 'ask', value: { id: 'dialog.open-from-url', props: {} } }]);
  });
});
