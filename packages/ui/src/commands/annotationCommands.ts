import type { ContractClient, RenderableCommand } from '@monstera/contract';
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
import {
  FORM_FIELD_CHECKBOX_TOOL_ID,
  FORM_FIELD_DROPDOWN_TOOL_ID,
  FORM_FIELD_LISTBOX_TOOL_ID,
  FORM_FIELD_RADIO_TOOL_ID,
  FORM_FIELD_TEXT_TOOL_ID,
} from '../annotations/formFieldTools.js';
import { LINK_ADDRESS_TOOL_ID, LINK_PAGE_TOOL_ID } from '../annotations/linkTools.js';
import {
  MEASURE_AREA_TOOL_ID,
  MEASURE_DISTANCE_TOOL_ID,
  MEASURE_PERIMETER_TOOL_ID,
} from '../annotations/measureTools.js';
import type { AnnotationSelection, SelectedAnnotation } from '../annotations/selectTool.js';
import { SELECT_TOOL_ID } from '../annotations/selectTool.js';
import { ANNOTATION_EDIT_DIALOG_ID } from '../dialogs/annotationEdit.js';
import { ANNOTATION_REPLY_DIALOG_ID } from '../dialogs/annotationReply.js';
import { ANNOTATION_TEXT_RESULT } from '../dialogs/annotationTextResult.js';
import { COMMAND_PROBLEM_DIALOG_ID } from '../dialogs/commandProblem.js';
import { CONTEXT_PANEL_OPEN_SETTING, CONTEXT_PANEL_TAB_SETTING } from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import {
  PLACE_BARCODE_TOOL_ID,
  PLACE_IMAGE_TOOL_ID,
  PLACE_SIGNATURE_TOOL_ID,
} from '../annotations/placeImageTool.js';
import {
  CLAUDE_REGION_TOOL_ID,
  CLOUD_REGION_TOOL_ID,
  OCR_REGION_TOOL_ID,
} from '../annotations/ocrRegionTool.js';
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
  EDIT_SELECTION_TITLE,
  REPLY_SELECTION_TITLE,
  COPY_ANNOTATIONS_TITLE,
  SELECTION_PROPERTIES_TITLE,
  ELLIPSE_TOOL_TITLE,
  ERASER_TOOL_TITLE,
  FORM_FIELD_CHECKBOX_TOOL_TITLE,
  FORM_FIELD_DROPDOWN_TOOL_TITLE,
  FORM_FIELD_LISTBOX_TOOL_TITLE,
  FORM_FIELD_RADIO_TOOL_TITLE,
  FORM_FIELD_TEXT_TOOL_TITLE,
  GROUP_MARKS,
  GROUP_FIELDS,
  GROUP_LINKS,
  GROUP_MARKUP,
  GROUP_MEASURE,
  GROUP_OCR,
  GROUP_REDACT,
  GROUP_SHAPES,
  GROUP_SIGNATURES,
  GROUP_STAMPS,
  GROUP_TEXT,
  PLACE_BARCODE_TOOL_TITLE,
  RIBBON_SNAPSHOT,
  RIBBON_STRIKEOUT,
  RIBBON_REDACT_MARK,
  RIBBON_LINK_ADDRESS,
  RIBBON_LINK_PAGE,
  RIBBON_PLACE_IMAGE,
  RIBBON_OCR_REGION,
  RIBBON_CLOUD_REGION,
  RIBBON_CLAUDE_REGION,
  RIBBON_PLACE_BARCODE,
  RIBBON_PLACE_SIGNATURE,
  RIBBON_COMMENT,
  RIBBON_HIGHLIGHT,
  RIBBON_SELECT,
  GROUP_QUICK_TOOLS,
  RIBBON_FIELD_TEXT,
  RIBBON_FIELD_CHECKBOX,
  RIBBON_FIELD_RADIO,
  RIBBON_FIELD_DROPDOWN,
  RIBBON_FIELD_LISTBOX,
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
  PLACE_IMAGE_TOOL_TITLE,
  PLACE_SIGNATURE_TOOL_TITLE,
  CLAUDE_REGION_TOOL_TITLE,
  CLOUD_REGION_TOOL_TITLE,
  OCR_REGION_TOOL_TITLE,
  SNAPSHOT_TOOL_TITLE,
  STRIKEOUT_TOOL_TITLE,
  TOOL_CARET_TITLE,
  TOOL_STICKY_NOTE_TITLE,
  TOOL_TEXT_BOX_TITLE,
  TYPEWRITER_TOOL_TITLE,
  UNDERLINE_TOOL_TITLE,
} from '../messages/en.js';
import type { IconName } from '../primitives/icons.js';
import type { UiCommand } from '../registries/commands.js';
import type { SectionId } from '../registries/placement.js';
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
  /**
   * Whether the cloud engine has both an endpoint and a key.
   *
   * **Optional, and absent means yes**, which is the right default for the only
   * graphs that omit it: a browser-shim test has no main process to ask, and a
   * predicate defaulting to *hidden* there would make every case about that tool
   * assert on a control nothing mounts. The shipped graph always supplies it.
   *
   * Read as a pair rather than two predicates: an endpoint with no key reaches
   * the service and comes back unauthorised, which tells a reader their key is
   * wrong when they never entered one.
   */
  readonly cloudReady?: () => boolean;
  /**
   * Whether the Claude engine can be offered: an Anthropic key is stored.
   *
   * One input rather than a pair, because this service needs no endpoint — the
   * API's address is the provider's and is not a setting (ADR-0057).
   */
  readonly claudeReady?: () => boolean;
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
 * @param where which ribbon section and group the tool belongs to. **A
 *   parameter and not a constant**, because this function builds the annotation
 *   tools AND the form-field tools, and the two belong to different sections of
 *   the product — a single section here would have put "text field" under
 *   Comment › Markup, which reads as a correct registration and is a wrong
 *   answer to *where is this tool*.
 */
