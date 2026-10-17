import type { DocId, DocVersion } from '@monstera/shared';

/**
 * Which layers behind may be PARKED — mount nothing, so their parse, worker and layout are given back
 * ([ADR-0129](../../../docs/DECISIONS/0129-an-open-documents-view-lives-until-it-closes.md)'s correction of 2026-10-17,
 * the owner's addendum 2 item 4).
 *
 * After `PARK_AFTER_MS` behind, and only for a document with nothing to lose: no command has applied since it opened
 * (its version is the one it opened at, so it has no unsaved change and no undo history) and no write or piece of
 * main's work is in flight anywhere in the window. The second is wider than the document on purpose: the in-flight
 * count is the window's, and a rule that parked while some write was out could park the document it was for.
 */
export const PARK_AFTER_MS = 60_000;

/** One open document as this rule reads it. */
export interface ParkingTab {
  readonly docId: DocId;
  readonly version: DocVersion;
  /** The version it opened at; a document whose version has moved has history, and never parks. */
  readonly openedVersion: DocVersion;
}

/** What the rule reads besides the tabs. */
export interface ParkingState {
  /** The document on show, and the one coming forward; neither is behind. */
  readonly shown: DocId | undefined;
  readonly arriving: DocId | undefined;
  /** When each document last went behind, in `now`'s clock; a document never shown is behind since it opened. */
  readonly behindSince: ReadonlyMap<DocId, number>;
  /** Those already parked. */
  readonly parked: ReadonlySet<DocId>;
  /** Writes and works in flight in this window. */
  readonly inFlight: number;
  readonly now: number;
}

/** The documents to park now: behind long enough, with nothing to lose, and not parked already. Empty while anything is in flight. */
export function toPark(tabs: readonly ParkingTab[], state: ParkingState): readonly DocId[] {
  if (state.inFlight > 0) return [];
  return tabs
    .filter((tab) => {
      if (tab.docId === state.shown || tab.docId === state.arriving || state.parked.has(tab.docId)) return false;
      if (tab.version !== tab.openedVersion) return false;
      const since = state.behindSince.get(tab.docId);
      return since !== undefined && state.now - since >= PARK_AFTER_MS;
    })
    .map((tab) => tab.docId);
}
