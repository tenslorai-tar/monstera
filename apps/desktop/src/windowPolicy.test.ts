import { describe, expect, it } from 'vitest';

import {
  CONTENT_SECURITY_POLICY,
  PERMITTED_PERMISSIONS,
  RENDERER_WEB_PREFERENCES,
  isPermittedNavigation,
  isPermittedPermission,
} from './windowPolicy.js';

describe('renderer web preferences', () => {
  // ARCHITECTURE §2's list, item for item. Reading the constant back is worth
  // little on its own — what it catches is a default quietly re-entering the
  // object during an unrelated edit, which is how `sandbox` gets turned off
  // while debugging and never turned back on.
  it.each([
    ['sandbox', true],
    ['contextIsolation', true],
    ['nodeIntegration', false],
    ['nodeIntegrationInWorker', false],
    ['nodeIntegrationInSubFrames', false],
    ['webSecurity', true],
  ] as const)('%s is %s', (key, expected) => {
    expect(RENDERER_WEB_PREFERENCES[key]).toBe(expected);
  });
});

describe('permissions', () => {
  it('grants media, which is §2\u2019s single exception', () => {
    expect(isPermittedPermission('media')).toBe(true);
  });

  // Deny-all is a claim about everything, so the test names the things Electron
  // can actually ask for rather than one representative. A predicate that
  // returned true for `openExternal` and false for a made-up string would pass a
  // single-case test and be a working exfiltration route.
  it.each([
    'geolocation',
    'notifications',
    'midi',
    'midiSysex',
    'pointerLock',
    'fullscreen',
    'openExternal',
    'clipboard-read',
    'clipboard-sanitized-write',
    'display-capture',
    'window-management',
    'usb',
    'serial',
    'hid',
    'bluetooth',
    'idle-detection',
    'speaker-selection',
    'storage-access',
    'fileSystem',
  ])('denies %s', (permission) => {
    expect(isPermittedPermission(permission)).toBe(false);
  });

  it('denies a permission nobody has heard of, rather than defaulting to grant', () => {
    expect(isPermittedPermission('a-permission-added-in-a-later-electron')).toBe(false);
  });

  it('is a set of exactly one, so widening it is a visible edit', () => {
    expect([...PERMITTED_PERMISSIONS]).toStrictEqual(['media']);
  });
});

describe('navigation lock', () => {
  const loaded = 'file:///C:/app/renderer/index.html';

  it('permits the document the shell itself loaded', () => {
    expect(isPermittedNavigation(loaded, loaded)).toBe(true);
  });

  // THE CONTROL FOR THE CASE ABOVE. Without it, a predicate that returns true
  // for everything passes — and "navigation is permitted" is the reassuring
  // answer here, because nothing about a working app reveals that the lock is
  // open.
  it.each([
    ['a remote origin', 'https://example.test/'],
    ['a different local file', 'file:///C:/app/renderer/other.html'],
    ['a parent directory', 'file:///C:/app/'],
    // The prefix trap, and the reason this compares whole hrefs: every one of
    // these starts with the permitted URL as a string.
    ['a suffixed sibling', 'file:///C:/app/renderer/index.html.evil'],
    ['a query appended', 'file:///C:/app/renderer/index.html?x=1'],
    ['a fragment appended', 'file:///C:/app/renderer/index.html#x'],
    ['a javascript: URL', 'javascript:void 0'],
    ['a data: URL', 'data:text/html,<script>1</script>'],
  ])('refuses %s', (_label, target) => {
    expect(isPermittedNavigation(target, loaded)).toBe(false);
  });

  it('refuses an unparseable URL rather than treating it as a match', () => {
    expect(isPermittedNavigation('not a url', loaded)).toBe(false);
    expect(isPermittedNavigation(loaded, 'not a url')).toBe(false);
  });
});

describe('content security policy', () => {
  it('starts from deny-all, so an unlisted directive is refused rather than inherited', () => {
    expect(CONTENT_SECURITY_POLICY.startsWith("default-src 'none'")).toBe(true);
  });

  it.each([
    // Each of these is a route out of the renderer, and `default-src 'none'`
    // covers some but not all of them — `base-uri` and `form-action` do not
    // fall back to `default-src`, which is exactly why they are named.
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "connect-src 'none'",
  ])('names %s explicitly', (directive) => {
    expect(CONTENT_SECURITY_POLICY).toContain(directive);
  });

  it('permits blob: images and media, which rendered pages arrive as', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("img-src 'self' data: blob:");
    expect(CONTENT_SECURITY_POLICY).toContain("media-src 'self' blob:");
  });

  it('permits no unsafe source and no wildcard', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
    expect(CONTENT_SECURITY_POLICY).not.toContain('*');
    // `'unsafe-inline'` on style-src was in this list until it was pinned, and
    // nothing needed it. These are properties rather than a copy of the pinned
    // list — invariant 27 owns the list, and `proof:rendererpolicy` compares
    // against it. What this adds is that re-granting one has to be an edit HERE
    // too, so it cannot arrive as a one-word change to a constant.
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-inline');
  });
});
