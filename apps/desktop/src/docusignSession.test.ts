import {
  DOCUSIGN_ENVIRONMENT_SETTING_ID,
  DOCUSIGN_INTEGRATION_KEY_SETTING_ID,
  SECRET_SETTING_IDS,
} from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { createDocusignSession, DocusignOutcomeRefused, SESSION_SECRET_ID } from './docusignSession.js';
import type { SecretStoreSurface } from './secretStore.js';
import type { SettingsSurface } from './settingsFile.js';

/**
 * DocuSign as `main` holds it — sign-in, keeping, refreshing, sending, retrieving.
 *
 * ## The sign-in is REAL; DocuSign is not
 *
 * The loopback listener binds a real port, and the "browser" follows the redirect
 * with a real request to it. What is faked is DocuSign: a fetch routed by path,
 * answering the shapes `docusign.ts` cites. So these cases assert the session's
 * DECISIONS — when it signs in, when it refreshes, what it keeps and where — and
 * not DocuSign's behaviour, which the owner's integration key is the trigger for.
 *
 * ## The decision is the assertion
 *
 * A session that signed in every time would pass every case that only checks a send
 * succeeded. So the cases count what was asked: how many times the browser opened,
 * which grant the token endpoint received.
 */

/** An in-memory secret store with the real store's removal rule. */
function memorySecrets(available = true): SecretStoreSurface & { readonly held: Map<string, string> } {
  const held = new Map<string, string>();
  return {
    held,
    available: () => available,
    read: () => Object.fromEntries(held),
    write: (id, value) => {
      if (!available) throw new Error('no cipher in the case');
      if (value === '') held.delete(id);
      else held.set(id, value);
    },
  };
}

function settingsWith(values: Readonly<Record<string, unknown>>): SettingsSurface {
  return { read: () => values, write: () => undefined };
}

interface DocusignFake {
  readonly fetchImpl: typeof fetch;
  readonly grants: string[];
  readonly envelopesSent: number[];
  status: string;
  envelopeAnswer: number;
  tokenAnswer: number;
}

