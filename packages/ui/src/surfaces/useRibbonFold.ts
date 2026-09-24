import { useCallback, useEffect, useRef, useState } from 'react';

import { foldGroups, type GroupFold, type GroupWidths } from './ribbonFolding.js';
import type { RibbonSection } from './projections.js';

/**
 * Measures the ribbon's tools row and answers how many buttons each group draws.
 *
 * ## The measurement is of the UNFOLDED row, once per section, and is then cached
 *
 * A fold changes the widths on screen, so measuring what is rendered after folding would feed the
 * fold its own output: one narrow frame would hide a button, which frees space, which shows it
 * again. The natural width of a button is a property of its label and the font, not of the window,
 * so it is measured while the row is unfolded and kept by command id. Every later answer is
 * arithmetic over those numbers and the row's current width.
 *
 * That is why the first paint of a section is unfolded: there is nothing else to measure from, and
 * a hidden measuring copy of the ribbon would be a second ribbon in the accessibility tree.
 *
 * ## The section must be a STABLE VALUE, and `Ribbon` memoises it for this
 *
 * The projection is recomputed on every render, so an effect depending on the model's object
 * identity re-runs for ever: it measures, sets state, the render builds another object, it runs
 * again. That is not a subtlety to be careful about — it put the ribbon behind the error boundary
 * the first time this was wired, with *Part of this window stopped working* on screen. `Ribbon`
 * memoises `ribbonModel(...)`, so the identity here changes only when the commands do.
 *
 * ## Nothing is measured synchronously in an effect
 *
 * The `ResizeObserver` delivers a first observation as soon as it observes, so the initial
 * measurement arrives through the same callback every later one does. An effect body that measured
 * and set state would be a cascading render, and there would then be two paths into the same state
 * with different timing.
 */
export interface RibbonFold {
  /** Attach to the element whose width the groups must fit inside. */
  readonly rowRef: (element: HTMLDivElement | null) => void;
  /** Attach to each group, in the order the model gives them. */
  readonly groupRef: (index: number) => (element: HTMLDivElement | null) => void;
  /** What each group draws, or `null` before this section has been measured. */
  readonly folds: readonly GroupFold[] | null;
}

/** A measurement, and the row it was taken of. */
interface Measured {
  readonly section: RibbonSection | undefined;
  readonly folds: readonly GroupFold[];
}

