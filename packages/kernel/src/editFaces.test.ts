import { afterEach, describe, expect, it } from 'vitest';

import { bindEditFaces, bindEditFolders, editFaces, editFacesBound, loadEditFaces } from './editFaces.js';

/** The provisioned bundled set, which the vitest setup names, as the PDFium proofs read it. */
const BUNDLED = process.env['MONSTERA_FONTS_DIRECTORY'] ?? '';

describe('the edit faces bound by their folders (ADR-0177)', () => {
  afterEach(() => {
    bindEditFaces(null);
  });

  it('reads as bound before the catalogue loads, refuses a read until it has, and then reads the folder', async () => {
    expect(BUNDLED).not.toBe('');
    bindEditFolders(BUNDLED, null);
    expect(editFacesBound()).toBe(true);
    // A READ BEFORE THE LOAD IS REFUSED BY NAME: answering `null` would refuse a word a bundled face carries.
    expect(() => editFaces()).toThrow(/before loadEditFaces/u);
    await loadEditFaces();
    const source = editFaces();
    expect(source?.faces.length ?? 0).toBeGreaterThan(0);
    expect(source?.faces.every((face) => face.origin === 'bundled')).toBe(true);
  });

  it('CONTROL: a binding made while the catalogue loaded is the one that stands', async () => {
    bindEditFolders(BUNDLED, null);
    const loading = loadEditFaces();
    bindEditFaces(null);
    await loading;
    // THE LATER UNBINDING STANDS, so the folders bound first cannot come back once their module arrives.
    expect(editFacesBound()).toBe(false);
    expect(editFaces()).toBeNull();
  });

  it('loads nothing for a binding by thunk, which reads as before', async () => {
    let reads = 0;
    bindEditFaces(() => {
      reads += 1;
      return { faces: [], read: () => new Uint8Array() };
    });
    await loadEditFaces();
    expect(reads).toBe(0);
    expect(editFaces()?.faces).toStrictEqual([]);
    expect(reads).toBe(1);
  });
});
