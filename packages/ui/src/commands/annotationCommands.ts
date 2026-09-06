import type { MessageKey } from '@monstera/shared';

import {
  ARROW_TOOL_ID,
  ELLIPSE_TOOL_ID,
  INK_TOOL_ID,
  LINE_TOOL_ID,
  RECTANGLE_TOOL_ID,
  REDACT_TOOL_ID,
} from '../annotations/shapeTools.js';
import { ERASER_TOOL_ID } from '../annotations/eraserTool.js';
import { CARET_TOOL_ID, STICKY_NOTE_TOOL_ID } from '../annotations/pointTools.js';
import { TEXT_BOX_TOOL_ID } from '../annotations/textTools.js';
import {
  CLOUD_TOOL_ID,
  POLYGON_TOOL_ID,
  POLYLINE_TOOL_ID,
} from '../annotations/vertexTools.js';
import {
  ARROW_TOOL_TITLE,
  CLOUD_TOOL_TITLE,
  ELLIPSE_TOOL_TITLE,
  ERASER_TOOL_TITLE,
  INK_TOOL_TITLE,
  LINE_TOOL_TITLE,
  POLYGON_TOOL_TITLE,
  POLYLINE_TOOL_TITLE,
  RECTANGLE_TOOL_TITLE,
  REDACT_TOOL_TITLE,
  TOOL_CARET_TITLE,
  TOOL_STICKY_NOTE_TITLE,
  TOOL_TEXT_BOX_TITLE,
} from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';

/**
 * Selecting a drawing tool, as registry commands.
 *
 * ## Why the tool is chosen by a COMMAND and not by a toolbar of its own
 *
 * CLAUDE.md: *"There is no second place where a feature is wired."* A palette
 * of tools maintained beside the command registry would be exactly the
 * hand-written layout file the registry exists to forbid, and it would put
 * tools outside the palette and the shortcut map — which is where a person
 * reaches for one while reading with both hands on the keyboard.
 *
 * So a tool is registered twice, in two registries that answer different
 * questions, and the shared id is what joins them without a mapping:
 * `registries/tools.ts` says what the drag does, and this says how a person
 * turns it on.
 *
 * ## A toggle, not a mode a person cannot leave
 *
 * Pressing the tool that is already active turns it off. Without that the only
 * way back to reading would be another control — and pressing a *different*
 * tool switches rather than toggling, which is what makes this a toggle and not
 * a switch. With one tool registered the two agree on every input; the case
 * that separates them is a third tool being active, which is why it exists.
 *
 * `when` is not the place for either: `when` decides existence, and a tool that
 * vanished once selected is a control that disappears under the pointer.
 *
 * ## No `ribbon` placement, for `toggleRulersCommand`'s reason
 *
 * §7 puts a drawing tool on the ribbon's Comment section and **there is no
 * ribbon**: `projections.ts` computes a model nothing renders, so a ribbon
 * placement today registers into nothing, which is §10.4's display-only sin
 * arriving through the registry rather than through a button. These go where a
 * person can reach them, and moving them is a one-line edit on the day the
 * ribbon lands.
 */
export interface ToolCommandDeps {
  /** The tool active now, or `undefined` for none. */
  readonly activeTool: () => string | undefined;
  /** Makes one active, or `undefined` to leave drawing altogether. */
  readonly onSelect: (id: string | undefined) => void;
}

/**
 * One tool's command.
 *
 * @param id the TOOL's id, which is also this command's. Not a second string
 *   that has to agree with it: the registries are joined by this value, and a
 *   command whose id merely resembled the tool's would select nothing, silently
 * @param order where its control sits among the others
 */
function toolCommand(
  id: string,
  title: MessageKey,
  order: number,
  deps: ToolCommandDeps,
): UiCommand {
  return {
    id,
    title,
    placements: [{ surface: 'quick-toolbar', order }],
    // A page to draw on is what this needs, which is what `hasDocument` says.
    when: hasDocument,
    run: (): void => {
      // READ THROUGH THE FUNCTION, not from a captured value: the command is
      // built once, and a captured id would toggle against whatever was active
      // at registration for ever. `toggleRulersCommand` reads its setting the
      // same way for the same reason.
      deps.onSelect(deps.activeTool() === id ? undefined : id);
    },
  };
}

export function rectangleToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(RECTANGLE_TOOL_ID, RECTANGLE_TOOL_TITLE, 40, deps);
}

export function ellipseToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(ELLIPSE_TOOL_ID, ELLIPSE_TOOL_TITLE, 41, deps);
}

