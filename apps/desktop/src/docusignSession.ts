import {
  DOCUSIGN_ENVIRONMENT_SETTING_ID,
  DOCUSIGN_ENVIRONMENTS,
  DOCUSIGN_INTEGRATION_KEY_SETTING_ID,
  type DocusignEnvironment,
  type DocusignRefusalKind,
} from '@monstera/contract';
import {
  authorizationUrl,
  completedDocument,
  defaultAccount,
  type DocusignAccount,
  DocusignRefused,
  type DocusignSigner,
  envelopeStatus,
  exchangeCode,
  oauthState,
  pkcePair,
  refreshTokens,
  sendEnvelope,
} from '@monstera/kernel';

import { type OpenInBrowser, SignInRefused, signInThroughLoopback } from './docusignSignIn.js';
import type { SecretStoreSurface } from './secretStore.js';
import type { SettingsSurface } from './settingsFile.js';

/**
 * DocuSign, as `main` holds it: one sign-in, kept, refreshed and used
 * ([ADR-0059](../../../docs/DECISIONS/0059-a-sign-in-redirect-returns-on-loopback-for-one-request.md)).
 *
 * ## Where each thing lives, and why
 *
 * - **The integration key** is a secret setting the person stores
 *   (`DOCUSIGN_INTEGRATION_KEY_SETTING_ID`), and the **environment** an ordinary one.
 * - **The sign-in** — tokens, their expiry, the account and its REST base path — is
 *   kept in the secret store under {@link SESSION_SECRET_ID}, which is NOT in
 *   `SECRET_SETTING_IDS`. The renderer can therefore neither write it nor learn it
 *   exists: `settings.saveSecret` refuses any id outside that list, and
 *   `settings.loadSecrets` reports only ids inside it.
 * - **Which envelope a document was sent as** is remembered for this session only.
 *   A signed copy is fetched for the envelope this session sent; nothing about a
 *   document's envelopes is written to the document or to disk.
 *
 * ## A refusal is always one of the contract's kinds
 *
 * Every failure the kernel or the sign-in names is mapped to `DOCUSIGN_REFUSALS`, and
 * nothing is mapped by elimination: an error that is neither is not a person's
 * situation, and propagates to the handler as a defect.
 */

/**
 * The secret-store id a sign-in is kept under.
 *
 * **Deliberately outside `SECRET_SETTING_IDS`** — see the module header.
 */
export const SESSION_SECRET_ID = 'integrations.docusign-session';

/**
 * How long before its expiry an access token is refreshed, in milliseconds.
 *
 * **A bound, not a measurement**: a request started with a token about to lapse
 * would fail mid-flight, and a minute is longer than any single request here takes
 * while being far shorter than any token's life.
 */
const EXPIRY_MARGIN_MS = 60_000;

/** A sign-in, as it is kept. */
interface KeptSession {
  readonly environment: DocusignEnvironment;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly account: DocusignAccount;
}

/** A DocuSign attempt that ended without its result, named by the contract's kind. */
export class DocusignOutcomeRefused extends Error {
  override readonly name = 'DocusignOutcomeRefused';
  readonly kind: DocusignRefusalKind;

  constructor(kind: DocusignRefusalKind, options?: ErrorOptions) {
    super(`DocuSign: ${kind}`, options);
    this.kind = kind;
  }
}

/** The kernel's refusal, as the contract names it. */
function kindOfKernelRefusal(error: DocusignRefused): DocusignRefusalKind {
  switch (error.reason) {
    case 'unauthorised':
      return 'unauthorised';
    case 'rejected':
      return 'rejected';
    case 'unreachable':
      return 'unreachable';
    case 'unreadable-answer':
      return 'unexpected-answer';
    // A BASE PATH OUTSIDE DOCUSIGN'S DOMAIN IS NOT AN ACCOUNT THIS BUILD WILL ACT
    // IN, and the person's situation is the same as having none: no send can happen.
    case 'no-account':
    case 'unlisted-host':
      return 'no-account';
  }
}

/** The sign-in's refusal, as the contract names it. */
function kindOfSignInRefusal(error: SignInRefused): DocusignRefusalKind {
  switch (error.reason) {
    case 'cancelled':
      return 'sign-in-cancelled';
    case 'timed-out':
      return 'sign-in-timed-out';
    // A FORGED OR MISMATCHED REDIRECT IS A SIGN-IN THAT DID NOT HAPPEN, and the
    // person's next step is the same as for a refusal: sign in again.
    case 'denied':
    case 'mismatched-state':
      return 'sign-in-denied';
    case 'listener-failed':
      return 'sign-in-unavailable';
  }
}

/** Runs `work`, translating every named refusal into the contract's kind. */
async function named<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DocusignOutcomeRefused) throw error;
    if (error instanceof DocusignRefused) {
      throw new DocusignOutcomeRefused(kindOfKernelRefusal(error), { cause: error });
    }
    if (error instanceof SignInRefused) {
      throw new DocusignOutcomeRefused(kindOfSignInRefusal(error), { cause: error });
    }
    throw error;
  }
}