function toolCommand(
  id: string,
  /**
   * The tool's name, or a PAIR where the ribbon needs a shorter one.
   *
   * A union rather than an eighth positional parameter: this factory already
   * takes seven, and a caller passing `undefined` through four of them to reach
   * an abbreviation is how a signature stops being readable. The pair also puts
   * the two texts next to each other at the call site, which is where a reader
   * can see that the short one does not contradict the long one.
   */
  title: MessageKey | { readonly full: MessageKey; readonly ribbon: MessageKey },
  /** The glyph the ribbon draws for this tool (§10.4), from the one closed set. */
  icon: IconName,
  order: number,
  deps: ToolCommandDeps,
  where: { readonly section: SectionId; readonly group: MessageKey } = {
    section: 'comment',
    group: GROUP_MARKUP,
  },
  /**
   * A second condition on top of *there is a document*, or nothing.
   *
   * The network engines need it: without a key their tool would be a control
   * that dispatches a command the service refuses — the wired-tools rule's own
   * defect. `when` is what the registry already has for *this does not exist
   * yet*, and using it keeps a control that cannot work off the screen rather
   * than failing after the drag.
   */
  also?: () => boolean,
): UiCommand {
  const named = typeof title === 'string' ? { full: title, ribbon: undefined } : title;
  return {
    id,
    title: named.full,
    ...(named.ribbon === undefined ? {} : { ribbonTitle: named.ribbon }),
    icon,
    // ONE SURFACE, and §7's own example is why this is not two. *"Highlight
    // legitimately lives in Home › Quick tools, Comment › Markup, and the
    // annotation context menu"* — those are places a reader meets the command
    // at different moments; a ribbon section and the floating pill are both on
    // screen at once, so a tool on both is the same button twice.
    placements: [{ surface: 'ribbon', section: where.section, group: where.group, order }],
    // A page to draw on is what this needs, which is what `hasDocument` says.
    when: also === undefined ? hasDocument : (context) => hasDocument(context) && also(),
    run: (): void => {
      // READ THROUGH THE FUNCTION, not from a captured value: the command is
      // built once, and a captured id would toggle against whatever was active
      // at registration for ever. `toggleRulersCommand` reads its setting the
      // same way for the same reason.
      deps.onSelect(deps.activeTool() === id ? undefined : id);
    },
  };
}

/**
 * The Comment ribbon's groups, the owner's own: Markup · Shapes · Stamps · Measure · Links · Redact.
 *
 * Twenty-nine tools sat in ONE group until 2026-09-23, so the per-group fold had nothing to fold
 * by and the section overflowed. Grouped, each group folds its less-used tools into More on a
 * narrow window, which is what the owner's narrow exports show. No D3 tool leaves the section.
 *
 * **The groups sit in that order by their tools' `order` numbers**, because `ribbonModel` places a
 * group by its earliest member: Shapes from 40, Stamps 52, Measure 56, Links 60, Redact 62. A tool
 * renumbered past a later group's first number moves its whole group.
 */
