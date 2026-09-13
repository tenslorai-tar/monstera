import { createHash, randomBytes } from 'node:crypto';

import type { DocusignEnvironment } from '@monstera/contract';

import { readWithin } from './verifiedDownload.js';

/**
 * DocuSign, as a public OAuth client and an eSignature REST caller
 * ([ADR-0059](../../../docs/DECISIONS/0059-a-sign-in-redirect-returns-on-loopback-for-one-request.md)).
 *
 * ## What this module is, and what it is not
 *
 * The protocol: the PKCE pair, the authorization URL, the code exchange, a refresh,
 * the account a token belongs to, and the envelope calls. It opens no browser,
 * listens on no port and stores nothing — those are `main`'s, where the loopback
 * listener and the secret store are. Every call takes `fetchImpl`, so its cases
 * drive it without a network, which is `ocrClaude.ts`' shape.
 *
 * ## EVERY FACT HERE IS SOURCED, and two premises are not
 *
 * Read 2026-09-13:
 *
 * - **Hosts**: `account.docusign.com` and `account-d.docusign.com` publish
 *   `/oauth/auth`, `/oauth/token` and `/oauth/userinfo` in their OpenID discovery
 *   documents.
 * - **The authorization request and the exchange**: Docusign's developer blog,
 *   *How to Set Up JavaScript OAuth Authorization Code Grant with PKCE* — the request
 *   carries `response_type=code`, `scope`, `client_id`, `code_challenge`,
 *   `code_challenge_method=S256`, `redirect_uri` and `state`; the exchange posts
 *   `grant_type=authorization_code`, `code`, `client_id` and `code_verifier`, with
 *   no secret; the answer carries `access_token`, `token_type`, `refresh_token` and
 *   `expires_in`. `redirect_uri` is sent on the exchange as well, because RFC 6749
 *   §4.1.3 requires it whenever the authorization request carried one.
 * - **The account**: Docusign's *From the Trenches: Who are you?* — `userinfo`
 *   answers `accounts[]` with `account_id`, `account_name`, `base_uri` and
 *   `is_default`, **`is_default` being the STRING `"true"` or `"false"`**, and the
 *   REST base path is `base_uri` plus `/restapi`; its examples are
 *   `https://eu.docusign.net` and `https://na3.docusign.net`. DocuSign's own Java
 *   SDK test builds the base path the same way.
 * - **The envelope**: Docusign's eSignature OpenAPI (v2.1) — `POST
 *   /v2.1/accounts/{accountId}/envelopes` with `emailSubject`, `documents[]`
 *   (`documentBase64`, `name`, `fileExtension`, `documentId`), `recipients.signers[]`
 *   (`email`, `name`, `recipientId`, `routingOrder`) and `status: "sent"`; `GET
 *   …/envelopes/{envelopeId}` for its status; and `GET
 *   …/envelopes/{envelopeId}/documents/combined`, *"all of the documents as a single
 *   PDF file"*.
 *
 * **Unconfirmed**, with the owner's integration key as the trigger: whether
 * DocuSign accepts a varying loopback port (ADR-0059), and whether a signer with no
 * placed tabs is offered free-form signing on the owner's account.
 */

/** The account host for each environment, from its discovery document. */
export const DOCUSIGN_ACCOUNT_HOSTS: Readonly<Record<DocusignEnvironment, string>> = {
  production: 'account.docusign.com',
  demo: 'account-d.docusign.com',
};

/**
 * The domain every REST base path must sit under.
 *
 * `base_uri` is regional — `eu.docusign.net`, `na3.docusign.net`, `demo.docusign.net`
 * in DocuSign's own examples — so the host is locked by suffix, with the dot
 * load-bearing: `evil-docusign.net` is refused. A token is sent to that host, so an
 * answer naming any other one is refused before anything is.
 */
export const DOCUSIGN_REST_DOMAIN = 'docusign.net';

/** The eSignature scope, as the discovery documents list it. */
export const DOCUSIGN_SCOPE = 'signature';

/**
 * The largest JSON answer read, in received bytes.
 *
 * **A bound, not a measurement**: every answer this module reads as JSON is a small
 * object, and a reply past this is refused rather than parsed.
 */
const MAX_JSON_BYTES = 1_048_576;

/**
 * The largest signed document read back, in received bytes.
 *
 * **A bound, not a measurement**, set at the application's own open ceiling's order
 * rather than guessed smaller: a signed document is the document sent, plus
 * DocuSign's signature and certificate pages.
 */
const MAX_DOCUMENT_BYTES = 512 * 1_048_576;

/** Why a DocuSign call did not produce its answer. */
export type DocusignRefusal =
  /** The token or the key was refused — HTTP 401 or 403. */
  | 'unauthorised'
  /** DocuSign answered with another HTTP error. */
  | 'rejected'
  /** The request could not be made. */
  | 'unreachable'
  /** The answer was not the shape documented, or past its ceiling. */
  | 'unreadable-answer'
  /** `userinfo` named no default account. */
  | 'no-account'
  /** A base path outside DocuSign's REST domain. */
  | 'unlisted-host';

