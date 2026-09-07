import type { RenderableCommand } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import {
  ARROW_TOOL_ID,
  ELLIPSE_TOOL_ID,
  INK_TOOL_ID,
  LINE_TOOL_ID,
  RECTANGLE_TOOL_ID,
  REDACT_TOOL_ID,
} from '../annotations/shapeTools.js';
import { CALLOUT_TOOL_ID } from '../annotations/calloutTool.js';
import { ERASER_TOOL_ID } from '../annotations/eraserTool.js';
import { LINK_ADDRESS_TOOL_ID, LINK_PAGE_TOOL_ID } from '../annotations/linkTools.js';
import {
  MEASURE_AREA_TOOL_ID,
  MEASURE_DISTANCE_TOOL_ID,
  MEASURE_PERIMETER_TOOL_ID,
} from '../annotations/measureTools.js';
import type { AnnotationSelection } from '../annotations/selectTool.js';
import { SELECT_TOOL_ID } from '../annotations/selectTool.js';
import { SNAPSHOT_TOOL_ID } from '../annotations/snapshotTool.js';
import {
  HIGHLIGHT_TOOL_ID,
  STRIKEOUT_TOOL_ID,
  UNDERLINE_TOOL_ID,
} from '../annotations/textMarkupTools.js';
import { CARET_TOOL_ID, STICKY_NOTE_TOOL_ID } from '../annotations/pointTools.js';
import { TEXT_BOX_TOOL_ID, TYPEWRITER_TOOL_ID } from '../annotations/textTools.js';
import {
  CLOUD_TOOL_ID,
  POLYGON_TOOL_ID,
  POLYLINE_TOOL_ID,
} from '../annotations/vertexTools.js';
import {
  ARROW_TOOL_TITLE,
  CALLOUT_TOOL_TITLE,
  CLOUD_TOOL_TITLE,
  DELETE_SELECTION_TITLE,
  ELLIPSE_TOOL_TITLE,
  ERASER_TOOL_TITLE,
  HIGHLIGHT_TOOL_TITLE,
  INK_TOOL_TITLE,
  LINE_TOOL_TITLE,
  LINK_ADDRESS_TOOL_TITLE,
  LINK_PAGE_TOOL_TITLE,
  MEASURE_AREA_TOOL_TITLE,
  MEASURE_DISTANCE_TOOL_TITLE,
  MEASURE_PERIMETER_TOOL_TITLE,
  NUDGE_DOWN_TITLE,
  NUDGE_LEFT_TITLE,
  NUDGE_RIGHT_TITLE,
  NUDGE_UP_TITLE,
  POLYGON_TOOL_TITLE,
  POLYLINE_TOOL_TITLE,
  RECTANGLE_TOOL_TITLE,
  REDACT_TOOL_TITLE,
  SELECT_TOOL_TITLE,
  SNAPSHOT_TOOL_TITLE,
  STRIKEOUT_TOOL_TITLE,
  TOOL_CARET_TITLE,
  TOOL_STICKY_NOTE_TITLE,
  TOOL_TEXT_BOX_TITLE,
  TYPEWRITER_TOOL_TITLE,
  UNDERLINE_TOOL_TITLE,
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

/** What a command acting on the selection needs. */
export interface SelectionCommandDeps {
  /**
   * What is selected now, read THROUGH A FUNCTION rather than captured.
   *
   * `toolCommand`'s rule and its reason: a command is built once, and a captured
   * selection would be whatever was selected at registration for ever — which
   * for a `when` predicate means a control that appears once and never leaves.
   */
  readonly selection: () => AnnotationSelection | undefined;
  /** Removes it, through the same dispatcher every other caller uses. */
  readonly onDelete: (selection: AnnotationSelection) => void;
  /** Sends a placement, through that same dispatcher. */
  readonly onPlace: (command: RenderableCommand) => void;
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
 * The three text markups' commands.
 *
 * Registrations, and the tools behind them are three ordinary drag tools — which
 * is the row's own finding rather than this file's: the text layer these were
 * expected to need turned out to belong to MuPDF, so the platform, this file and
 * the overlay are all untouched.
 */
export function highlightToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(HIGHLIGHT_TOOL_ID, HIGHLIGHT_TOOL_TITLE, 36, deps);
}

export function underlineToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(UNDERLINE_TOOL_ID, UNDERLINE_TOOL_TITLE, 37, deps);
}

export function strikeoutToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(STRIKEOUT_TOOL_ID, STRIKEOUT_TOOL_TITLE, 38, deps);
}

