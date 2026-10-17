/**
 * Where an object was last SENT, while its moves are still being written.
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
 * them settles, landed or refused, the entry goes and the document's read is the place again: a refused move, or an Undo
 * after the moves, is then what the selection shows and starts from, never a place nobody wrote.
 */
export interface PlacesAhead<Place> {
  /** The place last sent for `key`, while a send of it is unsettled; `undefined` once every one has settled. */
  readonly ahead: (key: string) => Place | undefined;
  /** Records that `place` was sent for `key`, unsettled until `settled` settles, whichever way. */
  readonly sent: (key: string, place: Place, settled: Promise<unknown>) => void;
}

export function placesAhead<Place>(): PlacesAhead<Place> {
  const held = new Map<string, { place: Place; pending: number }>();
  return {
    ahead: (key) => held.get(key)?.place,
    sent: (key, place, settled) => {
      held.set(key, { place, pending: (held.get(key)?.pending ?? 0) + 1 });
      const done = (): void => {
        const entry = held.get(key);
        if (entry === undefined) return;
        entry.pending -= 1;
        if (entry.pending === 0) held.delete(key);
      };
      settled.then(done, done);
    },
  };
}
