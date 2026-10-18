import type { ChannelResult } from '@monstera/contract';

/**
 * One block as `document.textBlocks` answers it.
 *
 * Its own module so a module that only reads a block's shape does not declare a dependency on the commands module: a
 * proof imports `textBlockOps.js` from the UI's build, and through `commands/documentCommands.js` its declarations
 * pulled the UI's whole declared graph into the scripts' program, whose DOM-free element types it retyped
 * (VVVVVVV-18, measured 2026-10-18: 38 errors in five walk scripts, none without that import).
 */
export type TextBlock = ChannelResult<'document.textBlocks'>['blocks'][number];
