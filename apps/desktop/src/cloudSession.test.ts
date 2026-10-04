import { SECRET_SETTING_IDS } from '@monstera/contract';
import { asDocId } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CloudOutcomeRefused, cloudSessionSecretId, createCloudStorage, safeFileName } from './cloudSession.js';
import type { SecretStoreSurface } from './secretStore.js';
import type { SettingsSurface } from './settingsFile.js';
import type { ShellFailure } from './shellFailure.js';

/**
 * Cloud storage as `main` holds it (ADR-0091): the sign-in runs through a REAL loopback listener
 * and a "browser" that follows the redirect; the providers are answered by host and path.
 */

function memorySecrets(): SecretStoreSurface & { readonly held: Map<string, string> } {
  const held = new Map<string, string>();
  return {
    held,
    available: () => true,
    read: () => Object.fromEntries(held),
    write: (id, value) => {
      if (value === '') held.delete(id);
      else held.set(id, value);
    },
  };
}

interface Provider {
  readonly fetchImpl: typeof fetch;
  readonly tokenForms: URLSearchParams[];
  readonly uploads: { url: string; ifMatch: string | null }[];
  uploadStatus: number;
  refreshStatus: number;
}

/** OneDrive's hosts, answering by path. */
function onedrive(): Provider {
  let issued = 0;
  const provider: Provider = {
    tokenForms: [],
    uploads: [],
    uploadStatus: 200,
    refreshStatus: 200,
    fetchImpl: (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status });
      if (url.host === 'login.microsoftonline.com') {
        const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
        provider.tokenForms.push(form);
        if (form.get('grant_type') === 'refresh_token' && provider.refreshStatus !== 200) {
          return Promise.resolve(json({ error: 'invalid_grant' }, provider.refreshStatus));
        }
        issued += 1;
        return Promise.resolve(json({ access_token: `access-${String(issued)}`, refresh_token: `refresh-${String(issued)}`, expires_in: 3600 }));
      }
      if (url.pathname.includes('/search(')) {
        return Promise.resolve(json({ value: [{ id: 'f1', name: 'contract.pdf', size: 9, lastModifiedDateTime: '2026-09-01T00:00:00Z', file: {} }] }));
      }
      if (url.pathname === '/v1.0/me/drive/items/f1' ) return Promise.resolve(json({ name: 'contract.pdf', eTag: '"v1"' }));
      // `f2` IS SHARED WITH THE PERSON TO VIEW, from another drive: a `remoteItem`, whose permissions for this caller
      // carry only `read` (Graph: a non-owner is listed only the permissions that apply to them).
      if (url.pathname === '/v1.0/me/drive/items/f2') {
        return Promise.resolve(
          json({ name: 'shared.pdf', eTag: '"s1"', remoteItem: { id: 'R2', parentReference: { driveId: 'D2' } } }),
        );
      }
      if (url.pathname === '/v1.0/drives/D2/items/R2/permissions') return Promise.resolve(json({ value: [{ roles: ['read'] }] }));
      if (/^\/v1\.0\/me\/drive\/items\/f[12]\/content$/u.test(url.pathname) && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(new Response('%PDF-1.7\n%%EOF\n', { status: 200 }));
      }
      if (/^\/v1\.0\/me\/drive\/items\/f[12]\/content$/u.test(url.pathname) && init?.method === 'PUT') {
        provider.uploads.push({ url: url.href, ifMatch: new Headers(init.headers).get('if-match') });
        if (provider.uploadStatus !== 200) return Promise.resolve(json({}, provider.uploadStatus));
        return Promise.resolve(json({ eTag: '"v2"' }));
      }
      throw new Error(`the fake has no answer for ${url.href}`);
    },
  };
  return provider;
}

