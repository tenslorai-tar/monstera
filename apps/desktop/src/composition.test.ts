import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { asDocId } from '@monstera/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { createShellDependencies } from './composition.js';
import { harnessSurfaces } from './harnessComposition.js';
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
const appInfo: AppInfo = { version: '0.0.0', installChannel: 'development' };

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
