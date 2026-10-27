import type { DocVersion } from '@monstera/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The pages on screen once the scroll has paused on them: what a page's reads are asked for (the owner's smooth
 * scrolling, after ADR-0271's Milestone 1: no frame over 50 ms).
 *
 * ## Why the reads wait
 *
 * A page's text, links and form fields are read the moment it is on screen (`usePageText`, `usePageLinks`,
 * `usePageFormFields`), and each answer that lands is a render of the whole page list. During a scroll the visible set
 * changes every few frames, so a long scroll started a read for every page it passed and took their answers in the
 * middle of drawing the next ones, on the frames that most need to be short. Nearly nothing of the three is seen while
 * scrolling past: the text is what a press selects, the links what a press follows, the fields what a press fills. The
 * one thing seen is the text read's answer that a page is a picture, which draws the page's note offering recognition;
 * it now appears a moment after the scroll stops on the page rather than as the page arrives. So the reads are asked for
 * the pages the scroll stopped on, a moment after it stopped.
 *
 * ## What "paused" is
 *
 * The set has stayed the same for {@link SETTLE_MS}. A wheel or a dragged scroll bar changes it every frame or two
 * while it moves, so a pause that long is a scroll that stopped, and the reads of the pages it stopped on start then,
 * which is before a hand has moved to press on them. The first set a list shows settles at once: a document opens with
 * its text and links as it always did.
 *
 * ## Keyed by a string
 *
 * `usePageText`'s reason: a `ReadonlySet` is a new object on every render, so the pause is measured against the
 * pages it names, and the set handed back keeps its identity while they are the same.
 */

/** How long the pages on screen must stay the same before their reads are asked for: a scroll that has stopped. */
export const SETTLE_MS = 150;

const NONE: ReadonlySet<number> = new Set();

export function useSettledPages(pages: ReadonlySet<number>, settleMs = SETTLE_MS): { readonly pages: ReadonlySet<number>; readonly paused: boolean } {
  const key = [...pages].sort((a, b) => a - b).join(',');
  const [settled, setSettled] = useState<{ readonly key: string; readonly pages: ReadonlySet<number> } | undefined>(undefined);
  // THE PAGES THE KEY NAMES, read by the timer when it fires: the effect keys on the string, so a render with the same
  // pages does not re-arm it.
  const latest = useRef(pages);
  useLayoutEffect(() => {
    latest.current = pages;
  }, [pages]);
  // AT ONCE while nothing has settled, or what settled was no page: a list laid out before it has measured a page
  // reports none first, and its first page then waits for nothing.
  const first = settled === undefined || settled.key === '';
  useEffect(() => {
    if (settled?.key === key) return;
    const timer = setTimeout(
      () => {
        setSettled({ key, pages: latest.current });
      },
      first ? 0 : settleMs,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [first, key, settleMs, settled?.key]);
  // PAUSED while what settled is what is shown: no scroll is moving the set.
  return { pages: settled?.pages ?? NONE, paused: settled?.key === key };
}

/**
 * Whether a page's editing layer may read the page at `version`: from the first moment no scroll is moving
 * ({@link useSettledPages}), and from then on at that version, wherever the scroll goes.
 *
 * On a pause EVERY mounted page reads, the ones just past the window's edge as well, so the page a person scrolls to
 * next has its outlines when it arrives; while a scroll moves, none starts. The layer itself is mounted while the page
 * is, so what a person has open on it stays open; only its READ waits. Held once asked, because a read cut short when
 * the scroll moves on would be asked again at the next pause, for the same answer.
 */
export function useSettledRead(paused: boolean, version: DocVersion): boolean {
  const [asked, setAsked] = useState<{ readonly at: DocVersion } | undefined>(paused ? { at: version } : undefined);
  if (paused && asked?.at !== version) {
    // DERIVED WHILE RENDERING rather than set in an effect, which would read one render late.
    setAsked({ at: version });
    return true;
  }
  return asked?.at === version;
}
