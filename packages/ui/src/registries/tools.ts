import type { RenderableCommand } from '@monstera/contract';
import type { PageTransform, ViewportPoint } from '@monstera/shared';

/**
 * The tool registry — §7's *Tools* row, whose entry is a controller.
 *
 * ## The undecided clause, decided
 *
 * `docs/FEATURES.md`' platform row left one thing open: *"whether a controller
 * is a registry of its own or a field on the existing tool registry."* There
 * was no existing tool registry, so the question was really whether a tool is
 * anything other than its controller. It is not — a tool's identity is the
 * gesture it turns into a command — so this is one registry whose entry
 * **carries** a controller, matching §7's table exactly rather than adding a
 * row to it.
 *
 * ## The lifecycle is begin / update / commit / cancel, and three are members
 *
 * `docs/ARCHITECTURE.md` §6 names four. The fourth is not a member here and
 * that is a design decision rather than an omission: the gesture's state is a
 * **value the overlay holds**, so cancelling is the overlay dropping it, and a
 * `cancel` on this interface would have an empty body in every implementation
 * this stage writes. An empty method that must be implemented is the
 * display-only sin at interface scale — every tool would carry a stub, and the
 * first tool that genuinely needs cleanup would be indistinguishable from the
 * nineteen that do not.
 *
 * It arrives with its first caller. A tool holding a resource across a gesture —
 * a text box with an editor mounted, say — is what makes cancellation more than
 * forgetting, and that tool is the one that adds the member.
 *
 * ## The controller is PURE, and that is what makes a tool testable
 *
 * `begin` and `update` return the gesture rather than mutating one, and
 * `commit` returns a command rather than sending it. So a case can drive a
 * whole drag with three calls and no DOM, and the overlay is the only thing
 * that knows about pointers. It is also what keeps the registry a **value**
 * (ADR-0029 Decision 1): a controller holding its own state would make two
 * pages sharing a tool share a drag.
 */

/**
 * A gesture in progress: the path the pointer has taken, in the coordinate
 * space the overlay measures.
 *
 * ## It was `{ from, to }` until the ink tool, and that is the seam working
 *
 * Two points is what a rectangle needs and what a line needs, and it was right
 * for as long as every tool was one of those. Ink is a path, and the three ways
 * to give it one were all worse than widening this:
 *
 * - **A generic state parameter** on the controller. Then `UiTool` holds a
 *   controller of some type the overlay cannot name, and the registry needs a
 *   cast at every entry — a type assertion per tool, in the file whose whole
 *   job is that a tool is an entry.
 * - **A union of gesture shapes.** Then each controller receives a gesture it
 *   may not have produced, narrows it at runtime and throws otherwise — a
 *   runtime check where a type was doing the work (B5, backwards).
 * - **A second registry** for path tools, which is a second wiring place.
 *
 * So the platform records the path for every tool and each reads what it
 * needs. {@link startOf} and {@link endOf} are what a two-point tool reads, and
 * they are exact rather than decimated — see {@link pointerPath}.
 *
 * The cost is a bounded array for tools that ignore it, which is the trade
 * taken deliberately: one gesture shape, no casts, and the twentieth tool
 * changes nothing here.
 */
export interface Gesture {
  /**
   * Every point the pointer has been at, in order, starting with where it went
   * down. Never empty.
   */
  readonly points: readonly ViewportPoint[];
}

/** Where the gesture started. */
export function startOf(gesture: Gesture): ViewportPoint {
  const [first] = gesture.points;
  if (first === undefined) throw new Error('a gesture always has the point it began at');
  return first;
}

/** Where the pointer is now — EXACT, never a decimated neighbour. */
export function endOf(gesture: Gesture): ViewportPoint {
  const last = gesture.points[gesture.points.length - 1];
  if (last === undefined) throw new Error('a gesture always has the point it began at');
  return last;
}