const SHAPES = { section: 'comment', group: GROUP_SHAPES } as const;
const STAMPS = { section: 'comment', group: GROUP_STAMPS } as const;
const MEASURE = { section: 'comment', group: GROUP_MEASURE } as const;
const LINKS = { section: 'comment', group: GROUP_LINKS } as const;
const REDACT_MARKS = { section: 'comment', group: GROUP_REDACT } as const;
/**
 * The recognition tools are D6's, whose ribbon is Tools › OCR — beside *OCR pages*, where a person
 * looking for recognition looks. They sat in Comment by the factory's default, not by a decision.
 */
const OCR_TOOLS = { section: 'tools', group: GROUP_OCR } as const;

/**
 * A tool command with a SECOND ribbon placement. §7: a command may sit in more than one surface,
 * and the record lists the typewriter under D3 and D4 alike — it is one command in two places, not
 * two commands.
 */
function alsoOn(command: UiCommand, placement: UiCommand['placements'][number]): UiCommand {
  return { ...command, placements: [...command.placements, placement] };
}

export function rectangleToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(RECTANGLE_TOOL_ID, RECTANGLE_TOOL_TITLE, 'Square', 40, deps, SHAPES);
}

export function ellipseToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(ELLIPSE_TOOL_ID, ELLIPSE_TOOL_TITLE, 'Circle', 41, deps, SHAPES);
}

export function lineToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(LINE_TOOL_ID, LINE_TOOL_TITLE, 'Minus', 42, deps, SHAPES);
}

export function arrowToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(ARROW_TOOL_ID, ARROW_TOOL_TITLE, 'MoveUpRight', 43, deps, SHAPES);
}

export function inkToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(INK_TOOL_ID, INK_TOOL_TITLE, 'Pencil', 44, deps);
}

export function redactToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(
    REDACT_TOOL_ID,
    { full: REDACT_TOOL_TITLE, ribbon: RIBBON_REDACT_MARK },
    'RectangleHorizontal',
    62,
    deps,
    REDACT_MARKS,
  );
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
  // AND ON EDIT › TEXT, beside Edit text: a text box is how new words are put on a page.
  return alsoOn(toolCommand(TEXT_BOX_TOOL_ID, TOOL_TEXT_BOX_TITLE, 'TextCursorInput', 46, deps), {
    surface: 'ribbon',
    section: 'edit',
    group: GROUP_TEXT,
    order: 30,
  });
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
  // AND HOME › QUICK TOOLS as v5-02's *Comment* — a note is how a comment is put on a page.
  return alsoOn(
    // LAST ON THE STRIP (80), as v5-02 draws the comment there.
    alsoOnThePill(toolCommand(STICKY_NOTE_TOOL_ID, { full: TOOL_STICKY_NOTE_TITLE, ribbon: RIBBON_COMMENT }, 'StickyNote', 47, deps), 80),
    { surface: 'ribbon', section: 'home', group: GROUP_QUICK_TOOLS, order: 106 },
  );
}

/**
 * The caret's command.
 *
 * The ninth built from the same factory, and the tool behind it is the only one
 * with no dependencies at all — which reaches this file as nothing, because
 * selecting a tool never depended on what the tool needs.
 */
export function caretToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(CARET_TOOL_ID, TOOL_CARET_TITLE, 'ChevronUp', 48, deps);
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
  return toolCommand(POLYGON_TOOL_ID, POLYGON_TOOL_TITLE, 'Pentagon', 49, deps, SHAPES);
}

export function polylineToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(POLYLINE_TOOL_ID, POLYLINE_TOOL_TITLE, 'Spline', 50, deps, SHAPES);
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
  // AND HOME › QUICK TOOLS, §7's own example of one command in two groups.
  return alsoOn(toolCommand(HIGHLIGHT_TOOL_ID, { full: HIGHLIGHT_TOOL_TITLE, ribbon: RIBBON_HIGHLIGHT }, 'Highlighter', 36, deps), {
    surface: 'ribbon',
    section: 'home',
    group: GROUP_QUICK_TOOLS,
    order: 104,
  });
}

export function underlineToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(UNDERLINE_TOOL_ID, UNDERLINE_TOOL_TITLE, 'Underline', 37, deps);
}

