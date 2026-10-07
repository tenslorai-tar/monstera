import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { foldRow, ribbonUnits, type GroupFold, type GroupWidths, type RowFold } from './ribbonFolding.js';
import type { RibbonSection } from './projections.js';

/**
 * Measures the ribbon's tools row and answers how many buttons each group draws.
 *
 * ## The measurements are KEPT, and the fold is DERIVED from them in render
 *
 * A fold changes the widths on screen, so measuring what is rendered after folding would feed the
 * fold its own output: one narrow frame would hide a button, which frees space, which shows it
 * again. The natural width of a button is a property of its label and the font, not of the window,
 * so it is measured while the button is drawn and kept by command id; a group's frame is kept by its
 * caption key. The row's room, the *More*'s width and the gap are read from the row. The fold is
 * then arithmetic over those numbers, computed while rendering.
 *
 * ## A NEW SECTION OBJECT IS NOT A NEW ROW, and treating it as one made the Comment ribbon flicker
 *
 * Until 2026-10-01 the answer was keyed on the section's IDENTITY, and the measured widths were
 * thrown away whenever it changed. The shell's command context depends on the text selection, so
 * every change of selection built new section objects with the same buttons: the row was drawn
 * unfolded for a frame, measured overflowing, and folded again. On a section that does not fit
 * unfolded — Comment, at the owner's width — that is a row alternating between 6 tools and 13 for as
 * long as text is selected (the owner's review of 0.1.6.0). Sections that fit unfolded look the same
 * either way, which is why only Comment showed it.
 *
 * Now nothing is keyed on identity. Two sections with the same buttons fold the same in the same
 * render, because the widths they are folded from are the same kept numbers. A row is drawn unfolded
 * only while some button it can show has never been drawn, which is a section's first appearance:
 * there is nothing else to measure from, and a hidden measuring copy of the ribbon would be a second
 * ribbon in the accessibility tree.
 *
 * ## When it measures
 *
 * On every resize of the row or of one of its groups (one `ResizeObserver`, whose first observation is
 * the first reading), and after a render that drew a button with no width yet. The groups are watched
 * because the row's box does not change when its content outgrows it.
 */
