// @vitest-environment happy-dom
import { channels, createClient } from '@monstera/contract';
import { type DocVersion, asDocId, asDocVersion } from '@monstera/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentView } from './useDocumentView.js';

/**
 * A new version REPLACES the shown view and never empties it first.
 *
 * Every command moves the version, and the hook used to clear the shown view in its cleanup and
 * then open the next, so the page area rendered empty for the whole of every reparse. What these
 * cases assert is the DECISION, not the end state: both the old hook and this one end on the new
 * view, so the separating observations are what `ready` holds while the next view is still opening,
 * and when the old one is closed.
 */

interface StubView {
  readonly version: DocVersion;
  readonly document: { readonly numPages: number };
  readonly closed: () => boolean;
  close: () => Promise<void>;
}

/** One open per version, each resolved by the case. */
const pending = new Map<number, (view: StubView) => void>();
const made: StubView[] = [];

vi.mock('./documentView.js', () => ({
  openDocumentView: (options: { readonly version: DocVersion }) =>
    new Promise<StubView>((resolve) => {
      pending.set(Number(options.version), resolve);
    }),
  needsPasswordToParse: () => false,
}));

function viewAt(version: number): StubView {
  let closed = false;
  const view: StubView = {
    version: asDocVersion(version),
    document: { numPages: 1 },
    closed: () => closed,
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  };
  made.push(view);
  return view;
}

/** Resolves the open for `version` with a fresh view and returns it. */
async function finishOpen(version: number): Promise<StubView> {
  await waitFor(() => {
    expect(pending.has(version)).toBe(true);
  });
  const view = viewAt(version);
  await act(async () => {
    pending.get(version)?.(view);
    pending.delete(version);
    await Promise.resolve();
  });
  return view;
}

const client = createClient(channels, () => Promise.reject(new Error('no channel is called by these cases')));
const DOC = asDocId('doc-swapped');
const moved = (): void => undefined;
const noPassword = (): Promise<undefined> => Promise.resolve(undefined);

function mount(): ReturnType<typeof renderHook<ReturnType<typeof useDocumentView>, { version: number }>> {
  return renderHook(
    ({ version }: { version: number }) =>
      useDocumentView(client, { docId: DOC, version: asDocVersion(version), byteLength: 100 }, moved, noPassword),
    { initialProps: { version: 1 } },
  );
}

beforeEach(() => {
  pending.clear();
  made.length = 0;
});

describe('useDocumentView — a new version', () => {
  it('KEEPS the shown view while the next one opens, and does not close it yet', async () => {
    const hook = mount();
    const first = await finishOpen(1);
    expect(hook.result.current.ready).toBe(first);

    hook.rerender({ version: 2 });
    await waitFor(() => {
      expect(pending.has(2)).toBe(true);
    });

    // THE SEPARATOR: the old hook answered `undefined` here, which is the blank page area.
    expect(hook.result.current.ready).toBe(first);
    expect(first.closed()).toBe(false);
  });

  it('swaps to the next view once it has opened, and only THEN closes the old one', async () => {
    const hook = mount();
    const first = await finishOpen(1);
    hook.rerender({ version: 2 });
    const second = await finishOpen(2);

    expect(hook.result.current.ready).toBe(second);
    await waitFor(() => {
      expect(first.closed()).toBe(true);
    });
    expect(second.closed()).toBe(false);
  });

  it('closes a view that opened after its version was superseded, and never shows it', async () => {
    const hook = mount();
    const first = await finishOpen(1);
    hook.rerender({ version: 2 });
    await waitFor(() => {
      expect(pending.has(2)).toBe(true);
    });
    hook.rerender({ version: 3 });
    const late = await finishOpen(2);

    await waitFor(() => {
      expect(late.closed()).toBe(true);
    });
    expect(hook.result.current.ready).toBe(first);

    const third = await finishOpen(3);
    expect(hook.result.current.ready).toBe(third);
  });

  it('closes the shown view on unmount', async () => {
    const hook = mount();
    const first = await finishOpen(1);

    hook.unmount();

    await waitFor(() => {
      expect(first.closed()).toBe(true);
    });
  });
});