export function strikeoutToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(
    STRIKEOUT_TOOL_ID,
    { full: STRIKEOUT_TOOL_TITLE, ribbon: RIBBON_STRIKEOUT },
    'Strikethrough',
    38,
    deps,
  );
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
  return toolCommand(CALLOUT_TOOL_ID, CALLOUT_TOOL_TITLE, 'MessageSquareQuote', 55, deps);
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
  // AND ON EDIT › TEXT, where the record's D4 lists it too.
  return alsoOn(toolCommand(TYPEWRITER_TOOL_ID, TYPEWRITER_TOOL_TITLE, 'Keyboard', 46.5, deps), {
    surface: 'ribbon',
    section: 'edit',
    group: GROUP_TEXT,
    order: 40,
  });
}

export function linkAddressToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(
    LINK_ADDRESS_TOOL_ID,
    { full: LINK_ADDRESS_TOOL_TITLE, ribbon: RIBBON_LINK_ADDRESS },
    'Link',
    60,
    deps,
    LINKS,
  );
}

export function linkPageToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(
    LINK_PAGE_TOOL_ID,
    { full: LINK_PAGE_TOOL_TITLE, ribbon: RIBBON_LINK_PAGE },
    'Link2',
    61,
    deps,
    LINKS,
  );
}

/**
 * The select tool's command.
 *
 * The thirteenth from the same factory, and the tool behind it produces no
 * command at all — which reaches this file as nothing, again. Turning a tool on
 * has never depended on what the tool does when it is on.
 */
export function selectToolCommand(deps: ToolCommandDeps): UiCommand {
  // AND HOME › QUICK TOOLS, first, as v5-02 draws it.
  return alsoOn(
    alsoOnThePill(toolCommand(SELECT_TOOL_ID, { full: SELECT_TOOL_TITLE, ribbon: RIBBON_SELECT }, 'MousePointer2', 39, deps), 39),
    { surface: 'ribbon', section: 'home', group: GROUP_QUICK_TOOLS, order: 100 },
  );
}

/**
 * Adds the floating pill to a command that is already in a ribbon section.
 *
 * **The overlap is §10.3's list and nothing else** — *"the always-needed tools
 * (select, hand, text selection, zoom in/out, crop, snapshot, bookmark,
 * comment)"*. The pill and a ribbon section are both on screen at once, so any
 * other command on both is the same button twice; a helper with this comment on
 * it is what makes adding a thirty-seventh one a decision rather than a habit.
 *
 * Three of that list are commands here — select, snapshot and the sticky note.
 * Hand and text selection (2026-09-24), zoom and crop declare their own in
 * `documentCommands.ts`, where they live. Bookmark is not built: the design draws
 * it as an unlabelled glyph, and whether it adds a bookmark or shows the panel is
 * a question for the owner.
 */