/** The person's browser: it follows the provider's redirect, resolving `localhost` to loopback. */
function browser(): { readonly openInBrowser: (url: string) => Promise<void>; readonly redirects: string[] } {
  const redirects: string[] = [];
  return {
    redirects,
    openInBrowser: async (authorizationUrl) => {
      const url = new URL(authorizationUrl);
      const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
      redirects.push(redirect.href);
      redirect.hostname = '127.0.0.1';
      redirect.searchParams.set('code', 'the-code');
      redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
      await fetch(redirect);
    },
  };
}

/** Where a session keeps its working copies' origins, held in memory so a second session can read what the first kept. */
function memoryOrigins(): SettingsSurface & { readonly held: () => Readonly<Record<string, unknown>> } {
  let held: Readonly<Record<string, unknown>> = {};
  return {
    held: () => held,
    read: () => held,
    write: (values) => {
      held = JSON.parse(JSON.stringify(values)) as Record<string, unknown>;
    },
  };
}

function storage(
  provider: Provider,
  secrets = memorySecrets(),
  shown = browser(),
  configured = true,
  origins = memoryOrigins(),
) {
  const written: { path: string; bytes: number }[] = [];
  /** Every line the session wrote to the diagnostics log. */
  const logged: ShellFailure[] = [];
  const cloud = createCloudStorage({
    report: (failure) => logged.push(failure),
    secrets,
    clients: { onedrive: configured ? { clientId: 'made-up-id' } : null, 'google-drive': null },
    openInBrowser: shown.openInBrowser,
    workingDirectory: 'C:/work',
    origins,
    maxBytes: 1_000_000,
    fetchImpl: provider.fetchImpl,
    writeWorkingCopy: async (path, open) => {
      let bytes = 0;
      for await (const chunk of await open()) bytes += (chunk as Uint8Array).byteLength;
      written.push({ path, bytes });
      return 'written';
    },
  });
  return { cloud, secrets, shown, written, logged };
}

