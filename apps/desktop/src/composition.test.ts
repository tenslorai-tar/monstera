import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RECENT_PREVIEWS_SETTING_ID } from '@monstera/contract';
import { asDocId } from '@monstera/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { createShellDependencies } from './composition.js';
import { harnessSurfaces } from './harnessComposition.js';
import { type PictureFiles, pictureName } from './recentPictures.js';
import { createEphemeralSettings } from './settingsFile.js';
import type { AppInfo } from './contractHandlers.js';

/**
 * The composition root, exercised through the handlers it returns.
 *
 * ## Why these cases live here and not beside `openEngineSession`
 *
 * Every piece below is proven in its own file: the supervisor's bound, the
 * handler's outcomes, the service's open. What none of them can answer is
 * whether this root **joined them up** — and finding KKKK-3 is what that costs
 * when it has not. For one commit `document.open` was registered while nothing
 * asked for a session, so an opened document reached `document.execute` with no
 * entry at all and the renderer was told `internal`, which the contract defines
 * as a defect rather than an outcome.
 *
 * A case against either half alone would have passed throughout. This is the
 * first caller of the assembled graph, which is the only place the join is
 * visible.
 *
 * ## No engine platform, which is the configuration these cases are ABOUT
 *
 * `createShellDependencies` is called with no `EngineHostPlatform`, exactly as
 * every unit test and every non-Windows run calls it. A host cannot be built,
 * so session creation fails — and the property under test is that failing is a
 * **decided** state rather than an absent one.
 */
const appInfo: AppInfo = { version: '0.0.0', installChannel: 'development', userName: 'A. Tester' };

// THE DESTINATION PICKER MOVED TO `harnessComposition.ts`, with its reason:
// every case here is about opening, poisoning or handler assembly and none
// writes a copy, so a stub returning a plausible path would let a case that
// accidentally reached it write a file on a developer's disk while passing.
// It was a copy in three harnesses and two test files; it is one object now.

