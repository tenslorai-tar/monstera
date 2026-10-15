import { describe, expect, it } from 'vitest';

import {
  authorizationUrl,
  completedDocument,
  DocusignRefused,
  ENVELOPE_READ_BYTES,
  envelopeBody,
  type EnvelopeTerms,
  exchangeCode,
  pkcePair,
  sendEnvelope,
  sendingAccount,
} from './docusign.js';
import type { PdfSource } from './cloudStorage.js';

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

describe('sendingAccount', () => {
  const ask = (accounts: unknown) =>
    recording(() => json({ sub: 'user', accounts }));

  it('chooses the account whose is_default is the BOOLEAN true — the reference’s type — and forms the base path', async () => {
    // THE DEFAULT IS SECOND, so taking the first account would choose `other`.
    const { fetchImpl, asked } = ask([
      { account_id: 'other', is_default: false, account_name: 'Other', base_uri: 'https://eu.docusign.net' },
      { account_id: 'chosen', is_default: true, account_name: 'Chosen', base_uri: 'https://na3.docusign.net' },
    ]);

    const account = await sendingAccount({ environment: 'production', accessToken: 'access' }, fetchImpl);

    expect(account).toStrictEqual({ accountId: 'chosen', basePath: 'https://na3.docusign.net/restapi' });
    expect(asked[0]?.url).toBe('https://account.docusign.com/oauth/userinfo');
    expect((asked[0]?.init?.headers as Record<string, string>)['authorization']).toBe('Bearer access');
  });

  it('also takes the STRING "true", DocuSign’s other published spelling', async () => {
    const { fetchImpl } = ask([
      { account_id: 'other', is_default: 'false', base_uri: 'https://eu.docusign.net' },
      { account_id: 'chosen', is_default: 'true', base_uri: 'https://na3.docusign.net' },
    ]);
    const account = await sendingAccount({ environment: 'production', accessToken: 'a' }, fetchImpl);
    expect(account.accountId).toBe('chosen');
  });

  it('takes the ONLY account when none is marked — the owner’s live answer, 2026-09-24', async () => {
    // THE SHAPE `npm run probe:docusign` READ: one entry, `is_default: false`, on the demo host. The
    // rule that took only a marked default refused this person, who has exactly one account.
    const { fetchImpl } = ask([
      { account_id: 'only', is_default: false, account_name: 'Only', base_uri: 'https://demo.docusign.net' },
    ]);
    const account = await sendingAccount({ environment: 'demo', accessToken: 'a' }, fetchImpl);
    expect(account).toStrictEqual({ accountId: 'only', basePath: 'https://demo.docusign.net/restapi' });
  });

  it.each([
    ['false in both spellings', [false, 'false']],
    ['absent', [undefined, undefined]],
    ['a truthy value that is neither spelling', [1, 'yes']],
  ])('CONTROL: SEVERAL accounts whose flags are %s name no default, and are refused rather than guessed', async (_label, flags) => {
    // TWO ENTRIES EACH, so the only-account clause cannot apply: choosing one of several unmarked
    // accounts would be a guess about which organisation a document goes out under. And the rule is
    // two spellings, not truthiness — `1` and `"yes"` are not DocuSign saying "default".
    const { fetchImpl } = ask(
      flags.map((flag, index) => ({ account_id: `a${String(index)}`, is_default: flag, base_uri: 'https://na3.docusign.net' })),
    );
    const refused = await refusalOf(sendingAccount({ environment: 'production', accessToken: 'a' }, fetchImpl));
    expect(refused.reason).toBe('no-account');
  });

  it('CONTROL: no accounts at all is refused', async () => {
    const { fetchImpl } = ask([]);
    const refused = await refusalOf(sendingAccount({ environment: 'production', accessToken: 'a' }, fetchImpl));
    expect(refused.reason).toBe('no-account');
  });

  it.each([
    ['a look-alike domain', 'https://evil-docusign.net', true],
    ['plain HTTP', 'http://na3.docusign.net', true],
    ['another domain entirely', 'https://example.com', true],
    // THE ONLY-ACCOUNT PATH TOO: the host check guards whichever account is chosen, not only a marked one.
    ['another domain, on an only account none marked', 'https://example.com', false],
  ])('refuses a base URI on %s, before a token is ever sent to it', async (_label, baseUri, isDefault) => {
    const { fetchImpl, asked } = ask([{ account_id: 'chosen', is_default: isDefault, base_uri: baseUri }]);
    const refused = await refusalOf(sendingAccount({ environment: 'production', accessToken: 'a' }, fetchImpl));
    expect(refused.reason).toBe('unlisted-host');
    // ONE CALL: userinfo. Nothing went to the refused host.
    expect(asked).toHaveLength(1);
  });
});

/**
 * THE BODY THE LIVE RUN PROVED, spelt as it was sent before the envelope was streamed (ADR-0165's correction of
 * 2026-10-15): `JSON.stringify` of the whole definition, the document's base64 in one string. Kept here as the oracle,
 * so a streamed body is held to the bytes DocuSign accepted rather than to this module agreeing with itself.
 */