export interface RibbonFold {
  /** Attach to the element whose width the groups must fit inside. */
  readonly rowRef: (element: HTMLDivElement | null) => void;
  /** Attach to each group, in the order the model gives them. */
  readonly groupRef: (index: number) => (element: HTMLDivElement | null) => void;
  /** What each group draws, or `null` while a button this section can show has never been measured. */
  readonly folds: readonly GroupFold[] | null;
  /**
   * The first group folded WHOLE into the row's own *More* (`foldRow`); the group count when none is, and when the
   * section has not been measured.
   */
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

/** Everything a fold is computed from: what was measured, kept across renders. */
interface Metrics {
  /** Each button's natural width by command id, so a folded-away button still has one. */
  readonly naturals: ReadonlyMap<string, number>;
  /** Each group's frame by caption key, so a group hidden in the row's More still has one. */
  readonly frames: ReadonlyMap<string, GroupFrame>;
  /** The row's content box (`innerWidthOf`). */
  readonly room: number;
  /** The *More*'s width, read off the gauge that is always drawn. */
  readonly more: number;
  /** The gap between two items in the row. */
  readonly gap: number;
}

export function useRibbonFold(section: RibbonSection | undefined): RibbonFold {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const row = useRef<HTMLDivElement | null>(null);
  const groups = useRef<(HTMLDivElement | null)[]>([]);
  /** The section drawn last, for a measurement that arrives from the observer rather than from a render. */
  const drawn = useRef<RibbonSection | undefined>(section);
  const observer = useRef<ResizeObserver | null>(null);

  const measure = useCallback((): void => {
    const container = row.current;
    const current = drawn.current;
    if (container === null || current === undefined) return;
    // THE GAUGE FIRST, which is always drawn (`RibbonMoreGauge`), so a More's width is known before any group has
    // folded. Absent or unlaid-out means the row is not laid out at all, so nothing in it can be read: fold nothing
    // yet rather than fold against a guess, and read no button.
    const more = container.querySelector<HTMLElement>('.m-ribbon__more-gauge')?.getBoundingClientRect().width ?? 0;
    if (more <= 0) return;

    // WHAT IS ON SCREEN NOW: the frames of the groups drawn and the widths of the buttons drawn. A button folded
    // away or a group hidden in the row's More is not read, and keeps what it was last measured at.
    const frames = new Map<string, GroupFrame>();
    const naturals = new Map<string, number>();
    current.groups.forEach((group, index) => {
      const element = groups.current[index] ?? null;
      if (element === null) return;
      frames.set(group.group, {
        chrome: Math.max(element.getBoundingClientRect().width - buttonsWidth(element), 0),
        gap: buttonGap(element),
      });
      // THE ROW'S BUTTONS, from the one function that defines them: the primaries, a named menu as one, then the
      // secondaries (ADR-0098's correction, ADR-0101). A button folded away keeps what it was last measured at.
      for (const unit of ribbonUnits(group.entries)) {
        // A COLUMN OF SMALL TOOLS (ADR-0194) is measured on its own box, `data-stack`; it comes before its first
        // member in the page, so the selector list finds it first, and a button or a menu has no such box.
        const key = CSS.escape(unit.key);
        const width = element.querySelector<HTMLElement>(`[data-stack="${key}"], [data-command="${key}"]`)?.getBoundingClientRect().width ?? 0;
        if (width > 0) naturals.set(unit.key, width);
      }
    });
    const room = innerWidthOf(container);
    const gap = rowGapOf(container);

    // MERGED, and AN EQUAL READING MUST NOT RE-RENDER: a measurement that agrees with what is kept has nothing to
    // say, and setting a fresh object anyway would make the observer its own trigger.
    setMetrics((previous) => {
      const next: Metrics = {
        naturals: merged(previous?.naturals, naturals),
        frames: merged(previous?.frames, frames),
        room,
        more,
        gap,
      };
      return previous !== null && sameMetrics(previous, next) ? previous : next;
    });
  }, []);

  // THE SECTION ON SCREEN, recorded after each render for the observer's readings.
  useLayoutEffect(() => {
    drawn.current = section;
  });

  const rowRef = useCallback(
    (element: HTMLDivElement | null): void => {
      observer.current?.disconnect();
      observer.current = null;
      row.current = element;
      if (element === null || typeof ResizeObserver === 'undefined') return;
      observer.current = new ResizeObserver(() => {
        measure();
      });
      observer.current.observe(element);
      // THE GROUPS ALREADY ATTACHED: React sets a child's ref before its parent's, so they arrived before this.
      for (const group of groups.current) if (group !== null) observer.current.observe(group);
    },
    [measure],
  );

  useEffect(
    () => (): void => {
      observer.current?.disconnect();
    },
    [],
  );

  // EACH GROUP IS OBSERVED TOO, because a group's box is what changes when a caption grows after it was measured —
  // a label re-rendered, the text drawn larger — while the row's box stays exactly the size it was. Measured
  // 2026-10-02: captions enlarged on the section on screen left the row 61 px wider than its box, for good, and the
  // row's `overflow: hidden` cut its last tool. A group that shrinks because the fold hid a button fires this too,
  // and that reading equals what is kept, so it renders nothing (`sameMetrics`).
  const groupRef = useCallback(
    (index: number) =>
      (element: HTMLDivElement | null): void => {
        const previous = groups.current[index] ?? null;
        if (previous !== null && previous !== element) observer.current?.unobserve(previous);
        groups.current[index] = element;
        if (element !== null) observer.current?.observe(element);
      },
    [],
  );

  // THE FOLD, from the kept numbers. `null` while any button or group this section can show has no measurement.
  const fold = useMemo<RowFold | null>(() => {
    if (section === undefined || metrics === null) return null;
    const widths: GroupWidths[] = [];
    for (const group of section.groups) {
      const frame = metrics.frames.get(group.group);
      if (frame === undefined) return null;
      const buttons: number[] = [];
      for (const unit of ribbonUnits(group.entries)) {
        const width = metrics.naturals.get(unit.key);
        if (width === undefined) return null;
        buttons.push(width);
      }
      widths.push({ buttons, chrome: frame.chrome, gap: frame.gap });
    }
    return foldRow(widths, metrics.room, metrics.more, metrics.gap);
  }, [metrics, section]);

  // A ROW DRAWN WITH A BUTTON NOBODY HAS MEASURED is measured once it is on screen. No resize announces it — the
  // row's box is the same size when its content overflows — so this is the one other trigger, and it fires only
  // while the fold is still unknown, which is a section's first appearance.
  useLayoutEffect(() => {
    if (fold === null && section !== undefined) measure();
  }, [fold, measure, section]);

  return {
    rowRef,
    groupRef,
    folds: fold?.groups ?? null,
    hiddenFrom: fold?.hiddenFrom ?? section?.groups.length ?? 0,
  };
}

/** `previous` with `readings` laid over it, or `previous` itself when nothing it holds changed. */
function merged<T>(previous: ReadonlyMap<string, T> | undefined, readings: ReadonlyMap<string, T>): ReadonlyMap<string, T> {
  if (previous === undefined) return readings;
  let changed = false;
  for (const [key, value] of readings) {
    if (!same(previous.get(key), value)) changed = true;
  }
  if (!changed) return previous;
  return new Map([...previous, ...readings]);
}

/** Two kept readings equal by value: a width, or a frame's two numbers. */
function same<T>(left: T | undefined, right: T): boolean {
  if (typeof right === 'object' && right !== null && typeof left === 'object' && left !== null) {
    const a = left as unknown as GroupFrame;
    const b = right as unknown as GroupFrame;
    return a.chrome === b.chrome && a.gap === b.gap;
  }
  return left === right;
}

/** Whether two sets of metrics say the same thing, so an unchanged measurement renders nothing. */
function sameMetrics(left: Metrics, right: Metrics): boolean {
  return (
    left.naturals === right.naturals &&
    left.frames === right.frames &&
    left.room === right.room &&
    left.more === right.more &&
    left.gap === right.gap
  );
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
