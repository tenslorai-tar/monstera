// @ts-check
/**
 * A walk's PER-STEP code, and the one guard that makes it so (ADR-0285's correction of 2026-11-04).
 *
 * A table of entries keyed by command id is declared `stepTable('<name>', { '<command id>': entry, … })`. The walk record
 * is to parse the walk program and take each such entry, with its own comment, as the code of the step whose command it
 * names, everything else in the program being shared; so a change inside one entry walks that one row again, and a
 * change anywhere else walks every row. THIS MODULE IS THE GUARD ALONE as of 2026-11-04: the record's reading of the
 * tables and the walk's use of them follow, by the owner's order, after the packages of 1.1.2611.0.
 *
 * ## Why the split is sound and not claimed
 *
 * An entry is the step's own only if no other row can read it. `stepTable` returns a guard that, while a row is walked
 * (`walkingRow`), answers a read of that row's command id and THROWS on any other: another command's entry, a listing of
 * the keys, a read outside any row. So a table read across rows fails the walk the moment it happens, on every full
 * walk, rather than passing on an entry the record attributed to the wrong row. A table that must be read across rows is
 * simply not declared through this, and is then shared, whole.
 *
 * The record's parse and this guard read the same shape: a call of `stepTable` whose second argument is an object
 * literal of string-keyed properties. A spread or a computed key inside it is not attributed to any row, so its text is
 * shared, and the guard still refuses it for any row but its own.
 */

/** The command id of the row being walked, or `undefined` between rows. @type {string | undefined} */
let row;

/**
 * Walks `work` as the row of `id`: the only command whose entries a step table answers meanwhile.
 * @template T
 * @param {string} id @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function walkingRow(id, work) {
  if (row !== undefined) throw new Error(`the row of ${id} began inside the row of ${row}`);
  row = id;
  try {
    return await work();
  } finally {
    row = undefined;
  }
}

/**
 * A table of per-step entries, keyed by command id, answering only the row being walked.
 * @template V
 * @param {string} name @param {Readonly<Record<string, V>>} entries
 * @returns {Readonly<Record<string, V>>}
 */
export function stepTable(name, entries) {
  return new Proxy(entries, {
    get(target, key) {
      if (typeof key !== 'string') return Reflect.get(target, key);
      if (row === undefined) throw new Error(`the step table ${name} was read for ${key} outside any row, which would make its entry shared code the record calls one step's`);
      if (key !== row) throw new Error(`the step table ${name} was read for ${key} in the row of ${row}: an entry another row reads is not that step's own`);
      return Reflect.get(target, key);
    },
    has(target, key) {
      if (typeof key !== 'string') return Reflect.has(target, key);
      if (key !== row) throw new Error(`the step table ${name} was asked whether it holds ${key} in the row of ${String(row)}`);
      return Reflect.has(target, key);
    },
    ownKeys() {
      throw new Error(`the step table ${name} was listed, which reads every row's entry at once`);
    },
  });
}