/** A DocuSign call that did not produce its answer. */
export class DocusignRefused extends Error {
  override readonly name = 'DocusignRefused';
  readonly reason: DocusignRefusal;

  constructor(reason: DocusignRefusal, message: string, options?: ErrorOptions) {
    super(message, options);
    this.reason = reason;
  }
}

/** A PKCE pair (RFC 7636). */
export interface PkcePair {
  /** 32 random bytes, base64url — 43 characters, inside §4.1's 43 to 128. */
  readonly verifier: string;
  /** base64url(SHA-256(verifier)), the `S256` method (§4.2). */
  readonly challenge: string;
}

/**
 * A fresh PKCE pair.
 *
 * @param random injected so a case can fix it; the application passes nothing.
 */
export function pkcePair(random: (count: number) => Buffer = randomBytes): PkcePair {
  const verifier = random(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** A fresh `state`, compared on the redirect (RFC 6749 §10.12). */
export function oauthState(random: (count: number) => Buffer = randomBytes): string {
  return random(24).toString('base64url');
}

/** What an authorization request names. */
export interface AuthorizationRequest {
  readonly environment: DocusignEnvironment;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly challenge: string;
}

/** The URL the person's browser is sent to. */
export function authorizationUrl(request: AuthorizationRequest): string {
  const url = new URL(`https://${DOCUSIGN_ACCOUNT_HOSTS[request.environment]}/oauth/auth`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', DOCUSIGN_SCOPE);
  url.searchParams.set('client_id', request.clientId);
  url.searchParams.set('redirect_uri', request.redirectUri);
  url.searchParams.set('state', request.state);
  url.searchParams.set('code_challenge', request.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** A token set, with its absolute expiry. */
export interface DocusignTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** When the access token stops working, as epoch milliseconds. */
  readonly expiresAt: number;
}

/**
 * A fetch whose failure to reach anything is named, and whose HTTP errors are too.
 *
 * The answer's body is read through `readWithin`, the application's one received-byte
 * ceiling, and never by `response.json()`, which reads whatever arrives.
 */
async function call(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  maxBytes: number,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, redirect: 'error' });
  } catch (cause) {
    throw new DocusignRefused('unreachable', 'DocuSign could not be reached', { cause });
  }
  if (response.status === 401 || response.status === 403) {
    throw new DocusignRefused('unauthorised', `DocuSign answered HTTP ${String(response.status)}`);
  }
  if (!response.ok) {
    throw new DocusignRefused('rejected', `DocuSign answered HTTP ${String(response.status)}`);
  }
  if (response.body === null) {
    throw new DocusignRefused('unreadable-answer', 'DocuSign answered no body');
  }
  return readWithin(
    response.body,
    maxBytes,
    (received) =>
      new DocusignRefused(
        'unreadable-answer',
        `DocuSign's answer passed its ${String(maxBytes)}-byte ceiling at ${String(received)} bytes`,
      ),
  );
}

/** A call's body as JSON, refusing anything that is not an object. */
async function callJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Readonly<Record<string, unknown>>> {
  const body = await call(fetchImpl, url, init, MAX_JSON_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body).toString('utf8'));
  } catch (cause) {
    throw new DocusignRefused('unreadable-answer', 'DocuSign answered something that is not JSON', {
      cause,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DocusignRefused('unreadable-answer', 'DocuSign answered JSON that is not an object');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

/** A token answer, read — refusing one without both tokens and an expiry. */
function tokensFrom(answer: Readonly<Record<string, unknown>>, now: number): DocusignTokens {
  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = answer;
  if (
    typeof accessToken !== 'string' ||
    accessToken === '' ||
    typeof refreshToken !== 'string' ||
    refreshToken === '' ||
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new DocusignRefused(
      'unreadable-answer',
      'the token answer lacks an access token, a refresh token or an expiry',
    );
  }
  return { accessToken, refreshToken, expiresAt: now + expiresIn * 1000 };
}

/** The token endpoint's URL for an environment. */
function tokenUrl(environment: DocusignEnvironment): string {
  return `https://${DOCUSIGN_ACCOUNT_HOSTS[environment]}/oauth/token`;
}

/**
 * Exchanges an authorization code for tokens, as a public client — no secret.
 *
 * @param now injected so a case can fix the expiry; the application passes nothing.
 */
export async function exchangeCode(
  request: {
    readonly environment: DocusignEnvironment;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly code: string;
    readonly verifier: string;
  },
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<DocusignTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: request.code,
    client_id: request.clientId,
    code_verifier: request.verifier,
    redirect_uri: request.redirectUri,
  });
  const answer = await callJson(fetchImpl, tokenUrl(request.environment), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return tokensFrom(answer, now());
}

/**
 * Exchanges a refresh token for a new set (RFC 6749 §6), as a public client.
 *
 * @param now injected so a case can fix the expiry; the application passes nothing.
 */
export async function refreshTokens(
  request: {
    readonly environment: DocusignEnvironment;
    readonly clientId: string;
    readonly refreshToken: string;
  },
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<DocusignTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: request.refreshToken,
    client_id: request.clientId,
  });
  const answer = await callJson(fetchImpl, tokenUrl(request.environment), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return tokensFrom(answer, now());
}

/** The account a token acts in, and where its REST calls go. */
export interface DocusignAccount {
  readonly accountId: string;
  /** `base_uri` plus `/restapi`, on a host under {@link DOCUSIGN_REST_DOMAIN}. */
  readonly basePath: string;
}

/**
 * The default account a token belongs to.
 *
 * **`is_default` is compared as the STRING `"true"`**, which is what DocuSign's own
 * example answer shows; a comparison with the boolean would never match, and would
 * report every person as having no account.
 */
export async function defaultAccount(
  request: { readonly environment: DocusignEnvironment; readonly accessToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<DocusignAccount> {
  const answer = await callJson(
    fetchImpl,
    `https://${DOCUSIGN_ACCOUNT_HOSTS[request.environment]}/oauth/userinfo`,
    { method: 'GET', headers: { authorization: `Bearer ${request.accessToken}` } },
  );
  const accounts = answer['accounts'];
  if (!Array.isArray(accounts)) {
    throw new DocusignRefused('unreadable-answer', 'userinfo answered no accounts list');
  }
  const chosen = accounts.find(
    (account: unknown) =>
      typeof account === 'object' &&
      account !== null &&
      (account as Record<string, unknown>)['is_default'] === 'true',
  ) as Record<string, unknown> | undefined;
  if (chosen === undefined) {
    throw new DocusignRefused('no-account', 'userinfo named no default account');
  }
  const accountId = chosen['account_id'];
  const baseUri = chosen['base_uri'];
  if (typeof accountId !== 'string' || accountId === '' || typeof baseUri !== 'string') {
    throw new DocusignRefused('unreadable-answer', 'the default account lacks an id or a base URI');
  }
  let host: URL;
  try {
    host = new URL(baseUri);
  } catch (cause) {
    throw new DocusignRefused('unreadable-answer', 'the base URI is not a URL', { cause });
  }
  // THE HOST A TOKEN IS SENT TO, locked by suffix with the dot load-bearing.
  const suffix = `.${DOCUSIGN_REST_DOMAIN}`;
  if (host.protocol !== 'https:' || !host.hostname.endsWith(suffix)) {
    throw new DocusignRefused('unlisted-host', 'the base URI is not an HTTPS host under DocuSign’s domain');
  }
  return { accountId, basePath: `${host.origin}/restapi` };
}

/** One recipient who signs. */
export interface DocusignSigner {
  readonly name: string;
  readonly email: string;
}

/**
 * Sends one PDF to its signers, in order, as an envelope with status `sent`.
 *
 * @returns the envelope's id.
 */
export async function sendEnvelope(
  request: {
    readonly account: DocusignAccount;
    readonly accessToken: string;
    readonly emailSubject: string;
    readonly documentName: string;
    readonly pdf: Uint8Array;
    readonly signers: readonly DocusignSigner[];
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const definition = {
    emailSubject: request.emailSubject,
    documents: [
      {
        documentBase64: Buffer.from(request.pdf).toString('base64'),
        name: request.documentName,
        fileExtension: 'pdf',
        documentId: '1',
      },
    ],
    recipients: {
      signers: request.signers.map((signer, index) => ({
        email: signer.email,
        name: signer.name,
        recipientId: String(index + 1),
        routingOrder: String(index + 1),
      })),
    },
    status: 'sent',
  };
  const answer = await callJson(
    fetchImpl,
    `${request.account.basePath}/v2.1/accounts/${encodeURIComponent(request.account.accountId)}/envelopes`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${request.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(definition),
    },
  );
  const envelopeId = answer['envelopeId'];
  if (typeof envelopeId !== 'string' || envelopeId === '') {
    throw new DocusignRefused('unreadable-answer', 'the envelope answer carries no envelope id');
  }
  return envelopeId;
}

/** An envelope's status, as DocuSign names it — `sent`, `delivered`, `completed`, … */
export async function envelopeStatus(
  request: { readonly account: DocusignAccount; readonly accessToken: string; readonly envelopeId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const answer = await callJson(
    fetchImpl,
    `${request.account.basePath}/v2.1/accounts/${encodeURIComponent(request.account.accountId)}` +
      `/envelopes/${encodeURIComponent(request.envelopeId)}`,
    { method: 'GET', headers: { authorization: `Bearer ${request.accessToken}` } },
  );
  const status = answer['status'];
  if (typeof status !== 'string' || status === '') {
    throw new DocusignRefused('unreadable-answer', 'the envelope answer carries no status');
  }
  return status;
}

/** A completed envelope's documents as one PDF (`documents/combined`). */
export async function completedDocument(
  request: { readonly account: DocusignAccount; readonly accessToken: string; readonly envelopeId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  return call(
    fetchImpl,
    `${request.account.basePath}/v2.1/accounts/${encodeURIComponent(request.account.accountId)}` +
      `/envelopes/${encodeURIComponent(request.envelopeId)}/documents/combined`,
    { method: 'GET', headers: { authorization: `Bearer ${request.accessToken}` } },
    MAX_DOCUMENT_BYTES,
  );
}
