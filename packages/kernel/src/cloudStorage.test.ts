import { describe, expect, it } from 'vitest';

import {
  CLOUD_PROVIDERS,
  CloudStorageRefused,
  cloudAuthorizationUrl,
  createCloudPdf,
  describeCloudFile,
  exchangeCloudCode,
  fetchCloudPdf,
  MAX_SIMPLE_UPLOAD_BYTES,
  UPLOAD_SESSION_CHUNK_BYTES,
  listCloudPdfs,
  pickedFileId,
  refreshCloudTokens,
  replaceCloudPdf,
} from './cloudStorage.js';
import { MAX_CLOUD_FILE_ID } from '@monstera/contract';

/**
 * The cloud providers' protocol (ADR-0091), with no network: every case reads the REQUEST a
 * provider would receive, and answers what its documentation says it answers.
 */

interface Seen {
  readonly url: string;
  readonly init: RequestInit;
}

/** A fetch answering from a script, in order, recording every request. */
function scripted(answers: readonly Response[]): { fetchImpl: typeof fetch; seen: Seen[] } {
  const queue = [...answers];
  const seen: Seen[] = [];
  const fetchImpl = ((url: string, init: RequestInit = {}) => {
    seen.push({ url, init });
    const next = queue.shift();
    if (next === undefined) throw new Error(`no scripted answer for ${url}`);
    return Promise.resolve(next);
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

async function drained(readable: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) chunks.push(Buffer.from(chunk as Uint8Array));
  return new Uint8Array(Buffer.concat(chunks));
}

describe('signing in (ADR-0059, ADR-0091)', () => {
  it('asks each provider with PKCE S256, its own scopes, and what it needs to answer a refresh token', () => {
    const request = { clientId: 'client', redirectUri: 'http://localhost:5000/', state: 's', challenge: 'c' };
    const microsoft = new URL(cloudAuthorizationUrl(CLOUD_PROVIDERS.onedrive, request));
    const google = new URL(cloudAuthorizationUrl(CLOUD_PROVIDERS['google-drive'], request));

    expect(microsoft.searchParams.get('code_challenge_method')).toBe('S256');
    expect(microsoft.searchParams.get('scope')).toBe('offline_access Files.ReadWrite User.Read');
    expect(google.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(google.searchParams.get('access_type')).toBe('offline');
    expect(microsoft.host).toBe('login.microsoftonline.com');
    expect(google.host).toBe('accounts.google.com');
  });

  it('GOOGLE’S PICKER is the same request with trigger_onepick and PDFs only, and drive.file ALONE (ADR-0091, 2026-09-29)', () => {
    const request = { clientId: 'client', redirectUri: 'http://127.0.0.1:5000/google', state: 's', challenge: 'c' };
    const picker = new URL(cloudAuthorizationUrl(CLOUD_PROVIDERS['google-drive'], { ...request, picker: true }));
    expect(picker.searchParams.get('trigger_onepick')).toBe('true');
    expect(picker.searchParams.get('mimetypes')).toBe('application/pdf');
    expect(picker.searchParams.get('prompt')).toBe('consent');
    // THE PICKER REFUSES ANY SCOPE BESIDE drive.file, by Google's guide.
    expect(picker.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    // CONTROL: the ordinary sign-in is not a Picker.
    const plain = new URL(cloudAuthorizationUrl(CLOUD_PROVIDERS['google-drive'], request));
    expect(plain.searchParams.get('trigger_onepick')).toBeNull();
    // AND A PROVIDER WITH NO PICKER cannot be asked for one.
    expect(() => cloudAuthorizationUrl(CLOUD_PROVIDERS.onedrive, { ...request, picker: true })).toThrow(/no Picker/u);
  });

  it('reads the FIRST picked id, held to Drive’s id alphabet — never a path, a query or nothing', () => {
    expect(pickedFileId('1AbC_d-9,2XyZ')).toBe('1AbC_d-9');
    expect(pickedFileId('1AbC_d-9')).toBe('1AbC_d-9');
    for (const refused of [undefined, '', ',', '../etc', 'a/b', 'a?b=1', 'a b', 'x'.repeat(MAX_CLOUD_FILE_ID + 1)]) {
      expect(pickedFileId(refused), String(refused)).toBeNull();
    }
    // CONTROL at the bound: an id exactly as long as the contract allows is read.
    expect(pickedFileId('x'.repeat(MAX_CLOUD_FILE_ID))).toBe('x'.repeat(MAX_CLOUD_FILE_ID));
  });

  it('sends a client secret ONLY where the build carries one — Google’s — and CONTROL: never for Microsoft', async () => {
    const google = scripted([json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })]);
    await exchangeCloudCode(
      CLOUD_PROVIDERS['google-drive'],
      { clientId: 'gid', clientSecret: 'not-confidential' },
      { code: 'code', verifier: 'v', redirectUri: 'http://127.0.0.1:1/google' },
      google.fetchImpl,
      () => 0,
    );
    const microsoft = scripted([json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })]);
    await exchangeCloudCode(
      CLOUD_PROVIDERS.onedrive,
      { clientId: 'mid' },
      { code: 'code', verifier: 'v', redirectUri: 'http://localhost:1/' },
      microsoft.fetchImpl,
      () => 0,
    );

    const form = (seen: readonly Seen[]): URLSearchParams => {
      const body = seen[0]?.init.body;
      if (typeof body !== 'string') throw new Error('a token request is a form string');
      return new URLSearchParams(body);
    };
    const googleForm = form(google.seen);
    const microsoftForm = form(microsoft.seen);
    expect(googleForm.get('client_secret')).toBe('not-confidential');
    expect(googleForm.get('code_verifier')).toBe('v');
    expect(microsoftForm.has('client_secret')).toBe(false);
    expect(microsoftForm.get('redirect_uri')).toBe('http://localhost:1/');
  });

  it('a refresh that omits the refresh token KEEPS the one it was made with (Google’s answer)', async () => {
    const { fetchImpl } = scripted([json({ access_token: 'new', expires_in: 60 })]);
    const tokens = await refreshCloudTokens(CLOUD_PROVIDERS['google-drive'], { clientId: 'g' }, 'kept', fetchImpl, () => 1000);
    expect(tokens).toStrictEqual({ accessToken: 'new', refreshToken: 'kept', expiresAt: 61_000 });
  });

  it('a refused refresh is UNAUTHORISED by name — the kept sign-in is to be repeated', async () => {
    const { fetchImpl } = scripted([new Response('{}', { status: 401 })]);
    await expect(refreshCloudTokens(CLOUD_PROVIDERS.onedrive, { clientId: 'm' }, 'old', fetchImpl)).rejects.toMatchObject({
      reason: 'unauthorised',
    });
  });
});

