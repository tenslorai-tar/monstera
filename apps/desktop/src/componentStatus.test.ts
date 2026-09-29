import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ComponentStatus, componentStatuses } from './componentStatus.js';
import { type NativeSource, nativeComponentPath } from './nativeComponents.js';

/**
 * The Components dialog's states, read from real files against a real manifest (ADR-0122). Every case builds a
 * PACKAGED folder — the layout item 14 produces — so what is asserted is what an installed build would show.
 */
let root = '';
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'monstera-components-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A packaged `native` folder holding PDFium's one file, its manifest naming it. */
function packaged(bytes = 'pdfium bytes'): NativeSource {
  mkdirSync(join(root, 'pdfium'), { recursive: true });
  writeFileSync(join(root, 'pdfium', 'pdfium.dll'), bytes);
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({
      manifest: 1,
      components: { pdfium: { name: 'PDFium', version: '155.0', files: { 'pdfium.dll': sha('pdfium bytes') } } },
    }),
  );
  return { kind: 'packaged', folder: root };
}

function pdfium(statuses: readonly ComponentStatus[]): ComponentStatus | undefined {
  return statuses.find((status) => status.id === 'pdfium');
}

describe('componentStatuses', () => {
  it('reports a packaged component VERIFIED when every file hashes to the manifest', async () => {
    const statuses = await componentStatuses({ verify: true, source: packaged() });
    expect(pdfium(statuses)).toStrictEqual({
      id: 'pdfium', name: 'PDFium', version: '155.0', state: 'verified', missing: 0, altered: 0, extra: 0,
    });
  });

  // CONTROL for the case above: the same file with other bytes — a verify that only looked for the file would pass it.
  it('reports CHANGED, counting the altered file, when its bytes differ', async () => {
    const statuses = await componentStatuses({ verify: true, source: packaged('somebody else’s pdfium') });
    expect(pdfium(statuses)).toMatchObject({ state: 'changed', altered: 1, missing: 0, extra: 0 });
  });

  it('reports CHANGED for a file nobody pinned beside a packaged component — a DLL Windows would load', async () => {
    const source = packaged();
    writeFileSync(join(root, 'pdfium', 'version.dll'), 'planted');
    expect(pdfium(await componentStatuses({ verify: true, source }))).toMatchObject({ state: 'changed', extra: 1 });
  });

  it('opens with PRESENT, not verified — nothing is hashed until Verify is asked', async () => {
    // The altered bytes would be CHANGED under verify; present is what a cheap look can honestly say.
    const statuses = await componentStatuses({ verify: false, source: packaged('somebody else’s pdfium') });
    expect(pdfium(statuses)).toMatchObject({ state: 'present', altered: 0 });
  });

  it('reports a missing file as CHANGED even without verify, and a component with no entry as ABSENT', async () => {
    const source = packaged();
    rmSync(join(root, 'pdfium', 'pdfium.dll'));
    const statuses = await componentStatuses({ verify: false, source });
    expect(pdfium(statuses)).toMatchObject({ state: 'changed', missing: 1 });
    expect(statuses.find((status) => status.id === 'ghostscript')).toMatchObject({ state: 'absent' });
    expect(statuses).toHaveLength(6);
  });

  it('refuses a manifest that does not parse, rather than showing a damaged package as merely absent', async () => {
    const source = packaged();
    writeFileSync(join(root, 'manifest.json'), '{ not json');
    await expect(componentStatuses({ verify: false, source })).rejects.toThrow();
  });

  it('reads each component from its packaged folder, and the launcher’s variable in development', () => {
    expect(nativeComponentPath('pdfium', { kind: 'packaged', folder: 'C:\\app\\resources\\native' })).toBe(
      join('C:\\app\\resources\\native', 'pdfium', 'pdfium.dll'),
    );
    expect(nativeComponentPath('ocr-models', { kind: 'packaged', folder: 'C:\\n' })).toBe(join('C:\\n', 'ocr-models'));
    expect(
      nativeComponentPath('pdfium', { kind: 'development', environment: { MONSTERA_PDFIUM_LIBRARY: 'C:\\t\\pdfium.dll' } }),
    ).toBe('C:\\t\\pdfium.dll');
    // EMPTY IS ABSENT: a shell expanding an unset variable produces ''.
    expect(nativeComponentPath('pdfium', { kind: 'development', environment: { MONSTERA_PDFIUM_LIBRARY: '' } })).toBeNull();
  });
});
