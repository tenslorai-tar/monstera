import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Catalogue, CatalogueReading, FontFolder } from '../fontCatalogue.js';
import { keptCatalogueName, keptCatalogueText } from '../keptCatalogue.js';
import { KEPT_AREA_ARGUMENT, catalogueReadingFrom } from './keptArguments.js';

/**
 * Where the three hosts that set text find their kept catalogue (ADR-0293 Decision 6): two arguments after the installed
 * fonts' folder, read in one place. A host started with them takes the file; one started without is the folders' read.
 */
const FINGERPRINT = 'd'.repeat(64);
const BUNDLED = join(tmpdir(), 'kept-arguments', 'bundled');
const FOLDERS: readonly FontFolder[] = [{ path: BUNDLED, origin: 'bundled' }];
const PATH = join(BUNDLED, 'Arimo.ttf');
const KEPT: Catalogue = {
  faces: [{ id: `bundled:${PATH}#0`, origin: 'bundled', family: 'Arimo', weight: 400, italic: false, embedding: 'subset', unicodes: new Set([65]), weights: null, path: PATH, faceIndex: 0, localNames: [], cff: false }],
  unreadable: [],
};

const made: string[] = [];
afterEach(() => {
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});
function areaHolding(text: string): string {
  const area = mkdtempSync(join(tmpdir(), 'kept-arguments-'));
  made.push(area);
  writeFileSync(join(area, keptCatalogueName(FINGERPRINT)), text);
  return area;
}
/** A host's command line: entry, pipe, library, fonts, installed, then the kept area and fingerprint where given. */
const argvWith = (...kept: string[]): string[] => ['node', 'entry.js', 'pipe', 'lib', BUNDLED, '', ...kept];

describe('catalogueReadingFrom', () => {
  it('reads the kept area and fingerprint from the places after the installed fonts', () => {
    expect(argvWith('area', FINGERPRINT).indexOf('area')).toBe(KEPT_AREA_ARGUMENT);
  });

  it('takes the kept file a host was told of, and reads no folder', () => {
    let read = 0;
    const folders: CatalogueReading = () => {
      read += 1;
      return { faces: [], unreadable: [] };
    };
    const reading = catalogueReadingFrom(argvWith(areaHolding(keptCatalogueText(KEPT, FINGERPRINT)), FINGERPRINT), folders, () => undefined);
    expect(reading(FOLDERS).faces.map((face) => face.family)).toStrictEqual(['Arimo']);
    expect(read).toBe(0);
  });

  it('CONTROL: started without them, it is the folders’ read itself', () => {
    const folders: CatalogueReading = () => ({ faces: [], unreadable: [] });
    expect(catalogueReadingFrom(argvWith(), folders, () => undefined)).toBe(folders);
    expect(catalogueReadingFrom(argvWith('', ''), folders, () => undefined)).toBe(folders);
  });

  it('is the folders’ read where the fingerprint is not one, so no argument becomes a file name', () => {
    const folders: CatalogueReading = () => ({ faces: [], unreadable: [] });
    expect(catalogueReadingFrom(argvWith(areaHolding('{}'), '..'), folders, () => undefined)).toBe(folders);
  });

  it('notes a kept file it refused once, and reads the folders', () => {
    let read = 0;
    const heard: string[] = [];
    const reading = catalogueReadingFrom(
      argvWith(areaHolding('{'), FINGERPRINT),
      () => {
        read += 1;
        return { faces: [], unreadable: [] };
      },
      (why) => heard.push(why),
    );
    reading(FOLDERS);
    expect(read).toBe(1);
    expect(heard).toHaveLength(1);
  });
});
