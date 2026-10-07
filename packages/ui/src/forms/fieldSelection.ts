import type { DocVersion } from '@monstera/shared';

/**
 * Which fields of the open form are selected, named as every field is named: its page and its place in that page's
 * widget walk, at the version the walk was read at.
 *
 * ## A selection is a position in a walk, so it is valid for ONE version
 *
 * The same rule the annotation selection keeps ([ADR-0041](../../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)):
 * a command that moves the version turns a walk position into arithmetic pointing at whatever is there now. So the
 * selection carries the version it was made at and {@link liveKeys} answers nothing for any other, DERIVED on read rather
 * than cleared by an effect that would run a render late.
 *
 * ## One writer of the selection
 *
 * The Fields list and the page both ask these functions, so a click means the same thing in both places: a plain click
 * selects that one field and drops the rest, Ctrl toggles one, Shift takes the run from the last one clicked.
 */
export type FieldKey = string;

/** The key of a field. */
export function fieldKey(page: number, index: number): FieldKey {
  return `${String(page)}:${String(index)}`;
}

/** A selection, and the field a Shift click measures its run from. */
export interface FieldSelection {
  readonly version: DocVersion;
  readonly keys: readonly FieldKey[];
  readonly anchor: FieldKey | undefined;
}

/** How a click joins the selection. */
export type SelectMode = 'replace' | 'toggle' | 'range';

/** The keys that are selected at `version`, which is none for a selection made at another. */
export function liveKeys(selection: FieldSelection | undefined, version: DocVersion | undefined): readonly FieldKey[] {
  return selection === undefined || version === undefined || selection.version !== version ? [] : selection.keys;
}

/**
 * The selection after a click on `key`.
 *
 * @param ordered every field of the form in the order the Fields list shows them, which is what a Shift click's run is
 *   taken over; a click on the page, which knows only its own page's fields, passes the keys it knows
 */
export function select(
  current: FieldSelection | undefined,
  version: DocVersion,
  key: FieldKey,
  mode: SelectMode,
  ordered: readonly FieldKey[],
): FieldSelection {
  const held = liveKeys(current, version);
  const anchor = current?.version === version ? current.anchor : undefined;
  if (mode === 'toggle') {
    const keys = held.includes(key) ? held.filter((each) => each !== key) : [...held, key];
    return { version, keys, anchor: key };
  }
  if (mode === 'range' && anchor !== undefined) {
    const from = ordered.indexOf(anchor);
    const to = ordered.indexOf(key);
    // AN ANCHOR THE LIST DOES NOT HOLD (it is on a page this list was not given) is no anchor: the click selects one.
    if (from !== -1 && to !== -1) {
      const [low, high] = from < to ? [from, to] : [to, from];
      return { version, keys: ordered.slice(low, high + 1), anchor };
    }
  }
  return { version, keys: [key], anchor: key };
}

/** The mode a click's modifier keys ask for. Ctrl and Cmd toggle, Shift takes a run, and neither replaces. */
export function modeOf(event: { readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean }): SelectMode {
  if (event.shiftKey) return 'range';
  if (event.ctrlKey || event.metaKey) return 'toggle';
  return 'replace';
}
