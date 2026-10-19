import type { DocVersion } from '@monstera/shared';

/**
 * Where an object was last SENT, while its moves are still being written — and, where the caller says which version
 * its read is at, until that read has caught up with them.
 *
 * ## The mechanism this holds shut
 *
 * A nudge computes the object's next place from the selection's place, and the selection's place is the document's,
 * read after a write lands. Four arrow presses sent before the first one landed each read the same place and each sent
 * "that place plus one point", so the object moved one point where four were pressed (the forms walk, 2026-10-17: four
 * ArrowRight presses moved a field 1 px). The command lane keeps the four from being refused as out of date; it cannot
 * make the third press know where the second one sent the field.
 *
 * So while any send of an object's place is unsettled, its next move starts from the last place sent. When the last of
 * them settles REFUSED, the entry goes and the document's read is the place again: a refused move, or an Undo after the
 * moves, is then what the selection shows and starts from, never a place nobody wrote.
 *
 * ## A landed move is kept until the read has caught up with it
 *
 * The read a move starts from can be OLDER than the move: a field's selection resolves against the last list read until
 * the next replaces it (`useFormFieldList`' `held`), and that list predates the write that just landed. Dropped as soon as
 * its send landed, the place was taken from that older list, and a nudge pressed before the list was read again sent
 * the place from BEFORE the drag plus one point, undoing the drag (the forms walk's gate-launched runs, 2026-10-19). So a
 * send that names the version it produced is kept while the caller's read is at an earlier version. A caller that says
 * no version keeps the first rule alone.
 */
export interface PlacesAhead<Place> {
  /**
   * The place last sent for `key`, while a send of it is unsettled, or landed at a version later than `read`, the version
   * of the read the caller would otherwise start from; `undefined` once the read holds it.
   */
  readonly ahead: (key: string, read?: DocVersion) => Place | undefined;
  /**
   * Records that `place` was sent for `key`, unsettled until `settled` settles, whichever way. Settled with the version the
   * send produced, the place is kept until a read at that version; with nothing, or refused, it goes as it settles.
   */
  readonly sent: (key: string, place: Place, settled: Promise<DocVersion | undefined>) => void;
}

export function placesAhead<Place>(): PlacesAhead<Place> {
  const held = new Map<string, { place: Place; pending: number; landedAt: DocVersion | undefined }>();
  return {
    ahead: (key, read) => {
      const entry = held.get(key);
      if (entry === undefined) return undefined;
      if (entry.pending > 0) return entry.place;
      // SETTLED AND LANDED: kept while the caller's read predates the version it produced; gone once the read holds it.
      if (entry.landedAt !== undefined && read !== undefined && read < entry.landedAt) return entry.place;
      held.delete(key);
      return undefined;
    },
    sent: (key, place, settled) => {
      const before = held.get(key);
      const entry = { place, pending: (before?.pending ?? 0) + 1, landedAt: before?.landedAt };
      held.set(key, entry);
      const done = (produced: DocVersion | undefined): void => {
        const current = held.get(key);
        if (current === undefined) return;
        current.pending -= 1;
        // THE LATEST VERSION A SEND OF IT PRODUCED, which a read must reach before the place is the read's again.
        if (produced !== undefined && (current.landedAt === undefined || produced > current.landedAt)) current.landedAt = produced;
        // THE LAST SEND REFUSED, or naming no version: the place goes as it settles, the first rule — never a place
        // nobody wrote, whatever an earlier send produced.
        if (current.pending === 0 && produced === undefined) held.delete(key);
      };
      settled.then(
        (produced) => {
          done(produced);
        },
        () => {
          done(undefined);
        },
      );
    },
  };
}
