import { describe, expect, it } from 'vitest';

import {
  CLOUD_PROVIDERS,
  CloudStorageRefused,
  cloudAuthorizationUrl,
  createCloudPdf,
  exchangeCloudCode,
  fetchCloudPdf,
  listCloudPdfs,
  refreshCloudTokens,
  replaceCloudPdf,
} from './cloudStorage.js';

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
