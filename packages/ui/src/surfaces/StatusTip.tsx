import { useLingui } from '@lingui/react';
import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { STATUS_TIPS_SETTING, TIPS_SHOWN_SETTING } from '../settings/appearance.js';
import type { SettingsStore } from '../settingsStore.js';
import { type Tip, nextTip } from '../tips/tips.js';
import { useSetting } from '../useSetting.js';

/** How long a tip stays before the next (ADR-0159's *"every so often"*): long enough to read twice, not chosen by measure. */
export const TIP_INTERVAL_MS = 40_000;

/**
 * How long the tip's fade takes, READ FROM THE ELEMENT: the stylesheet's transition is the one place the length is
 * written (`--motion-fade`), and under reduced motion it is none, so the next tip follows at once.
 */
function fadeOf(element: HTMLElement | null): number {
  if (element === null) return 0;
  const seconds = Number.parseFloat(getComputedStyle(element).transitionDuration);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

/**
 * The status bar's tip ([ADR-0159](../../../../docs/DECISIONS/0159-a-tip-is-registered-names-its-commands-and-is-shown-in-the-status-bar.md)),
 * while {@link STATUS_TIPS_SETTING} is on. Turning it off unmounts the line, so turning it on again starts afresh.
 */
export function StatusTip({ tips, settings }: { readonly tips: readonly Tip[]; readonly settings: SettingsStore }): ReactElement | null {
  const on = useSetting(settings, STATUS_TIPS_SETTING);
  return on ? <TipLine settings={settings} tips={tips} /> : null;
}

/**
 * One tip at a time: the first as the window opens, the next every {@link TIP_INTERVAL_MS}, each fading out before the
 * next fades in, over the stylesheet's `--motion-fade`.
 *
 * ## The tips are READ when a tip is chosen, never a reason to choose one
 *
 * The registry is rebuilt whenever a selection or the document in front changes, and the tips with it, so a timer
 * restarted by a new list would change the tip at every click. The latest list sits in a ref the timer reads; a
 * rebuild changes which tips the NEXT choice is made from, and the one on show stays its time.
 *
 * ## The round is the setting's, so it carries across sessions
 *
 * Each tip shown is written to {@link TIPS_SHOWN_SETTING} as it is chosen, by {@link nextTip}'s rule, so the next start
 * goes on with the tips this round has not shown rather than beginning again.
 *
 * ## Whole or not at all
 *
 * A tip wider than the room it has is hidden, never cut: the room is the bar's start, after what a tool waits for. The
 * measure is written to the element as `data-fits` rather than held in state, `useOnColor`'s reason: it answers the
 * layout, and the layout is the DOM's. `data-shown`, which the fade keys on, is written there for the same reason: it
 * must turn on after the browser has drawn the new words faded out, which only a reading of the layout can order.
 *
 * ## Not announced
 *
 * The status bar is a live region, and a sentence changing every so often there would be read aloud over a person's
 * work, so the tip is `aria-hidden`.
 */
function TipLine({ tips, settings }: { readonly tips: readonly Tip[]; readonly settings: SettingsStore }): ReactElement {
  const { i18n } = useLingui();
  // A TURN, not the tip alone: every advance faded the line out, so every advance must be a new state for the effect
  // below to fade it in. Holding the tip, an advance that chose the same one was the same state, React kept it, and
  // the line stayed faded out under the same words until the next advance.
  const [turn, setTurn] = useState<{ readonly tip: Tip } | undefined>(undefined);
  const current = turn?.tip;
  const element = useRef<HTMLSpanElement>(null);
  const latest = useRef(tips);

  useLayoutEffect(() => {
    latest.current = tips;
  }, [tips]);

  useEffect(() => {
    const advance = (): void => {
      const round = TIPS_SHOWN_SETTING.schema.safeParse(settings.get(TIPS_SHOWN_SETTING.id));
      const next = nextTip(latest.current, round.success ? round.data : [], Math.random);
      if (next === undefined) return;
      settings.set(TIPS_SHOWN_SETTING.id, next.shown);
      // The words change while the tip is faded out; the layout effect below fades it back in.
      setTurn({ tip: next.tip });
    };
    let fade: ReturnType<typeof setTimeout> | undefined;
    // THE FIRST AS THE WINDOW OPENS, from a timer like every later one, so a tip is chosen and its round written once
    // per change rather than during a render.
    const first = setTimeout(advance, 0);
    const every = setInterval(() => {
      if (element.current !== null) element.current.dataset['shown'] = 'false';
      fade = setTimeout(advance, fadeOf(element.current));
    }, TIP_INTERVAL_MS);
    return (): void => {
      clearTimeout(first);
      clearInterval(every);
      if (fade !== undefined) clearTimeout(fade);
    };
  }, [settings]);

  // FITS, measured whenever the words or the room change, and then FADED IN. The measure reads the layout, which makes
  // the browser compute the faded-out style first, so turning `data-shown` on here is a change the transition sees —
  // the first tip included, which is drawn into a span already on the page at opacity 0.
  useLayoutEffect(() => {
    const span = element.current;
    if (span === null) return;
    const measure = (): void => {
      span.dataset['fits'] = span.scrollWidth > span.clientWidth + 1 ? 'false' : 'true';
    };
    measure();
    if (turn !== undefined) span.dataset['shown'] = 'true';
    const observer = new ResizeObserver(measure);
    observer.observe(span);
    return (): void => {
      observer.disconnect();
    };
  }, [turn]);

  return (
    <span aria-hidden="true" className="m-status-tip" data-tip={current?.id} ref={element}>
      {current === undefined ? null : i18n._(current.words, current.values)}
    </span>
  );
}
