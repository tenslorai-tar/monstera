import type { MessageKey } from '@monstera/shared';

import {
  ARROW_TOOL_ID,
  ELLIPSE_TOOL_ID,
  INK_TOOL_ID,
  LINE_TOOL_ID,
  RECTANGLE_TOOL_ID,
  REDACT_TOOL_ID,
} from '../annotations/shapeTools.js';
import {
  ARROW_TOOL_TITLE,
  ELLIPSE_TOOL_TITLE,
  INK_TOOL_TITLE,
  LINE_TOOL_TITLE,
  RECTANGLE_TOOL_TITLE,
  REDACT_TOOL_TITLE,
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
 * Every shape tool's command.
 *
 * A list rather than four call sites at the composition point, for the reason
 * `shapeTools` is one: adding the fifth is an entry here, and a composition
 * root that named each of them individually would be a second place the set of
 * tools is written down.
 */
export function shapeToolCommands(deps: ToolCommandDeps): readonly UiCommand[] {
  return [
    rectangleToolCommand(deps),
    ellipseToolCommand(deps),
    lineToolCommand(deps),
    arrowToolCommand(deps),
    inkToolCommand(deps),
    redactToolCommand(deps),
  ];
}