/**
 * The two link tools' commands.
 *
 * Registrations again, and the tool behind each sends `addLink` rather than
 * `addAnnotation` — which reaches this file as nothing, for the eleventh time.
 * What a tool does with its gesture has never been this table's business.
 */
/**
 * The callout's command.
 *
 * The tool behind this is the first whose gesture genuinely spans two presses,
 * and the registration is one line — which is ADR-0042's claim paid rather than
 * stated. The lifecycle lives on the controller, so a command that turns a tool
 * on never learns how many presses it takes.
 */
export function calloutToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(CALLOUT_TOOL_ID, CALLOUT_TOOL_TITLE, 55, deps);
}

/**
 * The typewriter's command.
 *
 * **Order 46.5, which is the placement design being used rather than abused.**
 * `Placement.order` is a number precisely so two features that never see each
 * other's code can interleave, and this one has to sit beside the text box: they
 * are the same gesture differing only in whether the box is drawn, so a person
 * choosing between them needs both in view. Renumbering the ten controls after
 * it to make room would touch ten call sites to move one.
 */
export function typewriterToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(TYPEWRITER_TOOL_ID, TYPEWRITER_TOOL_TITLE, 46.5, deps);
}

export function linkAddressToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(LINK_ADDRESS_TOOL_ID, LINK_ADDRESS_TOOL_TITLE, 53, deps);
}

export function linkPageToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(LINK_PAGE_TOOL_ID, LINK_PAGE_TOOL_TITLE, 54, deps);
}

/**
 * The select tool's command.
 *
 * The thirteenth from the same factory, and the tool behind it produces no
 * command at all — which reaches this file as nothing, again. Turning a tool on
 * has never depended on what the tool does when it is on.
 */
export function selectToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(SELECT_TOOL_ID, SELECT_TOOL_TITLE, 39, deps);
}

/**
 * Deleting whatever is selected.
 *
 * ## Not a tool, and not a second remove path
 *
 * The select tool points; this acts. It goes through the same
 * `removeAnnotation` every other caller uses, and it is the reason that payload
 * became plural: five marks selected is one decision and must be one command,
 * or it is five undo steps and four stale handles.
 *
 * ## Where a key reaches a feature is the registry
 *
 * `Delete` is a shortcut on this entry rather than a handler on the overlay or
 * on the selection layer. A key handled by a component is the second wiring
 * place — the palette and the annotation context menu would each need their own
 * route to the same behaviour, and the shortcut map would not know the feature
 * exists.
 *
 * `when` is what keeps the control honest: with nothing selected the entry is
 * hidden rather than present and inert, so pressing Delete over a page with no
 * selection does nothing because there is nothing registered, not because a
 * handler decided to return early.
 */
export function deleteSelectionCommand(deps: SelectionCommandDeps): UiCommand {
  return {
    id: 'annotate.delete-selection',
    title: DELETE_SELECTION_TITLE,
    placements: [{ surface: 'context-menu', context: 'annotation', order: 10 }],
    shortcut: 'Delete',
    when: () => deps.selection() !== undefined,
    run: (): void => {
      const selection = deps.selection();
      if (selection === undefined) return;
      deps.onDelete(selection);
    },
  };
}

/**
 * How far one arrow press moves the selection, in PDF points.
 *
 * A point is the unit the document is measured in, so a nudge is the smallest
 * step that means anything rather than a number chosen for how it feels at some
 * zoom. Ten is the coarse step, which is what Shift means everywhere else.
 */
const NUDGE = 1;
const NUDGE_FAR = 10;

/** Which way an arrow points, in the PAGE's own axes. */
const NUDGES = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, 1],
  down: [0, -1],
} as const;

/** The four arrows' key names, in this object's own order. */
const ARROW_KEYS = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
} as const;

const ARROW_TITLES = {
  left: NUDGE_LEFT_TITLE,
  right: NUDGE_RIGHT_TITLE,
  up: NUDGE_UP_TITLE,
  down: NUDGE_DOWN_TITLE,
} as const;

/**
 * Moving the selection by one step.
 *
 * ## THE PAGE'S AXES, NOT THE SCREEN'S — stated because it is a real limit
 *
 * The selection carries rectangles in PDF user space and this adds to them, so
 * on a `/Rotate 90` page *up* follows the page rather than the screen. Doing it
 * the other way needs the page's `PageTransform`, which lives in the scroller
 * and does not reach the command registry — a command's `run(context)` takes
 * the application's state and no arguments. The trigger for fixing it is a
 * second command that needs the same thing, at which point the transform is
 * worth putting where commands can reach it rather than threading for one.
 *
 * ## Eight commands rather than one with a modifier
 *
 * A shortcut is a chord string on an entry, so `Shift+ArrowUp` is a different
 * entry from `ArrowUp` — and each of the eight then appears in the palette
 * under its own name, which is what a person searching for *nudge* needs.
 */
