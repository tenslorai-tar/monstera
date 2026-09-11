import type { UiTool } from '../registries/tools.js';
import type { EraserDeps } from './eraserTool.js';
import { eraserTool } from './eraserTool.js';
import { calloutTool } from './calloutTool.js';
import { formFieldTools } from './formFieldTools.js';
import { linkTools } from './linkTools.js';
import type { MeasureDeps } from './measureTools.js';
import { measureTools } from './measureTools.js';
import type { PlaceImageDeps } from './placeImageTool.js';
import { placeImageTool } from './placeImageTool.js';
import { pointTools } from './pointTools.js';
import type { SelectDeps } from './selectTool.js';
import { selectTool } from './selectTool.js';
import type { OcrRegionDeps } from './ocrRegionTool.js';
import { ocrRegionTool } from './ocrRegionTool.js';
import type { SnapshotDeps } from './snapshotTool.js';
import { snapshotTool } from './snapshotTool.js';
import { textMarkupTools } from './textMarkupTools.js';
import { shapeTools } from './shapeTools.js';
import type { TextToolDeps } from './textTools.js';
import { textBoxTool, typewriterTool } from './textTools.js';
import { vertexTools } from './vertexTools.js';

/**
 * Every annotation tool, composed once.
 *
 * ## Why this exists, which is a case that could drift
 *
 * `App.tsx` used to spread the four groups into `new ToolRegistry([...])`
 * itself, and `annotationCommands.test.ts` — asserting that every registered
 * tool has a command — had to build the same list a second time to have
 * anything to compare. Two statements of *what the tools are*, kept in step by
 * hand, in a case whose whole subject is a join going stale (B3a).
 *
 * It went stale immediately. The vertex tools were added to the app and to the
 * command list and not to the case's copy, and the case failed — correctly, but
 * about its own list rather than about the product. A check whose fixture can
 * disagree with the thing it checks reports a defect that is not there, which
 * costs the same attention as missing one.
 *
 * So the composition lives here, the app mounts it, and the case reads it. The
 * assertion is then between two genuinely different registries — the tools and
 * their commands — rather than between a list and a copy of itself.
 *
 * ## It takes the deps rather than holding them
 *
 * Two of these tools open a dialog and need `ask`, and the composition cannot
 * capture one: `App.tsx`'s `ask` is bound to the dialog host for that render.
 * Passing them through keeps this a list rather than a component with state,
 * which is what lets a case call it with a stub.
 */
export function annotationTools(deps: AnnotationToolDeps): readonly UiTool[] {
  return [
    ...shapeTools(deps.style),
    textBoxTool(deps),
    typewriterTool(deps),
    ...pointTools(deps),
    ...vertexTools(deps.style),
    ...textMarkupTools(deps.style),
    ...measureTools(deps),
    ...linkTools(deps),
    calloutTool(deps),
    eraserTool(deps),
    selectTool(deps),
    // NOT AN ANNOTATION TOOL, and it is composed here anyway: this list is what
    // the registry mounts and what `annotationCommands.test.ts` joins against,
    // so a tool composed anywhere else would be a second place tools are named
    // — which is the exact drift this file exists to have stopped. The file's
    // name is the residual falsehood, stated rather than fixed quietly.
    snapshotTool(deps),
    // THE SAME GESTURE AND A COMMAND, which is the one difference worth naming
    // beside the snapshot above: a region's recognition changes the document, so
    // `commit` answers a `RenderableCommand` and the registry dispatches it. D6
    // row 6, registered into ADR-0042's platform with nothing widened.
    ocrRegionTool(deps),
    placeImageTool(deps),
    // NOT ANNOTATION TOOLS EITHER, and composed here for the reason the two
    // above are: this list is what the registry mounts and what
    // `annotationCommands.test.ts` joins against, so a tool composed anywhere
    // else would be a second place tools are named. A field is a widget rather
    // than a comment — measured on the fill row, the annotation walk filters
    // widgets out entirely — so these are as far from an annotation as the
    // snapshot is, and they draw with the same gesture.
    ...formFieldTools(deps),
  ];
}

/**
 * Everything any annotation tool needs from the application.
 *
 * **One bag rather than a parameter per tool**, and it stays that way for the
 * reason it started that way: the composition is a list, and a signature that
 * grew a field per tool would make the composition root know which tool needs
 * what — the knowledge the registry exists to hold in one place. A tool that
 * needs neither takes it and reads nothing.
 *
 * The members are genuinely different questions, which is why this is an
 * intersection rather than one interface: `ask` puts something to a person,
 * `annotations` asks the document, and `scale` is a fact about the drawing. The
 * eraser is the first tool to need the second, and the first to need anything
 * about the document at all.
 */
export type AnnotationToolDeps = TextToolDeps &
  EraserDeps &
  SelectDeps &
  MeasureDeps &
  SnapshotDeps &
  OcrRegionDeps &
  PlaceImageDeps;