function alsoOnThePill(command: UiCommand, order: number): UiCommand {
  return { ...command, placements: [...command.placements, { surface: 'quick-toolbar', order }] };
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
    // LAST IN THE ANNOTATION MENU, which is the owner's order for it (§7's row, 2026-09-19):
    // edit, reply, properties, copy, delete. The numbers between are what the owed items take.
    placements: [{ surface: 'context-menu', context: 'annotation', order: 50 }],
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
 * Which subtypes this build offers to EDIT the text of.
 *
 * ## An allowlist in the surface, and not in the command
 *
 * `/Contents` is legal on every markup subtype, and `applyEditAnnotationText`
 * writes it without asking what the mark is — a kernel-side list would be a
 * second opinion about the format (B3a). What this list decides is a different
 * question: **which marks does this application draw the text of**, so that
 * *Edit* is offered where a person will see their change and hidden where the
 * text would go into the file and nowhere else.
 *
 * The four here are the ones whose words are visible: a note's popup, and the
 * three subtypes whose appearance IS their text. A highlight carrying a comment
 * is a real thing in the format and this build has no surface that shows one,
 * so offering *Edit* on a highlight would be a control whose effect a person
 * cannot see — the display-only defect with the pieces the other way round.
 *
 * **The trigger for widening it is a surface, not a subtype**: the day anything
 * renders a markup's comment, the kind joins this list in that commit.
 */
const EDITABLE_TEXT_KINDS: ReadonlySet<string> = new Set([
  'sticky-note',
  'text-box',
  'typewriter',
  'callout',
]);

/**
 * Rewrites what ONE selected mark says.
 *
 * ## First in the annotation menu, and singular where its neighbours are not
 *
 * *Delete* and the styles panel act on everything selected, because deleting
 * four marks is one decision. Editing is not: there is one box to type in, so
 * the item is hidden unless exactly one mark is selected rather than acting on
 * the first of several — which would be a control that quietly picks.
 *
 * ## The text comes from the SELECTION, not from a read
 *
 * `selection.items[0].contents` was carried out of the walk that produced the
 * handles, so the dialog opens holding text from the same answer the index
 * points into. A command that fetched it when the item was clicked would be a
 * second reader of that walk (B3a) and could answer at a version the handle no
 * longer names.
 *
 * ## The version travels with the command
 *
 * `editAnnotationText` declares `targets: 'annotation'`, so the bus refuses it
 * if the document has moved since the walk — the same staleness rule
 * *Delete* and the styles panel meet. The version sent is the selection's,
 * which is the one the index is a position in.
 */
export function editSelectionCommand(
  deps: SelectionCommandDeps & {
    readonly ask: (id: string, props: unknown) => Promise<unknown>;
  },
): UiCommand {
  const only = (): SelectedAnnotation | undefined => {
    const selection = deps.selection();
    if (selection?.items.length !== 1) return undefined;
    const item = selection.items[0];
    return item !== undefined && EDITABLE_TEXT_KINDS.has(item.kind) ? item : undefined;
  };
  return {
    id: 'annotate.edit-selection',
    title: EDIT_SELECTION_TITLE,
    // FIRST, which is the owner's order for this menu: edit, reply, properties,
    // copy, delete.
    placements: [{ surface: 'context-menu', context: 'annotation', order: 10 }],
    when: () => only() !== undefined,
    run: async (): Promise<void> => {
      const selection = deps.selection();
      const item = only();
      if (selection === undefined || item === undefined) return;
      const answered = ANNOTATION_TEXT_RESULT.safeParse(
        await deps.ask(ANNOTATION_EDIT_DIALOG_ID, { text: item.contents }),
      );
      // A DISMISSED DIALOG AND A REFUSED ANSWER ARE BOTH NOTHING TO SEND, which
      // is the platform's gate — and here it also covers the person who cleared
      // the box, because the result schema refuses a blank string.
      if (!answered.success) return;
      deps.onPlace({
        kind: 'editAnnotationText',
        page: selection.page,
        index: item.index,
        text: answered.data.text,
        version: selection.version,
      });
    },
  };
}

/**
 * Answers the selected mark — §7's *reply*, second in the annotation menu.
 *
 * ## Offered on EVERY subtype, where *Edit* is offered on four
 *
 * The two look like a pair and their `when` predicates are deliberately not the
 * same. *Edit* is confined to the kinds this application DRAWS the text of,
 * because a change a person cannot see is worse than an absent control. A reply
 * is a mark of its own carrying its own text, so answering a highlight, an ink
 * stroke or a stranger's stamp all produce something visible — there is no kind
 * where the answer would go into the file and nowhere else.
 *
 * ## And it is offered on a mark this build did not write
 *
 * `authored` is not consulted. Answering somebody's comment writes a new
 * annotation and does not touch theirs, which the kernel's apply is careful
 * about: `markAuthored` runs on the reply alone, so a foreign mark comes out of
 * this byte-identical.
 *
 * ## One mark, for `editSelectionCommand`'s reason
 *
 * A marquee of four and one reply is not an operation anybody intends — it is
 * either four replies carrying one sentence, or a reply to whichever mark the
 * loop reached first. The control is hidden rather than guessing.
 */
export function replySelectionCommand(
  deps: SelectionCommandDeps & {
    readonly ask: (id: string, props: unknown) => Promise<unknown>;
  },
): UiCommand {
  const only = (): SelectedAnnotation | undefined => {
    const selection = deps.selection();
    if (selection?.items.length !== 1) return undefined;
    return selection.items[0];
  };
  return {
    id: 'annotate.reply-selection',
    title: REPLY_SELECTION_TITLE,
    // SECOND, which is the owner's order for this menu: edit, reply,
    // properties, copy, delete.
    placements: [{ surface: 'context-menu', context: 'annotation', order: 20 }],
    when: () => only() !== undefined,
    run: async (): Promise<void> => {
      const selection = deps.selection();
      const item = only();
      if (selection === undefined || item === undefined) return;
      // THE DIALOG OPENS EMPTY, which is the difference from *Edit* at the call
      // site rather than in the dialog: an edit starts from what the mark says,
      // and a reply starts from nothing because it is not that mark's text.
      const answered = ANNOTATION_TEXT_RESULT.safeParse(
        await deps.ask(ANNOTATION_REPLY_DIALOG_ID, {}),
      );
      if (!answered.success) return;
      deps.onPlace({
        kind: 'replyToAnnotation',
        page: selection.page,
        index: item.index,
        text: answered.data.text,
        version: selection.version,
      });
    },
  };
}

/**
 * Copies the selected marks — §7's *copy*, fourth in the annotation menu.
 *
 * ## The marks go to MAIN, and this is told a count
 *
 * A paste is an `importAnnotations`, which carries bytes and is withheld from the renderer (B5), so
 * main holds the clipboard and this command only names what to copy: the page, the walk indices
 * and the version the selection was read at. `onCopied` is how the shell learns there is something
 * to paste, so *Paste annotations* can appear — the count, never the marks.
 *
 * ## Every selected kind is offered, and the answer says what did not travel
 *
 * Which subtypes the interchange carries is the kernel's rule (`INTERCHANGE_SUBTYPES`), and a list
 * of them here would be a second opinion that agrees until the kernel learns one more. So Copy is
 * offered on any selection, and a selection with nothing exchangeable is TOLD so, through the
 * command-problem dialog — a Copy that did nothing looks exactly like one that worked until the
 * paste finds nothing. A stale selection is told the same way, with the sentence that already
 * exists for a handle the document has moved past.
 *
 * No chord: Ctrl+C is the selected-text Copy, and one chord cannot name two commands.
 */
export function copyAnnotationsCommand(
  deps: SelectionCommandDeps & {
    readonly client: ContractClient;
    readonly ask: (id: string, props: unknown) => Promise<unknown>;
    readonly onCopied: (count: number) => void;
  },
): UiCommand {
  return {
    id: 'annotate.copy-selection',
    title: COPY_ANNOTATIONS_TITLE,
    // FOURTH, the owner's order for this menu: edit, reply, properties, copy, delete.
    placements: [{ surface: 'context-menu', context: 'annotation', order: 40 }],
    when: () => deps.selection() !== undefined,
    run: async (context): Promise<void> => {
      const selection = deps.selection();
      if (selection === undefined || context.docId === undefined) return;
      const answer = await deps.client['document.copyAnnotations']({
        docId: context.docId,
        page: selection.page,
        indices: selection.items.map((item) => item.index),
        version: selection.version,
      });
      if (!answer.ok) {
        void deps.ask(COMMAND_PROBLEM_DIALOG_ID, { code: answer.error.code });
        return;
      }
      if (answer.value.kind === 'stale') {
        void deps.ask(COMMAND_PROBLEM_DIALOG_ID, { code: 'stale-target' });
        return;
      }
      if (answer.value.kind === 'nothing-copyable') {
        void deps.ask(COMMAND_PROBLEM_DIALOG_ID, { code: 'not-copyable' });
        return;
      }
      deps.onCopied(answer.value.copied);
    },
  };
}

/**
 * The selected marks' PROPERTIES: the right panel, open, on the tab that holds them.
 *
 * ## It opens rather than toggles, and that is what a menu item may do
 *
 * `view.toggle-context-panel` is the panel's own command and flips it — right for a chord and for
 * the status bar's chrome group, wrong under a pointer on a mark: half the time *Properties* would
 * hide the properties. So this one sets both values it needs rather than inverting either, and the
 * panel's two settings stay the single owners of what is on screen (the tab strip and a command
 * move the same value, which is `ContextPanel`'s own rule).
 *
 * Nothing about the selection is written here: the panel already draws the selected marks' styles,
 * so what this command does is make that visible. A version that copied the selection into the
 * panel would be the second wiring place the registry exists to forbid.
 */
export function selectionPropertiesCommand(
  deps: SelectionCommandDeps & { readonly settings: SettingsStore },
): UiCommand {
  return {
    id: 'annotate.properties',
    title: SELECTION_PROPERTIES_TITLE,
    placements: [{ surface: 'context-menu', context: 'annotation', order: 30 }],
    when: () => deps.selection() !== undefined,
    run: (): void => {
      if (deps.selection() === undefined) return;
      deps.settings.set(CONTEXT_PANEL_OPEN_SETTING.id, true);
      deps.settings.set(CONTEXT_PANEL_TAB_SETTING.id, 'properties');
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
  return toolCommand(ERASER_TOOL_ID, ERASER_TOOL_TITLE, 'Eraser', 52, deps);
}

export function cloudToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(CLOUD_TOOL_ID, CLOUD_TOOL_TITLE, 'Cloud', 51, deps, SHAPES);
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
  return toolCommand(MEASURE_DISTANCE_TOOL_ID, MEASURE_DISTANCE_TOOL_TITLE, 'RulerDimensionLine', 56, deps, MEASURE);
}

export function measureAreaToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(MEASURE_AREA_TOOL_ID, MEASURE_AREA_TOOL_TITLE, 'SquareDashed', 57, deps, MEASURE);
}

export function measurePerimeterToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(MEASURE_PERIMETER_TOOL_ID, MEASURE_PERIMETER_TOOL_TITLE, 'Hexagon', 58, deps, MEASURE);
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
  return alsoOnThePill(
    toolCommand(
      SNAPSHOT_TOOL_ID,
      { full: SNAPSHOT_TOOL_TITLE, ribbon: RIBBON_SNAPSHOT },
      'Camera',
      // LATE IN MARKUP, which folds from the end: a snapshot is not a mark, and the marks a person
      // reaches for first — highlight, underline, strike — are what stay drawn on a narrow window.
      // The pill has its own order: after crop, as v5-02's strip draws it.
      58,
      deps,
    ),
    72,
  );
}

