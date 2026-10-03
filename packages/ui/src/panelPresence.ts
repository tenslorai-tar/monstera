import { useCallback, useSyncExternalStore } from 'react';

import {
  CONTEXT_PANEL_MIN_WIDTH,
  CONTEXT_PANEL_OPEN_SETTING,
  DOCUMENT_PANEL_MIN_WIDTH,
  DOCUMENT_PANEL_OPEN_SETTING,
  EDGE_HANDLE_WIDTH,
  PAGE_AREA_MIN_WIDTH,
} from './settings/layout.js';
import type { SettingsStore } from './settingsStore.js';

/** A side of the document row: the document panel's, or the right contextual panel's. */
export type PanelSide = 'start' | 'end';

/**
 * How a side is drawn: in the row beside the page, as a sheet over the page's edge, or as its reopen handle — which a
 * shut side and a side that has given way both are.
 */
export type PanelForm = 'row' | 'sheet' | 'handle';

/** Which sides the row cannot hold beside the page's floor. */
export interface GaveWay {
  readonly start: boolean;
  readonly end: boolean;
}

const OPEN_SETTING = { start: DOCUMENT_PANEL_OPEN_SETTING.id, end: CONTEXT_PANEL_OPEN_SETTING.id } as const;
const MIN_WIDTH = { start: DOCUMENT_PANEL_MIN_WIDTH, end: CONTEXT_PANEL_MIN_WIDTH } as const;

/**
 * Which open sides give way in a row this wide
 * ([ADR-0146](../../../docs/DECISIONS/0146-a-narrow-window-keeps-the-page-and-folds-the-chrome.md) Decision 2).
 *
 * The row must hold the page area's floor and, for each side, its minimum when it is in the row or its handle when it
 * is not. The right side gives way first, then the left. A pure function of the width and the open settings: drawing a
 * handle changes neither, so the answer cannot move because it was drawn, and nothing flickers at the boundary.
 *
 * @param row the document row's width in CSS pixels, or `undefined` before it has been measured — when nothing gives
 *   way, since a row nobody has laid out is not a narrow one
 */
export function sidesThatGiveWay(row: number | undefined, open: { readonly start: boolean; readonly end: boolean }): GaveWay {
  if (row === undefined) return { start: false, end: false };
  const need = (start: boolean, end: boolean): number =>
    PAGE_AREA_MIN_WIDTH +
    (open.start && start ? MIN_WIDTH.start : EDGE_HANDLE_WIDTH) +
    (open.end && end ? MIN_WIDTH.end : EDGE_HANDLE_WIDTH);
  if (need(true, true) <= row) return { start: false, end: false };
  if (need(true, false) <= row) return { start: false, end: open.end };
  return { start: open.start, end: open.end };
}

/**
 * Whether each side panel is on screen, and the ONE WRITER of both panels' open settings (ADR-0146 Decision 4).
 *
 * ## Three verbs, so no control can be dead in a narrow window
 *
 * A control that shows a panel by writing its open setting does nothing when the setting is already on and the side
 * has given way: the value does not change and nothing is drawn. So every control that shows or shuts a panel says
 * which it wants — `show`, `hide`, or `toggle` — and this decides how: `show` opens the setting and, when the side
 * will not have room, its sheet; `hide` closes the sheet when it is one and otherwise shuts the setting. A tick reads
 * `shown`, so a menu never ticks a panel that is not on screen.
 *
 * ## The row's width is measured by the document row and decided here
 *
 * `DocumentBody` reports the width it is laid out at (`measure`), and `sidesThatGiveWay` is the one rule that reads it.
 * The sheet is presentation and kept nowhere, as Studio's ribbon overlay is: one at a time, and gone when the side has
 * room again.
 */
export class PanelPresence {
  readonly #settings: SettingsStore;
  #row: number | undefined;
  #sheet: PanelSide | undefined;
  readonly #listeners = new Set<() => void>();

  constructor(settings: SettingsStore) {
    this.#settings = settings;
  }

  /** How the side is drawn now. */
  form(side: PanelSide): PanelForm {
    if (this.#settings.get(OPEN_SETTING[side]) !== true) return 'handle';
    if (!this.#gaveWay()[side]) return 'row';
    return this.#sheet === side ? 'sheet' : 'handle';
  }

  /** Whether the side is on screen: in the row, or as its sheet. */
  shown(side: PanelSide): boolean {
    return this.form(side) !== 'handle';
  }

  /** Puts the side on screen: opens its setting, and when the row will not hold it, its sheet. */
  show(side: PanelSide): void {
    this.#settings.set(OPEN_SETTING[side], true);
    // READ AFTER THE WRITE: opening this side can be what makes it give way, and then a sheet is the only way to show it.
    // A sheet replaces any other; a side that has room is in the row and needs none.
    if (this.#gaveWay()[side]) this.#setSheet(side);
    else if (this.#sheet === side) this.#setSheet(undefined);
  }

  /** Takes the side off screen: its sheet when it is one, otherwise its setting. */
  hide(side: PanelSide): void {
    if (this.form(side) === 'sheet') {
      this.#setSheet(undefined);
      return;
    }
    this.#settings.set(OPEN_SETTING[side], false);
  }

  toggle(side: PanelSide): void {
    if (this.shown(side)) this.hide(side);
    else this.show(side);
  }

  /** The document row's width as laid out — written by `DocumentBody`, the one place that measures it. */
  measure(row: number): void {
    if (row === this.#row) return;
    this.#row = row;
    // A SHEET WHOSE SIDE HAS ROOM AGAIN is in the row now, and is forgotten so a later narrowing does not bring it back.
    const sheet = this.#sheet !== undefined && this.#gaveWay()[this.#sheet] ? this.#sheet : undefined;
    this.#sheet = sheet;
    this.#emit();
  }

  /** Called on any change to how a side may be drawn: the row, the sheet, or either open setting. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    const offSettings = this.#settings.watch([OPEN_SETTING.start, OPEN_SETTING.end], listener);
    return (): void => {
      this.#listeners.delete(listener);
      offSettings();
    };
  }

  #gaveWay(): GaveWay {
    return sidesThatGiveWay(this.#row, {
      start: this.#settings.get(OPEN_SETTING.start) === true,
      end: this.#settings.get(OPEN_SETTING.end) === true,
    });
  }

  #setSheet(next: PanelSide | undefined): void {
    if (next === this.#sheet) return;
    this.#sheet = next;
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** A side's form, re-rendering when it changes. A string, so the snapshot is the same value until it moves. */
export function usePanelForm(presence: PanelPresence, side: PanelSide): PanelForm {
  const subscribe = useCallback((listener: () => void) => presence.subscribe(listener), [presence]);
  return useSyncExternalStore(subscribe, () => presence.form(side));
}
