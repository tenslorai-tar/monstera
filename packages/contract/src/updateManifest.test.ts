import { describe, expect, it } from 'vitest';

import {
  compareReleaseVersions,
  releaseVersionSchema,
  UPDATE_MANIFEST,
  updateManifestSchema,
} from './channels.js';

/** The update manifest's shape and the one version comparison (ADR-0110, U6 and U7). */

const VALID = { schema: 1, channel: 'store', version: '1.4.0', minimumVersion: '1.2.0', security: false };

describe('updateManifestSchema', () => {
  it('CONTROL: a valid manifest parses, so the refusals below are not "everything is refused"', () => {
    expect(updateManifestSchema.parse(VALID)).toStrictEqual(VALID);
    // EQUAL minimum and newest is a manifest, not a contradiction.
    expect(updateManifestSchema.safeParse({ ...VALID, minimumVersion: '1.4.0' }).success).toBe(true);
  });

  it('refuses a field nobody declared — a manifest that started carrying text or an address', () => {
    expect(updateManifestSchema.safeParse({ ...VALID, notes: 'Update now' }).success).toBe(false);
    expect(updateManifestSchema.safeParse({ ...VALID, url: 'https://example.com/setup.exe' }).success).toBe(false);
  });

  it('refuses a minimum above the newest, another channel, another shape, and a pre-release version', () => {
    expect(updateManifestSchema.safeParse({ ...VALID, minimumVersion: '1.10.0' }).success).toBe(false);
    expect(updateManifestSchema.safeParse({ ...VALID, channel: 'web' }).success).toBe(false);
    expect(updateManifestSchema.safeParse({ ...VALID, schema: 2 }).success).toBe(false);
    expect(updateManifestSchema.safeParse({ ...VALID, version: '1.5.0-beta.1' }).success).toBe(false);
  });
});

describe('releaseVersionSchema', () => {
  it('takes three numbers without leading zeros, and nothing else', () => {
    for (const good of ['0.0.0', '1.2.3', '10.20.30', '999999.0.1']) expect(releaseVersionSchema.safeParse(good).success).toBe(true);
    for (const bad of ['1.2', '1.2.3.4', '01.2.3', 'v1.2.3', '1.2.3 ', '1000000.0.0', ''])
      expect(releaseVersionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('compareReleaseVersions', () => {
  it('compares numbers, not strings: 1.2.10 is above 1.2.9', () => {
    // A STRING COMPARE orders '1.2.10' before '1.2.9' — the mutant this row exists to fail.
    expect(compareReleaseVersions('1.2.10', '1.2.9')).toBeGreaterThan(0);
    expect(compareReleaseVersions('1.2.9', '1.2.10')).toBeLessThan(0);
    expect(compareReleaseVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareReleaseVersions('1.4.0', '1.4.0')).toBe(0);
  });
});

describe('UPDATE_MANIFEST', () => {
  it('is dormant in this build: nothing hosts the file until the owner says so', () => {
    expect(UPDATE_MANIFEST).toStrictEqual({ state: 'dormant' });
  });
});
