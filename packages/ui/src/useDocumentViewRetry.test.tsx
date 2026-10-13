// @vitest-environment happy-dom
import { channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NO_KEYS } from './documentKeys.js';
import { useDocumentView } from './useDocumentView.js';

/**
 * *Try again* on a page area that could not be drawn (the owner's Part 7 B).
 *
 * A tab whose range main refused used to wait for ever on *Opening the document…*; it now fails, says why, and offers
 * Try again. This file holds the hook's half: a retry is one more open of the same version, and a view that opens on it
 * replaces the failure. What it asserts is the OPEN CALLS, because *ready* is also what a hook that never failed would
 * produce.
 */

const opens: { readonly version: number }[] = [];
/** How each open answers, in order: `fail` rejects as a parse that threw, `open` resolves with a view. */
const answers: ('fail' | 'open')[] = [];

vi.mock('./documentView.js', () => ({
  openDocumentView: (options: { readonly version: number }) => {
    opens.push({ version: options.version });
    return answers.shift() === 'open'
      ? Promise.resolve({ document: { numPages: 1 }, version: options.version, close: () => Promise.resolve() })
      : Promise.reject(new Error('the parse threw'));
  },
  needsPasswordToParse: () => false,
}));

const DOC = { docId: asDocId('doc-retry'), version: asDocVersion(3), byteLength: 1024 };
const client = createClient(channels, () => Promise.reject(new Error('this fixture answers nothing')));
const ignoreVersion = (): void => undefined;
const noPassword = (): Promise<undefined> => Promise.resolve(undefined);

describe('useDocumentView — Try again after a failure', () => {
  it('a failed open is retried once per Try again, at the same version, and the view it opens replaces the failure', async () => {
    opens.length = 0;
    answers.splice(0, answers.length, 'fail', 'open');
    const { result } = renderHook(() => useDocumentView(client, DOC, ignoreVersion, noPassword, NO_KEYS));

    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });
    // CONTROL: one open, and nothing retries by itself.
    expect(opens).toStrictEqual([{ version: 3 }]);
    expect(result.current.ready).toBeUndefined();

    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(result.current.ready).toBeDefined();
    });
    expect(result.current.failed).toBe(false);
    expect(opens).toStrictEqual([{ version: 3 }, { version: 3 }]);
  });

  it('a retry that fails again is a failure again, with nothing left opening', async () => {
    opens.length = 0;
    answers.splice(0, answers.length, 'fail', 'fail');
    const { result } = renderHook(() => useDocumentView(client, DOC, ignoreVersion, noPassword, NO_KEYS));
    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(opens).toHaveLength(2);
    });
    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });
    expect(result.current.ready).toBeUndefined();
  });
});