const scratch = mkdtempSync(join(tmpdir(), 'monstera-composition-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** A file the service can open. Main never parses, so any bytes are a document. */
function aDocument(name: string): string {
  const path = join(scratch, name);
  writeFileSync(path, '%PDF-1.7\n');
  return path;
}

describe('the title bar overlay, through the assembled handlers', () => {
  it('answers applied:false before a window is attached, then paints the attached window with exactly what crossed', async () => {
    // The join only this root makes: the handler's surface reads the holder `attachWindow` writes. Asserted as the
    // CALL the window received, not the answer alone — an answer of `true` from a surface that painted nothing
    // is what a holder read at the wrong moment would produce.
    const deps = createShellDependencies({ ...harnessSurfaces('the composition test'), appInfo });
    const overlay = { color: '#141618', symbolColor: '#e6e8e6', height: 33 };

    const before = await deps.handlers['window.titleBarOverlay'](overlay);
    expect(before).toStrictEqual({ ok: true, value: { applied: false } });

    const painted: unknown[] = [];
    deps.attachWindow({
      setTitleBarOverlay: (given) => {
        painted.push(given);
      },
      close: () => undefined,
      askToClose: () => false,
      copy: () => undefined,
    });
    const after = await deps.handlers['window.titleBarOverlay'](overlay);
    expect(after).toStrictEqual({ ok: true, value: { applied: true } });
    expect(painted).toStrictEqual([overlay]);
  });
});

describe('copying the selection, through the assembled handlers', () => {
  it('answers copied:false before a window is attached, then runs the attached window’s copy exactly once', async () => {
    // The overlay case's join, for the selected-text menu's *Copy*: asserted as the CALL the window
    // received, because `copied: true` from a root that wired the handler to nothing reads the same.
    const deps = createShellDependencies({ ...harnessSurfaces('the composition test'), appInfo });
    expect(await deps.handlers['window.copy']({})).toStrictEqual({ ok: true, value: { copied: false } });

    let copies = 0;
    deps.attachWindow({
      setTitleBarOverlay: () => undefined,
      close: () => undefined,
      askToClose: () => false,
      copy: () => {
        copies += 1;
      },
    });
    expect(await deps.handlers['window.copy']({})).toStrictEqual({ ok: true, value: { copied: true } });
    expect(copies).toBe(1);
  });
});

describe('closing the window, through the assembled handlers and the shell’s hook', () => {
  it('holds the platform’s close and asks the page, then lets exactly the confirmed close through', async () => {
    // THE JOIN ONLY THIS ROOT MAKES: `closeRequested` (what main.ts binds to the window's close)
    // and `window.close` (what the renderer calls) are two ends of one gate, and a root that built
    // two gates would pass each end's own test while never letting a confirmed close through.
    const deps = createShellDependencies({ ...harnessSurfaces('the composition test'), appInfo });
    let asked = 0;
    let closed = 0;
    deps.attachWindow({
      setTitleBarOverlay: () => undefined,
      close: () => {
        closed += 1;
      },
      askToClose: () => {
        asked += 1;
        return true;
      },
      copy: () => undefined,
    });

    // THE RENDERER SAYS IT IS LISTENING FIRST, as it does at mount: before that the gate lets a
    // close through rather than spending a request on a page that is not subscribed.
    expect(await deps.handlers['window.closeListening']({})).toStrictEqual({ ok: true, value: { acknowledged: true } });

    expect(deps.closeRequested()).toBe(false);
    expect(asked).toBe(1);

    const answer = await deps.handlers['window.close']({});
    expect(answer).toStrictEqual({ ok: true, value: { closing: true } });
    expect(closed).toBe(1);
    expect(deps.closeRequested()).toBe(true);
    // CONTROL: the confirmed close did not ask again.
    expect(asked).toBe(1);
  });

  it('lets the platform’s close through while the renderer has NOT said it is listening, asking nobody', () => {
    // The join only this root makes, and the one `proof:shell` hung on: a quit that arrives
    // before the page subscribes must not be held for an answer that was delivered to nobody.
    const deps = createShellDependencies({ ...harnessSurfaces('the composition test'), appInfo });
    let asked = 0;
    deps.attachWindow({
      setTitleBarOverlay: () => undefined,
      close: () => undefined,
      askToClose: () => {
        asked += 1;
        return true;
      },
      copy: () => undefined,
    });

    expect(deps.closeRequested()).toBe(true);
    // ASSERTED AS THE CALL: a root that asked and let the close through anyway reads the same here.
    expect(asked).toBe(0);
  });

  it('answers closing:false and closes nothing when no window is attached', async () => {
    const deps = createShellDependencies({ ...harnessSurfaces('the composition test'), appInfo });
    expect(await deps.handlers['window.close']({})).toStrictEqual({ ok: true, value: { closing: false } });
    // With no page to ask, the platform's close goes through rather than hanging.
    expect(deps.closeRequested()).toBe(true);
  });
});

describe('the composition root, with no engine host platform', () => {
  it('leaves an opened document POISONED rather than sessionless', async () => {
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('poisoned.pdf')),
    });

    const opened = await handlers['document.open']({});
    expect(opened.ok).toBe(true);
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');

    // Queues BEHIND the session entry, because both run in this document's
    // lane and the entry was queued before `document.open` returned. So this
    // observes the settled state without waiting on anything.
    const executed = await handlers['document.execute']({
      docId: opened.value.docId,
      command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
    });

    // THE WHOLE CASE IS THE CODE, and `internal` is the value that must not
    // appear: it is what a document with no supervisor entry produces, and it
    // reaches the renderer as an inconsistency rather than as something a user
    // can be told. `document-poisoned` is declared.
    expect(executed.ok).toBe(false);
    if (executed.ok) throw new Error('the command should not have succeeded');
    expect(executed.error.code).toBe('document-poisoned');
  });

  it('SAVE IS REACHABLE, and refuses through the same guard as a command', async () => {
    // KKKK-3's shape is why this exists rather than a unit test alone: a
    // channel can be registered while nothing runs the path behind it, and
    // every kernel-level case still passes. This drives the real handler map,
    // so it fails if `document.save` is declared and unwired — and it asserts
    // the DECLARED code, because `internal` is what an unwired or half-wired
    // path produces and it reaches the renderer as an inconsistency.
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('unsaveable.pdf')),
    });

    const opened = await handlers['document.open']({});
    expect(opened.ok).toBe(true);
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');

    const saved = await handlers['document.save']({ docId: opened.value.docId });

    // A DECLARED code, not the order. This case was written asserting that
    // poison is read before the session and does not prove it: mutating the
    // order left it green, because against the real supervisor a document with
    // no entry has no failure count either, so the two guards cannot both be
    // reachable. What it does prove is that the path runs and answers something
    // the renderer can act on — see `save`'s comment for why the order is kept.
    expect(saved.ok).toBe(false);
    if (saved.ok) throw new Error('the save should not have succeeded');
    expect(saved.error.code).toBe('document-poisoned');
  });

  it('CONTROL: a document that never opened is refused by a DIFFERENT declared code', async () => {
    // Without this, the case above passes for any refusal at all — and
    // `document-not-open` is the refusal that was already there before a
    // session was ever asked for. Two declared codes that are not the same
    // code is what separates *the supervisor decided* from *the service
    // refused first*.
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition test'),
      appInfo,
      pickDocument: () => Promise.resolve(null),
    });

    const executed = await handlers['document.execute']({
      // A well-formed DocId the service has never issued.
      docId: asDocId('0'.repeat(64)),
      command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
    });

    expect(executed.ok).toBe(false);
    if (executed.ok) throw new Error('the command should not have succeeded');
    expect(executed.error.code).toBe('document-not-open');
  });

  it('poisons each document on its own, so one failure is not the app', async () => {
    // The bound is PER DOCUMENT (Decision 9a), and a supervisor that counted
    // globally would poison the second document on the first one's failures
    // while producing exactly the same answer for the first. The observable
    // that separates them is the second document reaching the same terminal
    // state by its own route rather than inheriting one.
    const paths = [aDocument('one.pdf'), aDocument('two.pdf')];
    let next = 0;
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition test'),
      appInfo,
      pickDocument: () => Promise.resolve(paths[next++] ?? null),
    });

    const first = await handlers['document.open']({});
    const second = await handlers['document.open']({});
    if (!first.ok || first.value.kind !== 'opened') throw new Error('the first did not open');
    if (!second.ok || second.value.kind !== 'opened') throw new Error('the second did not open');
    expect(second.value.docId).not.toBe(first.value.docId);

    for (const docId of [first.value.docId, second.value.docId]) {
      const executed = await handlers['document.execute']({
        docId,
        command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
      });
      expect(executed.ok).toBe(false);
      if (executed.ok) throw new Error('the command should not have succeeded');
      expect(executed.error.code).toBe('document-poisoned');
    }
  });
});

