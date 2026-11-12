import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { keptCatalogueName } from '../keptCatalogue.js';
import { cryptoBytes } from '../token.js';
import { catalogueChannels } from './catalogueChannels.js';
import { catalogueFoldersOf } from './catalogueArguments.js';
import { createCatalogueHandlers } from './catalogueHandlers.js';
import type { HostArea } from './engineHandlers.js';
import { createHostSessions } from './hostSessions.js';

/**
 * The catalogue host (ADR-0293): a host that holds no document, whose one job is to write the kept catalogue into the
 * area it is handed. Driven through its handlers, as the compose host's channel set is; the body is the one every host
 * runs.
 */
const FINGERPRINT = 'c'.repeat(64);
const made: string[] = [];
function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'catalogue-host-'));
  made.push(path);
  return path;
}
afterEach(() => {
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

const NO_PROBE = () => Promise.reject(new Error('not probed here'));

describe('the catalogue host', () => {
  it('owes the probe, an area, and keeping the catalogue: none of the three command channels', () => {
    // A LITERAL, `composeHostBody.test.ts`' reason: a set derived from the map agrees with any change to it.
    expect(Object.keys(catalogueChannels).sort()).toStrictEqual(['engine/close', 'engine/keep-catalogue', 'engine/open', 'engine/probe-containment']);
  });

  it('writes the kept file into the area it was handed, under the fingerprint’s name, and answers the faces it kept', async () => {
    const areas = createHostSessions<HostArea>(cryptoBytes);
    const output = folder();
    const kept: string[] = [];
    const handlers = createCatalogueHandlers({
      areas,
      probe: NO_PROBE,
      keep: (outputDirectory, fingerprint) => {
        kept.push(outputDirectory);
        return fingerprint === FINGERPRINT ? 3 : 0;
      },
    });
    const opened = await handlers['engine/open']({ snapshotDirectory: folder(), outputDirectory: output });
    if (!opened.ok) throw new Error('open refused');
    expect(await handlers['engine/keep-catalogue']({ session: opened.value.session, fingerprint: FINGERPRINT })).toStrictEqual({ ok: true, value: { faces: 3 } });
    // THE AREA'S OUTPUT DIRECTORY, the only directory the request could have named: it names none itself.
    expect(kept).toStrictEqual([output]);
  });

  it('answers no-faces where the folders held none, and no-such-session for an area it does not hold', async () => {
    const areas = createHostSessions<HostArea>(cryptoBytes);
    const handlers = createCatalogueHandlers({ areas, probe: NO_PROBE, keep: () => 0 });
    const opened = await handlers['engine/open']({ snapshotDirectory: folder(), outputDirectory: folder() });
    if (!opened.ok) throw new Error('open refused');
    expect(await handlers['engine/keep-catalogue']({ session: opened.value.session, fingerprint: FINGERPRINT })).toStrictEqual({ ok: false, error: { code: 'no-faces' } });
    await handlers['engine/close']({ session: opened.value.session });
    expect(await handlers['engine/keep-catalogue']({ session: opened.value.session, fingerprint: FINGERPRINT })).toStrictEqual({
      ok: false,
      error: { code: 'no-such-session' },
    });
  });

  it('takes a fingerprint that names a file and refuses one that could name a path', () => {
    const params = catalogueChannels['engine/keep-catalogue'].params;
    expect(params.safeParse({ session: 's', fingerprint: FINGERPRINT }).success).toBe(true);
    for (const fingerprint of ['..', `..\\${'c'.repeat(61)}`, 'C'.repeat(64), 'c'.repeat(65)]) {
      expect(params.safeParse({ session: 's', fingerprint }).success).toBe(false);
    }
  });

  it('reads its two folders from its command line, an empty one as none', () => {
    expect(catalogueFoldersOf(['node', 'entry.js', 'pipe', 'B', 'I'])).toStrictEqual({ bundled: 'B', installed: 'I' });
    expect(catalogueFoldersOf(['node', 'entry.js', 'pipe', '', ''])).toStrictEqual({ bundled: null, installed: null });
    expect(catalogueFoldersOf(['node', 'entry.js', 'pipe'])).toStrictEqual({ bundled: null, installed: null });
  });

  it('CONTROL: the kept file a real keep writes is the one main copies by name', async () => {
    const { keepCatalogue } = await import('../keptCatalogue.js');
    const output = folder();
    const face = { id: '', origin: 'bundled' as const, family: 'F', weight: 400, italic: false, embedding: 'subset' as const, unicodes: new Set([65]), weights: null, path: '', faceIndex: 0, localNames: [], cff: false };
    keepCatalogue(output, FINGERPRINT, [], () => ({ faces: [face], unreadable: [] }));
    expect(readdirSync(output)).toStrictEqual([keptCatalogueName(FINGERPRINT)]);
    expect(existsSync(join(output, keptCatalogueName(FINGERPRINT)))).toBe(true);
  });
});