describe('listing', () => {
  it('OneDrive: PDFs only, folders and other files dropped, newest first', async () => {
    const { fetchImpl, seen } = scripted([
      json({
        value: [
          { id: 'a', name: 'old.pdf', size: 10, lastModifiedDateTime: '2026-01-01T00:00:00Z', file: {} },
          { id: 'b', name: 'new.PDF', size: 20, lastModifiedDateTime: '2026-09-01T00:00:00Z', file: {} },
          { id: 'c', name: 'notes.docx', size: 5, lastModifiedDateTime: '2026-09-02T00:00:00Z', file: {} },
          { id: 'd', name: 'folder.pdf', lastModifiedDateTime: '2026-09-03T00:00:00Z', folder: {} },
        ],
      }),
    ]);
    const files = await listCloudPdfs('onedrive', 'token', fetchImpl);
    expect(files.map((file) => file.id)).toStrictEqual(['b', 'a']);
    expect(new Headers(seen[0]?.init.headers).get('authorization')).toBe('Bearer token');
  });

  it('Google Drive: sizes arrive as strings and are read as numbers', async () => {
    const { fetchImpl } = scripted([json({ files: [{ id: 'g', name: 'x.pdf', size: '1234', modifiedTime: '2026-09-01T00:00:00Z' }] })]);
    expect(await listCloudPdfs('google-drive', 't', fetchImpl)).toStrictEqual([
      { id: 'g', name: 'x.pdf', size: 1234, modified: Date.parse('2026-09-01T00:00:00Z') },
    ]);
  });
});