/**
 * The place-image tool's command.
 *
 * **59, among the marks**, where the snapshot above is at 29 with the view
 * controls. The two tools have the same gesture and the same shape — drag a
 * box, main does the rest — and they are not the same kind of thing: a
 * snapshot is something a reader does to LOOK at a document, and this puts an
 * object into it that survives the save.
 */
export function placeImageToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(
    PLACE_IMAGE_TOOL_ID,
    { full: PLACE_IMAGE_TOOL_TITLE, ribbon: RIBBON_PLACE_IMAGE },
    'Image',
    52,
    deps,
    // A STAMP: D3's custom-image stamp IS this tool (its FEATURES row says so).
    STAMPS,
  );
}

/**
 * The place-signature tool's command.
 *
 * **On the Protect ribbon, beside *Sign document***, which is where a person
 * looks for signing — the tool is a way of signing that happens to start with a
 * drag, not a mark. 15 sits between *Sign document* at 10 and *Check
 * signatures* at 20, so the group reads invisible, visible, verify.
 */
export function placeSignatureToolCommand(deps: ToolCommandDeps): UiCommand {
  // AND HOME › QUICK TOOLS as v5-02's *Sign*. Captioned *Signature* in both places: *Sign* beside
  // Protect's *Sign document* would read as two names for one thing.
  return alsoOn(
    toolCommand(PLACE_SIGNATURE_TOOL_ID, { full: PLACE_SIGNATURE_TOOL_TITLE, ribbon: RIBBON_PLACE_SIGNATURE }, 'PenTool', 15, deps, {
      section: 'protect',
      group: GROUP_SIGNATURES,
    }),
    { surface: 'ribbon', section: 'home', group: GROUP_QUICK_TOOLS, order: 108 },
  );
}

