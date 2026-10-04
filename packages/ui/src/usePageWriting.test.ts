// @vitest-environment happy-dom
import { asDocId } from '@monstera/shared';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WRITE_TEXT_BOX_LABEL } from './messages/en.js';
import type { WriteRequest } from './pageWriting.js';
import { usePageWriting } from './usePageWriting.js';

/**
 * The window's one request for words on a page (ADR-0154 Decision 2 and its correction to it): whose document it
 * belongs to, what finishes it, and what a closed document does to it. The editor's cases see a request drawn; these
 * see the request's life, which no editor holds.
 */

const FIRST = asDocId('00000000-0000-4000-8000-0000000000a1');
const SECOND = asDocId('00000000-0000-4000-8000-0000000000a2');

const BLOCK: WriteRequest = {
  page: 0,
  box: { x0: 10, y0: 20, x1: 110, y1: 60 },
  shape: 'block',
  initial: '',
  label: WRITE_TEXT_BOX_LABEL,
};

/** The hook with the first document on show, or with `active` — `null` for none, since `undefined` would be a default. */
function hosted(active: typeof FIRST | null = FIRST) {
  return renderHook(({ active: shown, open }) => usePageWriting(shown, open), {
    initialProps: {
      active: active ?? undefined,
      open: [{ docId: FIRST }, { docId: SECOND }] as readonly { readonly docId: typeof FIRST }[],
    },
  });
}

/** Whether a promise has settled yet, and with what. */
function watch(promise: Promise<string | undefined>): { settled: boolean; value: string | undefined } {
  const seen: { settled: boolean; value: string | undefined } = { settled: false, value: undefined };
  void promise.then((value) => {
    seen.settled = true;
    seen.value = value;
  });
  return seen;
}

describe('usePageWriting', () => {
  it('a request BELONGS TO THE DOCUMENT ON SHOW, is drawn as asked, and answers with the words it finished with', async () => {
    const { result } = hosted();
    let answer!: Promise<string | undefined>;
    act(() => {
      answer = result.current.write(BLOCK);
    });
    expect(result.current.writingDocId).toBe(FIRST);
    expect(result.current.writing?.request).toBe(BLOCK);
    act(() => {
      result.current.writing?.onDone('see figure 3');
    });
    expect(await answer).toBe('see figure 3');
    expect(result.current.writing).toBeUndefined();
  });

  it('answers NOTHING with no document on show, and draws nothing', async () => {
    const { result } = hosted(null);
    let answer!: Promise<string | undefined>;
    act(() => {
      answer = result.current.write(BLOCK);
    });
    expect(await answer).toBeUndefined();
    expect(result.current.writing).toBeUndefined();
  });

  it('a SECOND REQUEST finishes the first with the words typed so far, and is the one drawn', async () => {
    const { result } = hosted();
    let first!: Promise<string | undefined>;
    act(() => {
      first = result.current.write(BLOCK);
    });
    const firstId = result.current.writing?.id;
    result.current.writing?.draft.keep('half a sentence');
    act(() => {
      void result.current.write({ ...BLOCK, page: 2 });
    });
    expect(await first).toBe('half a sentence');
    expect(result.current.writing?.request.page).toBe(2);
    // A NEW EDITOR for the new request, never the first one's.
    expect(result.current.writing?.id).not.toBe(firstId);
  });

  it('CONTROL: a first request left BLANK answers nothing when replaced — the draft is what decides', async () => {
    const { result } = hosted();
    let first!: Promise<string | undefined>;
    act(() => {
      first = result.current.write(BLOCK);
    });
    act(() => {
      void result.current.write(BLOCK);
    });
    expect(await first).toBeUndefined();
  });

  it('the REPLACED request finishing late does not take the new one off the page', () => {
    const { result } = hosted();
    act(() => {
      void result.current.write(BLOCK);
    });
    const stale = result.current.writing;
    act(() => {
      void result.current.write({ ...BLOCK, page: 2 });
    });
    act(() => {
      stale?.onDone('too late');
    });
    expect(result.current.writing?.request.page).toBe(2);
  });

  it('ANOTHER DOCUMENT ON SHOW leaves the request waiting with its document, unanswered', async () => {
    const { result, rerender } = hosted();
    let answer!: Promise<string | undefined>;
    act(() => {
      answer = result.current.write(BLOCK);
    });
    const seen = watch(answer);
    rerender({ active: SECOND, open: [{ docId: FIRST }, { docId: SECOND }] });
    await Promise.resolve();
    expect(seen.settled).toBe(false);
    // STILL THE FIRST DOCUMENT'S: the application draws it only while that one is on show.
    expect(result.current.writingDocId).toBe(FIRST);
  });

  it('a CLOSED DOCUMENT’S request answers nothing at once, without waiting for another request', async () => {
    const { result, rerender } = hosted();
    let answer!: Promise<string | undefined>;
    act(() => {
      answer = result.current.write(BLOCK);
    });
    result.current.writing?.draft.keep('never sent');
    const seen = watch(answer);
    act(() => {
      rerender({ active: SECOND, open: [{ docId: SECOND }] });
    });
    await Promise.resolve();
    expect(seen).toStrictEqual({ settled: true, value: undefined });
  });
});
