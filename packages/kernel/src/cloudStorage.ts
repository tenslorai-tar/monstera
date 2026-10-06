import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import {
  type CloudFile,
  type CloudProviderId,
  MAX_CLOUD_FILE_ID,
  MAX_CLOUD_FILE_NAME,
  MAX_CLOUD_FILES,
} from '@monstera/contract';
import { hostWithin } from '@monstera/shared';

import { pdfBody } from './guardedFetch.js';
import { readWithin } from './verifiedDownload.js';

/**
 * OneDrive and Google Drive, as public OAuth clients and file APIs
 * ([ADR-0091](../../../docs/DECISIONS/0091-cloud-storage-a-declared-provider-a-build-configured-client-and-a-working-copy.md)).
 *
 * ## What this module is, and what it is not
 *
 * `docusign.ts`' shape: the protocol and nothing else — the authorization URL, the code
 * exchange, a refresh, and a provider's four file calls (list, describe, fetch, replace,
 * create). It opens no browser, listens on no port and stores nothing; those are `main`'s. Every
 * call takes `fetchImpl`, so its cases drive it with no network.
 *
 * ## Every endpoint is the provider's own page, read 2026-09-22
 *
 * Google: *OAuth 2.0 for iOS & Desktop Apps* and the Drive v3 reference. Microsoft: *OAuth 2.0
 * authorization code flow*, *Redirect URI best practices*, and Graph's driveItem reference. The
 * hosts a call may reach are declared per provider below, and a download a provider redirects is
 * followed only to a declared host.
 */

/** Why a provider call did not happen. */
export type CloudStorageRefusalReason =
  /** HTTP 401: the provider no longer accepts the sign-in, and signing in again is the remedy. */
  | 'unauthorised'
  /**
   * HTTP 403: the sign-in is accepted and this request is refused for this person — a file shared with them to view,
   * not to change. Signing in again changes nothing, so it is never said as a sign-in problem.
   */
  | 'forbidden'
  | 'unreachable'
  | 'rejected'
  | 'unexpected-answer'
  | 'changed-elsewhere'
  | 'too-large'
  | 'not-a-pdf';

export class CloudStorageRefused extends Error {
  override readonly name = 'CloudStorageRefused';
  readonly reason: CloudStorageRefusalReason;

  constructor(reason: CloudStorageRefusalReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.reason = reason;
  }
}

/** A provider's client values, from build configuration — never source (ADR-0091 Decision 2). */
export interface CloudClient {
  readonly clientId: string;
  /** Google's Desktop secret, which Google declares non-confidential; absent for Microsoft. */
  readonly clientSecret?: string;
}

/** How a provider's redirect is spelt and where it arrives (ADR-0091 Decision 4). */
export interface CloudRedirect {
  /** The host the redirect STRING names. The listener is bound to `127.0.0.1` either way. */
  readonly host: 'localhost' | '127.0.0.1';
  readonly path: string;
}

/** One provider's declaration. */
export interface CloudProviderSpec {
  readonly id: CloudProviderId;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scopes: readonly string[];
  /** Extra authorization parameters the provider needs to answer a refresh token. */
  readonly authorizeExtras: Readonly<Record<string, string>>;
  readonly redirect: CloudRedirect;
  /** The hosts its API calls go to. */
  readonly apiHosts: readonly string[];
  /**
   * Host suffixes a download it redirects may be followed to. Microsoft answers a file's content
   * with a redirect to a pre-authorised address on another host; nothing else is followed.
   */
  readonly downloadHostSuffixes: readonly string[];
  /**
   * A Picker the sign-in can open (ADR-0091, corrected 2026-09-29): the parameters that turn the authorization
   * request into one, and the redirect parameter that names the chosen files. Absent for a provider with none.
   */
  readonly picker?: { readonly extras: Readonly<Record<string, string>>; readonly picked: string };
}

