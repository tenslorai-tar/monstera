import { RECTANGLE_TOOL_ID } from '../annotations/rectangleTool.js';
import { RECTANGLE_TOOL_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';

/**
 * Selecting a drawing tool, as a registry command.
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
 * way back to reading would be another control — and until a second tool
 * exists there would be no other control, so the first rectangle a person drew
 * would leave them unable to select text. `when` is not the place for it: `when`
 * decides existence, and a tool that vanished once selected is a control that
 * disappears under the pointer.
 *
 * ## No `ribbon` placement, for `toggleRulersCommand`'s reason
 *
 * §7 puts a drawing tool on the ribbon's Comment section and **there is no
 * ribbon**: `projections.ts` computes a model nothing renders, so a ribbon
 * placement today registers into nothing, which is §10.4's display-only sin
 * arriving through the registry rather than through a button. It goes where a
 * person can reach it, and moving it is a one-line edit on the day the ribbon
 * lands.
 */
export interface ToolCommandDeps {
  /** The tool active now, or `undefined` for none. */
  readonly activeTool: () => string | undefined;
  /** Makes one active, or `undefined` to leave drawing altogether. */
  readonly onSelect: (id: string | undefined) => void;
}

export function rectangleToolCommand(deps: ToolCommandDeps): UiCommand {
  return {
    // THE TOOL'S OWN ID. Not a second string that has to agree with it: the
    // registries are joined by this value, and a command whose id merely
    // resembled the tool's would select nothing, silently.
    id: RECTANGLE_TOOL_ID,
    title: RECTANGLE_TOOL_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 40 }],
    // A page to draw on is what this needs, which is what `hasDocument` says.
    when: hasDocument,
    run: (): void => {
      // READ THROUGH THE FUNCTION, not from a captured value: the command is
      // built once, and a captured id would toggle against whatever was active
      // at registration for ever. `toggleRulersCommand` reads its setting the
      // same way for the same reason.
      deps.onSelect(deps.activeTool() === RECTANGLE_TOOL_ID ? undefined : RECTANGLE_TOOL_ID);
    },
  };
}