describe('the Store rating prompt, as the root wires it (E3)', () => {
  it('the STORE build rates through the Store application; every other build opens the web listing', async () => {
    let deepLinks = 0;
    const browsed: string[] = [];
    const rootFor = (installChannel: AppInfo['installChannel']) =>
      createShellDependencies({
        ...harnessSurfaces('the composition test'),
        appInfo: { ...appInfo, installChannel },
        engagementFile: createEphemeralSettings(),
        openStoreReview: () => {
          deepLinks += 1;
          return Promise.resolve(true);
        },
        openInBrowser: (url) => {
          browsed.push(url);
          return Promise.resolve();
        },
      });

    await rootFor('store').handlers['app.review']({ action: 'rate' });
    expect([deepLinks, browsed.length]).toStrictEqual([1, 0]);

    await rootFor('web').handlers['app.review']({ action: 'rate' });
    expect(deepLinks).toBe(1);
    expect(browsed).toStrictEqual(['https://apps.microsoft.com/detail/9NHV3B1PV3XS']);
  });

  it('CONTROL: a root with no engagement record is never due', async () => {
    const deps = createShellDependencies({ ...harnessSurfaces('the composition test'), appInfo });
    expect(await deps.handlers['app.reviewPrompt']({})).toStrictEqual({ ok: true, value: { due: false } });
  });
});

describe('the recent cards’ pictures, as the root wires them (ADR-0100)', () => {
  /** A picture folder in memory, handed in as `entry.ts` hands the real one. */
  function memoryFolder(): PictureFiles & { readonly held: Map<string, Uint8Array> } {
    const held = new Map<string, Uint8Array>();
    return {
      held,
      write: (name, bytes) => held.set(name, bytes),
      read: (name) => (held.has(name) ? new Uint8Array(held.get(name) ?? []) : null),
      remove: (name) => held.delete(name),
      names: () => [...held.keys()],
    };
  }

  it('an entry LEAVING the list takes its picture with it — the store’s listener, registered by the root', async () => {
    // THE JOIN ONLY THIS ROOT MAKES: the recent store says which paths left, and the pictures delete theirs.
    // The handler cases wire the same join in their own harness; this is the one the product runs.
    const folder = memoryFolder();
    const surfaces = harnessSurfaces('the composition test');
    surfaces.recent.record({ path: 'C:/docs/a.pdf', name: 'a.pdf' });
    folder.write(pictureName('C:/docs/a.pdf'), Uint8Array.of(0xff, 0xd8));
    const deps = createShellDependencies({ ...surfaces, appInfo, recentPictureFiles: folder });

    await deps.handlers['document.clearRecent']({});

    expect(folder.held.size).toBe(0);
  });

  it('the Privacy setting, turned off through the channel, empties the folder — the id the root reads is the page’s', async () => {
    const folder = memoryFolder();
    const surfaces = harnessSurfaces('the composition test');
    surfaces.recent.record({ path: 'C:/docs/a.pdf', name: 'a.pdf' });
    folder.write(pictureName('C:/docs/a.pdf'), Uint8Array.of(0xff, 0xd8));
    const deps = createShellDependencies({ ...surfaces, appInfo, recentPictureFiles: folder });

    // CONTROL: a settings write that leaves it on deletes nothing.
    await deps.handlers['settings.save']({ values: { [RECENT_PREVIEWS_SETTING_ID]: true } });
    expect(folder.held.size).toBe(1);

    await deps.handlers['settings.save']({ values: { [RECENT_PREVIEWS_SETTING_ID]: false } });
    expect(folder.held.size).toBe(0);
  });
});
