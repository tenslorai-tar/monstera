import { useCallback, useEffect, useRef, useState } from 'react';

import { foldRow, ribbonUnits, type GroupFold, type GroupWidths } from './ribbonFolding.js';
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
  /**
   * The first group folded WHOLE into the row's own *More* (`foldRow`); the group count when none is, and when the
   * section has not been measured.
   */
  readonly hiddenFrom: number;
}

/** A measurement, and the row it was taken of. */
interface Measured {
  readonly section: RibbonSection | undefined;
  readonly folds: readonly GroupFold[];
  readonly hiddenFrom: number;
}

/**
 * A group's measured frame: what it costs besides its buttons, and the gap between them. Kept by the group's
 * caption key, so a group folded whole into the row's *More* — and so not drawn — still has the numbers it was
 * measured with while it was.
 */
interface GroupFrame {
  readonly chrome: number;
  readonly gap: number;
}

export function useRibbonFold(section: RibbonSection | undefined): RibbonFold {
  const [measured, setMeasured] = useState<Measured | null>(null);
  const row = useRef<HTMLDivElement | null>(null);
  const groups = useRef<(HTMLDivElement | null)[]>([]);
  /** Each button's natural width by command id, so a folded-away button still has one. */
  const naturals = useRef<Map<string, number>>(new Map());
  /** Each group's frame by caption key, so a group hidden in the row's More still has one. */
  const frames = useRef<Map<string, GroupFrame>>(new Map());

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
      // A DRAWN GROUP IS MEASURED, and its frame kept; one folded whole into the row's More is not drawn and takes
      // the frame it was last measured with. Never measured is unmeasured, for a button's reason below.
      if (element !== null) {
        frames.current.set(group.group, {
          chrome: Math.max(element.getBoundingClientRect().width - buttonsWidth(element), 0),
          gap: buttonGap(element),
        });
      }
      const frame = frames.current.get(group.group);
      if (frame === undefined) unmeasured.add(group.group);
      // THE ROW'S BUTTONS, from the one function that defines them: primaries only, a named menu as
      // one (ADR-0098, ADR-0101). A secondary is never drawn in the row, so it has no width to fold
      // by, and what it costs is the *More* its group then always draws.
      const units = ribbonUnits(group.entries);
      const primaries = group.entries.filter((entry) => !entry.secondary);
      const buttons = units.map((unit) => {
        const drawn = element?.querySelector<HTMLElement>(`[data-command="${CSS.escape(unit.key)}"]`);
        const width = drawn?.getBoundingClientRect().width ?? 0;
        if (width > 0) naturals.current.set(unit.key, width);
        const known = naturals.current.get(unit.key);
        if (known === undefined) unmeasured.add(unit.key);
        return known ?? 0;
      });
      return {
        buttons,
        chrome: frame?.chrome ?? 0,
        gap: frame?.gap ?? 0,
        secondaries: group.entries.length - primaries.length,
      };
    });
    if (unmeasured.size > 0) return;

    // THE GAUGE, which is always drawn (`RibbonMoreGauge`), so a More's width is known before any
    // group has folded. Absent or unlaid-out means the row is not ready, which is the same answer
    // as an unmeasured button: fold nothing yet rather than fold against a guess.
    const more = container.querySelector<HTMLElement>('.m-ribbon__more-gauge')?.getBoundingClientRect().width ?? 0;
    if (more <= 0) return;
    const { groups: folds, hiddenFrom } = foldRow(widths, innerWidthOf(container), more, rowGapOf(container));

    // AN EQUAL ANSWER MUST NOT RE-RENDER. The fold is a pure function of the widths and the row, so
    // a measurement that agrees with the last one has nothing to say, and setting a fresh array
    // anyway would make the observer its own trigger.
    setMeasured((previous) =>
      previous !== null &&
      previous.section === section &&
      previous.hiddenFrom === hiddenFrom &&
      same(previous.folds, folds)
        ? previous
        : { section, folds, hiddenFrom },
    );
  }, [section]);

  useEffect(() => {
    const container = row.current;
    if (container === null || typeof ResizeObserver === 'undefined') return undefined;
    // A DIFFERENT ROW HAS NEVER BEEN MEASURED. Its buttons carry other labels, so their widths and
    // the width of a *More* beside them are somebody else's numbers.
    naturals.current = new Map();
    frames.current = new Map();
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
  const current = measured !== null && measured.section === section ? measured : null;

  return {
    rowRef,
    groupRef,
    folds: current?.folds ?? null,
    hiddenFrom: current?.hiddenFrom ?? section?.groups.length ?? 0,
  };
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
 * The width the row's items may occupy inside `row`: its CONTENT box — its box less its padding and its border.
 *
 * **The border was missing until 2026-09-29.** v5 draws the ribbon with a 1 px border on every side
 * (`app.css`), so a row whose groups summed to within 2 px of its padding box fitted the fold's arithmetic and
 * scrolled sideways on screen, by exactly 2 px. Measured on the failing case: box 972, padding 16, groups 955.97 —
 * room 956 by the old rule, 954 in fact. It surfaced only where some font's widths happened to land in that 2 px,
 * which is why CI's Linux fonts found it and this machine's did not until a sweep under other fonts reproduced it
 * at seven widths.
 *
 * **Two things the row's own box is not**: its border box includes the padding the groups sit
 * inside, and the flex gaps between items are space no group is charged for. Measuring the border
 * box alone over-states the room by exactly padding + gaps — 57 px on the shipped ribbon at six
 * groups, measured 2026-09-23 — and the fold then stops one button early on every group and leaves
 * the row scrolling sideways, which is the one thing the design forbids. The padding comes off here;
 * the gaps are `foldRow`'s to charge, because how many there are depends on how many groups it draws.
 *
 * Read from the computed style rather than restated here: `app.css` owns those numbers, and a copy
 * would be right until somebody changed the padding (B3).
 */
export function innerWidthOf(row: HTMLElement): number {
  const style = getComputedStyle(row);
  const sides = (left: string, right: string): number => (Number.parseFloat(left) || 0) + (Number.parseFloat(right) || 0);
  return (
    row.getBoundingClientRect().width -
    sides(style.paddingLeft, style.paddingRight) -
    sides(style.borderLeftWidth, style.borderRightWidth)
  );
}

/** The gap between two items in the row, from the computed style `app.css` owns. */
function rowGapOf(row: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(row).columnGap) || 0;
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
