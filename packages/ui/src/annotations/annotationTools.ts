import type { UiTool } from '../registries/tools.js';
import { pointTools } from './pointTools.js';
import { shapeTools } from './shapeTools.js';
import type { TextToolDeps } from './textTools.js';
import { textBoxTool } from './textTools.js';
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
export function annotationTools(deps: TextToolDeps): readonly UiTool[] {
  return [...shapeTools, textBoxTool(deps), ...pointTools(deps), ...vertexTools];
}
