import { type TextSelection, readTextSelection } from './TextLayer.js';

/**
 * The text selected in the focused document's text layer, held outside React's state.
 *
 * ## Why a store and not the shell's state
 *
 * The selection changes on every step of a drag. Held as `App`'s state, each change rendered `App`, and because the
 * selected-text commands were made over that state, the command registry was built again with them: every projection
 * of it (the menu bar, the ribbon, the status bar) then drew its model again, about 56 ms of React work per select and
 * clear on a dense page. Here the shell writes nothing it renders from: the commands read the selection when they are
 * asked (`current`), and the command answers recompute from it (`subscribe`), so only a surface whose drawn answer moved
 * renders ([ADR-0272](../../../docs/DECISIONS/0272-each-surface-subscribes-to-the-answers-of-the-commands-it-places.md)).
 */
export class TextSelectionStore {
  #current: TextSelection | undefined;
  readonly #listeners = new Set<() => void>();
  readonly #read: () => TextSelection | undefined;

  constructor(read: () => TextSelection | undefined = readTextSelection) {
    this.#read = read;
  }

  /** The selection now, or `undefined` where nothing in a text layer is selected. */
  readonly current = (): TextSelection | undefined => this.#current;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Reads the document's selection again, on `selectionchange`. THE SAME SELECTION IS NOT A NEW ONE: the event fires on
   * every step of a drag, and a listener told of a selection that did not change would recompute for nothing.
   */
  readonly read = (): void => {
    const next = this.#read();
    if (same(this.#current, next)) return;
    this.#current = next;
    for (const listener of [...this.#listeners]) listener();
  };
}

function same(left: TextSelection | undefined, right: TextSelection | undefined): boolean {
  return (
    left?.page === right?.page &&
    left?.text === right?.text &&
    left?.from.x === right?.from.x &&
    left?.from.y === right?.from.y &&
    left?.to.x === right?.to.x &&
    left?.to.y === right?.to.y
  );
}
