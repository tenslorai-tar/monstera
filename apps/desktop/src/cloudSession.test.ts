import { SECRET_SETTING_IDS } from '@monstera/contract';
import { asDocId } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CloudOutcomeRefused, cloudSessionSecretId, createCloudStorage, safeFileName } from './cloudSession.js';
import type { SecretStoreSurface } from './secretStore.js';

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
      if (url.pathname === '/v1.0/me/drive/items/f1/content' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(new Response('%PDF-1.7\n%%EOF\n', { status: 200 }));
      }
      if (url.pathname === '/v1.0/me/drive/items/f1/content' && init?.method === 'PUT') {
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

function storage(provider: Provider, secrets = memorySecrets(), shown = browser(), configured = true) {
  const written: { path: string; bytes: number }[] = [];
  const cloud = createCloudStorage({
    secrets,
    clients: { onedrive: configured ? { clientId: 'made-up-id' } : null, 'google-drive': null },
    openInBrowser: shown.openInBrowser,
    workingDirectory: 'C:/work',
    maxBytes: 1_000_000,
    fetchImpl: provider.fetchImpl,
    writeWorkingCopy: async (path, open) => {
      let bytes = 0;
      for await (const chunk of await open()) bytes += (chunk as Uint8Array).byteLength;
      written.push({ path, bytes });
      return 'written';
    },
  });
  return { cloud, secrets, shown, written };
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