/** A kept session read back, or `null` for none, a malformed one, or another environment's. */
function keptSession(raw: string | undefined, environment: DocusignEnvironment): KeptSession | null {
  if (raw === undefined || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A KEPT SESSION THAT WILL NOT PARSE is one this build never wrote whole, and the
    // honest response is the same as having none: sign in again.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const session = parsed as Record<string, unknown>;
  const account = session['account'] as Record<string, unknown> | undefined;
  if (
    session['environment'] !== environment ||
    typeof session['accessToken'] !== 'string' ||
    typeof session['refreshToken'] !== 'string' ||
    typeof session['expiresAt'] !== 'number' ||
    typeof account?.['accountId'] !== 'string' ||
    typeof account['basePath'] !== 'string'
  ) {
    return null;
  }
  return {
    environment,
    accessToken: session['accessToken'],
    refreshToken: session['refreshToken'],
    expiresAt: session['expiresAt'],
    account: { accountId: account['accountId'], basePath: account['basePath'] },
  };
}

/** What `main` asks of DocuSign. */
export interface DocusignSession {
  /** Sends a document's bytes to its signers, and remembers the envelope for `docId`. */
  send(request: {
    readonly docId: string;
    readonly pdf: Uint8Array;
    readonly documentName: string;
    readonly emailSubject: string;
    readonly signers: readonly DocusignSigner[];
  }): Promise<string>;
  /** The signed copy of the envelope `docId` was last sent as, or why not. */
  retrieve(
    docId: string,
  ): Promise<
    | { readonly kind: 'nothing-sent' }
    | { readonly kind: 'not-completed'; readonly status: string }
    | { readonly kind: 'completed'; readonly bytes: Uint8Array }
  >;
  /** Whether an envelope was sent from `docId` in this session. */
  hasSent(docId: string): boolean;
}

/**
 * Builds the session.
 *
 * @param deps.fetchImpl, deps.now and deps.signInTimeoutMs are injected for cases;
 *   the application passes none of them.
 */
export function createDocusignSession(deps: {
  readonly settings: SettingsSurface;
  readonly secrets: SecretStoreSurface;
  readonly openInBrowser: OpenInBrowser;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly signInTimeoutMs?: number;
}): DocusignSession {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const sent = new Map<string, string>();

  /** The key and environment a call needs, or the refusal a person can act on. */
  function configuration(): { readonly clientId: string; readonly environment: DocusignEnvironment } {
    const clientId = deps.secrets.read()[DOCUSIGN_INTEGRATION_KEY_SETTING_ID] ?? '';
    if (clientId === '') throw new DocusignOutcomeRefused('no-integration-key');
    if (!deps.secrets.available()) throw new DocusignOutcomeRefused('secrets-unavailable');
    const stored = deps.settings.read()[DOCUSIGN_ENVIRONMENT_SETTING_ID];
    const environment = (DOCUSIGN_ENVIRONMENTS as readonly unknown[]).includes(stored)
      ? (stored as DocusignEnvironment)
      : 'production';
    return { clientId, environment };
  }

  /** Keeps a session in the secret store. */
  function keep(session: KeptSession): void {
    deps.secrets.write(SESSION_SECRET_ID, JSON.stringify(session));
  }

  /** A fresh sign-in through the person's browser. */
  async function signIn(clientId: string, environment: DocusignEnvironment): Promise<KeptSession> {
    const pair = pkcePair();
    const state = oauthState();
    const { code, redirectUri } = await signInThroughLoopback({
      authorize: (redirect) => ({
        url: authorizationUrl({ environment, clientId, redirectUri: redirect, state, challenge: pair.challenge }),
        state,
      }),
      openInBrowser: deps.openInBrowser,
      ...(deps.signInTimeoutMs === undefined ? {} : { timeoutMs: deps.signInTimeoutMs }),
    });
    const tokens = await exchangeCode(
      { environment, clientId, redirectUri, code, verifier: pair.verifier },
      fetchImpl,
      now,
    );
    const account = await defaultAccount({ environment, accessToken: tokens.accessToken }, fetchImpl);
    const session: KeptSession = { environment, ...tokens, account };
    keep(session);
    return session;
  }

  /** A session whose access token is good for the next request. */
  async function usable(): Promise<KeptSession> {
    const { clientId, environment } = configuration();
    const kept = keptSession(deps.secrets.read()[SESSION_SECRET_ID], environment);
    if (kept === null) return signIn(clientId, environment);
    if (kept.expiresAt - now() > EXPIRY_MARGIN_MS) return kept;
    try {
      const tokens = await refreshTokens({ environment, clientId, refreshToken: kept.refreshToken }, fetchImpl, now);
      const refreshed: KeptSession = { ...kept, ...tokens };
      keep(refreshed);
      return refreshed;
    } catch (error) {
      // A REFRESH TOKEN DOCUSIGN NO LONGER ACCEPTS is a sign-in to repeat, and the
      // stale one is removed first so a failed new sign-in does not leave it behind.
      if (error instanceof DocusignRefused && error.reason === 'unauthorised') {
        deps.secrets.write(SESSION_SECRET_ID, '');
        return signIn(clientId, environment);
      }
      throw error;
    }
  }

  return {
    send: (request) =>
      named(async () => {
        const session = await usable();
        const envelopeId = await sendEnvelope(
          {
            account: session.account,
            accessToken: session.accessToken,
            emailSubject: request.emailSubject,
            documentName: request.documentName,
            pdf: request.pdf,
            signers: request.signers,
          },
          fetchImpl,
        );
        sent.set(request.docId, envelopeId);
        return envelopeId;
      }),
    retrieve: (docId) =>
      named(async () => {
        const envelopeId = sent.get(docId);
        if (envelopeId === undefined) return { kind: 'nothing-sent' as const };
        const session = await usable();
        const status = await envelopeStatus(
          { account: session.account, accessToken: session.accessToken, envelopeId },
          fetchImpl,
        );
        if (status !== 'completed') return { kind: 'not-completed' as const, status };
        const bytes = await completedDocument(
          { account: session.account, accessToken: session.accessToken, envelopeId },
          fetchImpl,
        );
        return { kind: 'completed' as const, bytes };
      }),
    hasSent: (docId) => sent.has(docId),
  };
}