/**
 * How far the pointer must move before a new point is kept, in CSS pixels.
 *
 * A pointer reports a move per frame, so an undecimated stroke is hundreds of
 * points for a short scribble and every one of them crosses to the kernel.
 * Two pixels is below what a hand can place deliberately and far above the
 * rate a pointer samples at.
 */
const KEEP_APART = 2;

/**
 * How many points one gesture may hold.
 *
 * Invariant L11 forbids a payload that scales with the DOCUMENT, and a stroke
 * scales with the drag — so this is not that rule, and a bound is still owed:
 * a command is intent, and intent that grows without limit is a renderer that
 * can send anything. At {@link KEEP_APART} apart, this is over eight thousand
 * pixels of travel, which is more than a page holds at any sane zoom.
 *
 * **Reaching it stops the path rather than truncating it silently**: the
 * preview stops following the pointer, which a person can see. A cap that
 * dropped later points while the preview kept moving would commit a shape
 * nobody drew.
 */
const MAX_GESTURE_POINTS = 4096;

/**
 * The `begin` and `update` every pointer-driven tool spreads into its
 * controller.
 *
 * **Spread explicitly at each tool rather than defaulted**, so a controller
 * still declares all four members and a tool that needs its own — a polygon,
 * whose gesture is extended by clicks rather than by moves — writes one without
 * an exception to a default.
 *
 * The LAST point is replaced rather than appended when the pointer has not
 * moved far, which is what keeps {@link endOf} exact while the interior is
 * decimated. Without that a rectangle's corner would snap to the nearest two
 * pixels, and a tool that reads only two points would be paying for a
 * simplification it does not use.
 */
export const pointerPath: Pick<ToolController, 'begin' | 'update'> = {
  begin: (at: ViewportPoint): Gesture => ({ points: [at] }),
  update: (gesture: Gesture, at: ViewportPoint): Gesture => {
    const last = endOf(gesture);
    const far = Math.hypot(at.x - last.x, at.y - last.y) >= KEEP_APART;
    if (far && gesture.points.length >= MAX_GESTURE_POINTS) return gesture;
    return {
      points: far
        ? [...gesture.points, at]
        : [...gesture.points.slice(0, -1), at],
    };
  },
};

/**
 * What a tool does with a drag.
 *
 * The gesture is {@link Gesture} for every tool, which is a decision that
 * changed once and is recorded there: it was parameterised so a path tool could
 * carry more, and the parameter cost a cast per registry entry. The path is now
 * what every gesture is.
 */
export interface ToolController {
  /** Starts a gesture at a point. Usually {@link pointerPath}'s. */
  readonly begin: (at: ViewportPoint) => Gesture;
  /** Moves it. Pure: the caller keeps whichever value it wants. */
  readonly update: (gesture: Gesture, at: ViewportPoint) => Gesture;
  /**
   * What the gesture produced, or `undefined` when it produced nothing.
   *
   * `undefined` is the ordinary outcome for a click that did not drag, and it
   * is a **value rather than a throw** for the reason a capture refusal is: the
   * overlay has to do something sensible with it, and a caller may not catch.
   *
   * The command is `RenderableCommand`, which is the narrower union — the type
   * is what stops a surface expressing a command only main may mint.
   *
   * ## IT MAY ANSWER NOW OR LATER
   *
   * A text-bearing tool cannot build its command from the gesture alone: the
   * words come from a person, through a dialog, and
   * [ADR-0038](../../../../docs/DECISIONS/0038-a-dialog-answers-the-command-that-opened-it.md)'s
   * shape is that whatever opened the dialog is what builds the command from
   * its answer.
   *
   * **A union rather than always a promise**, and the difference is not
   * cosmetic. Making every `commit` async would turn six tools that answer from
   * the gesture alone into promises nothing awaits, and their twenty-two cases
   * into `async` bodies with no await in them — ceremony placed where the
   * behaviour is not. The overlay `await`s, which handles both without knowing
   * which it has.
   *
   * **A dismissed dialog is `undefined`**, which is the same outcome a click
   * that did not drag already produced. That is the whole of the gate: there is
   * no value to build a command from, so there is nothing to send — rather than
   * a confirmed flag somebody has to remember to check.
   *
   * **The tool holds `ask` itself**, captured when it is constructed, exactly
   * as `deletePagesCommand(deps)` does. The alternative was a fourth parameter
   * every tool receives and one uses; the alternative to that was the overlay
   * knowing which dialog belongs to which tool, which is the second wiring
   * place the registry exists to forbid.
   */
  readonly commit: (
    gesture: Gesture,
    page: number,
    transform: PageTransform,
  ) => RenderableCommand | undefined | Promise<RenderableCommand | undefined>;
  /**
   * What is drawn while the gesture is in flight, in the overlay's own
   * coordinates.
   *
   * A **shape description**, not an element: the overlay owns the SVG surface,
   * so a controller returning markup would put two components in charge of one
   * drawing. It also keeps this module free of React, which is what lets a case
   * assert a preview's geometry by reading four numbers.
   */
  readonly preview: (gesture: Gesture) => ToolPreview | undefined;
}

