import { type ContractClient, channels, createClient, type UpdateStatus } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { updateAvailableCommand } from './commands/updateAvailable.js';
import { SECURITY_UPDATE_DIALOG_ID } from './dialogs/securityUpdate.js';
import type { CommandContext } from './registries/commands.js';
import { checksForUpdates, isUpdateOffered, offerSecurityNotice } from './updateStatus.js';

/**
 * The renderer's half of the update check (ADR-0110): which answers show the indicator, and what the indicator and
 * the notice send. The switch is `settings/updates.test.ts`'s. Main's half — which starts make the call — is
 * `updateCheck.test.ts`; `composition.test.ts` holds the production wiring's dormant answer.
 */

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-0000000000d1'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

/** Every answer main can give, so a case over the set cannot leave one out. */
const EVERY: readonly UpdateStatus[] = [
  { kind: 'none' },
  { kind: 'dormant' },
  { kind: 'off' },
  { kind: 'unknown' },
  { kind: 'current' },
  { kind: 'newer', version: '1.4.0' },
  { kind: 'unsupported', version: '1.4.0' },
  { kind: 'security', version: '1.4.0', acknowledged: false },
];

/** A client that records every call and answers each with `answer(id)`. */
function recording(answer: (id: string) => unknown = () => ({ opened: true })): { client: ContractClient; sent: unknown[] } {
  const sent: unknown[] = [];
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    return Promise.resolve(ok(answer(id)));
  });
  return { client, sent };
}

describe('which answers mean what — the one reading', () => {
  it('the indicator is offered for newer, unsupported and security, and for nothing else', () => {
    expect(EVERY.filter(isUpdateOffered).map((status) => status.kind)).toStrictEqual(['newer', 'unsupported', 'security']);
    expect(isUpdateOffered(undefined)).toBe(false);
  });

  it('About says the site was asked exactly when a request was made — unknown included, the three quiet ones not', () => {
    expect(EVERY.filter(checksForUpdates).map((status) => status.kind)).toStrictEqual([
      'unknown',
      'current',
      'newer',
      'unsupported',
      'security',
    ]);
    expect(checksForUpdates(undefined)).toBe(false);
  });
});

describe('Update available — the title bar’s indicator', () => {
  it('exists only while main has offered an update, and reads the status when asked rather than when built', () => {
    let status: UpdateStatus | undefined;
    const command = updateAvailableCommand({ client: recording().client, status: () => status });
    expect(command.when?.(CONTEXT)).toBe(false);
    status = { kind: 'newer', version: '1.4.0' };
    expect(command.when?.(CONTEXT)).toBe(true);
    status = { kind: 'current' };
    expect(command.when?.(CONTEXT)).toBe(false);
  });

  it('opens the Store’s LISTING page by name — the one page named, and nothing else crosses', async () => {
    const { client, sent } = recording();
    await updateAvailableCommand({ client, status: () => ({ kind: 'newer', version: '1.4.0' }) }).run(CONTEXT);
    expect(sent).toStrictEqual([{ id: 'app.openStore', params: { page: 'listing' } }]);
  });
});

describe('the security notice', () => {
  const security: UpdateStatus = { kind: 'security', version: '1.4.0', acknowledged: false };

  it('Open Microsoft Store opens the listing, THEN acknowledges', async () => {
    const { client, sent } = recording((id) => (id === 'app.openStore' ? { opened: true } : { acknowledged: true }));
    const asked: unknown[] = [];
    await offerSecurityNotice(
      {
        client,
        ask: (id, props) => {
          asked.push({ id, props });
          return Promise.resolve('store');
        },
      },
      security,
    );
    expect(asked).toStrictEqual([{ id: SECURITY_UPDATE_DIALOG_ID, props: { version: '1.4.0' } }]);
    expect(sent).toStrictEqual([
      { id: 'app.openStore', params: { page: 'listing' } },
      { id: 'app.acknowledgeSecurityUpdate', params: {} },
    ]);
  });

  it('I understand acknowledges and opens nothing', async () => {
    const { client, sent } = recording(() => ({ acknowledged: true }));
    await offerSecurityNotice({ client, ask: () => Promise.resolve('understood') }, security);
    expect(sent).toStrictEqual([{ id: 'app.acknowledgeSecurityUpdate', params: {} }]);
  });

  it('CONTROL: a dismissal records nothing, so the notice returns next start', async () => {
    const { client, sent } = recording();
    await offerSecurityNotice({ client, ask: () => Promise.resolve(undefined) }, security);
    expect(sent).toStrictEqual([]);
  });

  it('is not shown for a release already acknowledged, nor for any other answer', async () => {
    const asked: unknown[] = [];
    const ask = (id: string): Promise<unknown> => {
      asked.push(id);
      return Promise.resolve('understood');
    };
    const { client } = recording();
    await offerSecurityNotice({ client, ask }, { ...security, acknowledged: true });
    for (const status of EVERY.filter((each) => each.kind !== 'security')) await offerSecurityNotice({ client, ask }, status);
    expect(asked).toStrictEqual([]);
  });
});
