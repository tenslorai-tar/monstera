import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import type { CloudFile, CloudProviderId, CloudRefusal, CloudState } from '@monstera/contract';
import {
  CLOUD_PROVIDERS,
  type CloudClient,
  CloudStorageRefused,
  type CloudTokens,
  cloudAuthorizationUrl,
  createCloudPdf,
  describeCloudFile,
  exchangeCloudCode,
  fetchCloudPdf,
  listCloudPdfs,
  oauthState,
  pkcePair,
  refreshCloudTokens,
  replaceCloudPdf,
} from '@monstera/kernel';
import type { DocId } from '@monstera/shared';

import { type OpenInBrowser, SignInRefused, signInThroughLoopback } from './docusignSignIn.js';
import type { SecretStoreSurface } from './secretStore.js';

/**
 * Cloud storage, as `main` holds it
 * ([ADR-0091](../../../docs/DECISIONS/0091-cloud-storage-a-declared-provider-a-build-configured-client-and-a-working-copy.md)).
 *
 * `docusignSession.ts`' shape, per provider: a sign-in kept in the secret store under an id
 * OUTSIDE `SECRET_SETTING_IDS` — so the renderer can neither write it nor learn it exists — kept
 * fresh by refresh, and repeated when the provider stops accepting it.
 *
 * ## A cloud file is a working copy
 *
 * `download` writes into this application's own data directory, one folder per provider and
 * file, and answers the path; the caller opens it through the one way a document opens. The link
 * from the open document back to the cloud file — which file, at which version — is held here, by
 * `DocId`, for this session only: nothing about it is written to the document.
 *
 * ## Every failure is a named refusal
 *
 * The kernel's and the sign-in's refusals map to the contract's `CloudRefusal`, and nothing is
 * mapped by elimination.
 */

/** A cloud request that ended without its result, named by the contract. */
export class CloudOutcomeRefused extends Error {
  override readonly name = 'CloudOutcomeRefused';
  readonly reason: CloudRefusal;

  constructor(reason: CloudRefusal, options?: ErrorOptions) {
    super(`cloud storage: ${reason}`, options);
    this.reason = reason;
  }
}

/** The secret-store id a provider's sign-in is kept under — deliberately not a setting. */
export function cloudSessionSecretId(provider: CloudProviderId): string {
  return `cloud.${provider}-session`;
}

/** How long before expiry an access token is refreshed. DocuSign's bound, for its reason. */
const EXPIRY_MARGIN_MS = 60_000;

/** Characters Windows refuses in a file name, beside the control characters below 32. */
const REFUSED_IN_NAMES = '<>:"/\\|?*';

/** A cloud file this session opened, and the version it was at. */
interface CloudOrigin {
  readonly provider: CloudProviderId;
  readonly fileId: string;
  readonly version: string;
}

function refusalOfKernel(error: CloudStorageRefused): CloudRefusal {
  switch (error.reason) {
    case 'unauthorised':
    case 'unreachable':
    case 'rejected':
    case 'changed-elsewhere':
    case 'too-large':
    case 'not-a-pdf':
    case 'unexpected-answer':
      return error.reason;
  }
}

function refusalOfSignIn(error: SignInRefused): CloudRefusal {
  switch (error.reason) {
    case 'cancelled':
      return 'sign-in-cancelled';
    case 'timed-out':
      return 'sign-in-timed-out';
    case 'denied':
    case 'mismatched-state':
      return 'sign-in-denied';
    case 'listener-failed':
      return 'sign-in-unavailable';
  }
}

/** Runs `work`, turning every named refusal into the contract's. */
async function named<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CloudOutcomeRefused) throw error;
    if (error instanceof CloudStorageRefused) throw new CloudOutcomeRefused(refusalOfKernel(error), { cause: error });
    if (error instanceof SignInRefused) throw new CloudOutcomeRefused(refusalOfSignIn(error), { cause: error });
    throw error;
  }
}