/**
 * What the overlay draws for a gesture in flight, in its own CSS pixels.
 *
 * A **shape description** discriminated on `shape`, so the overlay's one
 * `switch` is the only place that knows how any of them is drawn. A member
 * added here is a branch there and nothing else.
 *
 * ORDERED, unlike the command's rectangle, and that is not an inconsistency:
 * a preview is a box on screen and SVG has no meaning for a negative width,
 * where the command's rectangle is a pair of document corners whose order says
 * which way the drag ran.
 */
export type ToolPreview =
  | {
      readonly shape: 'rect' | 'ellipse';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly shape: 'line';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    }
  | {
      readonly shape: 'path';
      /** Every kept point, as `[x, y]` pairs in order. */
      readonly points: readonly (readonly [number, number])[];
    };

/** One registered tool. */
export interface UiTool {
  /**
   * `<domain>.<name>`, and the SAME id as the command that selects it.
   *
   * Not a coincidence and not a join: a tool is selected by exactly one
   * command, so two ids would be a mapping to keep in step — and the registry
   * refuses a duplicate, so the shared id is checked by construction rather
   * than by a rule. `check:secondwiring` reads ids of this grammar, which is
   * the other reason it is not free-form.
   */
  readonly id: string;
  /** How the drag becomes a command. */
  readonly controller: ToolController;
}

/**
 * The composed set of tools.
 *
 * `CommandRegistry`'s shape and for its reasons — a duplicate id is a startup
 * failure rather than a silent replacement (ADR-0029 Decision 3). It is a
 * separate class rather than a generic one shared with commands because the two
 * entries have nothing in common but an id, and a shared base would exist to
 * hold four lines.
 */
export class ToolRegistry {
  readonly #byId = new Map<string, UiTool>();

  constructor(tools: readonly UiTool[]) {
    for (const tool of tools) {
      if (this.#byId.has(tool.id)) {
        throw new Error(
          `Two tools claim the id "${tool.id}". A tool's id is also its command's, so one ` +
            `silently replacing the other would leave a control that selects the wrong tool ` +
            `(ADR-0029 Decision 3). Rename one of them.`,
        );
      }
      this.#byId.set(tool.id, tool);
    }
  }

  /** One tool by id, or `undefined` — which is what *no tool is active* is. */
  get(id: string | undefined): UiTool | undefined {
    return id === undefined ? undefined : this.#byId.get(id);
  }

  /** Every tool, in registration order. */
  all(): readonly UiTool[] {
    return [...this.#byId.values()];
  }

  /** How many are registered. For cases that assert a count. */
  get size(): number {
    return this.#byId.size;
  }
}
