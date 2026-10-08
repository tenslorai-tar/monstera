import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import {
  CLOUD_PROVIDER_IDS,
  type CloudFile,
  type CloudPickerProviderId,
  type CloudProviderId,
  type CloudRefusal,
  type CloudState,
} from '@monstera/contract';
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
  pickedFileId,
  pkcePair,
  refreshCloudTokens,
  replaceCloudPdf,
} from '@monstera/kernel';
import type { DocId } from '@monstera/shared';
import { z } from 'zod';

import { type OpenInBrowser, SignInRefused, signInThroughLoopback } from './docusignSignIn.js';
import type { SecretStoreSurface } from './secretStore.js';
import type { SettingsSurface } from './settingsFile.js';
import type { ShellFailureSink } from './shellFailure.js';

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

/** A cloud file this session opened, the version it was at, and whether the person may change it there. */
const cloudOriginSchema = z.strictObject({
  provider: z.enum(CLOUD_PROVIDER_IDS),
  fileId: z.string().min(1),
  version: z.string(),
  /** As the provider said when it was opened; `null` where it did not say. */
  canEdit: z.boolean().nullable(),
});
type CloudOrigin = z.infer<typeof cloudOriginSchema>;

/** Where the working copies' origins are kept, in the working directory beside the copies they describe. */
export const CLOUD_ORIGINS_FILE = 'origins.json';

/** A document's link: its cloud file, and the working copy it was opened from, or `null` for a local file uploaded. */
interface Linked {
  readonly origin: CloudOrigin;
  readonly path: string | null;
}

function refusalOfKernel(error: CloudStorageRefused): CloudRefusal {
  switch (error.reason) {
    case 'unauthorised':
    case 'forbidden':
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
      return 'sign-in-denied';
    case 'listener-failed':
      return 'sign-in-unavailable';
  }
}

/** The contract's refusal for anything `work` threw, or the throw itself where it is not a named refusal. */
function refusalOf(error: unknown): unknown {
  if (error instanceof CloudOutcomeRefused) return error;
  if (error instanceof CloudStorageRefused) return new CloudOutcomeRefused(refusalOfKernel(error), { cause: error });
  if (error instanceof SignInRefused) return new CloudOutcomeRefused(refusalOfSignIn(error), { cause: error });
  return error;
}

/**
 * One line for the diagnostics log: what was asked, of which provider, the contract's name for why it did not happen,
 * and the provider's own words beneath it — a host and an HTTP status, never a token, which no refusal's message
 * carries. The owner's 0.1.6.0 run met a refused Save back that left nothing in the log.
 */
