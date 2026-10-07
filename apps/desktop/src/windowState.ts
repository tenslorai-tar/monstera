import { z } from 'zod';

import type { SettingsSurface } from './settingsFile.js';

/**
 * Where the main window was last, and where it opens now.
 *
 * ## One rule, in one place (B3a)
 *
 * *Where does the window open* has two halves — what is remembered, and whether it can still be shown — and both are
 * decided here, by a function of the remembered record and the screens that are connected NOW. `window.ts` takes the
 * answer and writes the record; it holds no opinion of its own about either.
 *
 * ## First launch opens maximised
 *
 * With no record Electron's default size was used, and on a large screen that is a small window in a corner. A launch
 * nobody has recorded opens maximised. After that it opens as it was left: the size and place the window had when it
 * was last not maximised, and whether it was maximised.
 *
 * ## A place that is no longer there is not used
 *
 * A window left on a second screen that is no longer connected, or on a resolution that is gone, would open where
 * nobody can reach its title bar. The remembered bounds are used only if enough of them lies on a screen's work area to
 * grab and drag; otherwise the launch is treated as a first one and opens maximised on the primary screen.
 */

/** The record's file name inside `userData`. */
export const WINDOW_STATE_FILE = 'window.json';

/** A rectangle in screen coordinates, as Electron reports bounds and work areas. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How much of the remembered window must lie on one screen's work area for the place to count as still there: enough
 * to grab its title bar and to see that it is a window. Chosen as a floor, not measured; a window on a screen's edge by
 * less than this is one a person would have to hunt for.
 */
export const MIN_VISIBLE = { width: 200, height: 100 } as const;

/** What is kept. Whole numbers, because bounds are pixels; `maximized` is the state the window was left in. */
export const savedWindowSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    maximized: z.boolean(),
  })
  .strict();

export type SavedWindow = z.infer<typeof savedWindowSchema>;

/** How a window opens: the bounds to give it (`undefined` leaves them to the platform) and whether to maximise it. */
export interface Placement {
  readonly bounds: Box | undefined;
  readonly maximize: boolean;
}

/** Opened with nothing remembered, or nothing that can be shown: maximised, on the platform's own choice of screen. */
export const FIRST_LAUNCH: Placement = { bounds: undefined, maximize: true };

/**
 * A window with NO memory behind it — a harness's, which must open the same way every run whatever a person did last on
 * this machine. The platform's default size, not maximised.
 */
export const PLATFORM_DEFAULT: Placement = { bounds: undefined, maximize: false };

function overlap(a: Box, b: Box): { readonly width: number; readonly height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/**
 * Where the window opens, from what was remembered and the work areas of the screens connected now.
 *
 * @param saved whatever the record held — unvalidated, because a file a person can edit or a build can change is not a
 *   type
 * @param workAreas every connected screen's usable area, taskbar excluded
 * @param floor the window's minimum size on its screen; a remembered size under it is raised to it
 */
export function placementFor(saved: unknown, workAreas: readonly Box[], floor: { readonly width: number; readonly height: number }): Placement {
  const parsed = savedWindowSchema.safeParse(saved);
  if (!parsed.success) return FIRST_LAUNCH;
  const { maximized, ...place } = parsed.data;
  const shown = workAreas.some((area) => {
    const common = overlap(place, area);
    return common.width >= MIN_VISIBLE.width && common.height >= MIN_VISIBLE.height;
  });
  if (!shown) return FIRST_LAUNCH;
  return {
    bounds: { ...place, width: Math.max(place.width, floor.width), height: Math.max(place.height, floor.height) },
    maximize: maximized,
  };
}

/** What `window.ts` asks of the record: what was kept, and keeping what is now. */
export interface WindowMemory {
  read(): unknown;
  write(state: SavedWindow): void;
}

/** The memory over a JSON document under `userData`, made by `createJsonFile` for `SettingsSurface`'s reason. */
export function windowMemory(file: SettingsSurface): WindowMemory {
  return {
    // THE WHOLE DOCUMENT, validated by `placementFor`: an empty one — a first launch — is not a window.
    read: () => file.read(),
    write: (state) => {
      file.write({ ...state });
    },
  };
}
