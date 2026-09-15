import type { MessageKey } from '@monstera/shared';
import { lazy } from 'react';
import { z } from 'zod';

import { KEYBOARD_SHORTCUTS_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the command opens, and the registry's key. */
export const KEYBOARD_SHORTCUTS_DIALOG_ID = 'dialog.keyboard-shortcuts';

/**
 * Every keyboard shortcut and the command it runs (§10.3's footer: *"Press F1 for keyboard shortcuts"*).
 *
 * ## The command lists and the dialog displays, which is `about.ts`' split
 *
 * `DialogRegistry.openWith` validates props at the open call, so the list is read off the registry before this opens
 * rather than by the body — a body that read its own would be validated before it had anything to validate.
 *
 * ## Titles cross as KEYS
 *
 * Each row carries its command's title key and the body resolves it, so a locale change re-renders the list and no
 * resolved English sits in a validated prop. The chord is the command's own spelling — `Ctrl+O`, `F1` — which is what a
 * person presses and is not translatable text.
 *
 * ## The bound is a stated one
 *
 * 512 rows is far above any registry this application has and small enough that a list gone wrong cannot flood the
 * dialog; a chord longer than 64 characters is not a chord.
 */
export const KEYBOARD_SHORTCUTS_DIALOG = declareDialog({
  id: KEYBOARD_SHORTCUTS_DIALOG_ID,
  title: KEYBOARD_SHORTCUTS_TITLE,
  props: z.object({
    entries: z
      .array(
        z.object({
          chord: z.string().min(1).max(64),
          title: z.custom<MessageKey>((value) => typeof value === 'string' && value.length > 0),
        }),
      )
      .max(512),
  }),
  // Lazy, per ADR-0029 Decision 7: nothing is loaded until this is opened.
  component: lazy(() => import('./KeyboardShortcutsBody.js')),
});
