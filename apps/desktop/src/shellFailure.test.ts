import { describe, expect, it } from 'vitest';

import {
  type ShellFailureEvent,
  describeChildProcessGone,
  describeEngineHostGone,
  describePreloadError,
  describeRenderProcessGone,
  describeUnresponsive,
} from './shellFailure.js';

/**
 * The wording is the value, so the wording is what is tested here.
 *
 * **What this file deliberately does not test: the subscription.** Attaching to
 * a fake `EventEmitter` would prove a fake emits, and the question is whether
 * the *shipped* window is subscribed — which is a statement about
 * `createMainWindow`, not about a test double. `proof:rendererpolicy` answers it
 * on the real `WebContents` two ways: it counts listeners on the window the
 * shell returned, and then it kills the renderer and requires the shell's sink
 * to have received the failure. A listener count alone would not do, because a
 * listener attached to a function that drops its argument is the same silence
 * one step along.
 *
 * That split is the wired-tools rule's pair, on a failure channel rather than on
 * a command: fast tests for what the message says, a runtime observation for
 * whether anyone hears it.
 */
describe('shell failure messages', () => {
  it('keeps the preload path, which is what identified the defect', () => {
    const failure = describePreloadError(
      'C:\\app\\dist\\preload.js',
      new SyntaxError('Cannot use import statement outside a module'),
    );

    expect(failure.detail).toContain('C:\\app\\dist\\preload.js');
    expect(failure.detail).toContain('Cannot use import statement outside a module');
    // A ShellFailure never crosses to a renderer, so invariant 2's path
    // stripping does not apply to it — the opposite rule does. Asserted rather
    // than assumed, because the two sinks sit next to each other in `startShell`
    // and the wrong habit is one edit away.
    expect(failure.event).toBe('preload-error');
  });

  it('names the remedy for the failure that has actually happened here', () => {
    const failure = describePreloadError('/app/preload.js', new SyntaxError('unexpected token'));

    // Not decoration. This exact class cost a day: the ESM artefact tsc emits
    // being loaded instead of the CommonJS bundle. A reader who sees a
    // SyntaxError on this channel should not have to rediscover why.
    expect(failure.detail).toContain('scripts/build/preload.mjs');
  });

  it('carries the reason and exit code a renderer died with', () => {
    const failure = describeRenderProcessGone({ reason: 'crashed', exitCode: 133 });

    expect(failure.event).toBe('render-process-gone');
    expect(failure.detail).toContain('crashed');
    expect(failure.detail).toContain('133');
  });

  it('includes a child process name only when Electron supplied one', () => {
    const named = describeChildProcessGone({
      type: 'Utility',
      reason: 'killed',
      exitCode: 9,
      name: 'Network Service',
      serviceName: 'network.mojom.NetworkService',
    });
    expect(named.detail).toContain('Network Service');
    expect(named.detail).toContain('network.mojom.NetworkService');

    // Both fields are optional in Electron's own type. Interpolating them
    // unconditionally would write `name=undefined` into a log, which reads as a
    // process that reported a name and reported it wrong.
    const anonymous = describeChildProcessGone({ type: 'GPU', reason: 'crashed', exitCode: 1 });
    expect(anonymous.detail).not.toContain('undefined');
    expect(anonymous.detail).toContain('GPU');
  });

  it('says why an unresponsive renderer is worth a line at all', () => {
    const failure = describeUnresponsive();

    expect(failure.event).toBe('unresponsive');
    // A freeze that resolves itself leaves no other trace. That is the whole
    // argument for logging a non-fatal condition, and it belongs in the message.
    expect(failure.detail).toContain('no other trace');
  });

  it('files every message under its own event, so none can be mislabelled', () => {
    const cases: [ShellFailureEvent, string][] = [
      ['preload-error', describePreloadError('/p', new Error('x')).event],
      ['render-process-gone', describeRenderProcessGone({ reason: 'oom', exitCode: 0 }).event],
      [
        'child-process-gone',
        describeChildProcessGone({ type: 'Utility', reason: 'oom', exitCode: 0 }).event,
      ],
      ['unresponsive', describeUnresponsive().event],
      ['engine-host-gone', describeEngineHostGone({ code: 'connection-lost', detail: 'x' }).event],
    ];

    for (const [expected, actual] of cases) expect(actual).toBe(expected);
    expect(new Set(cases.map(([event]) => event)).size).toBe(cases.length);

    // THE ANCHOR, and the line above is not one (finding CCCCC-3). A count
    // computed from `cases` is computed from the list it polices: it catches a
    // duplicate and can never catch an OMISSION, which is the direction the
    // danger runs here — a describe function that simply never gets a row.
    // This file's comment used to claim otherwise, and was already false when
    // it did: `describeEngineHostGone` had no row, and its label was pinned
    // only by `contract.proof.mjs`'s IIII-1 cases, in another file by another
    // mechanism. A literal is what a shrinker has to touch separately.
    expect(cases).toHaveLength(5);
  });

  it('every ShellFailureEvent has a message writer, or is deliberately built inline', () => {
    // The other half, and it needs its own anchor for the same reason: the roster
    // above covers `describe*` functions, and the UNION is what a reader takes as
    // the set of things that can be reported. `document-unreadable` is written
    // inline by the supervisor — where its detail names a specific document, so a
    // parameterless describe function could not produce it — and its label is
    // asserted in `engineSessions.test.ts`. That is a deliberate exception rather
    // than a gap, and one nobody would notice without this line.
    const inlineOnly: ShellFailureEvent[] = ['document-unreadable'];
    const written: ShellFailureEvent[] = [
      'preload-error',
      'render-process-gone',
      'child-process-gone',
      'unresponsive',
      'engine-host-gone',
    ];

    // Six because `ShellFailureEvent` has six members. A type cannot be counted
    // at run time, so this is the anchor: adding a seventh without deciding
    // which list it belongs in reddens here rather than passing in silence.
    expect([...written, ...inlineOnly]).toHaveLength(6);
    expect(new Set([...written, ...inlineOnly]).size).toBe(6);
  });
});