describe('fetching a file', () => {
  it('OneDrive’s redirect is followed to a DECLARED host, WITHOUT the bearer token', async () => {
    const { fetchImpl, seen } = scripted([
      new Response(null, { status: 302, headers: { location: 'https://contoso-my.sharepoint.com/download?x=1' } }),
      new Response(PDF, { status: 200 }),
    ]);
    const body = await drained(await fetchCloudPdf('onedrive', 'secret-token', 'id', 1_000_000, fetchImpl));
    expect(Buffer.from(body).toString('latin1').startsWith('%PDF-')).toBe(true);
    expect(seen[1]?.url).toBe('https://contoso-my.sharepoint.com/download?x=1');
    expect(new Headers(seen[1]?.init.headers).has('authorization')).toBe(false);
  });

  it('CONTROL: a redirect to an UNDECLARED host is refused and not followed', async () => {
    const { fetchImpl, seen } = scripted([
      new Response(null, { status: 302, headers: { location: 'https://attacker.example/pdf' } }),
    ]);
    await expect(fetchCloudPdf('onedrive', 't', 'id', 1_000_000, fetchImpl)).rejects.toBeInstanceOf(CloudStorageRefused);
    expect(seen).toHaveLength(1);
  });

  it('a body that is not a PDF is refused while it is read — the URL route’s own check', async () => {
    const { fetchImpl } = scripted([new Response('<html>sign in</html>'.padEnd(2000, ' '), { status: 200 })]);
    const readable = await fetchCloudPdf('google-drive', 't', 'id', 1_000_000, fetchImpl);
    await expect(drained(readable)).rejects.toMatchObject({ reason: 'not-a-pdf' });
  });
});

describe('Save back (ADR-0091 Decision 6)', () => {
  it('OneDrive sends If-Match with the version it opened, and a 412 is CHANGED ELSEWHERE, not overwritten', async () => {
    const { fetchImpl, seen } = scripted([new Response('{}', { status: 412 })]);
    await expect(replaceCloudPdf('onedrive', 't', 'id', '"etag-1"', PDF, fetchImpl)).rejects.toMatchObject({
      reason: 'changed-elsewhere',
    });
    expect(seen[0]?.init.method).toBe('PUT');
    expect(new Headers(seen[0]?.init.headers).get('if-match')).toBe('"etag-1"');
  });

  it('Google Drive reads the version first and sends NOTHING when it moved', async () => {
    const { fetchImpl, seen } = scripted([json({ name: 'x.pdf', version: '7' })]);
    await expect(replaceCloudPdf('google-drive', 't', 'id', '6', PDF, fetchImpl)).rejects.toMatchObject({
      reason: 'changed-elsewhere',
    });
    expect(seen.map((request) => request.init.method ?? 'GET')).toStrictEqual(['GET']);
  });

  it('CONTROL: at the version it opened, Google Drive’s upload goes and answers the new version', async () => {
    const { fetchImpl, seen } = scripted([json({ name: 'x.pdf', version: '6' }), json({ version: '7' })]);
    expect(await replaceCloudPdf('google-drive', 't', 'id', '6', PDF, fetchImpl)).toBe('7');
    expect(seen[1]?.init.method).toBe('PATCH');
    expect(seen[1]?.url).toContain('uploadType=media');
  });
});

/**
 * 401 AND 403 ARE TWO SITUATIONS (the owner's 0.1.6.0 run): a file shared with the person to view answered Save back's
 * upload with 403, which read as "sign in again". Each status is asserted against the other, so a rule that mapped both
 * to either name is red in one of the two cases.
 */
describe('a refusal names which of the two it was', () => {
  it('HTTP 403 is FORBIDDEN — a permission on this file, not a sign-in', async () => {
    const { fetchImpl } = scripted([json({ name: 'shared.pdf', version: '6', capabilities: { canEdit: true } }), new Response('{}', { status: 403 })]);
    await expect(replaceCloudPdf('google-drive', 't', 'id', '6', PDF, fetchImpl)).rejects.toMatchObject({ reason: 'forbidden' });
  });

  it('CONTROL: HTTP 401 on the same request is still UNAUTHORISED', async () => {
    const { fetchImpl } = scripted([json({ name: 'shared.pdf', version: '6', capabilities: { canEdit: true } }), new Response('{}', { status: 401 })]);
    await expect(replaceCloudPdf('google-drive', 't', 'id', '6', PDF, fetchImpl)).rejects.toMatchObject({ reason: 'unauthorised' });
  });
});

