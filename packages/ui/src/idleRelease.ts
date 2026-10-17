/**
 * When this window asks `main` to give its memory back by reloading it
 * ([ADR-0252](../../../docs/DECISIONS/0252-a-closed-and-idle-window-gives-its-renderer-back.md)): only after
 * `IDLE_RELEASE_MS` in which every one of these held — no document open, no dialog open (Settings is one), no write or
 * piece of main's work in flight, and no pointer, wheel or key input. The renderer is where all of these are known;
 * `main` decides the rest by the documents it holds.
 */
export const IDLE_RELEASE_MS = 60_000;

/** What the rule reads, each as of now. */
export interface IdleState {
  readonly documents: number;
  readonly dialogOpen: boolean;
  readonly inFlight: number;
  /** When the window last became quiet: its last input, or the last time one of the conditions above stopped holding. */
  readonly quietSince: number;
  /** Whether this window has asked since it last held a document; it asks once. */
  readonly asked: boolean;
  readonly now: number;
}

/** Whether to ask now. */
export function shouldAskRelease(state: IdleState): boolean {
  if (state.asked || state.documents > 0 || state.dialogOpen || state.inFlight > 0) return false;
  return state.now - state.quietSince >= IDLE_RELEASE_MS;
}

/** The start area's scroll offset, kept across the reload in the window's `sessionStorage` (ADR-0252 Decision 4). */
const START_SCROLL_KEY = 'monstera.start-scroll';

/** Keeps the start area's scroll offset for the page that loads next. A storage that refuses keeps nothing, and says so to nobody: the offset is a convenience. */
export function keepStartScroll(storage: Pick<Storage, 'setItem'> | undefined, offset: number): void {
  try {
    storage?.setItem(START_SCROLL_KEY, String(Math.round(offset)));
  } catch {
    // A STORAGE THAT REFUSES (a private window, blocked site data) keeps nothing: the start screen then opens at its top,
    // which is where it opens on any other start, so nothing is lost but the offset itself.
  }
}

/** The kept offset, taken once: answered and removed, or `undefined` where none was kept or the storage refuses. */
export function takeStartScroll(storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined): number | undefined {
  try {
    const kept = storage?.getItem(START_SCROLL_KEY);
    storage?.removeItem(START_SCROLL_KEY);
    const offset = kept === null || kept === undefined ? Number.NaN : Number(kept);
    return Number.isFinite(offset) && offset >= 0 ? offset : undefined;
  } catch {
    return undefined;
  }
}
