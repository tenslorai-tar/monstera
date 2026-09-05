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

/** A drag in progress, in the coordinate space the overlay measures. */
export interface Gesture {
  /** Where the pointer went down. */
  readonly from: ViewportPoint;
  /** Where it is now. */
  readonly to: ViewportPoint;
}

/**
 * What a tool does with a drag.
 *
 * @template S the shape drawn while the gesture is in flight, handed back to
 *   {@link ToolController.preview}. {@link Gesture} for every tool this stage
 *   builds; a tool that needs more — an ink stroke's point list — parameterises
 *   it rather than widening this one.
 */
export interface ToolController<S = Gesture> {
  /** Starts a gesture at a point. */
  readonly begin: (at: ViewportPoint) => S;
  /** Moves it. Pure: the caller keeps whichever value it wants. */
  readonly update: (gesture: S, at: ViewportPoint) => S;
  /**
   * What the gesture produced, or `undefined` when it produced nothing.
   *
   * `undefined` is the ordinary outcome for a click that did not drag, and it
   * is a **value rather than a throw** for the reason a capture refusal is: the
   * overlay has to do something sensible with it, and a caller may not catch.
   *
   * The command is `RenderableCommand`, which is the narrower union — the type
   * is what stops a surface expressing a command only main may mint.
   */
  readonly commit: (
    gesture: S,
    page: number,
    transform: PageTransform,
  ) => RenderableCommand | undefined;
  /**
   * What is drawn while the gesture is in flight, in the overlay's own
   * coordinates.
   *
   * A **shape description**, not an element: the overlay owns the SVG surface,
   * so a controller returning markup would put two components in charge of one
   * drawing. It also keeps this module free of React, which is what lets a case
   * assert a preview's geometry by reading four numbers.
   */
  readonly preview: (gesture: S) => ToolPreview | undefined;
}

/**
 * What the overlay draws for a gesture in flight.
 *
 * One member today, and a union rather than a rectangle because the second tool
 * is an ink stroke and the third a line: making the shape a discriminated value
 * now is a member added later, where an inline rectangle would be a change at
 * every call site.
 */
export interface ToolPreview {
  readonly shape: 'rect';
  /** In the overlay's own CSS pixels, already ordered. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

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