export function describeCloudFailure(operation: string, provider: CloudProviderId | null, error: unknown): string {
  const at = provider === null ? operation : `${operation} (${provider})`;
  if (error instanceof CloudOutcomeRefused) {
    const cause = error.cause instanceof Error ? ` — ${error.cause.message}` : '';
    return `${at}: ${error.reason}${cause}`;
  }
  return `${at}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
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
  /**
   * Runs the provider's Picker — a sign-in that chooses a file (ADR-0091, corrected 2026-09-29) — and downloads the
   * chosen file into its working copy, answering the path to open. `nothing-picked` where the Picker chose none.
   */
  pick(provider: CloudPickerProviderId): Promise<string>;
  /** Links an opened working copy's document to its cloud file. */
  link(docId: DocId, path: string): void;
  /** Which provider a document came from, or `null`. */
  originOf(docId: DocId): CloudProviderId | null;
  /**
   * Whether the person may change a document's cloud file, as the provider said when it was opened — `null` where it
   * did not say — or `undefined` for a document not from the cloud.
   */
  canEdit(docId: DocId): boolean | null | undefined;
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
    // NO COPY, SO NO ORIGIN: nothing downloads here, so the record stays empty and every open links nothing.
    origins: { read: () => ({}), write: () => undefined },
    writeWorkingCopy: () => Promise.reject(new Error('an unconfigured cloud writes no working copy')),
    maxBytes: 0,
    // NOWHERE TO WRITE, and nothing to say: every call here is refused `not-configured` before any provider is asked,
    // which is this assembly's shape rather than a failure — a harness, or a case not about cloud storage.
    report: () => undefined,
  });
}

export function createCloudStorage(deps: {
  /** Where every cloud failure is written: the diagnostics log, from the composition root. */
  readonly report: ShellFailureSink;
  readonly secrets: SecretStoreSurface;
  readonly clients: Readonly<Record<CloudProviderId, CloudClient | null>>;
  readonly openInBrowser: OpenInBrowser;
  /** This application's own directory for working copies. */
  readonly workingDirectory: string;
  /**
   * Each working copy's cloud origin, by path, kept for as long as the copy is (CR-DOC-02): a copy reopened from
   * Recent, the last session or the picker, in this run or a later one, is the same cloud file, so its Save back goes
   * there. Written only here.
   */
  readonly origins: SettingsSurface;
  readonly writeWorkingCopy: WriteWorkingCopy;
  /** The document ceiling a download is bounded by. */
  readonly maxBytes: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly signInTimeoutMs?: number;
}): CloudStorage {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  /**
   * Every working copy's origin, by path, read from where it was kept. ONE record per copy, which the document's link
   * names rather than copies: a Save back moves the version here, so the copy reopened later saves back at the version
   * the cloud file now has rather than the one it was downloaded at, which would be refused as changed elsewhere.
   */
  const origins = new Map<string, CloudOrigin>();
  for (const [path, value] of Object.entries(deps.origins.read())) {
    // A RECORD THAT DOES NOT PARSE IS DROPPED, never guessed at: the copy then opens as a local file, which is what it
    // is without one, and the next download of that file writes a whole record again.
    const parsed = cloudOriginSchema.safeParse(value);
    if (parsed.success) origins.set(path, parsed.data);
  }
  const keepOrigins = (): void => {
    deps.origins.write(Object.fromEntries(origins));
  };
  /** Opened documents' links, by document. */
  const linked = new Map<DocId, Linked>();

  /**
   * Runs one cloud request, turning every refusal into the contract's name and writing every failure to the log — ONE
   * wrapper every public call takes, so a request cannot fail without a line.
   */
  async function named<T>(operation: string, provider: CloudProviderId | null, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const refused = refusalOf(error);
      deps.report({ event: 'cloud-failed', detail: describeCloudFailure(operation, provider, refused) });
      throw refused;
    }
  }

  function client(provider: CloudProviderId): CloudClient {
    const found = deps.clients[provider];
    if (found === null) throw new CloudOutcomeRefused('not-configured');
    if (!deps.secrets.available()) throw new CloudOutcomeRefused('secrets-unavailable');
    return found;
  }

  function keep(provider: CloudProviderId, tokens: CloudTokens): void {
    deps.secrets.write(cloudSessionSecretId(provider), JSON.stringify(tokens));
  }

  /**
   * One sign-in — or, with `picker`, the provider's Picker, which IS a sign-in with two parameters more (ADR-0091,
   * corrected 2026-09-29). Answers the tokens, kept, and the file the Picker chose when it was asked.
   */
  async function signIn(
    provider: CloudProviderId,
    picker = false,
  ): Promise<{ readonly tokens: CloudTokens; readonly picked: string | null }> {
    const spec = CLOUD_PROVIDERS[provider];
    const values = client(provider);
    const pair = pkcePair();
    const state = oauthState();
    const picked = picker ? spec.picker?.picked : undefined;
    const { code, redirectUri, kept } = await signInThroughLoopback({
      authorize: (redirect) => ({
        url: cloudAuthorizationUrl(spec, {
          clientId: values.clientId,
          redirectUri: redirect,
          state,
          challenge: pair.challenge,
          picker,
        }),
        state,
      }),
      openInBrowser: deps.openInBrowser,
      path: spec.redirect.path,
      redirectHost: spec.redirect.host,
      ...(picked === undefined ? {} : { keep: [picked] }),
      ...(deps.signInTimeoutMs === undefined ? {} : { timeoutMs: deps.signInTimeoutMs }),
    });
    const tokens = await exchangeCloudCode(spec, values, { code, verifier: pair.verifier, redirectUri }, fetchImpl, now);
    keep(provider, tokens);
    return { tokens, picked: picked === undefined ? null : pickedFileId(kept[picked]) };
  }

  /**
   * Downloads one file into its working copy and answers the path to open — the one route for a file opened from a
   * listing and a file chosen in a Picker, so the two cannot differ in what a working copy is.
   */
  async function downloadInto(provider: CloudProviderId, fileId: string, access: string): Promise<string> {
    const { name, version, canEdit } = await describeCloudFile(provider, access, fileId, fetchImpl);
    const path = workingPath(provider, fileId, name);
    const written = await deps.writeWorkingCopy(path, () =>
      fetchCloudPdf(provider, access, fileId, deps.maxBytes, fetchImpl),
    );
    // A WORKING COPY ALREADY OPEN is contested by the save pipeline's own check: the person has
    // this file open, and a fresh download would replace a document under them.
    if (written === 'contested') throw new CloudOutcomeRefused('changed-elsewhere');
    if (written === 'write-failed') throw new CloudOutcomeRefused('rejected');
    origins.set(path, { provider, fileId, version, canEdit });
    keepOrigins();
    return path;
  }

  /** An access token good for the next request, refreshing — or signing in again — as needed. */
  async function token(provider: CloudProviderId): Promise<string> {
    const values = client(provider);
    const session = kept(deps.secrets.read()[cloudSessionSecretId(provider)]);
    if (session === null) return (await signIn(provider)).tokens.accessToken;
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
        return (await signIn(provider)).tokens.accessToken;
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
      named('sign in', provider, async () => {
        await signIn(provider);
      }),
    signOut: (provider) => {
      deps.secrets.write(cloudSessionSecretId(provider), '');
    },
    list: (provider) => named('list', provider, async () => listCloudPdfs(provider, await token(provider), fetchImpl)),
    download: (provider, fileId) =>
      named('open', provider, async () => downloadInto(provider, fileId, await token(provider))),
    pick: (provider) =>
      named('pick', provider, async () => {
        // THE PICKER SIGNS IN AS IT CHOOSES, so its tokens are the ones the download takes and are kept as any
        // sign-in's are: a person signed out is signed in by choosing, and is never asked twice for one file.
        const { tokens, picked } = await signIn(provider, true);
        if (picked === null) throw new CloudOutcomeRefused('nothing-picked');
        return downloadInto(provider, picked, tokens.accessToken);
      }),
    link: (docId, path) => {
      const origin = origins.get(path);
      if (origin !== undefined) linked.set(docId, { origin, path });
    },
    originOf: (docId) => linked.get(docId)?.origin.provider ?? null,
    canEdit: (docId) => linked.get(docId)?.origin.canEdit,
    saveBack: (docId, pdf) =>
      named('save back', linked.get(docId)?.origin.provider ?? null, async () => {
        const held = linked.get(docId);
        if (held === undefined) throw new Error('saveBack was asked for a document with no cloud origin');
        const { origin, path } = held;
        // THE PROVIDER ALREADY SAID NO, when the file was opened: nothing is sent, so a view-only file is never asked to
        // take an upload it will refuse. Unknown (`null`) is not no — the upload goes, and a refusal is named `forbidden`.
        if (origin.canEdit === false) throw new CloudOutcomeRefused('read-only');
        const access = await token(origin.provider);
        const version = await replaceCloudPdf(origin.provider, access, origin.fileId, origin.version, pdf, fetchImpl);
        const moved = { ...origin, version };
        linked.set(docId, { origin: moved, path });
        // THE COPY'S RECORD MOVES WITH IT, so the copy reopened saves back at the version it now matches.
        if (path !== null) {
          origins.set(path, moved);
          keepOrigins();
        }
      }),
    uploadCopy: (docId, provider, name, pdf) =>
      named('upload a copy', provider, async () => {
        const access = await token(provider);
        const fileId = await createCloudPdf(provider, access, name, pdf, fetchImpl);
        const { version, canEdit } = await describeCloudFile(provider, access, fileId, fetchImpl);
        // LINKED to the new file, so Save back goes there next; the local file stays where it was. Its edit access is
        // the provider's answer for the new file too, rather than assumed from having just made it.
        linked.set(docId, { origin: { provider, fileId, version, canEdit }, path: null });
      }),
    forget: (docId) => {
      linked.delete(docId);
    },
  };
}