/** A kept sign-in read back, or `null` for none or a malformed one. */
function kept(raw: string | undefined): CloudTokens | null {
  if (raw === undefined || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // ONE THIS BUILD NEVER WROTE WHOLE is the same as none: sign in again.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { accessToken, refreshToken, expiresAt } = parsed as Record<string, unknown>;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || typeof expiresAt !== 'number') return null;
  return { accessToken, refreshToken, expiresAt };
}

/** A provider's file name, made safe for this file system: the name is the person's. */
export function safeFileName(name: string): string {
  // BY CODE UNIT: every character refused here is one code unit, and a pair from outside the Basic
  // Multilingual Plane passes through unchanged as its two halves.
  let safe = '';
  for (let at = 0; at < name.length && safe.length < 180; at += 1) {
    const character = name.charAt(at);
    safe += name.charCodeAt(at) < 32 || REFUSED_IN_NAMES.includes(character) ? '_' : character;
  }
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
}

/** What writes a working copy: the save pipeline's streamed write, from the composition root. */
export type WriteWorkingCopy = (
  path: string,
  open: () => Promise<Readable>,
) => Promise<'written' | 'contested' | 'write-failed'>;

export interface CloudStorage {
  state(provider: CloudProviderId): CloudState;
  signIn(provider: CloudProviderId): Promise<void>;
  signOut(provider: CloudProviderId): void;
  list(provider: CloudProviderId): Promise<readonly CloudFile[]>;
  /** Downloads a file into its working copy and answers the path to open. */
  download(provider: CloudProviderId, fileId: string): Promise<string>;
  /** Links an opened working copy's document to its cloud file. */
  link(docId: DocId, path: string): void;
  /** Which provider a document came from, or `null`. */
  originOf(docId: DocId): CloudProviderId | null;
  /** Uploads a linked document's saved bytes back to its file, at the version it was opened at. */
  saveBack(docId: DocId, pdf: Uint8Array): Promise<void>;
  /** Puts a copy of a document in the provider's storage, and links the document to it. */
  uploadCopy(docId: DocId, provider: CloudProviderId, name: string, pdf: Uint8Array): Promise<void>;
  /** Forgets a closed document's link. */
  forget(docId: DocId): void;
}

/**
 * A build with no provider configured — what an assembly without cloud client values IS, not an
 * inert stand-in: every provider answers `not-configured`, and nothing reaches a network or a disk.
 * For the harnesses and the cases that assemble the handlers without being about cloud storage.
 */
export function unconfiguredCloud(): CloudStorage {
  return createCloudStorage({
    secrets: { available: () => false, read: () => ({}), write: () => undefined },
    clients: { onedrive: null, 'google-drive': null },
    openInBrowser: () => Promise.reject(new Error('an unconfigured cloud opens no browser')),
    workingDirectory: '',
    writeWorkingCopy: () => Promise.reject(new Error('an unconfigured cloud writes no working copy')),
    maxBytes: 0,
  });
}

export function createCloudStorage(deps: {
  readonly secrets: SecretStoreSurface;
  readonly clients: Readonly<Record<CloudProviderId, CloudClient | null>>;
  readonly openInBrowser: OpenInBrowser;
  /** This application's own directory for working copies. */
  readonly workingDirectory: string;
  readonly writeWorkingCopy: WriteWorkingCopy;
  /** The document ceiling a download is bounded by. */
  readonly maxBytes: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly signInTimeoutMs?: number;
}): CloudStorage {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  /** Working copies downloaded this session, by path, until opened. */
  const downloaded = new Map<string, CloudOrigin>();
  /** Opened working copies, by document. */
  const linked = new Map<DocId, CloudOrigin>();

  function client(provider: CloudProviderId): CloudClient {
    const found = deps.clients[provider];
    if (found === null) throw new CloudOutcomeRefused('not-configured');
    if (!deps.secrets.available()) throw new CloudOutcomeRefused('secrets-unavailable');
    return found;
  }

  function keep(provider: CloudProviderId, tokens: CloudTokens): void {
    deps.secrets.write(cloudSessionSecretId(provider), JSON.stringify(tokens));
  }

  async function signIn(provider: CloudProviderId): Promise<CloudTokens> {
    const spec = CLOUD_PROVIDERS[provider];
    const values = client(provider);
    const pair = pkcePair();
    const state = oauthState();
    const { code, redirectUri } = await signInThroughLoopback({
      authorize: (redirect) => ({
        url: cloudAuthorizationUrl(spec, {
          clientId: values.clientId,
          redirectUri: redirect,
          state,
          challenge: pair.challenge,
        }),
        state,
      }),
      openInBrowser: deps.openInBrowser,
      path: spec.redirect.path,
      redirectHost: spec.redirect.host,
      ...(deps.signInTimeoutMs === undefined ? {} : { timeoutMs: deps.signInTimeoutMs }),
    });
    const tokens = await exchangeCloudCode(spec, values, { code, verifier: pair.verifier, redirectUri }, fetchImpl, now);
    keep(provider, tokens);
    return tokens;
  }

  /** An access token good for the next request, refreshing — or signing in again — as needed. */
  async function token(provider: CloudProviderId): Promise<string> {
    const values = client(provider);
    const session = kept(deps.secrets.read()[cloudSessionSecretId(provider)]);
    if (session === null) return (await signIn(provider)).accessToken;
    if (session.expiresAt - now() > EXPIRY_MARGIN_MS) return session.accessToken;
    try {
      const refreshed = await refreshCloudTokens(CLOUD_PROVIDERS[provider], values, session.refreshToken, fetchImpl, now);
      keep(provider, refreshed);
      return refreshed.accessToken;
    } catch (error) {
      // A REFRESH TOKEN THE PROVIDER NO LONGER ACCEPTS is a sign-in to repeat, and the stale one is
      // removed first so a failed new sign-in does not leave it behind.
      if (error instanceof CloudStorageRefused && error.reason === 'unauthorised') {
        deps.secrets.write(cloudSessionSecretId(provider), '');
        return (await signIn(provider)).accessToken;
      }
      throw error;
    }
  }

  /** The working copy's path: one folder per provider and file, named by a hash of the id. */
  function workingPath(provider: CloudProviderId, fileId: string, name: string): string {
    const folder = createHash('sha256').update(fileId).digest('hex').slice(0, 24);
    return join(deps.workingDirectory, provider, folder, safeFileName(name));
  }

  return {
    state: (provider) => {
      if (deps.clients[provider] === null) return 'not-configured';
      return kept(deps.secrets.read()[cloudSessionSecretId(provider)]) === null ? 'signed-out' : 'signed-in';
    },
    signIn: (provider) =>
      named(async () => {
        await signIn(provider);
      }),
    signOut: (provider) => {
      deps.secrets.write(cloudSessionSecretId(provider), '');
    },
    list: (provider) => named(async () => listCloudPdfs(provider, await token(provider), fetchImpl)),
    download: (provider, fileId) =>
      named(async () => {
        const access = await token(provider);
        const { name, version } = await describeCloudFile(provider, access, fileId, fetchImpl);
        const path = workingPath(provider, fileId, name);
        const written = await deps.writeWorkingCopy(path, () =>
          fetchCloudPdf(provider, access, fileId, deps.maxBytes, fetchImpl),
        );
        // A WORKING COPY ALREADY OPEN is contested by the save pipeline's own check: the person has
        // this file open, and a fresh download would replace a document under them.
        if (written === 'contested') throw new CloudOutcomeRefused('changed-elsewhere');
        if (written === 'write-failed') throw new CloudOutcomeRefused('rejected');
        downloaded.set(path, { provider, fileId, version });
        return path;
      }),
    link: (docId, path) => {
      const origin = downloaded.get(path);
      if (origin !== undefined) linked.set(docId, origin);
    },
    originOf: (docId) => linked.get(docId)?.provider ?? null,
    saveBack: (docId, pdf) =>
      named(async () => {
        const origin = linked.get(docId);
        if (origin === undefined) throw new Error('saveBack was asked for a document with no cloud origin');
        const access = await token(origin.provider);
        const version = await replaceCloudPdf(origin.provider, access, origin.fileId, origin.version, pdf, fetchImpl);
        linked.set(docId, { ...origin, version });
      }),
    uploadCopy: (docId, provider, name, pdf) =>
      named(async () => {
        const access = await token(provider);
        const fileId = await createCloudPdf(provider, access, name, pdf, fetchImpl);
        const { version } = await describeCloudFile(provider, access, fileId, fetchImpl);
        // LINKED to the new file, so Save back goes there next; the local file stays where it was.
        linked.set(docId, { provider, fileId, version });
      }),
    forget: (docId) => {
      linked.delete(docId);
    },
  };
}