/**
 * The place-barcode tool's command.
 *
 * **Organize › Marks, secondary, at 60**, beside *Read barcodes* at 62: a barcode is something a page
 * is given, like a Bates number or a watermark, and the owner's v5 Marks group draws Bates · Header ·
 * Watermark · Background · TOC, so the two barcode tools sit in its More (ADR-0098), make then read.
 */
export function placeBarcodeToolCommand(deps: ToolCommandDeps): UiCommand {
  const command = toolCommand(PLACE_BARCODE_TOOL_ID, { full: PLACE_BARCODE_TOOL_TITLE, ribbon: RIBBON_PLACE_BARCODE }, 'QrCode', 60, deps, {
    section: 'organize',
    group: GROUP_MARKS,
  });
  return {
    ...command,
    placements: command.placements.map((placement) =>
      placement.surface === 'ribbon' ? { ...placement, prominence: 'secondary' as const } : placement,
    ),
  };
}

/**
 * The OCR region tool's command.
 *
 * **60, among the marks**, beside the place-image tool and for its reason: both put
 * something into the document that survives the save, where the snapshot at 29 is
 * something a reader does to look at one. A recognised region becomes an invisible
 * text layer, which is as much a change to the document as a stamp is.
 *
 * It is the control that makes the tool reachable, which is the whole of why it
 * exists: `annotationCommands.test.ts` joins this file's commands against the tool
 * registry's ids and fails on a tool nothing can select — the wired-tools rule with
 * a test behind it.
 */