describe('cloud storage in main (ADR-0091)', () => {
  it('a provider with no client values is NOT CONFIGURED, and asks nobody', async () => {
    const provider = onedrive();
    const { cloud, shown } = storage(provider, memorySecrets(), browser(), false);
    expect(cloud.state('onedrive')).toBe('not-configured');
    await expect(cloud.list('onedrive')).rejects.toMatchObject({ reason: 'not-configured' });
    expect(shown.redirects).toStrictEqual([]);
    expect(provider.tokenForms).toStrictEqual([]);
  });

  it('the first listing SIGNS IN through the browser — Microsoft’s localhost redirect, no secret — and keeps the sign-in outside the settings', async () => {
    const provider = onedrive();
    const { cloud, secrets, shown } = storage(provider);
    expect(cloud.state('onedrive')).toBe('signed-out');

    const files = await cloud.list('onedrive');

    expect(files.map((file) => file.name)).toStrictEqual(['contract.pdf']);
    expect(new URL(shown.redirects[0] ?? '').hostname).toBe('localhost');
    expect(provider.tokenForms[0]?.get('grant_type')).toBe('authorization_code');
    expect(provider.tokenForms[0]?.has('client_secret')).toBe(false);
    expect(cloud.state('onedrive')).toBe('signed-in');
    const id = cloudSessionSecretId('onedrive');
    expect(secrets.held.has(id)).toBe(true);
    // NOT A SETTING, so the renderer can neither write it nor learn it exists.
    expect((SECRET_SETTING_IDS as readonly string[]).includes(id)).toBe(false);
  });

  it('an expired sign-in is REFRESHED, and one the provider refuses is removed and signed in again', async () => {
    const provider = onedrive();
    const secrets = memorySecrets();
    secrets.write(cloudSessionSecretId('onedrive'), JSON.stringify({ accessToken: 'old', refreshToken: 'r', expiresAt: 0 }));
    const { cloud, shown } = storage(provider, secrets);
    provider.refreshStatus = 400;
    // A 400 is `rejected`, not `unauthorised`: kept, and said, rather than signed in again.
    await expect(cloud.list('onedrive')).rejects.toBeInstanceOf(CloudOutcomeRefused);
    expect(shown.redirects).toStrictEqual([]);

    provider.refreshStatus = 401;
    await cloud.list('onedrive');
    expect(provider.tokenForms.map((form) => form.get('grant_type'))).toStrictEqual([
      'refresh_token',
      'refresh_token',
      'authorization_code',
    ]);
    expect(shown.redirects).toHaveLength(1);
  });

  it('OPEN writes a working copy; SAVE BACK sends the version it opened, and a moved file is CHANGED ELSEWHERE', async () => {
    const provider = onedrive();
    const { cloud, written } = storage(provider);
    const path = await cloud.download('onedrive', 'f1');
    expect(written).toStrictEqual([{ path, bytes: 15 }]);
    expect(path.replaceAll('\\', '/')).toMatch(/^C:\/work\/onedrive\/[0-9a-f]{24}\/contract\.pdf$/u);

    const doc = asDocId('00000000-0000-4000-8000-0000000000c1');
    cloud.link(doc, path);
    expect(cloud.originOf(doc)).toBe('onedrive');
    await cloud.saveBack(doc, new Uint8Array([1]));
    expect(provider.uploads[0]?.ifMatch).toBe('"v1"');

    // THE NEXT SAVE BACK names the version the last one answered, not the one it opened at.
    provider.uploadStatus = 412;
    await expect(cloud.saveBack(doc, new Uint8Array([2]))).rejects.toMatchObject({ reason: 'changed-elsewhere' });
    expect(provider.uploads[1]?.ifMatch).toBe('"v2"');
  });

  /**
   * THE OWNER'S 0.1.6.0 RUN, decision A: a file shared with them to view was answered "sign in again", and nothing
   * reached the log. Each case asserts the DECISION — which request was or was not made — not the tidy end state.
   */
  describe('a file the person may not change', () => {
    it('is read-only from the moment it opens, and Save back SENDS NOTHING — no upload, no sign-in — and says so in the log', async () => {
      const provider = onedrive();
      const { cloud, shown, logged } = storage(provider);
      const doc = asDocId('00000000-0000-4000-8000-0000000000c3');
      cloud.link(doc, await cloud.download('onedrive', 'f2'));
      expect(cloud.canEdit(doc)).toBe(false);

      await expect(cloud.saveBack(doc, new Uint8Array([1]))).rejects.toMatchObject({ reason: 'read-only' });
      expect(provider.uploads).toStrictEqual([]);
      expect(shown.redirects).toHaveLength(1);
      expect(logged).toStrictEqual([{ event: 'cloud-failed', detail: 'save back (onedrive): read-only' }]);
    });

    it('a 403 on the upload is FORBIDDEN — never a sign-in to repeat — and the log names the status', async () => {
      const provider = onedrive();
      const { cloud, shown, logged } = storage(provider);
      const doc = asDocId('00000000-0000-4000-8000-0000000000c4');
      cloud.link(doc, await cloud.download('onedrive', 'f1'));
      expect(cloud.canEdit(doc)).toBe(true);
      provider.uploadStatus = 403;

      await expect(cloud.saveBack(doc, new Uint8Array([1]))).rejects.toMatchObject({ reason: 'forbidden' });
      expect(provider.uploads).toHaveLength(1);
      // ONE SIGN-IN, the first one: the 403 did not send the person round another.
      expect(shown.redirects).toHaveLength(1);
      expect(logged.map((line) => line.detail)).toStrictEqual(['save back (onedrive): forbidden — graph.microsoft.com answered HTTP 403']);
    });

    it('CONTROL: a 401 on the same upload is still UNAUTHORISED, and a Save back that lands writes no line', async () => {
      const provider = onedrive();
      const { cloud, logged } = storage(provider);
      const doc = asDocId('00000000-0000-4000-8000-0000000000c5');
      cloud.link(doc, await cloud.download('onedrive', 'f1'));
      await cloud.saveBack(doc, new Uint8Array([1]));
      expect(logged).toStrictEqual([]);

      provider.uploadStatus = 401;
      await expect(cloud.saveBack(doc, new Uint8Array([2]))).rejects.toMatchObject({ reason: 'unauthorised' });
      expect(logged.map((line) => line.detail)).toStrictEqual(['save back (onedrive): unauthorised — graph.microsoft.com answered HTTP 401']);
    });
  });

  describe('GOOGLE’S PICKER (ADR-0091, corrected 2026-09-29)', () => {
    /** Google's token endpoint and one file, `g1`, answering by path; every request recorded. */
    function google(): { readonly fetchImpl: typeof fetch; readonly asked: string[] } {
      const asked: string[] = [];
      return {
        asked,
        fetchImpl: (input: string | URL | Request): Promise<Response> => {
          const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
          asked.push(`${url.host}${url.pathname}`);
          const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200 });
          if (url.host === 'oauth2.googleapis.com') {
            return Promise.resolve(json({ access_token: 'g-access', refresh_token: 'g-refresh', expires_in: 3600 }));
          }
          if (url.pathname === '/drive/v3/files/g1' && url.searchParams.get('alt') === 'media') {
            return Promise.resolve(new Response('%PDF-1.7\n%%EOF\n', { status: 200 }));
          }
          if (url.pathname === '/drive/v3/files/g1') return Promise.resolve(json({ name: 'chosen.pdf', version: '7' }));
          throw new Error(`the fake has no answer for ${url.href}`);
        },
      };
    }

    /** The browser, where the person chooses `picked` in Google's Picker — or chooses nothing. */
    function picking(picked: string | null): { readonly openInBrowser: (url: string) => Promise<void>; readonly asked: URL[] } {
      const asked: URL[] = [];
      return {
        asked,
        openInBrowser: async (authorizationUrl) => {
          const url = new URL(authorizationUrl);
          asked.push(url);
          const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
          redirect.searchParams.set('code', 'the-code');
          redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
          if (picked !== null) redirect.searchParams.set('picked_file_ids', picked);
          await fetch(redirect);
        },
      };
    }

    function googleStorage(shown: ReturnType<typeof picking>, fake: ReturnType<typeof google>) {
      const written: string[] = [];
      const secrets = memorySecrets();
      const cloud = createCloudStorage({
        report: () => undefined,
        secrets,
        clients: { onedrive: null, 'google-drive': { clientId: 'made-up-google-id', clientSecret: 'made-up' } },
        openInBrowser: shown.openInBrowser,
        workingDirectory: 'C:/work',
        origins: memoryOrigins(),
        maxBytes: 1_000_000,
        fetchImpl: fake.fetchImpl,
        writeWorkingCopy: async (path, open) => {
          for await (const chunk of await open()) void chunk;
          written.push(path);
          return 'written';
        },
      });
      return { cloud, secrets, written };
    }

    it('opens the Picker as the sign-in, downloads the file it CHOSE with that sign-in, and keeps the sign-in', async () => {
      const shown = picking('g1,g2');
      const fake = google();
      const { cloud, secrets, written } = googleStorage(shown, fake);

      const path = await cloud.pick('google-drive');

      expect(shown.asked).toHaveLength(1);
      expect(shown.asked[0]?.searchParams.get('trigger_onepick')).toBe('true');
      // THE FIRST CHOSEN FILE, described and fetched — and nothing listed, since the Picker named it.
      expect(fake.asked).toStrictEqual([
        'oauth2.googleapis.com/token',
        'www.googleapis.com/drive/v3/files/g1',
        'www.googleapis.com/drive/v3/files/g1',
      ]);
      expect(written).toStrictEqual([path]);
      expect(path.replaceAll('\\', '/')).toMatch(/\/google-drive\/[0-9a-f]{24}\/chosen\.pdf$/u);
      expect(secrets.held.has(cloudSessionSecretId('google-drive'))).toBe(true);
      expect(cloud.state('google-drive')).toBe('signed-in');
    });

    it('a Picker that came back with NO file is nothing-picked, and downloads nothing', async () => {
      const fake = google();
      const { cloud, written } = googleStorage(picking(null), fake);
      await expect(cloud.pick('google-drive')).rejects.toMatchObject({ reason: 'nothing-picked' });
      expect(written).toStrictEqual([]);
      expect(fake.asked).toStrictEqual(['oauth2.googleapis.com/token']);
    });

    it('an id that is not one — a path — is refused before any request names it', async () => {
      const fake = google();
      const { cloud } = googleStorage(picking('../../drive/v3/about'), fake);
      await expect(cloud.pick('google-drive')).rejects.toMatchObject({ reason: 'nothing-picked' });
      expect(fake.asked).toStrictEqual(['oauth2.googleapis.com/token']);
    });
  });

  /**
   * CR-DOC-02: a working copy is its cloud file however it is opened, and in whichever run. The origin is kept by the
   * copy's path, so a document opened from that path later (Recent, the last session) links to the same file, at the
   * version the last Save back left rather than the one it was downloaded at.
   */
  it('a working copy opened again, in a LATER RUN, is linked to its file at the version its last Save back left', async () => {
    const provider = onedrive();
    const secrets = memorySecrets();
    const origins = memoryOrigins();
    const first = storage(provider, secrets, browser(), true, origins).cloud;
    const path = await first.download('onedrive', 'f1');
    const opened = asDocId('00000000-0000-4000-8000-0000000000c3');
    first.link(opened, path);
    await first.saveBack(opened, new Uint8Array([1]));
    first.forget(opened);

    // A NEW SESSION over what the first kept, as the next run is, and the same copy opened from its path.
    const later = storage(provider, secrets, browser(), true, origins).cloud;
    const reopened = asDocId('00000000-0000-4000-8000-0000000000c4');
    later.link(reopened, path);
    expect(later.originOf(reopened)).toBe('onedrive');
    await later.saveBack(reopened, new Uint8Array([2]));
    // THE DECISION: the upload names the version the first Save back answered. The download's would be refused.
    expect(provider.uploads.map((upload) => upload.ifMatch)).toStrictEqual(['"v1"', '"v2"']);
  });

  it('CONTROL: a kept origin that does not parse links nothing, and the copy opens as the local file it then is', () => {
    const origins = memoryOrigins();
    origins.write({ 'C:/work/onedrive/abc/contract.pdf': { provider: 'dropbox', fileId: 'f1', version: 'v1', canEdit: true } });
    const { cloud } = storage(onedrive(), memorySecrets(), browser(), true, origins);
    const doc = asDocId('00000000-0000-4000-8000-0000000000c5');
    cloud.link(doc, 'C:/work/onedrive/abc/contract.pdf');
    expect(cloud.originOf(doc)).toBeNull();
  });

  it('CONTROL: a document never opened from the cloud has no origin, and a path this session did not download links nothing', () => {
    const { cloud } = storage(onedrive());
    const doc = asDocId('00000000-0000-4000-8000-0000000000c2');
    cloud.link(doc, 'C:/elsewhere/file.pdf');
    expect(cloud.originOf(doc)).toBeNull();
  });

  it('SIGN OUT forgets the sign-in on this machine', async () => {
    const { cloud } = storage(onedrive());
    await cloud.signIn('onedrive');
    cloud.signOut('onedrive');
    expect(cloud.state('onedrive')).toBe('signed-out');
  });

  it('a provider’s file name is made safe for this file system, and ends .pdf', () => {
    expect(safeFileName(`a${String.fromCharCode(7)}b:c?.PDF`)).toBe('a_b_c_.PDF');
    expect(safeFileName('report')).toBe('report.pdf');
  });
});