/** DocuSign, answering by path. */
function docusignFake(): DocusignFake {
  let issued = 0;
  const fake: DocusignFake = {
    grants: [],
    envelopesSent: [],
    status: 'sent',
    envelopeAnswer: 200,
    tokenAnswer: 200,
    fetchImpl: (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      Promise.resolve(answer(input, init)),
  };

  /** The response for one request, decided by its path. */
  function answer(input: string | URL | Request, init?: RequestInit): Response {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const json = (value: unknown, status = 200): Response =>
      new Response(JSON.stringify(value), { status });
    if (url.pathname === '/oauth/token') {
      const grant = new URLSearchParams(init?.body as string).get('grant_type') ?? '';
      fake.grants.push(grant);
      if (fake.tokenAnswer !== 200) return json({ error: 'invalid_grant' }, fake.tokenAnswer);
      issued += 1;
      return json({ access_token: `access-${String(issued)}`, refresh_token: `refresh-${String(issued)}`, expires_in: 3600 });
    }
    if (url.pathname === '/oauth/userinfo') {
      return json({ accounts: [{ account_id: 'acct', is_default: 'true', base_uri: 'https://na3.docusign.net' }] });
    }
    if (url.pathname.endsWith('/envelopes') && init?.method === 'POST') {
      fake.envelopesSent.push(fake.envelopesSent.length + 1);
      if (fake.envelopeAnswer !== 200) return json({ errorCode: 'X' }, fake.envelopeAnswer);
      return json({ envelopeId: 'env-1', status: 'sent' });
    }
    if (url.pathname.endsWith('/documents/combined')) return new Response(Uint8Array.of(9, 9, 9));
    if (url.pathname.endsWith('/envelopes/env-1')) return json({ status: fake.status });
    return json({}, 404);
  }

  return fake;
}

/** A browser that completes a sign-in, counting how often it was opened. */
function browser(outcome: 'accept' | 'decline' = 'accept'): {
  readonly openInBrowser: (url: string) => Promise<void>;
  readonly opened: string[];
} {
  const opened: string[] = [];
  return {
    opened,
    openInBrowser: async (authorizationUrl) => {
      opened.push(authorizationUrl);
      const url = new URL(authorizationUrl);
      const redirect = url.searchParams.get('redirect_uri') ?? '';
      const state = url.searchParams.get('state') ?? '';
      const query = outcome === 'accept' ? `code=the-code&state=${state}` : `error=access_denied&state=${state}`;
      await fetch(`${redirect}?${query}`);
    },
  };
}

const SEND = {
  docId: 'doc-1',
  pdf: Uint8Array.of(0x25, 0x50, 0x44, 0x46),
  documentName: 'Contract.pdf',
  emailSubject: 'Please sign',
  signers: [{ name: 'Grace Hopper', email: 'grace@example.com' }],
};

/** A secret store holding the integration key. */
function keyed(): ReturnType<typeof memorySecrets> {
  const secrets = memorySecrets();
  secrets.write(DOCUSIGN_INTEGRATION_KEY_SETTING_ID, 'client-id');
  return secrets;
}

async function kindOf(pending: Promise<unknown>): Promise<string> {
  try {
    await pending;
  } catch (error) {
    if (error instanceof DocusignOutcomeRefused) return error.kind;
    throw error;
  }
  throw new Error('the call succeeded');
}

describe('createDocusignSession', () => {
  it('refuses with no integration key, BEFORE asking anything', async () => {
    const fake = docusignFake();
    const shown = browser();
    const session = createDocusignSession({
      settings: settingsWith({}),
      secrets: memorySecrets(),
      openInBrowser: shown.openInBrowser,
      fetchImpl: fake.fetchImpl,
    });
    expect(await kindOf(session.send(SEND))).toBe('no-integration-key');
    expect(shown.opened).toStrictEqual([]);
    expect(fake.grants).toStrictEqual([]);
  });

  it('refuses where no secret store is available, rather than signing in to keep nothing', async () => {
    const secrets = memorySecrets(false);
    // THE KEY IS READABLE here only because the case puts it in the map directly: a
    // store with no cipher still answers `read`, and this is the refusal it owes.
    secrets.held.set(DOCUSIGN_INTEGRATION_KEY_SETTING_ID, 'client-id');
    const session = createDocusignSession({
      settings: settingsWith({}),
      secrets,
      openInBrowser: browser().openInBrowser,
      fetchImpl: docusignFake().fetchImpl,
    });
    expect(await kindOf(session.send(SEND))).toBe('secrets-unavailable');
  });

  it('THE FIRST SEND signs in once, keeps the sign-in OUTSIDE the renderer’s secret list, and remembers the envelope', async () => {
    const fake = docusignFake();
    const shown = browser();
    const secrets = keyed();
    const session = createDocusignSession({
      settings: settingsWith({ [DOCUSIGN_ENVIRONMENT_SETTING_ID]: 'demo' }),
      secrets,
      openInBrowser: shown.openInBrowser,
      fetchImpl: fake.fetchImpl,
    });

    expect(await session.send(SEND)).toBe('env-1');

    expect(shown.opened).toHaveLength(1);
    expect(new URL(shown.opened[0] ?? '').origin).toBe('https://account-d.docusign.com');
    expect(fake.grants).toStrictEqual(['authorization_code']);
    expect(session.hasSent('doc-1')).toBe(true);
    // KEPT, and where the renderer cannot reach it.
    expect(secrets.held.has(SESSION_SECRET_ID)).toBe(true);
    expect((SECRET_SETTING_IDS as readonly string[]).includes(SESSION_SECRET_ID)).toBe(false);
  });

  it('a SECOND send reuses the kept sign-in: no browser, no token call', async () => {
    const fake = docusignFake();
    const shown = browser();
    const session = createDocusignSession({
      settings: settingsWith({}),
      secrets: keyed(),
      openInBrowser: shown.openInBrowser,
      fetchImpl: fake.fetchImpl,
    });

    await session.send(SEND);
    await session.send({ ...SEND, docId: 'doc-2' });

    expect(shown.opened).toHaveLength(1);
    expect(fake.grants).toStrictEqual(['authorization_code']);
    expect(fake.envelopesSent).toHaveLength(2);
  });

  it('an expired token is REFRESHED, not signed in again, and the rotated token is kept', async () => {
    const fake = docusignFake();
    const shown = browser();
    const secrets = keyed();
    let clock = 1_000;
    const session = createDocusignSession({
      settings: settingsWith({}),
      secrets,
      openInBrowser: shown.openInBrowser,
      fetchImpl: fake.fetchImpl,
      now: () => clock,
    });

    await session.send(SEND);
    clock += 3_600_000; // past the token's hour
    await session.send({ ...SEND, docId: 'doc-2' });

    expect(shown.opened).toHaveLength(1);
    expect(fake.grants).toStrictEqual(['authorization_code', 'refresh_token']);
    expect(JSON.parse(secrets.held.get(SESSION_SECRET_ID) ?? '{}')).toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });
  });

  it('a refresh DocuSign refuses CLEARS the stale sign-in and signs in again', async () => {
    const fake = docusignFake();
    const shown = browser();
    let clock = 1_000;
    const session = createDocusignSession({
      settings: settingsWith({}),
      secrets: keyed(),
      openInBrowser: shown.openInBrowser,
      fetchImpl: fake.fetchImpl,
      now: () => clock,
    });

    await session.send(SEND);
    clock += 3_600_000;
    fake.tokenAnswer = 401;
    // The refresh is refused, and so is the exchange that follows it — which is what
    // shows the session tried a new sign-in rather than giving up after the refresh.
    expect(await kindOf(session.send({ ...SEND, docId: 'doc-2' }))).toBe('unauthorised');
    expect(shown.opened).toHaveLength(2);
    expect(fake.grants).toStrictEqual(['authorization_code', 'refresh_token', 'authorization_code']);
  });

  it('a sign-in kept for the OTHER environment is discarded', async () => {
    const fake = docusignFake();
    const shown = browser();
    const secrets = keyed();
    secrets.write(
      SESSION_SECRET_ID,
      JSON.stringify({
        environment: 'production',
        accessToken: 'old',
        refreshToken: 'old',
        expiresAt: Number.MAX_SAFE_INTEGER,
        account: { accountId: 'acct', basePath: 'https://na3.docusign.net/restapi' },
      }),
    );
    const session = createDocusignSession({
      settings: settingsWith({ [DOCUSIGN_ENVIRONMENT_SETTING_ID]: 'demo' }),
      secrets,
      openInBrowser: shown.openInBrowser,
      fetchImpl: fake.fetchImpl,
    });

    await session.send(SEND);
    expect(shown.opened).toHaveLength(1);
  });

  it('retrieve answers nothing sent, then not completed with DocuSign’s status, then the signed bytes', async () => {
    const fake = docusignFake();
    const session = createDocusignSession({
      settings: settingsWith({}),
      secrets: keyed(),
      openInBrowser: browser().openInBrowser,
      fetchImpl: fake.fetchImpl,
    });

    expect(await session.retrieve('doc-1')).toStrictEqual({ kind: 'nothing-sent' });
    await session.send(SEND);
    expect(await session.retrieve('doc-1')).toStrictEqual({ kind: 'not-completed', status: 'sent' });
    fake.status = 'completed';
    const done = await session.retrieve('doc-1');
    expect(done.kind).toBe('completed');
    if (done.kind === 'completed') expect(Array.from(done.bytes)).toStrictEqual([9, 9, 9]);
  });

  it('maps DocuSign’s error and a declined sign-in to the contract’s kinds', async () => {
    const rejecting = docusignFake();
    rejecting.envelopeAnswer = 503;
    const rejected = createDocusignSession({
      settings: settingsWith({}),
      secrets: keyed(),
      openInBrowser: browser().openInBrowser,
      fetchImpl: rejecting.fetchImpl,
    });
    expect(await kindOf(rejected.send(SEND))).toBe('rejected');

    const declined = createDocusignSession({
      settings: settingsWith({}),
      secrets: keyed(),
      openInBrowser: browser('decline').openInBrowser,
      fetchImpl: docusignFake().fetchImpl,
    });
    expect(await kindOf(declined.send(SEND))).toBe('sign-in-denied');
  });

  it('CONTROL: a failure nobody named is NOT turned into a refusal — it propagates', async () => {
    // A secret store that cannot write after the key was read: an unnamed failure,
    // which is not a person's situation and must reach the handler as a defect.
    const secrets = keyed();
    const failing: SecretStoreSurface = {
      available: () => true,
      read: () => secrets.read(),
      write: () => {
        throw new Error('the disk in the case is full');
      },
    };
    const session = createDocusignSession({
      settings: settingsWith({}),
      secrets: failing,
      openInBrowser: browser().openInBrowser,
      fetchImpl: docusignFake().fetchImpl,
    });
    await expect(session.send(SEND)).rejects.toThrow('the disk in the case is full');
  });
});
