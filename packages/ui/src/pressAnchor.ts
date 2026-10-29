/**
 * Keeps a drag's selection anchored where the press put it, which Chromium 151 does not always do: the one repair both
 * surfaces a person selects text on take, the page's text layer (`holdPressedAnchor`) and the editor's words
 * (`EditorSurface`), so neither carries its own opinion of the mechanism below.
 *
 * ## The mechanism, read from Chromium's `selection_controller.cc` and `mouse_event_manager.cc`
 *
 * A press places a caret where the pointer is, hit-tested at its exact, fractional point. Chromium also keeps
 * `mouse_down_pos_`, which is that point FLOORED to whole pixels, and on each drag event while the selection is not yet
 * a range `HandleMouseDraggedEvent` hit-tests `mouse_down_pos_` again and collapses the selection there. Where a
 * character's midpoint lies between the two points that caret is not the press's, so the selection changes,
 * `NotifySelectionChanged` reads a caret and sets the state back to *placed caret*, and every later drag event takes
 * the same branch and collapses again, at the pointer. The anchor travels with the pointer, nothing is selected, and
 * the release marks nothing.
 *
 * Measured 2026-10-05 in Chromium 151.0.7922.34, pressing at every half pixel across the start of two lines at five
 * horizontal scales and then dragging: a drag failed exactly where the caret at the press point and the caret at its
 * floor differ, with no failure that rule missed and no failure it predicted that did not happen, and the transform is not needed (it
 * fails at scale 1 too). It needs a pointer whose position is a fraction of a pixel, since flooring a whole number
 * changes nothing: Playwright's pointer always is, and that is the condition measured; whether a scaled Windows
 * display delivers one was not measured. Given one, a line fails or works by where its first letters fall, so the
 * same lines fail on every press at their start, the shape of F-C8's two lines that could not be highlighted while
 * the lines either side of them could. A plain drag to copy fails the same way; the markup tools only made it visible.
 *
 * THE EDITOR'S WORDS FAIL THE SAME WAY, and more often where its letters are narrow: measured 2026-10-27 in the editor
 * over a drawn font's line, a drag across *lilt*, each letter under 3 px, was pressed at offset 1 and ended with anchor
 * and focus both at 3, nothing selected.
 *
 * ## The repair restores the press's own caret, and touches nothing else
 *
 * The anchor is the caret at the press's exact point (`caretOf`, the hit test the press itself made). The point comes
 * from `pointerdown`: `MouseEvent.clientX` is a whole number in Chromium, so reading it there would be the floored point
 * again. The moving end is left where Chromium put it, and only a selection whose anchor has left the press is
 * re-anchored; a range makes `NotifySelectionChanged` read *extended*, and from the next drag event Chromium extends
 * from the press as it does for every other drag.
 *
 * **Never before the first drag event.** That event decides whether the press starts a drag of selected text, by
 * asking whether `mouse_down_pos_` lies inside the selection, and only then updates the selection. With the exact caret
 * the press itself already matches, so the first re-anchor can only follow the collapse that event makes, after the
 * decision. Anchored at the floored point instead, the re-anchor ran on the press, put a one character range under the
 * pointer, and the first move started a text drag and cancelled the pointer (measured the same day).
 *
 * A double or triple click selects by word or line, and a shift-press extends a selection whose anchor is already
 * set, so neither is held; `PointerEvent.detail` is 0, so the click count is read from `mousedown`, which follows. A
 * touch selects by a long press, through none of this path.
 *
 * ## A click's wobble is no drag
 *
 * Chromium selects as soon as a held pointer crosses a character's midpoint, however little it moved: a hand's click that
 * drifts a pixel or two sideways across a narrow letter's middle selected that letter, so the click chose a letter where
 * the person meant a caret (the owner's decision, 2026-10-27; *t* is 2.56 px wide on Linux CI and 3.02 on Windows CI,
 * measured by cloud run 21 at 7e784d57). Until the pointer leaves {@link CLICK_WOBBLE_PX} about the press, the press is
 * a click, and anything the browser selected meanwhile is put back to the press's caret.
 *
 * @param caretOf the press's own caret, or `null` for a press this surface does not hold
 * @returns the cleanup that removes every listener this added
 */
