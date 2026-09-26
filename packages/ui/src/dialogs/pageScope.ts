import { z } from 'zod';

/**
 * The pages a page dialog was opened for — the command's `targetPages` (ADR-0104): the ticked pages in the Organize
 * grid, else the page being read. Zero-based, and never empty, since a command with no page to act on does not open
 * its dialog.
 *
 * One schema for the seven dialogs that take it, beside `PageScopeChoice`, which draws them — declared in its own
 * module so a dialog's declaration can take it without importing a component its body loads lazily.
 */
export const TARGET_PAGES = z.array(z.number().int().nonnegative()).min(1);