export function nudgeSelectionCommand(
  direction: keyof typeof NUDGES,
  far: boolean,
  deps: SelectionCommandDeps,
): UiCommand {
  const [dx, dy] = NUDGES[direction];
  const step = far ? NUDGE_FAR : NUDGE;
  return {
    id: `annotate.nudge-${direction}${far ? '-far' : ''}`,
    title: ARROW_TITLES[direction],
    // NO SURFACE. An arrow key is the whole of this control: eight buttons for
    // one-point moves would be a toolbar nobody uses, and the palette reaches
    // every registered command whether or not it is placed.
    placements: [],
    shortcut: `${far ? 'Shift+' : ''}${ARROW_KEYS[direction]}`,
    // WITHOUT A SELECTION THE ARROWS ARE NOT REGISTERED AT ALL, which is what
    // keeps them from taking the key away from the scroller. A handler that
    // returned early would still have swallowed the press.
    when: () => deps.selection() !== undefined,
    run: (): void => {
      const selection = deps.selection();
      if (selection === undefined) return;
      deps.onPlace({
        kind: 'placeAnnotation',
        page: selection.page,
        placements: selection.items.map((item) => ({
          index: item.index,
          rect: {
            x0: item.rect.x0 + dx * step,
            y0: item.rect.y0 + dy * step,
            x1: item.rect.x1 + dx * step,
            y1: item.rect.y1 + dy * step,
          },
        })),
        version: selection.version,
      });
    },
  };
}

/** All eight nudges, so the composition root names the set once. */
export function nudgeSelectionCommands(deps: SelectionCommandDeps): readonly UiCommand[] {
  return (Object.keys(NUDGES) as (keyof typeof NUDGES)[]).flatMap((direction) => [
    nudgeSelectionCommand(direction, false, deps),
    nudgeSelectionCommand(direction, true, deps),
  ]);
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
 * The three measurement tools' commands.
 *
 * **56, 57, 58 — after the callout and adjacent to each other**, which is the
 * one thing worth saying about them: a person reaching for *measure area* has
 * usually just used *measure distance*, and three consecutive orders put them
 * together on every surface the registry projects onto without any surface
 * knowing they are related.
 *
 * The tools behind these take a calibration the others do not, and that reaches
 * this file as nothing at all — the fourteenth, fifteenth and sixteenth
 * registrations from the same factory, each one line.
 */
export function measureDistanceToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(MEASURE_DISTANCE_TOOL_ID, MEASURE_DISTANCE_TOOL_TITLE, 56, deps);
}

export function measureAreaToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(MEASURE_AREA_TOOL_ID, MEASURE_AREA_TOOL_TITLE, 57, deps);
}

export function measurePerimeterToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(MEASURE_PERIMETER_TOOL_ID, MEASURE_PERIMETER_TOOL_TITLE, 58, deps);
}

/**
 * The snapshot's command.
 *
 * **Order 29, at the end of the view block rather than among the marks**, which
 * is the founding record's own grouping: `BUILD-PROMPT.md`:1067 lists the quick
 * toolbar's always-needed tools as *select, hand, text selection, zoom in/out,
 * crop, snapshot, bookmark, comment* — a snapshot is something a reader does to
 * look at a document, not something they draw on it. Its id says the same:
 * `view.snapshot`.
 *
 * **29 and not 20**, which the paragraph above wanted: `documentCommands.ts`
 * already places four controls at 20, and adding a fifth would put this one in
 * a slot whose occupant depends on registration order. The uniqueness case in
 * this file's own suite covers only the commands this file builds, so that
 * collision is one nothing would have reported.
 *
 * It is registered from this file regardless of not being a mark, because this
 * is where every TOOL-selecting command lives and the alternative is a second
 * such factory somewhere else.
 */
export function snapshotToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(SNAPSHOT_TOOL_ID, SNAPSHOT_TOOL_TITLE, 29, deps);
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
    selectToolCommand(deps),
    highlightToolCommand(deps),
    underlineToolCommand(deps),
    strikeoutToolCommand(deps),
    linkAddressToolCommand(deps),
    linkPageToolCommand(deps),
    calloutToolCommand(deps),
    typewriterToolCommand(deps),
    measureDistanceToolCommand(deps),
    measureAreaToolCommand(deps),
    measurePerimeterToolCommand(deps),
    snapshotToolCommand(deps),
  ];
}