function provenBody(terms: EnvelopeTerms, pdf: Uint8Array): string {
  return JSON.stringify({
    emailSubject: terms.emailSubject,
    documents: [{ documentBase64: Buffer.from(pdf).toString('base64'), name: terms.documentName, fileExtension: 'pdf', documentId: '1' }],
    recipients: {
      signers: terms.signers.map((signer, index) => ({
        email: signer.email,
        name: signer.name,
        recipientId: String(index + 1),
        routingOrder: String(index + 1),
      })),
    },
    status: 'sent',
  });
}

/** A source over `bytes` that records every range asked of it. */
function recordedSource(bytes: Uint8Array): { readonly source: PdfSource; readonly reads: [number, number][] } {
  const reads: [number, number][] = [];
  return {
    reads,
    source: {
      byteLength: bytes.byteLength,
      read: (offset, end) => {
        reads.push([offset, end]);
        return Promise.resolve(bytes.slice(offset, end));
      },
    },
  };
}

async function joined(parts: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const part of parts) text += part;
  return text;
}

const TERMS: EnvelopeTerms = {
  // A SUBJECT CARRYING THE SLOT'S OWN TEXT, quotes and all: inside a string value it is escaped, so the split finds the
  // document's slot and not this.
  emailSubject: 'Please sign "documentBase64":"" — ünïcode',
  documentName: 'Contract "final".pdf',
  signers: [
    { name: 'Grace Hopper', email: 'grace@example.com' },
    { name: 'Ada Lovelace', email: 'ada@example.com' },
  ],
};

describe('envelopeBody', () => {
  it('joins to the body the live run proved, byte for byte, for every length across several reads', async () => {
    for (let length = 0; length <= 20; length += 1) {
      const pdf = Uint8Array.from({ length }, (_, at) => (at * 37 + 11) % 256);
      for (const readBytes of [3, 6, 21]) {
        expect(await joined(envelopeBody(TERMS, recordedSource(pdf).source, readBytes))).toBe(provenBody(TERMS, pdf));
      }
    }
  });

  it('reads the document in order, a read at a time, never more than one read’s bytes', async () => {
    const pdf = Uint8Array.from({ length: 20 }, (_, at) => at);
    const { source, reads } = recordedSource(pdf);
    await joined(envelopeBody(TERMS, source, 6));
    expect(reads).toStrictEqual([
      [0, 6],
      [6, 12],
      [12, 18],
      [18, 20],
    ]);
  });

  it('refuses a read that is not a multiple of three, since its base64 would pad mid-document', async () => {
    const pdf = Uint8Array.from({ length: 8 }, (_, at) => at);
    await expect(joined(envelopeBody(TERMS, recordedSource(pdf).source, 4))).rejects.toThrow('not a multiple of three');
    // CONTROL, the reason the refusal exists: four-byte parts encoded and joined are NOT the document's base64.
    const fours = Buffer.from(pdf.subarray(0, 4)).toString('base64') + Buffer.from(pdf.subarray(4)).toString('base64');
    expect(fours).not.toBe(Buffer.from(pdf).toString('base64'));
  });

  it('the production read is a multiple of three', () => {
    expect(ENVELOPE_READ_BYTES % 3).toBe(0);
  });
});

describe('sendEnvelope', () => {
  it('posts one PDF to its signers in order, with status sent, to the account’s envelopes', async () => {
    const { fetchImpl, asked } = recording(() => json({ envelopeId: 'env-1', status: 'sent' }));
    const pdf = Uint8Array.of(0x25, 0x50, 0x44, 0x46);
    const terms: EnvelopeTerms = { ...TERMS, emailSubject: 'Please sign', documentName: 'Contract.pdf' };
    const parts: string[] = [];
    for await (const part of envelopeBody(terms, recordedSource(pdf).source)) parts.push(part);

    const envelopeId = await sendEnvelope(
      {
        account: { accountId: 'acct', basePath: 'https://na3.docusign.net/restapi' },
        accessToken: 'access',
        body: new Blob(parts),
      },
      fetchImpl,
    );

    expect(envelopeId).toBe('env-1');
    expect(asked[0]?.url).toBe('https://na3.docusign.net/restapi/v2.1/accounts/acct/envelopes');
    // THE BODY SENT IS THE PROVEN ONE, and goes as a Blob, which `fetch` sends with its length rather than chunked.
    const sent = asked[0]?.init?.body;
    expect(sent).toBeInstanceOf(Blob);
    const text = await (sent as Blob).text();
    expect(text).toBe(provenBody(terms, pdf));
    expect(new Headers(asked[0]?.init?.headers).get('content-type')).toBe('application/json');
    const body = JSON.parse(text) as {
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
  it('reads the combined document’s bytes from documents/combined, ASKING for the certificate', async () => {
    // THE WHOLE URL, query included: DocuSign leaves the certificate of completion out of `combined`
    // unless `certificate=true` is asked for, and the owner's first signed copy came back without it.
    const signed = Uint8Array.of(1, 2, 3, 4);
    const { fetchImpl, asked } = recording(() => new Response(signed));

    const bytes = await completedDocument(
      { account: { accountId: 'acct', basePath: 'https://na3.docusign.net/restapi' }, accessToken: 'a', envelopeId: 'env-1' },
      fetchImpl,
    );

    expect(Array.from(bytes)).toStrictEqual([1, 2, 3, 4]);
    expect(asked[0]?.url).toBe(
      'https://na3.docusign.net/restapi/v2.1/accounts/acct/envelopes/env-1/documents/combined?certificate=true',
    );
  });
});