export function holdAnchorAtPress(root: HTMLElement, caretOf: (event: PointerEvent) => { readonly node: Node; readonly offset: number } | null): () => void {
  const owner = root.ownerDocument;
  let press: { readonly node: Node; readonly offset: number } | undefined;
  /** Where the press went down, on the window. */
  let pressedAt: { readonly x: number; readonly y: number } | undefined;
  /**
   * Whether the pointer has left the click's wobble with the button held since the press. ONLY A DRAG is repaired: the
   * collapse above happens on drag events, and a caret a surface places itself during a press (the editor's double press
   * puts it at the point) is not the platform's to undo. Re-anchored on any change, that caret became a range from the
   * press, measured 2026-10-27 in the editor: two presses that open a block left *[4]* selected instead of a caret before
   * it.
   */
  let dragging = false;
  /** Whether the pointer has moved with the button held but stayed inside the wobble: a click, whose range is undone. */
  let wobbling = false;
  const moved = (event: PointerEvent): void => {
    if (press === undefined || pressedAt === undefined || (event.buttons & 1) === 0 || dragging) return;
    if (withinClickWobble(pressedAt, { x: event.clientX, y: event.clientY })) wobbling = true;
    else dragging = true;
  };
  /** Puts a range the browser made during a click's wobble back to the press's caret. */
  const unwobble = (): void => {
    if (!wobbling || dragging || press?.node.isConnected !== true) return;
    const selection = owner.getSelection();
    if (selection === null || selection.isCollapsed) return;
    selection.collapse(press.node, press.offset);
  };

  /**
   * Whether two points are ONE PLACE in the text: nothing lies between them either way. The end of one text node and the
   * start of the next are one place given two ways, and the browser's caret and its hit test answer it differently
   * (measured 2026-10-27: a press before *[4]* put the caret at the end of the node before it, offset 41, where the hit
   * test named offset 0 of *[4]*); compared by node, the two read as a drag and made an empty range in place of the caret.
   */
  const samePlace = (a: { readonly node: Node; readonly offset: number }, b: { readonly node: Node; readonly offset: number }): boolean => {
    const between = (from: typeof a, to: typeof b): string => {
      const range = owner.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      return range.toString();
    };
    return between(a, b) === '' && between(b, a) === '';
  };

  const reanchor = (): void => {
    if (!dragging) {
      unwobble();
      return;
    }
    // A LINE REPLACED UNDER THE DRAG takes its press with it: a detached node is no anchor.
    if (press?.node.isConnected !== true) return;
    const selection = owner.getSelection();
    const focus = selection?.focusNode ?? null;
    const anchor = selection?.anchorNode ?? null;
    if (selection === null || focus === null || anchor === null) return;
    if (samePlace({ node: anchor, offset: selection.anchorOffset }, press)) return;
    // A CARET AT THE PRESS is no selection to make: the pointer is back where it began.
    if (samePlace({ node: focus, offset: selection.focusOffset }, press)) return;
    selection.setBaseAndExtent(press.node, press.offset, focus, selection.focusOffset);
  };
  const release = (): void => {
    press = undefined;
    pressedAt = undefined;
    dragging = false;
    wobbling = false;
    owner.removeEventListener('selectionchange', reanchor);
  };
  // A CLICK LET GO is undone at once as well: `selectionchange` is a queued task, so the range the last wobble made may
  // not have been reported before the button comes up.
  const letGo = (): void => {
    unwobble();
    release();
  };
  const pressed = (event: PointerEvent): void => {
    release();
    if (event.button !== 0 || event.shiftKey || event.pointerType === 'touch') return;
    const caret = caretOf(event);
    if (caret?.node.nodeType !== Node.TEXT_NODE || !root.contains(caret.node)) return;
    press = caret;
    pressedAt = { x: event.clientX, y: event.clientY };
    owner.addEventListener('selectionchange', reanchor);
  };
  const counted = (event: MouseEvent): void => {
    if (event.detail > 1) release();
  };

  root.addEventListener('pointerdown', pressed);
  root.addEventListener('mousedown', counted);
  // ON THE DOCUMENT, so a release anywhere ends the press and a drag past the root still counts: a drag routinely ends
  // off the page.
  owner.addEventListener('pointermove', moved, true);
  owner.addEventListener('mouseup', letGo, true);
  owner.addEventListener('pointercancel', release, true);
  return (): void => {
    release();
    owner.removeEventListener('pointermove', moved, true);
    root.removeEventListener('pointerdown', pressed);
    root.removeEventListener('mousedown', counted);
    owner.removeEventListener('mouseup', letGo, true);
    owner.removeEventListener('pointercancel', release, true);
  };
}

/**
 * How far a press may move, across and down, in CSS pixels, and still be a click: Windows' drag rectangle, whose default
 * is 4 pixels each way (`SM_CXDRAG` and `SM_CYDRAG`, Microsoft's `GetSystemMetrics` documentation), the distance a
 * platform drag must go before it begins. The one threshold for every press on text: on a line's letters
 * ({@link holdAnchorAtPress}), in the editor's words, and on the page's blank space (`holdPressedAnchor`).
 */
export const CLICK_WOBBLE_PX = 4;

/** Whether a held pointer at `to` is still inside the click's wobble about the press at `from`. */
export function withinClickWobble(from: { readonly x: number; readonly y: number }, to: { readonly x: number; readonly y: number }): boolean {
  return Math.abs(to.x - from.x) < CLICK_WOBBLE_PX && Math.abs(to.y - from.y) < CLICK_WOBBLE_PX;
}

/** The caret at a press's exact point, the browser's own hit test; `null` in an engine without it (happy-dom). */
export function exactCaretOf(event: PointerEvent): { readonly node: Node; readonly offset: number } | null {
  const owner = event.target instanceof Node ? event.target.ownerDocument : null;
  if (owner === null || typeof owner.caretPositionFromPoint !== 'function') return null;
  const exact = owner.caretPositionFromPoint(event.clientX, event.clientY);
  return exact === null ? null : { node: exact.offsetNode, offset: exact.offset };
}
