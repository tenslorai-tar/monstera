import { asFileHandle } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CapabilityRegistry, handlesEqual } from './capabilityRegistry.js';

describe('CapabilityRegistry', () => {
  it('resolves a minted handle to the exact path', () => {
    // The control for every rejection below: a registry that resolved nothing
    // would satisfy all of them.
    const registry = new CapabilityRegistry();
    const path = 'C:\\Users\\someone\\Documents\\report.pdf';
    expect(registry.resolve(registry.mint(path))).toBe(path);
  });

  it('does not resolve a handle it did not mint', () => {
    const registry = new CapabilityRegistry();
    registry.mint('C:\\real.pdf');
    // Shaped exactly like a real handle — 32 random bytes, base64url — so this
    // tests the registry's bookkeeping and not a format check.
    const forged = asFileHandle('x'.repeat(43));
    expect(registry.resolve(forged)).toBeUndefined();
    expect(registry.has(forged)).toBe(false);
  });

  it('throws with an actionable message rather than returning undefined', () => {
    // An undefined path reaching a filesystem call becomes a confusing error
    // somewhere else; the boundary is where this should fail.
    const registry = new CapabilityRegistry();
    expect(() => registry.resolveOrThrow(asFileHandle('not-minted'))).toThrow(/Unknown FileHandle/);
  });

  it('is idempotent per path without deriving the handle from it', () => {
    const registry = new CapabilityRegistry();
    const path = '/home/someone/report.pdf';

    // Same path, same handle — otherwise reopening a file grows the registry
    // without bound.
    expect(registry.mint(path)).toBe(registry.mint(path));
    expect(registry.size).toBe(1);

    // But two registries must not agree, or the handle is a function of the
    // path and anyone who can guess a filename can forge one.
    expect(new CapabilityRegistry().mint(path)).not.toBe(new CapabilityRegistry().mint(path));
  });

  it('mints distinct handles for distinct paths', () => {
    const registry = new CapabilityRegistry();
    const a = registry.mint('/a.pdf');
    const b = registry.mint('/b.pdf');
    expect(a).not.toBe(b);
    expect(registry.resolve(a)).toBe('/a.pdf');
    expect(registry.resolve(b)).toBe('/b.pdf');
  });

  it('mints handles with no collisions and the documented shape', () => {
    const registry = new CapabilityRegistry();
    const handles = new Set<string>();
    for (let index = 0; index < 2000; index += 1) handles.add(registry.mint(`/f${String(index)}.pdf`));

    expect(handles.size).toBe(2000);
    // base64url of 32 bytes is 43 characters with no padding. Asserting the
    // length catches a future change that shortens the token far more reliably
    // than reviewing the constant.
    for (const handle of handles) {
      expect(handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  // The four cases below replace one that was named for entropy and could not
  // fail: it asserted uniqueness and a 43-character shape, and a padded counter
  // substituted for randomBytes satisfies both — the whole suite stayed green
  // under exactly that mutation. Uniqueness is not unpredictability, and shape
  // is not width.

  it('draws exactly 256 bits from its byte source for each handle', () => {
    const requested: number[] = [];
    const registry = new CapabilityRegistry((size) => {
      requested.push(size);
      return new Uint8Array(size).fill(requested.length);
    });

    registry.mint('/a.pdf');
    registry.mint('/b.pdf');
    // Idempotent per path, so this must NOT draw again — a registry that
    // re-drew would be minting a second handle for a path it already knows.
    registry.mint('/a.pdf');

    expect(requested).toStrictEqual([32, 32]);
  });

  it('encodes the source bytes verbatim rather than deriving from them', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_unused, index) => index * 7);
    const registry = new CapabilityRegistry(() => bytes);
    // Any hashing or truncation between the draw and the token would break this,
    // which is what keeps the 256-bit claim true of the handle and not merely of
    // some value upstream of it.
    expect(registry.mint('/a.pdf')).toBe(Buffer.from(bytes).toString('base64url'));
  });

  it('refuses a byte source that returns a short draw', () => {
    // The failure this prevents is silent: a 4-byte draw still yields an opaque,
    // unique, base64url-shaped token, so nothing downstream could notice.
    const registry = new CapabilityRegistry((size) => new Uint8Array(Math.min(size, 4)));
    expect(() => registry.mint('/a.pdf')).toThrow(/4 bytes, expected 32/);
  });

  it('varies every byte position by default, which a counter or a stub cannot', () => {
    // The real assertion about the DEFAULT source, and the one that fails under
    // the audit's mutation. A padded counter varies only its last byte or two,
    // so the leading positions are constant across every draw. With 512 samples
    // the chance a genuinely random position is constant is 256^-511.
    const registry = new CapabilityRegistry();
    const samples = Array.from({ length: 512 }, (_unused, index) =>
      Buffer.from(registry.mint(`/f${String(index)}.pdf`), 'base64url'),
    );

    expect(samples.every((sample) => sample.length === 32)).toBe(true);

    const constantPositions = Array.from({ length: 32 }, (_unused, position) => position).filter(
      (position) => new Set(samples.map((sample) => sample[position])).size === 1,
    );
    expect(constantPositions).toStrictEqual([]);
  });

  it('revokes a handle so it resolves as though never minted', () => {
    const registry = new CapabilityRegistry();
    const handle = registry.mint('/secret.pdf');
    registry.revoke(handle);

    expect(registry.resolve(handle)).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it('mints a fresh handle after revocation rather than reviving the old one', () => {
    // The reverse index must be cleared too. If it is not, minting the same
    // path again returns the revoked handle and revocation silently did nothing.
    const registry = new CapabilityRegistry();
    const path = '/secret.pdf';
    const first = registry.mint(path);
    registry.revoke(first);
    const second = registry.mint(path);

    expect(second).not.toBe(first);
    expect(registry.resolve(first)).toBeUndefined();
    expect(registry.resolve(second)).toBe(path);
  });

  it('mints per path string, not per file — pinned so it is known, not assumed', () => {
    // On Windows these three name one file. The registry mints three handles,
    // which is safe (each resolves to a path that reaches the file) but is NOT
    // a basis for document identity: two documents over one file means two
    // command logs and a save that discards the other's edits.
    //
    // This test exists so the behaviour is a recorded decision rather than an
    // accident, and so that anyone who later adds canonicalisation here has to
    // read why it was deliberately left out.
    const registry = new CapabilityRegistry();
    const sameFile = ['C:\\Users\\me\\report.pdf', 'C:/Users/me/report.pdf', 'c:\\users\\me\\REPORT.pdf'];
    const handles = new Set(sameFile.map((path) => registry.mint(path)));

    expect(handles.size).toBe(3);
    expect(registry.size).toBe(3);
  });

  it('mints for paths that do not exist', () => {
    // A Save As target and an app-created temp file are both named before they
    // exist. A registry that checked existence could not mint for either, which
    // is why minting is a capability to name a location and not an assertion
    // that something is there.
    const registry = new CapabilityRegistry();
    const path = '/tmp/not-created-yet-9f2a.pdf';
    expect(registry.resolve(registry.mint(path))).toBe(path);
  });

  it('handles paths with unicode and spaces unchanged', () => {
    const registry = new CapabilityRegistry();
    const path = 'C:\\Users\\me\\rapport café (final) 日本語.pdf';
    // Returned byte-for-byte: any normalisation here would silently change the
    // path a later filesystem call receives.
    expect(registry.resolve(registry.mint(path))).toBe(path);
  });

  it('refuses to mint for an empty path', () => {
    expect(() => new CapabilityRegistry().mint('')).toThrow();
  });

  it('revoking an unknown handle is a no-op rather than an error', () => {
    const registry = new CapabilityRegistry();
    registry.mint('/a.pdf');
    expect(() => {
      registry.revoke(asFileHandle('never-minted'));
    }).not.toThrow();
    expect(registry.size).toBe(1);
  });
});

describe('handlesEqual', () => {
  it('is true for identical handles and false for different ones', () => {
    const registry = new CapabilityRegistry();
    const handle = registry.mint('/a.pdf');
    expect(handlesEqual(handle, handle)).toBe(true);
    expect(handlesEqual(handle, registry.mint('/b.pdf'))).toBe(false);
  });

  it('returns false for different lengths instead of throwing', () => {
    // timingSafeEqual throws on a length mismatch, which would turn a
    // comparison into a crash at exactly the moment an attacker controls one
    // side of it.
    expect(handlesEqual(asFileHandle('short'), asFileHandle('much-longer-handle'))).toBe(false);
  });
});
