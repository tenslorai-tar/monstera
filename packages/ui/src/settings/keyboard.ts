import { z } from 'zod';

import { SHORTCUTS_SETTING_TITLE } from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * The keys a person chose — Part F's *"shortcut editor (rebind any registry command; conflict detection)"*
 * ([ADR-0111](../../../../docs/DECISIONS/0111-a-key-a-person-chose-is-a-setting-applied-before-the-registry-is-built.md)).
 *
 * A command id → the normalised chord chosen for it, or `null` for *no key*. **Only the differences are stored**: a
 * command a person never touched has no entry and keeps its registered default, so a default a later build changes
 * reaches everyone who did not choose otherwise.
 *
 * **Remembered, not a row**: its control is the keyboard shortcuts dialog (Ctrl+/), where each key is changed against the
 * whole list — a generic Settings row could not show which command a key would collide with. The bounds are the
 * dialog's own: 512 commands, 64 characters a chord.
 */
export const SHORTCUTS_SETTING: SettingDefinition<z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>> = {
  id: 'keyboard.shortcuts',
  title: SHORTCUTS_SETTING_TITLE,
  schema: z.record(z.string().min(1).max(128), z.string().min(1).max(64).nullable()),
  fallback: {},
  category: 'keyboard',
  remembered: true,
};
