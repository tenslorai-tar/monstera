import type { MessageKey } from '@monstera/shared';
import { lazy } from 'react';
import { z } from 'zod';

import { KEYBOARD_SHORTCUTS_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the command opens, and the registry's key. */
export const KEYBOARD_SHORTCUTS_DIALOG_ID = 'dialog.keyboard-shortcuts';

/** A chord as a surface prints one. 64 characters is not a chord. */
const CHORD = z.string().min(1).max(64);

/**
 * What the dialog reports as a person changes keys
 * ([ADR-0094](../../../../docs/DECISIONS/0094-a-dialog-may-report-before-it-answers.md)): one command given a key or
 * none, or every key back to its default. The OPENER writes it to the setting — the mutation stays with the command,
 * as ADR-0038 put it — and the dialog has no *Save*, like Settings.
 */
export const KEYBOARD_SHORTCUTS_RESULT = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choose'), id: z.string().min(1).max(128), chord: CHORD.nullable() }).strict(),
  z.object({ kind: z.literal('reset') }).strict(),
]);

export type KeyboardShortcutsAnswer = z.infer<typeof KEYBOARD_SHORTCUTS_RESULT>;

/**
 * Every command and its key, where any key can be changed (the founding record's D12 *"keyboard shortcut reference"*,
 * on Ctrl+/ since ADR-0112 gave F1 to the Help centre; its Part F: *"shortcut editor (rebind any registry command; conflict detection)"*;
 * [ADR-0111](../../../../docs/DECISIONS/0111-a-key-a-person-chose-is-a-setting-applied-before-the-registry-is-built.md)).
 *
 * ## The command lists and the dialog displays, which is `about.ts`' split
 *
 * `DialogRegistry.openWith` validates props at the open call, so the rows are read off the registry before this opens
 * rather than by the body. Titles cross as KEYS, so a locale change re-renders the list and no resolved English sits in
 * a validated prop.
 *
 * `dropped` names the commands whose stored key went back to its default because it no longer passes (another
 * command now has it) — said once, at the top, rather than silently.
 *
 * ## The bound is a stated one
 *
 * 512 rows is far above any registry this application has and small enough that a list gone wrong cannot flood the
 * dialog.
 */
export const KEYBOARD_SHORTCUTS_DIALOG = declareDialog({
  id: KEYBOARD_SHORTCUTS_DIALOG_ID,
  title: KEYBOARD_SHORTCUTS_TITLE,
  props: z
    .object({
      rows: z
        .array(
          z
            .object({
              id: z.string().min(1).max(128),
              title: z.custom<MessageKey>((value) => typeof value === 'string' && value.length > 0),
              chord: CHORD.nullable(),
              fallback: CHORD.nullable(),
              also: z.array(CHORD).max(8),
            })
            .strict(),
        )
        .max(512),
      dropped: z.array(z.string().min(1).max(128)).max(512),
    })
    .strict(),
  result: KEYBOARD_SHORTCUTS_RESULT,
  component: lazy(() => import('./KeyboardShortcutsBody.js')),
});