describe('whether the person may change a file', () => {
  it('Google Drive: asks for capabilities.canEdit with the version, and reads a view-only file as FALSE', async () => {
    const { fetchImpl, seen } = scripted([json({ name: 'shared.pdf', version: '3', capabilities: { canEdit: false } })]);
    expect(await describeCloudFile('google-drive', 't', 'id', fetchImpl)).toStrictEqual({
      name: 'shared.pdf',
      version: '3',
      canEdit: false,
    });
    expect(new URL(seen[0]?.url ?? '').searchParams.get('fields')).toBe('name,version,capabilities(canEdit)');
  });

  it('Google Drive: an answer that does not say is UNKNOWN, never yes', async () => {
    const { fetchImpl } = scripted([json({ name: 'x.pdf', version: '3' })]);
    expect((await describeCloudFile('google-drive', 't', 'id', fetchImpl)).canEdit).toBeNull();
  });

  it('OneDrive: an item in the person’s own drive — no remoteItem — is theirs to change, in ONE request', async () => {
    const { fetchImpl, seen } = scripted([json({ name: 'mine.pdf', eTag: '"e1"' })]);
    expect((await describeCloudFile('onedrive', 't', 'id', fetchImpl)).canEdit).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('OneDrive: an item shared from another drive is asked of THAT drive’s permissions — read only is FALSE', async () => {
    const { fetchImpl, seen } = scripted([
      json({ name: 'shared.pdf', eTag: '"e1"', remoteItem: { id: 'R!1', parentReference: { driveId: 'D2' } } }),
      json({ value: [{ roles: ['read'] }] }),
    ]);
    expect((await describeCloudFile('onedrive', 't', 'id', fetchImpl)).canEdit).toBe(false);
    expect(seen[1]?.url).toBe('https://graph.microsoft.com/v1.0/drives/D2/items/R!1/permissions');
  });

  it('CONTROL: the same shared item with a write role is TRUE', async () => {
    const { fetchImpl } = scripted([
      json({ name: 'shared.pdf', eTag: '"e1"', remoteItem: { id: 'R!1', parentReference: { driveId: 'D2' } } }),
      json({ value: [{ roles: ['read'] }, { roles: ['write'] }] }),
    ]);
    expect((await describeCloudFile('onedrive', 't', 'id', fetchImpl)).canEdit).toBe(true);
  });
});

/**
 * A DOCUMENT PAST THE SIMPLE UPLOAD goes in a session (table A row 13): until 2026-10-02 it was refused before any
 * request, as "too large to send in one piece". The buffer is one byte past the bound and never copied — each request
 * carries a view of it — and the scripted provider answers what its documentation says it answers.
 */
describe('a document past the simple upload, in a session', () => {
  const LARGE = new Uint8Array(MAX_SIMPLE_UPLOAD_BYTES + 1);
  const CHUNKS = Math.ceil(LARGE.byteLength / UPLOAD_SESSION_CHUNK_BYTES);
  /** The `Content-Range` each request named, in order. */
  const ranges = (seen: readonly Seen[]): (string | null)[] =>
    seen.filter((request) => request.init.method === 'PUT').map((request) => new Headers(request.init.headers).get('content-range'));
  const expectedRanges = Array.from({ length: CHUNKS }, (_, index) => {
    const start = index * UPLOAD_SESSION_CHUNK_BYTES;
    const end = Math.min(start + UPLOAD_SESSION_CHUNK_BYTES, LARGE.byteLength) - 1;
    return `bytes ${String(start)}-${String(end)}/${String(LARGE.byteLength)}`;
  });

  it('a request size both providers accept: a multiple of 320 KiB and of 256 KiB, under 60 MiB', () => {
    expect(UPLOAD_SESSION_CHUNK_BYTES % 327_680).toBe(0);
    expect(UPLOAD_SESSION_CHUNK_BYTES % 262_144).toBe(0);
    expect(UPLOAD_SESSION_CHUNK_BYTES).toBeLessThan(60 * 1024 * 1024);
  });

  it('OneDrive Save back: a session made with If-Match, every range in order, and NO token sent to the upload URL', async () => {
    const UPLOAD = 'https://sn3302.up.1drv.com/up/fe6987415ace7X4e1eF866337';
    const { fetchImpl, seen } = scripted([
      json({ uploadUrl: UPLOAD, expirationDateTime: '2026-10-03T00:00:00Z' }),
      ...Array.from({ length: CHUNKS - 1 }, (_, index) => json({ nextExpectedRanges: [`${String((index + 1) * UPLOAD_SESSION_CHUNK_BYTES)}-`] }, 202)),
      json({ id: 'id', eTag: '"etag-2"' }, 200),
    ]);

    expect(await replaceCloudPdf('onedrive', 't', 'id', '"etag-1"', LARGE, fetchImpl)).toBe('"etag-2"');

    expect(seen[0]?.url).toBe('https://graph.microsoft.com/v1.0/me/drive/items/id/createUploadSession');
    expect(new Headers(seen[0]?.init.headers).get('if-match')).toBe('"etag-1"');
    expect(JSON.parse(seen[0]?.init.body as string)).toStrictEqual({ item: { '@microsoft.graph.conflictBehavior': 'replace' } });
    expect(ranges(seen)).toStrictEqual(expectedRanges);
    expect(seen.slice(1).every((request) => request.url === UPLOAD && !new Headers(request.init.headers).has('authorization'))).toBe(true);
    // EVERY BYTE SENT, ONCE: the bodies' lengths add up to the document.
    expect(seen.slice(1).reduce((sum, request) => sum + (request.init.body as Uint8Array).byteLength, 0)).toBe(LARGE.byteLength);
  });

  it('Google Drive Upload a copy: a resumable session, its address from Location, 308 until the last range', async () => {
    const SESSION = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc';
    const { fetchImpl, seen } = scripted([
      new Response(null, { status: 200, headers: { location: SESSION } }),
      ...Array.from(
        { length: CHUNKS - 1 },
        (_, index) => new Response(null, { status: 308, headers: { range: `bytes=0-${String((index + 1) * UPLOAD_SESSION_CHUNK_BYTES - 1)}` } }),
      ),
      json({ id: 'new-id' }, 200),
    ]);

    expect(await createCloudPdf('google-drive', 't', 'big.pdf', LARGE, fetchImpl)).toBe('new-id');

    expect(seen[0]?.url).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id');
    expect(new Headers(seen[0]?.init.headers).get('x-upload-content-length')).toBe(String(LARGE.byteLength));
    expect(ranges(seen)).toStrictEqual(expectedRanges);
    // A 308 IS GOOGLE'S "MORE, PLEASE", never a redirect to follow.
    expect(seen.slice(1).every((request) => request.init.redirect === 'manual')).toBe(true);
  });

  it('CONTROL: a document AT the bound still goes in one request, the route the live runs proved', async () => {
    const { fetchImpl, seen } = scripted([json({ id: 'new-id' })]);
    await createCloudPdf('onedrive', 't', 'report.pdf', new Uint8Array(MAX_SIMPLE_UPLOAD_BYTES), fetchImpl);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toContain(':/content?');
  });

  it('REFUSES a session on a host the provider is not declared to keep content on, and sends it nothing', async () => {
    const { fetchImpl, seen } = scripted([json({ uploadUrl: 'https://uploads.example.org/up/1' })]);
    await expect(createCloudPdf('onedrive', 't', 'big.pdf', LARGE, fetchImpl)).rejects.toMatchObject({ reason: 'unexpected-answer' });
    expect(seen).toHaveLength(1);
  });

  it('ENDS a session that does not move forward, and cancels it, rather than sending the same bytes again', async () => {
    const UPLOAD = 'https://sn3302.up.1drv.com/up/x';
    const { fetchImpl, seen } = scripted([
      json({ uploadUrl: UPLOAD }),
      json({ nextExpectedRanges: ['0-'] }, 202),
      new Response(null, { status: 204 }),
    ]);
    await expect(createCloudPdf('onedrive', 't', 'big.pdf', LARGE, fetchImpl)).rejects.toMatchObject({ reason: 'unexpected-answer' });
    expect(seen.map((request) => request.init.method)).toStrictEqual(['POST', 'PUT', 'DELETE']);
  });
});

describe('Upload a copy', () => {
  it('Google Drive: one multipart request carrying the name and the document', async () => {
    const { fetchImpl, seen } = scripted([json({ id: 'new-id' })]);
    expect(await createCloudPdf('google-drive', 't', 'report.pdf', PDF, fetchImpl)).toBe('new-id');
    const sent = Buffer.from(seen[0]?.init.body as Uint8Array).toString('latin1');
    expect(sent).toContain('"name":"report.pdf"');
    expect(sent).toContain('%PDF-1.7');
  });

  it('OneDrive: a taken name is RENAMED by the provider, never overwritten', async () => {
    const { fetchImpl, seen } = scripted([json({ id: 'new-id' })]);
    await createCloudPdf('onedrive', 't', 'report.pdf', PDF, fetchImpl);
    expect(seen[0]?.url).toContain('conflictBehavior=rename');
  });
});