export const CLOUD_PROVIDERS: Readonly<Record<CloudProviderId, CloudProviderSpec>> = {
  onedrive: {
    id: 'onedrive',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    // THE OWNER'S REGISTRATION: Files.ReadWrite, offline_access (for a refresh token) and User.Read.
    scopes: ['offline_access', 'Files.ReadWrite', 'User.Read'],
    authorizeExtras: { response_mode: 'query' },
    // ENTRA IGNORES THE PORT ONLY FOR `localhost`, and the registration is `http://localhost` with
    // no path — which Entra answers with a trailing `/`.
    redirect: { host: 'localhost', path: '/' },
    apiHosts: ['graph.microsoft.com'],
    // WHERE GRAPH'S CONTENT REDIRECTS POINT for work and personal drives. Not a measured list: the
    // live run records the host it met, and a host outside these is refused by name.
    downloadHostSuffixes: ['sharepoint.com', '1drv.com', 'microsoftpersonalcontent.com', 'livefilestore.com'],
  },
  'google-drive': {
    id: 'google-drive',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    // A REFRESH TOKEN only comes with offline access, and only on a consented grant.
    authorizeExtras: { access_type: 'offline', prompt: 'consent' },
    redirect: { host: '127.0.0.1', path: '/google' },
    apiHosts: ['www.googleapis.com'],
    downloadHostSuffixes: [],
    // GOOGLE'S DESKTOP PICKER, their guide of 2026-09-14: the sign-in with `trigger_onepick`, narrowed to PDFs; the
    // chosen ids come back as `picked_file_ids`. `prompt=consent` is already above, and `drive.file` is the one scope
    // the Picker allows.
    picker: { extras: { trigger_onepick: 'true', mimetypes: 'application/pdf' }, picked: 'picked_file_ids' },
  },
};

/** A token set, with its absolute expiry. */
export interface CloudTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

/** How large a JSON answer may be. A listing of {@link MAX_CLOUD_FILES} files is far below it. */
const MAX_JSON_BYTES = 4 * 1024 * 1024;

/**
 * The largest document sent in one request: Graph's simple upload takes up to 250 MB (driveItem *Upload small files*);
 * Google's `uploadType=media` up to 5 MB is *recommended* and larger is accepted. A larger document goes through an
 * upload SESSION ({@link uploadInSession}); until 2026-10-02 it was refused as *"too large to send in one piece"*
 * (JOURNAL, *No document-size refusals*, table A row 13). The simple route stays below this, because it is the one the
 * live runs proved.
 */
export const MAX_SIMPLE_UPLOAD_BYTES = 250 * 1024 * 1024;

/**
 * The bytes one request of an upload session carries: 40 MiB, a multiple of BOTH providers' fragment rules and under
 * Graph's per-request ceiling, so one size serves either.
 *
 * - Graph: *"the size of each byte range MUST be a multiple of 320 KiB (327,680 bytes)"*, and *"the maximum bytes in
 *   any given request is less than 60 MiB"* (driveItem-createUploadSession, ms.date 2025-10-15, read 2026-10-02 from
 *   `microsoftgraph/microsoft-graph-docs-contrib` on GitHub; learn.microsoft.com is not reachable from the cloud
 *   session that wrote this).
 * - Google: a chunk is a multiple of `UPLOAD_CHUNK_SIZE = 262144` (`google-resumable-media-python`, `common.py`, read
 *   the same day; developers.google.com was not reachable either).
 *
 * 40 MiB is 128 x 320 KiB and 160 x 256 KiB. The last request carries what is left, which both allow.
 */
export const UPLOAD_SESSION_CHUNK_BYTES = 40 * 1024 * 1024;

/**
 * The file a Picker chose, from its redirect's parameter — the first id of the comma-separated list, or `null` where
 * there is none or it is not an id (ADR-0091, corrected 2026-09-29).
 *
 * **An opaque string from a redirect**, so it is held to Drive's id alphabet — letters, digits, `-` and `_` — and to
 * the contract's id bound before it names a request path. Only the first is taken: the Picker is asked for one file.
 */
