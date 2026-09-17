import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HANDWRITING_HOSTS, artefactsFor } from './handwritingArtefacts.js';
import { DownloadRefused, downloadVerified } from './verifiedDownload.js';

/**
 * The host list against the redirect HuggingFace actually answers with.
 *
 * Read 2026-09-17 with a `HEAD` on the small encoder's `resolve` URL: `302` to
 * `us.aws.cdn.hf.co`. The fake fetch replays that shape, so the case runs with no
 * network and still crosses the hop where the bytes arrive — the hop the list
 * refused before `*.hf.co` joined it.
 */

const CDN = 'https://us.aws.cdn.hf.co/repos/encoder';
const BODY = new TextEncoder().encode('weights');
const DIGEST = createHash('sha256').update(BODY).digest('hex');

function huggingFaceFetch(): { fetchImpl: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  // `downloadVerified` passes a string on every hop, so the fake takes only that.
  const fetchImpl = ((url: string) => {
    asked.push(url);
    return Promise.resolve(
      url === CDN
        ? new Response(BODY, { status: 200 })
        : new Response(null, { status: 302, headers: { location: CDN } }),
    );
  }) as typeof fetch;
  return { fetchImpl, asked };
}

describe('HANDWRITING_HOSTS', () => {
  let scratch = '';
  afterEach(async () => {
    if (scratch !== '') await rm(scratch, { recursive: true, force: true });
    scratch = '';
  });

  it('admits the CDN host a model download is redirected to, and the bytes land', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'monstera-handwriting-hosts-'));
    const encoder = artefactsFor('small')[0];
    expect(encoder?.url.startsWith('https://huggingface.co/')).toBe(true);
    const { fetchImpl, asked } = huggingFaceFetch();
    const destination = join(scratch, 'encoder.onnx');

    await downloadVerified({
      url: encoder?.url ?? '',
      allowedHosts: HANDWRITING_HOSTS,
      sha256: DIGEST,
      maxBytes: BODY.byteLength,
      destination,
      fetchImpl,
    });

    // BOTH HOPS WERE REQUESTED, so the pass is the redirect being followed rather
    // than a fake that answered the first URL with the body.
    expect(asked).toStrictEqual([encoder?.url, CDN]);
    expect(new Uint8Array(await readFile(destination))).toStrictEqual(BODY);
  });

  it('CONTROL: the list without the wildcard refuses that same hop, before requesting it', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'monstera-handwriting-hosts-'));
    const encoder = artefactsFor('small')[0];
    const { fetchImpl, asked } = huggingFaceFetch();

    const refused = await downloadVerified({
      url: encoder?.url ?? '',
      allowedHosts: ['huggingface.co'],
      sha256: DIGEST,
      maxBytes: BODY.byteLength,
      destination: join(scratch, 'encoder.onnx'),
      fetchImpl,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refused).toBeInstanceOf(DownloadRefused);
    expect((refused as DownloadRefused).reason).toBe('unlisted-host');
    expect(asked).toStrictEqual([encoder?.url]);
  });

  it('no artefact is fetched from a host outside the list on its first request', () => {
    for (const size of ['small', 'base'] as const) {
      for (const artefact of artefactsFor(size)) {
        expect(new URL(artefact.url).host).toBe('huggingface.co');
      }
    }
  });
});