export function lineToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(LINE_TOOL_ID, LINE_TOOL_TITLE, 42, deps);
}

export function arrowToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(ARROW_TOOL_ID, ARROW_TOOL_TITLE, 43, deps);
}

export function inkToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(INK_TOOL_ID, INK_TOOL_TITLE, 44, deps);
}

export function redactToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(REDACT_TOOL_ID, REDACT_TOOL_TITLE, 45, deps);
}

/**
 * The text box's command.
 *
 * Identical to its five siblings, and that is the whole point of it being here:
 * the tool behind it is the first that opens a dialog and the first whose
 * commit answers later, and **selecting** it is unchanged by either. A command
 * that had to know its tool asks would be the overlay's table of dialogs one
 * layer up.
 */
export function textBoxToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(TEXT_BOX_TOOL_ID, TOOL_TEXT_BOX_TITLE, 46, deps);
}

/**
 * The sticky note's command.
 *
 * Identical to its seven siblings, and identical for a second reason worth
 * having beside the text box's: that tool was the first to open a dialog, and
 * this one is the first driven by a CLICK rather than a drag. Neither changed
 * what selecting a tool means. A command that had to know how its tool is
 * gestured would be the overlay's dispatch table one layer up.
 */
export function stickyNoteToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(STICKY_NOTE_TOOL_ID, TOOL_STICKY_NOTE_TITLE, 47, deps);
}

/**
 * The caret's command.
 *
 * The ninth built from the same factory, and the tool behind it is the only one
 * with no dependencies at all — which reaches this file as nothing, because
 * selecting a tool never depended on what the tool needs.
 */
export function caretToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(CARET_TOOL_ID, TOOL_CARET_TITLE, 48, deps);
}

/**
 * The three vertex tools' commands.
 *
 * The tools behind these are the first whose gesture outlives a pointer-up, and
 * this file is unchanged by that — which is the point of `complete` living on
 * the controller. A command that had to know its tool takes several presses
 * would be the lifecycle leaking into the registry that turns tools on.
 *
 * The toggle matters more here than anywhere else, and it works already: a
 * half-drawn polygon is abandoned by pressing the tool again, because
 * `onSelect(undefined)` unmounts the overlay and the gesture is a value that
 * overlay holds.
 */
export function polygonToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(POLYGON_TOOL_ID, POLYGON_TOOL_TITLE, 49, deps);
}

export function polylineToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(POLYLINE_TOOL_ID, POLYLINE_TOOL_TITLE, 50, deps);
}

/**
 * The eraser's command.
 *
 * The twelfth from the same factory, and the tool behind it is the first that
 * READS the document rather than only drawing on it — which reaches this file as
 * nothing at all. Selecting a tool has never depended on what the tool needs,
 * and the eraser is the strongest evidence for that: it holds a channel read,
 * answers later, and names an object that already exists, and its registration
 * is one line the same shape as the rectangle's.
 */
export function eraserToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(ERASER_TOOL_ID, ERASER_TOOL_TITLE, 52, deps);
}

export function cloudToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(CLOUD_TOOL_ID, CLOUD_TOOL_TITLE, 51, deps);
}

/**
 * Every annotation tool's command.
 *
 * A list rather than eight call sites at the composition point, for the reason
 * `shapeTools` is one: adding the ninth is an entry here, and a composition
 * root that named each of them individually would be a second place the set of
 * tools is written down.
 *
 * **NOT ONLY THE SHAPES, whatever this function is called.** The sentence here
 * used to read *every shape tool's command*, and it stopped being true the day
 * the text box joined the list — a tool that draws no shape, and now a second
 * one that draws nothing at all. The name is left alone deliberately: renaming
 * an exported function reaches the composition root and two case files, which
 * is a separate edit from the one that makes the description honest. **The name
 * is the residual falsehood and it is stated here rather than fixed quietly**,
 * so the next reader meets the discrepancy in the place a false name would
 * otherwise hide it.
 */
export function shapeToolCommands(deps: ToolCommandDeps): readonly UiCommand[] {
  return [
    rectangleToolCommand(deps),
    ellipseToolCommand(deps),
    lineToolCommand(deps),
    arrowToolCommand(deps),
    inkToolCommand(deps),
    redactToolCommand(deps),
    textBoxToolCommand(deps),
    stickyNoteToolCommand(deps),
    caretToolCommand(deps),
    polygonToolCommand(deps),
    polylineToolCommand(deps),
    cloudToolCommand(deps),
    eraserToolCommand(deps),
  ];
}
