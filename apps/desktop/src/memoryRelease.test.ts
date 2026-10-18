import { describe, expect, it } from 'vitest';

import { type HeldDocuments, type RendererWindow, createMemoryRelease } from './memoryRelease.js';

/**
 * ADR-0252's decision in `main`: a new renderer process only with no document open and one opened since the window last
 * loaded (its correction of 2026-10-18). Each control is the one fact that must refuse, built from a state the rule
 * otherwise releases. That the renewal is a NEW PROCESS is the memory walk's M5, which reads the process id: no case
 * here holds a window.
 */
function window(): RendererWindow & { readonly renewals: () => number; readonly signals: () => number } {
  let renewals = 0;
  let signals = 0;
  return {
    pressure: () => {
      signals += 1;
      return Promise.resolve();
    },
    renew: () => {
      renewals += 1;
      return Promise.resolve();
    },
    renewals: () => renewals,
    signals: () => signals,
  };
}

const NOW = (run: () => void): void => {
  run();
};

describe('a window with no document gives its renderer back', () => {
  it('renews where nothing is open and a document was opened since it loaded, once', () => {
    const shown = window();
    const documents: HeldDocuments = { size: 0, openedSoFar: 3 };
    const release = createMemoryRelease(documents, shown, () => undefined, NOW);
    expect(release.release()).toBe('released');
    expect(shown.renewals()).toBe(1);
    // ONCE: the window just loaded has held nothing yet, so asking again changes nothing.
    expect(release.release()).toBe('nothing-to-release');
    expect(shown.renewals()).toBe(1);
  });

  it('CONTROL: with a document open it answers documents-open and renews nothing', () => {
    const shown = window();
    const release = createMemoryRelease({ size: 1, openedSoFar: 3 }, shown, () => undefined, NOW);
    expect(release.release()).toBe('documents-open');
    expect(shown.renewals()).toBe(0);
  });

  it('CONTROL: a window that has never held a document has nothing to release', () => {
    const shown = window();
    const release = createMemoryRelease({ size: 0, openedSoFar: 0 }, shown, () => undefined, NOW);
    expect(release.release()).toBe('nothing-to-release');
    expect(shown.renewals()).toBe(0);
  });

  it('the renewal runs after the answer, through `later`', () => {
    const shown = window();
    const queued: (() => void)[] = [];
    const release = createMemoryRelease({ size: 0, openedSoFar: 1 }, shown, () => undefined, (run) => queued.push(run));
    expect(release.release()).toBe('released');
    expect(shown.renewals()).toBe(0);
    queued.forEach((run) => {
      run();
    });
    expect(shown.renewals()).toBe(1);
  });

  it('a renewal that fails is told, not thrown', async () => {
    const told: string[] = [];
    const failing: RendererWindow = { pressure: () => Promise.resolve(), renew: () => Promise.reject(new Error('the page did not load')) };
    expect(createMemoryRelease({ size: 0, openedSoFar: 1 }, failing, (detail) => told.push(detail), NOW).release()).toBe('released');
    await Promise.resolve();
    await Promise.resolve();
    expect(told).toStrictEqual(['the window was not given a new renderer: the page did not load']);
  });

  it('the last close sends the signal, and a signal that cannot be sent is told, not thrown', async () => {
    const shown = window();
    const told: string[] = [];
    createMemoryRelease({ size: 0, openedSoFar: 1 }, shown, (detail) => told.push(detail), NOW).lastClosed();
    expect(shown.signals()).toBe(1);
    const refusing: RendererWindow = {
      pressure: () => Promise.reject(new Error('DevTools is attached')),
      renew: () => Promise.resolve(),
    };
    createMemoryRelease({ size: 0, openedSoFar: 1 }, refusing, (detail) => told.push(detail), NOW).lastClosed();
    await Promise.resolve();
    await Promise.resolve();
    expect(told).toStrictEqual(['the memory-pressure signal was not sent: DevTools is attached']);
  });
});