export function pickedFileId(value: string | undefined): string | null {
  const first = value?.split(',')[0]?.trim() ?? '';
  return first.length > 0 && first.length <= MAX_CLOUD_FILE_ID && /^[A-Za-z0-9_-]+$/u.test(first) ? first : null;
}

/** The authorization URL the person's browser is sent to. */
export function cloudAuthorizationUrl(
  spec: CloudProviderSpec,
  request: {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly state: string;
    readonly challenge: string;
    /** The provider's Picker parameters, for a sign-in that picks a file (ADR-0091, corrected 2026-09-29). */
    readonly picker?: boolean;
  },
): string {
  const url = new URL(spec.authorizeUrl);
  url.searchParams.set('client_id', request.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', request.redirectUri);
  url.searchParams.set('scope', spec.scopes.join(' '));
  url.searchParams.set('state', request.state);
  url.searchParams.set('code_challenge', request.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  for (const [name, value] of Object.entries(spec.authorizeExtras)) url.searchParams.set(name, value);
  if (request.picker === true) {
    if (spec.picker === undefined) throw new Error(`${spec.id} has no Picker to ask for`);
    for (const [name, value] of Object.entries(spec.picker.extras)) url.searchParams.set(name, value);
  }
  return url.toString();
}

/** A call whose reaching-nothing and whose authorisation, conflict and size refusals are named. */
async function call(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (cause) {
    throw new CloudStorageRefused('unreachable', `${new URL(url).host} could not be reached`, { cause });
  }
  // TWO STATUSES, TWO SITUATIONS (RFC 9110 §15.5.2 and §15.5.4): 401 is credentials the server does not accept; 403
  // is a request it understood and refuses for the credentials it did accept. Answering both as "sign in again" sent a
  // person with a view-only shared file round a sign-in that could never change the answer (the owner's 0.1.6.0 run).
  if (response.status === 401) {
    throw new CloudStorageRefused('unauthorised', `${new URL(url).host} answered HTTP 401`);
  }
  if (response.status === 403) {
    throw new CloudStorageRefused('forbidden', `${new URL(url).host} answered HTTP 403`);
  }
  if (response.status === 412) {
    throw new CloudStorageRefused('changed-elsewhere', 'the file changed since it was opened');
  }
  if (response.status === 413) {
    throw new CloudStorageRefused('too-large', 'the provider refused the upload as too large');
  }
  return response;
}

/** A call's JSON object, refusing anything else. */
async function callJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Readonly<Record<string, unknown>>> {
  return jsonOf(await call(fetchImpl, url, init), url);
}

/** A response's JSON object, refusing a failed status and anything that is not one bounded object. */
async function jsonOf(response: Response, url: string): Promise<Readonly<Record<string, unknown>>> {
  if (!response.ok) {
    throw new CloudStorageRefused('rejected', `${new URL(url).host} answered HTTP ${String(response.status)}`);
  }
  if (response.body === null) throw new CloudStorageRefused('unexpected-answer', 'the provider answered no body');
  const body = await readWithin(
    response.body,
    MAX_JSON_BYTES,
    (received) => new CloudStorageRefused('unexpected-answer', `an answer passed ${String(MAX_JSON_BYTES)} bytes at ${String(received)}`),
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body).toString('utf8'));
  } catch (cause) {
    throw new CloudStorageRefused('unexpected-answer', 'the provider answered something that is not JSON', { cause });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CloudStorageRefused('unexpected-answer', 'the provider answered JSON that is not an object');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

/**
 * A token answer, read. A refresh may omit the refresh token — Google's does — and then the one
 * it was made with stays the one kept.
 */
function tokensFrom(answer: Readonly<Record<string, unknown>>, now: number, previousRefresh?: string): CloudTokens {
  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = answer;
  const refresh = typeof refreshToken === 'string' && refreshToken !== '' ? refreshToken : previousRefresh;
  if (
    typeof accessToken !== 'string' ||
    accessToken === '' ||
    refresh === undefined ||
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new CloudStorageRefused('unexpected-answer', 'the token answer lacks an access token, a refresh token or an expiry');
  }
  return { accessToken, refreshToken: refresh, expiresAt: now + expiresIn * 1000 };
}

/** The token request's form, with Google's non-confidential secret where the build carries one. */
function tokenForm(client: CloudClient, fields: Readonly<Record<string, string>>): string {
  return new URLSearchParams({
    ...fields,
    client_id: client.clientId,
    ...(client.clientSecret === undefined || client.clientSecret === '' ? {} : { client_secret: client.clientSecret }),
  }).toString();
}

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

/** Exchanges an authorization code, with its PKCE verifier. */
export async function exchangeCloudCode(
  spec: CloudProviderSpec,
  client: CloudClient,
  request: { readonly code: string; readonly verifier: string; readonly redirectUri: string },
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<CloudTokens> {
  const answer = await callJson(fetchImpl, spec.tokenUrl, {
    method: 'POST',
    headers: FORM,
    body: tokenForm(client, {
      grant_type: 'authorization_code',
      code: request.code,
      code_verifier: request.verifier,
      redirect_uri: request.redirectUri,
    }),
  });
  return tokensFrom(answer, now());
}

/** Exchanges a refresh token (RFC 6749 §6). */
export async function refreshCloudTokens(
  spec: CloudProviderSpec,
  client: CloudClient,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<CloudTokens> {
  const answer = await callJson(fetchImpl, spec.tokenUrl, {
    method: 'POST',
    headers: FORM,
    body: tokenForm(client, { grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  return tokensFrom(answer, now(), refreshToken);
}

const bearer = (accessToken: string): Record<string, string> => ({ authorization: `Bearer ${accessToken}` });

/** A string field of an answer, or `null`. */
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** A timestamp field, as epoch milliseconds, or `null`. */
function time(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** A size field — Google sends a decimal string, Graph a number — or `null`. */
function size(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** One listed entry as the contract's file, or `null` for one outside its bounds or not a PDF. */
function fileOf(id: unknown, name: unknown, bytes: unknown, modified: unknown): CloudFile | null {
  const fileId = text(id);
  const fileName = text(name);
  if (fileId === null || fileName === null || fileId.length > MAX_CLOUD_FILE_ID || fileName.length > MAX_CLOUD_FILE_NAME) {
    return null;
  }
  if (!fileName.toLowerCase().endsWith('.pdf')) return null;
  return { id: fileId, name: fileName, size: size(bytes), modified: time(modified) };
}

/** A provider's list of the person's PDFs, newest first, at most {@link MAX_CLOUD_FILES}. */
export async function listCloudPdfs(
  provider: CloudProviderId,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly CloudFile[]> {
  if (provider === 'onedrive') {
    const url = new URL("https://graph.microsoft.com/v1.0/me/drive/root/search(q='.pdf')");
    url.searchParams.set('$select', 'id,name,size,lastModifiedDateTime,file');
    url.searchParams.set('$top', String(MAX_CLOUD_FILES));
    const answer = await callJson(fetchImpl, url.toString(), { headers: bearer(accessToken) });
    const value = Array.isArray(answer['value']) ? (answer['value'] as unknown[]) : [];
    return newestFirst(
      value.map((entry) => {
        const item = (entry ?? {}) as Record<string, unknown>;
        return item['file'] === undefined ? null : fileOf(item['id'], item['name'], item['size'], item['lastModifiedDateTime']);
      }),
    );
  }
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', "mimeType='application/pdf' and trashed=false");
  url.searchParams.set('fields', 'files(id,name,size,modifiedTime)');
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', String(MAX_CLOUD_FILES));
  const answer = await callJson(fetchImpl, url.toString(), { headers: bearer(accessToken) });
  const files = Array.isArray(answer['files']) ? (answer['files'] as unknown[]) : [];
  return newestFirst(
    files.map((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      return fileOf(item['id'], item['name'], item['size'], item['modifiedTime']);
    }),
  );
}

function newestFirst(files: readonly (CloudFile | null)[]): readonly CloudFile[] {
  return files
    .filter((file): file is CloudFile => file !== null)
    .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))
    .slice(0, MAX_CLOUD_FILES);
}

/**
 * What a file is NOW, for Save back's check: its name and a version that changes whenever its
 * content does — Graph's `eTag`, Drive's `version` — and whether this person may change it.
 */
export interface CloudFileVersion {
  readonly name: string;
  readonly version: string;
  /**
   * Whether the signed-in person may change the file's content, as the provider says it: `null` where the answer did
   * not say. UNKNOWN IS NOT YES: a surface says read-only only for `false`, and Save back still tries on `null`, where
   * a refusal arrives as HTTP 403 and is named `forbidden`.
   */
  readonly canEdit: boolean | null;
}

/** Graph's roles that may change an item's content (*permission resource*: `read`, `write`, `owner`). */
const GRAPH_EDIT_ROLES = new Set(['write', 'owner']);

/**
 * Whether the person may change a OneDrive item.
 *
 * Graph has no single flag. An item in the person's own drive carries no `remoteItem` facet — *"Remote item data, if
 * the item is shared from a drive other than the one being accessed"* (driveItem resource) — and its owner may change
 * it. An item shared from another drive is asked of that drive's permissions, which for a caller who is not the owner
 * list *"only the sharing permissions that apply to the caller"* (*List who has access to a file*), so any `write` or
 * `owner` role there is this person's. Both read 2026-09-30 from Microsoft's reference; not run live.
 */
async function graphCanEdit(
  answer: Readonly<Record<string, unknown>>,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<boolean | null> {
  const remote = answer['remoteItem'];
  if (remote === undefined || remote === null) return true;
  const item = remote as Record<string, unknown>;
  const itemId = text(item['id']);
  const driveId = text((item['parentReference'] as Record<string, unknown> | undefined)?.['driveId']);
  if (itemId === null || driveId === null) return null;
  const permissions = await callJson(
    fetchImpl,
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/permissions`,
    { headers: bearer(accessToken) },
  );
  const value = Array.isArray(permissions['value']) ? (permissions['value'] as unknown[]) : [];
  return value.some((entry) => {
    const roles = (entry as Record<string, unknown> | null)?.['roles'];
    return Array.isArray(roles) && roles.some((role) => typeof role === 'string' && GRAPH_EDIT_ROLES.has(role));
  });
}

/** A file's name, current version, and whether this person may change it. */
export async function describeCloudFile(
  provider: CloudProviderId,
  accessToken: string,
  fileId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CloudFileVersion> {
  const id = encodeURIComponent(fileId);
  // DRIVE'S `capabilities.canEdit` is the file's own answer for the requesting user (Drive v3 *files* resource: "Whether
  // the current user can edit this file"), asked in the same request as the version, so the two cannot disagree.
  const answer =
    provider === 'onedrive'
      ? await callJson(fetchImpl, `https://graph.microsoft.com/v1.0/me/drive/items/${id}?$select=name,eTag,remoteItem`, {
          headers: bearer(accessToken),
        })
      : await callJson(
          fetchImpl,
          `https://www.googleapis.com/drive/v3/files/${id}?fields=name,version,capabilities(canEdit)`,
          { headers: bearer(accessToken) },
        );
  const name = text(answer['name']);
  const version = provider === 'onedrive' ? text(answer['eTag']) : text(answer['version']);
  if (name === null || version === null) {
    throw new CloudStorageRefused('unexpected-answer', 'the file answer lacks a name or a version');
  }
  const flag = (answer['capabilities'] as Record<string, unknown> | undefined)?.['canEdit'];
  const canEdit =
    provider === 'onedrive' ? await graphCanEdit(answer, accessToken, fetchImpl) : typeof flag === 'boolean' ? flag : null;
  return { name, version, canEdit };
}

/** Whether a host is one of the provider's declared download hosts. */
export function downloadHostDeclared(spec: CloudProviderSpec, host: string): boolean {
  return spec.downloadHostSuffixes.some((suffix) => hostWithin(host, suffix));
}

/**
 * Whether an upload session's address may receive the document: HTTPS, on one of the provider's API hosts — Google's
 * session is on the host the request went to — or on a host its content is declared to live on, where Graph's
 * `uploadUrl` points (its documentation's example is `sn3302.up.1drv.com`). The same declared list as downloads, so
 * there is one opinion about where a provider keeps content (B3a).
 */
function sessionUrlDeclared(spec: CloudProviderSpec, url: URL): boolean {
  return url.protocol === 'https:' && (spec.apiHosts.includes(url.hostname.toLowerCase()) || downloadHostDeclared(spec, url.hostname));
}

/** Where the next byte of a session goes, from an intermediate answer; `null` where the answer does not say. */
function nextOffset(provider: CloudProviderId, response: Response, body: Readonly<Record<string, unknown>> | null): number | null {
  if (provider === 'google-drive') {
    // `Range: bytes=0-N` — the bytes held so far; absent, none are (google-resumable-media's own reading).
    const range = response.headers.get('range');
    if (range === null) return 0;
    const held = /^bytes=0-(\d+)$/u.exec(range.trim());
    return held === null ? null : Number(held[1]) + 1;
  }
  // `nextExpectedRanges: ["26-"]` — Graph's documentation: the first missing range's start.
  const ranges = body?.['nextExpectedRanges'];
  const first: unknown = Array.isArray(ranges) ? (ranges as readonly unknown[])[0] : undefined;
  const start = typeof first === 'string' ? /^(\d+)-/u.exec(first) : null;
  return start === null ? null : Number(start[1]);
}

/**
 * Sends `pdf` to an upload session in requests of {@link UPLOAD_SESSION_CHUNK_BYTES}, and answers the provider's final
 * JSON — the item or file the session made.
 *
 * Each request names its range of the whole (`Content-Range: bytes a-b/total`), and the provider's answer says where
 * the next starts: Graph's `202` with `nextExpectedRanges`, Google's `308` with `Range`. A next start that does not move
 * forward is refused rather than sent again, so a provider that keeps asking for the same bytes ends the upload instead
 * of looping. Graph's `uploadUrl` is pre-authorised and *"if you include the Authorization header … it might result in
 * an HTTP 401"*, so the token goes only to Google's, which is its API host.
 *
 * A session that fails part way is CANCELLED (`DELETE`, both providers' documented way), so no half-written upload is
 * left holding the person's quota; the failure that ended it is what is thrown, whatever the cancel answers.
 */
async function uploadInSession(
  provider: CloudProviderId,
  accessToken: string,
  sessionUrl: string,
  pdf: Uint8Array,
  fetchImpl: typeof fetch,
): Promise<Readonly<Record<string, unknown>>> {
  const total = pdf.byteLength;
  const auth = provider === 'google-drive' ? bearer(accessToken) : {};
  let offset = 0;
  try {
    for (;;) {
      const end = Math.min(offset + UPLOAD_SESSION_CHUNK_BYTES, total);
      const response = await call(fetchImpl, sessionUrl, {
        method: 'PUT',
        // MANUAL: Google's "more, please" is a 308, which a fetch would otherwise treat as a redirect.
        redirect: 'manual',
        headers: { ...auth, 'content-range': `bytes ${String(offset)}-${String(end - 1)}/${String(total)}` },
        body: pdf.subarray(offset, end),
      });
      if (response.status === 200 || response.status === 201) {
        if (end !== total) throw new CloudStorageRefused('unexpected-answer', `the session finished at ${String(end)} of ${String(total)} bytes`);
        return await jsonOf(response, sessionUrl);
      }
      const more = provider === 'google-drive' ? response.status === 308 : response.status === 202;
      if (!more) throw new CloudStorageRefused('rejected', `the upload session answered HTTP ${String(response.status)}`);
      const next = nextOffset(provider, response, provider === 'onedrive' ? await jsonOf(response, sessionUrl) : null);
      if (next === null || next <= offset || next > total) {
        throw new CloudStorageRefused('unexpected-answer', `the upload session asked for byte ${String(next)} after ${String(end)}`);
      }
      offset = next;
    }
  } catch (failure) {
    // THE CANCEL'S OWN ANSWER IS NOT THE NEWS: the person is told why the upload failed, and a cancel that could not be
    // made leaves a session the provider expires on its own (Graph: `expirationDateTime`).
    await fetchImpl(sessionUrl, { method: 'DELETE', headers: auth }).catch(() => undefined);
    throw failure;
  }
}

/** Opens an upload session at `url` and answers its address, held to the provider's declared hosts. */
async function openSession(
  provider: CloudProviderId,
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<string> {
  const spec = CLOUD_PROVIDERS[provider];
  let address: string | null;
  if (provider === 'onedrive') {
    address = text((await callJson(fetchImpl, url, init))['uploadUrl']);
  } else {
    const response = await call(fetchImpl, url, init);
    if (!response.ok) throw new CloudStorageRefused('rejected', `${new URL(url).host} answered HTTP ${String(response.status)}`);
    address = response.headers.get('location');
  }
  const target = address === null ? null : new URL(address, url);
  if (target === null || !sessionUrlDeclared(spec, target)) {
    throw new CloudStorageRefused('unexpected-answer', `the upload session is at ${target?.hostname ?? 'no address'}, which is not a declared host`);
  }
  return target.toString();
}

/**
 * A file's content, as a bounded PDF body (`pdfBody`: the ceiling and `%PDF-`, the URL route's own
 * check). Graph answers with a redirect to a pre-authorised address, which is followed only to a
 * declared host and without the bearer token.
 */
export async function fetchCloudPdf(
  provider: CloudProviderId,
  accessToken: string,
  fileId: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Readable> {
  const spec = CLOUD_PROVIDERS[provider];
  const id = encodeURIComponent(fileId);
  const first =
    provider === 'onedrive'
      ? `https://graph.microsoft.com/v1.0/me/drive/items/${id}/content`
      : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
  let response = await call(fetchImpl, first, { headers: bearer(accessToken), redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    const target = location === null ? null : new URL(location, first);
    if (target?.protocol !== 'https:' || !downloadHostDeclared(spec, target.hostname)) {
      throw new CloudStorageRefused(
        'unexpected-answer',
        `the download was redirected to ${target?.hostname ?? 'nowhere'}, which is not a declared host`,
      );
    }
    // THE BEARER TOKEN STAYS BEHIND: the address is pre-authorised, and a token sent to another
    // host is a token that host holds.
    response = await call(fetchImpl, target.toString(), { redirect: 'error' });
  }
  if (!response.ok || response.body === null) {
    throw new CloudStorageRefused('rejected', `the file's content answered HTTP ${String(response.status)}`);
  }
  return pdfBody(
    Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
    maxBytes,
    (kind, message) => new CloudStorageRefused(kind, message),
  );
}

/**
 * Replaces a file's content with `pdf`, only if it is still at `expected` — Save back
 * (ADR-0091 Decision 6). Graph checks `If-Match` itself; Drive v3 has no conditional upload, so its
 * version is read first and the window between that read and the upload is stated, not closed.
 *
 * @returns the file's new version
 */
export async function replaceCloudPdf(
  provider: CloudProviderId,
  accessToken: string,
  fileId: string,
  expected: string,
  pdf: Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const id = encodeURIComponent(fileId);
  const inSession = pdf.byteLength > MAX_SIMPLE_UPLOAD_BYTES;
  if (provider === 'onedrive') {
    // A SESSION KEEPS THE CONDITION: `if-match` on the session's creation, which answers 412 when the item moved.
    const answer = inSession
      ? await uploadInSession(
          provider,
          accessToken,
          await openSession(
            provider,
            `https://graph.microsoft.com/v1.0/me/drive/items/${id}/createUploadSession`,
            {
              method: 'POST',
              headers: { ...bearer(accessToken), 'content-type': 'application/json', 'if-match': expected },
              body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
            },
            fetchImpl,
          ),
          pdf,
          fetchImpl,
        )
      : await callJson(fetchImpl, `https://graph.microsoft.com/v1.0/me/drive/items/${id}/content`, {
          method: 'PUT',
          headers: { ...bearer(accessToken), 'content-type': 'application/pdf', 'if-match': expected },
          body: pdf,
        });
    const version = text(answer['eTag']);
    if (version === null) throw new CloudStorageRefused('unexpected-answer', 'the upload answer carries no eTag');
    return version;
  }
  const now = await describeCloudFile(provider, accessToken, fileId, fetchImpl);
  if (now.version !== expected) {
    throw new CloudStorageRefused('changed-elsewhere', 'the file changed since it was opened');
  }
  const answer = inSession
    ? await uploadInSession(
        provider,
        accessToken,
        await openSession(
          provider,
          `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=resumable&fields=version`,
          {
            method: 'PATCH',
            headers: {
              ...bearer(accessToken),
              'content-type': 'application/json; charset=UTF-8',
              'x-upload-content-type': 'application/pdf',
              'x-upload-content-length': String(pdf.byteLength),
            },
            body: '{}',
          },
          fetchImpl,
        ),
        pdf,
        fetchImpl,
      )
    : await callJson(fetchImpl, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=version`, {
        method: 'PATCH',
        headers: { ...bearer(accessToken), 'content-type': 'application/pdf' },
        body: pdf,
      });
  const version = text(answer['version']);
  if (version === null) throw new CloudStorageRefused('unexpected-answer', 'the upload answer carries no version');
  return version;
}

/**
 * Puts a new PDF in the person's storage — *Upload a copy*, the route by which Google's `drive.file`
 * scope comes to see a document (ADR-0091 Decision 7). A name already taken is renamed by the
 * provider, never overwritten.
 *
 * @returns the new file's id
 */
export async function createCloudPdf(
  provider: CloudProviderId,
  accessToken: string,
  name: string,
  pdf: Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (pdf.byteLength > MAX_SIMPLE_UPLOAD_BYTES) {
    const created =
      provider === 'onedrive'
        ? text(
            (
              await uploadInSession(
                provider,
                accessToken,
                await openSession(
                  provider,
                  `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(name)}:/createUploadSession`,
                  {
                    method: 'POST',
                    headers: { ...bearer(accessToken), 'content-type': 'application/json' },
                    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
                  },
                  fetchImpl,
                ),
                pdf,
                fetchImpl,
              )
            )['id'],
          )
        : text(
            (
              await uploadInSession(
                provider,
                accessToken,
                await openSession(
                  provider,
                  'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
                  {
                    method: 'POST',
                    headers: {
                      ...bearer(accessToken),
                      'content-type': 'application/json; charset=UTF-8',
                      'x-upload-content-type': 'application/pdf',
                      'x-upload-content-length': String(pdf.byteLength),
                    },
                    body: JSON.stringify({ name, mimeType: 'application/pdf' }),
                  },
                  fetchImpl,
                ),
                pdf,
                fetchImpl,
              )
            )['id'],
          );
    if (created === null) throw new CloudStorageRefused('unexpected-answer', 'the upload answer carries no id');
    return created;
  }
  if (provider === 'onedrive') {
    const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`;
    const answer = await callJson(fetchImpl, url, {
      method: 'PUT',
      headers: { ...bearer(accessToken), 'content-type': 'application/pdf' },
      body: pdf,
    });
    const created = text(answer['id']);
    if (created === null) throw new CloudStorageRefused('unexpected-answer', 'the upload answer carries no id');
    return created;
  }
  // MULTIPART/RELATED: the name and the content in one request (Drive v3 *Perform a multipart upload*).
  const boundary = `monstera-${String(Date.now())}`;
  const head = Buffer.from(
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: 'application/pdf' })}\r\n` +
      `--${boundary}\r\ncontent-type: application/pdf\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const answer = await callJson(fetchImpl, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { ...bearer(accessToken), 'content-type': `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([head, Buffer.from(pdf), tail]),
  });
  const created = text(answer['id']);
  if (created === null) throw new CloudStorageRefused('unexpected-answer', 'the upload answer carries no id');
  return created;
}
