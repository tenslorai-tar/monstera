import { describe, expect, it } from 'vitest';

import {
  authorizationUrl,
  completedDocument,
  defaultAccount,
  DocusignRefused,
  exchangeCode,
  pkcePair,
  sendEnvelope,
} from './docusign.js';

/**
 * DocuSign's protocol, driven with no network and no key.
 *
 * ## WHAT THESE CASES ASSERT, AND WHAT THEY CANNOT
 *
 * Every fixture is written from DocuSign's own published material, read 2026-09-13
 * and cited in `docusign.ts`. What passes is a reading of that material, not
 * evidence that DocuSign answers this way for the owner's integration key — which is
 * the row's live trigger, stated here because a green file about a cloud API is
 * exactly the shape that reads as verified.
 *
 * ## The PKCE case is RFC 7636's own example, not this module agreeing with itself
 *
 * Appendix B gives the 32 octets, the verifier they encode to and the challenge that
 * verifier hashes to. A case that computed the expected challenge with the same
 * `createHash` call would pass for any encoding mistake the two shared.
 */

/** RFC 7636 Appendix B's 32-octet sequence. */
const RFC_7636_OCTETS = Buffer.from([
  116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105,
  214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
]);

interface Asked {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** A fetch that records each call and answers `respond`. */
function recording(respond: (url: string) => Response | Error): {
  readonly fetchImpl: typeof fetch;
  readonly asked: Asked[];
} {
  const asked: Asked[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    asked.push({ url, init });
    const answer = respond(url);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  }) as typeof fetch;
  return { fetchImpl, asked };
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** The refusal a call rejects with, asserting it is one. */
async function refusalOf(pending: Promise<unknown>): Promise<DocusignRefused> {
  try {
    await pending;
  } catch (error) {
    if (error instanceof DocusignRefused) return error;
    throw error;
  }
  throw new Error('the call succeeded');
}

describe('pkcePair', () => {
  it('produces RFC 7636 Appendix B’s verifier and S256 challenge from its octets', () => {
    const pair = pkcePair(() => RFC_7636_OCTETS);
    expect(pair.verifier).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    expect(pair.challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('authorizationUrl', () => {
  it('names every parameter DocuSign documents, on the environment’s account host', () => {
    const url = new URL(
      authorizationUrl({
        environment: 'demo',
        clientId: 'client-id',
        redirectUri: 'http://127.0.0.1:51004/docusign',
        state: 'state-value',
        challenge: 'challenge-value',
      }),
    );
    expect(url.origin).toBe('https://account-d.docusign.com');
    expect(url.pathname).toBe('/oauth/auth');
    expect(Object.fromEntries(url.searchParams)).toStrictEqual({
      response_type: 'code',
      scope: 'signature',
      client_id: 'client-id',
      redirect_uri: 'http://127.0.0.1:51004/docusign',
      state: 'state-value',
      code_challenge: 'challenge-value',
      code_challenge_method: 'S256',
    });
  });

  it('CONTROL: production reaches the production host', () => {
    const url = authorizationUrl({
      environment: 'production',
      clientId: 'c',
      redirectUri: 'http://127.0.0.1:1/x',
      state: 's',
      challenge: 'x',
    });
    expect(new URL(url).origin).toBe('https://account.docusign.com');
  });
});

describe('exchangeCode', () => {
  const request = {
    environment: 'production' as const,
    clientId: 'client-id',
    redirectUri: 'http://127.0.0.1:51004/docusign',
    code: 'the-code',
    verifier: 'the-verifier',
  };

  it('posts the code and verifier as a PUBLIC client — no secret — and reads an absolute expiry', async () => {
    const { fetchImpl, asked } = recording(() =>
      json({ access_token: 'access', token_type: 'Bearer', refresh_token: 'refresh', expires_in: 3600 }),
    );

    const tokens = await exchangeCode(request, fetchImpl, () => 1_000);

    expect(tokens).toStrictEqual({ accessToken: 'access', refreshToken: 'refresh', expiresAt: 3_601_000 });
    expect(asked[0]?.url).toBe('https://account.docusign.com/oauth/token');
    expect(asked[0]?.init?.method).toBe('POST');
    const body = new URLSearchParams(asked[0]?.init?.body as string);
    expect(Object.fromEntries(body)).toStrictEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: 'client-id',
      code_verifier: 'the-verifier',
      redirect_uri: 'http://127.0.0.1:51004/docusign',
    });
    // NO SECRET, asserted by name: a public client carries none (RFC 8252 §8.4).
    expect(body.has('client_secret')).toBe(false);
  });

  it('refuses a token answer without a refresh token', async () => {
    const { fetchImpl } = recording(() => json({ access_token: 'access', expires_in: 3600 }));
    expect((await refusalOf(exchangeCode(request, fetchImpl))).reason).toBe('unreadable-answer');
  });

  it('answers HTTP 401 as unauthorised and an unreachable service by that name', async () => {
    const refused = recording(() => json({ error: 'invalid_grant' }, 401));
    expect((await refusalOf(exchangeCode(request, refused.fetchImpl))).reason).toBe('unauthorised');
    const unreachable = recording(() => new TypeError('fetch failed'));
    expect((await refusalOf(exchangeCode(request, unreachable.fetchImpl))).reason).toBe('unreachable');
  });
});

describe('defaultAccount', () => {
  const ask = (accounts: unknown) =>
    recording(() => json({ sub: 'user', accounts }));

  it('chooses the account whose is_default is the STRING "true", and forms the base path', async () => {
    const { fetchImpl, asked } = ask([
      { account_id: 'other', is_default: 'false', account_name: 'Other', base_uri: 'https://eu.docusign.net' },
      { account_id: 'chosen', is_default: 'true', account_name: 'Chosen', base_uri: 'https://na3.docusign.net' },
    ]);

    const account = await defaultAccount({ environment: 'production', accessToken: 'access' }, fetchImpl);

    expect(account).toStrictEqual({ accountId: 'chosen', basePath: 'https://na3.docusign.net/restapi' });
    expect(asked[0]?.url).toBe('https://account.docusign.com/oauth/userinfo');
    expect((asked[0]?.init?.headers as Record<string, string>)['authorization']).toBe('Bearer access');
  });

  it('CONTROL: a BOOLEAN true is not DocuSign’s shape, and names no account', async () => {
    // Without this, a comparison with the boolean passes the case above only if the
    // fixture happened to use one — and would report every real person as having no
    // default account.
    const { fetchImpl } = ask([
      { account_id: 'chosen', is_default: true, base_uri: 'https://na3.docusign.net' },
    ]);
    const refused = await refusalOf(defaultAccount({ environment: 'production', accessToken: 'a' }, fetchImpl));
    expect(refused.reason).toBe('no-account');
  });

  it.each([
    ['a look-alike domain', 'https://evil-docusign.net'],
    ['plain HTTP', 'http://na3.docusign.net'],
    ['another domain entirely', 'https://example.com'],
  ])('refuses a base URI on %s, before a token is ever sent to it', async (_label, baseUri) => {
    const { fetchImpl, asked } = ask([{ account_id: 'chosen', is_default: 'true', base_uri: baseUri }]);
    const refused = await refusalOf(defaultAccount({ environment: 'production', accessToken: 'a' }, fetchImpl));
    expect(refused.reason).toBe('unlisted-host');
    // ONE CALL: userinfo. Nothing went to the refused host.
    expect(asked).toHaveLength(1);
  });
});

describe('sendEnvelope', () => {
  it('posts one PDF to its signers in order, with status sent, to the account’s envelopes', async () => {
    const { fetchImpl, asked } = recording(() => json({ envelopeId: 'env-1', status: 'sent' }));
    const pdf = Uint8Array.of(0x25, 0x50, 0x44, 0x46);

    const envelopeId = await sendEnvelope(
      {
        account: { accountId: 'acct', basePath: 'https://na3.docusign.net/restapi' },
        accessToken: 'access',
        emailSubject: 'Please sign',
        documentName: 'Contract.pdf',
        pdf,
        signers: [
          { name: 'Grace Hopper', email: 'grace@example.com' },
          { name: 'Ada Lovelace', email: 'ada@example.com' },
        ],
      },
      fetchImpl,
    );

    expect(envelopeId).toBe('env-1');
    expect(asked[0]?.url).toBe('https://na3.docusign.net/restapi/v2.1/accounts/acct/envelopes');
    const body = JSON.parse(asked[0]?.init?.body as string) as {
      documents: { documentBase64: string; fileExtension: string; documentId: string }[];
      recipients: { signers: { email: string; recipientId: string; routingOrder: string }[] };
      status: string;
    };
    expect(body.status).toBe('sent');
    expect(Buffer.from(body.documents[0]?.documentBase64 ?? '', 'base64')).toStrictEqual(Buffer.from(pdf));
    expect(body.documents[0]?.fileExtension).toBe('pdf');
    expect(body.recipients.signers.map((signer) => [signer.email, signer.recipientId, signer.routingOrder])).toStrictEqual([
      ['grace@example.com', '1', '1'],
      ['ada@example.com', '2', '2'],
    ]);
  });
});

describe('completedDocument', () => {
  it('reads the combined document’s bytes from documents/combined', async () => {
    const signed = Uint8Array.of(1, 2, 3, 4);
    const { fetchImpl, asked } = recording(() => new Response(signed));

    const bytes = await completedDocument(
      { account: { accountId: 'acct', basePath: 'https://na3.docusign.net/restapi' }, accessToken: 'a', envelopeId: 'env-1' },
      fetchImpl,
    );

    expect(Array.from(bytes)).toStrictEqual([1, 2, 3, 4]);
    expect(asked[0]?.url).toBe(
      'https://na3.docusign.net/restapi/v2.1/accounts/acct/envelopes/env-1/documents/combined',
    );
  });
});