export function useRibbonFold(section: RibbonSection | undefined): RibbonFold {
  const [measured, setMeasured] = useState<Measured | null>(null);
  const row = useRef<HTMLDivElement | null>(null);
  const groups = useRef<(HTMLDivElement | null)[]>([]);
  /** Each button's natural width by command id, so a folded-away button still has one. */
  const naturals = useRef<Map<string, number>>(new Map());

  const measure = useCallback((): void => {
    const container = row.current;
    if (container === null || section === undefined) return;

    // EVERY BUTTON THIS ROW CAN SHOW, whether or not it is on screen now: a width already measured
    // is kept, and one that is not measurable yet leaves the row unmeasured rather than counted as
    // zero — which would say everything fits.
    // WHICH BUTTONS HAVE NO WIDTH YET, as a set rather than a flag: a boolean assigned inside the
    // map below is narrowed to its initial value by the compiler, so the guard after it would be
    // dead code that reads as a check.
    const unmeasured = new Set<string>();
    const widths: GroupWidths[] = section.groups.map((group, index) => {
      const element = groups.current[index] ?? null;
      const chrome = element === null ? 0 : element.getBoundingClientRect().width - buttonsWidth(element);
      // PRIMARIES ONLY: a secondary is never drawn in the row, so it has no width to fold by, and
      // what it costs is the *More* its group then always draws (ADR-0098).
      const primaries = group.entries.filter((entry) => !entry.secondary);
      const buttons = primaries.map((entry) => {
        const drawn = element?.querySelector<HTMLElement>(`[data-command="${CSS.escape(entry.command.id)}"]`);
        const width = drawn?.getBoundingClientRect().width ?? 0;
        if (width > 0) naturals.current.set(entry.command.id, width);
        const known = naturals.current.get(entry.command.id);
        if (known === undefined) unmeasured.add(entry.command.id);
        return known ?? 0;
      });
      return {
        buttons,
        chrome: Math.max(chrome, 0),
        gap: buttonGap(element),
        secondaries: group.entries.length - primaries.length,
      };
    });
    if (unmeasured.size > 0) return;

    // THE GAUGE, which is always drawn (`RibbonMoreGauge`), so a More's width is known before any
    // group has folded. Absent or unlaid-out means the row is not ready, which is the same answer
    // as an unmeasured button: fold nothing yet rather than fold against a guess.
    const more = container.querySelector<HTMLElement>('.m-ribbon__more-gauge')?.getBoundingClientRect().width ?? 0;
    if (more <= 0) return;
    const folds = foldGroups(widths, availableIn(container, widths.length), more);

    // AN EQUAL ANSWER MUST NOT RE-RENDER. The fold is a pure function of the widths and the row, so
    // a measurement that agrees with the last one has nothing to say, and setting a fresh array
    // anyway would make the observer its own trigger.
    setMeasured((previous) =>
      previous !== null && previous.section === section && same(previous.folds, folds) ? previous : { section, folds },
    );
  }, [section]);

  useEffect(() => {
    const container = row.current;
    if (container === null || typeof ResizeObserver === 'undefined') return undefined;
    // A DIFFERENT ROW HAS NEVER BEEN MEASURED. Its buttons carry other labels, so their widths and
    // the width of a *More* beside them are somebody else's numbers.
    naturals.current = new Map();
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(container);
    return (): void => {
      observer.disconnect();
    };
  }, [measure]);

  const rowRef = useCallback((element: HTMLDivElement | null): void => {
    row.current = element;
  }, []);

  const groupRef = useCallback(
    (index: number) =>
      (element: HTMLDivElement | null): void => {
        groups.current[index] = element;
      },
    [],
  );

  // DERIVED, NEVER RESET. A measurement of a different row is not this row's answer, and comparing
  // here means no effect has to set state back to `null` when the section changes — which is the
  // cascading render the pattern above avoids on the other side.
  const folds = measured !== null && measured.section === section ? measured.folds : null;

  return { rowRef, groupRef, folds };
}

/** Whether two answers say the same thing, so an unchanged measurement renders nothing. */
function same(left: readonly GroupFold[], right: readonly GroupFold[]): boolean {
  if (left.length !== right.length) return false;
  // `at`, so the pair is a value both the compiler and the lint rule agree can be absent — an index
  // read is narrowed differently by each and neither spelling satisfies both.
  return left.every((entry, index) => {
    const other = right.at(index);
    return other?.shown === entry.shown && other.more === entry.more;
  });
}

/**
 * The width the groups may actually occupy inside `row`.
 *
 * **Two things the row's own box is not**: its border box includes the padding the groups sit
 * inside, and the flex gaps between groups are space no group is charged for. Measuring the border
 * box alone over-states the room by exactly padding + gaps — 57 px on the shipped ribbon at six
 * groups, measured 2026-09-23 — and the fold then stops one button early on every group and leaves
 * the row scrolling sideways, which is the one thing the design forbids.
 *
 * Read from the computed style rather than restated here: `app.css` owns those numbers, and a copy
 * would be right until somebody changed the padding (B3).
 */
function availableIn(row: HTMLElement, groups: number): number {
  const style = getComputedStyle(row);
  const gap = Number.parseFloat(style.columnGap) || 0;
  const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  return row.getBoundingClientRect().width - padding - gap * Math.max(groups - 1, 0);
}

/** The gap between a group's buttons, from the computed style `app.css` owns rather than a copy. */
function buttonGap(group: HTMLElement | null): number {
  const buttons = group?.querySelector<HTMLElement>('.m-ribbon__buttons') ?? null;
  return buttons === null ? 0 : Number.parseFloat(getComputedStyle(buttons).columnGap) || 0;
}

/** The buttons row inside a group, so the rest of the group's width is its chrome and caption. */
function buttonsWidth(group: HTMLElement): number {
  const buttons = group.querySelector<HTMLElement>('.m-ribbon__buttons');
  return buttons === null ? 0 : buttons.getBoundingClientRect().width;
}