export function ocrRegionToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(
    OCR_REGION_TOOL_ID,
    { full: OCR_REGION_TOOL_TITLE, ribbon: RIBBON_OCR_REGION },
    'ScanSearch',
    50,
    deps,
    OCR_TOOLS,
  );
}

/**
 * The cloud engine's control, hidden until its endpoint AND key are both set.
 *
 * Without credentials the drag would spend a round trip to be told the service
 * refused a key nobody entered — and the reader would read that as *the service
 * is broken* rather than as *I have not set this up*.
 */
export function cloudRegionToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(
    CLOUD_REGION_TOOL_ID,
    { full: CLOUD_REGION_TOOL_TITLE, ribbon: RIBBON_CLOUD_REGION },
    'CloudUpload',
    52,
    deps,
    OCR_TOOLS,
    () => deps.cloudReady?.() ?? true,
  );
}

/**
 * The Claude engine's control, hidden until an Anthropic key is stored.
 *
 * The cloud tool's `when` and its reason: without a key the drag would spend a
 * round trip to be told there is none, which reads as a broken service. **63**,
 * beside the cloud tool at 62.
 */
export function claudeRegionToolCommand(deps: ToolCommandDeps): UiCommand {
  return toolCommand(
    CLAUDE_REGION_TOOL_ID,
    { full: CLAUDE_REGION_TOOL_TITLE, ribbon: RIBBON_CLAUDE_REGION },
    'Sparkles',
    53,
    deps,
    OCR_TOOLS,
    () => deps.claudeReady?.() ?? true,
  );
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
    placeImageToolCommand(deps),
    placeSignatureToolCommand(deps),
    placeBarcodeToolCommand(deps),
    ocrRegionToolCommand(deps),
    cloudRegionToolCommand(deps),
    claudeRegionToolCommand(deps),
    ...formFieldToolCommands(deps),
  ];
}

/**
 * The five create-field tools' commands.
 *
 * A nested list rather than five entries above, because they arrive together and
 * leave together: the set is *what pdf-lib has a factory for*, which is a fact
 * about the writer of record rather than a choice made here. A signature tool is
 * absent for that reason and nothing in this file has to say so — there is no
 * id to give a command to.
 *
 * Ordered after every annotation tool. They are the Forms ribbon's, and the
 * quick toolbar orders by number rather than by group, so the numbers are what
 * keeps them together.
 */
export function formFieldToolCommands(deps: ToolCommandDeps): readonly UiCommand[] {
  // FORMS › FIELDS, named once here rather than five times below.
  const fields = { section: 'forms', group: GROUP_FIELDS } as const;
  return [
    toolCommand(FORM_FIELD_TEXT_TOOL_ID, { full: FORM_FIELD_TEXT_TOOL_TITLE, ribbon: RIBBON_FIELD_TEXT }, 'TextCursor', 70, deps, fields),
    toolCommand(FORM_FIELD_CHECKBOX_TOOL_ID, { full: FORM_FIELD_CHECKBOX_TOOL_TITLE, ribbon: RIBBON_FIELD_CHECKBOX }, 'SquareCheck', 71, deps, fields),
    toolCommand(FORM_FIELD_RADIO_TOOL_ID, { full: FORM_FIELD_RADIO_TOOL_TITLE, ribbon: RIBBON_FIELD_RADIO }, 'CircleDot', 72, deps, fields),
    toolCommand(FORM_FIELD_DROPDOWN_TOOL_ID, { full: FORM_FIELD_DROPDOWN_TOOL_TITLE, ribbon: RIBBON_FIELD_DROPDOWN }, 'ChevronDown', 73, deps, fields),
    toolCommand(FORM_FIELD_LISTBOX_TOOL_ID, { full: FORM_FIELD_LISTBOX_TOOL_TITLE, ribbon: RIBBON_FIELD_LISTBOX }, 'List', 74, deps, fields),
  ];
}
