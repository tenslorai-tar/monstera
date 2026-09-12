import { SECRET_SETTING_IDS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { SETTINGS_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import type { SettingDefinition } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';

/** The id the Settings command opens. */
export const SETTINGS_DIALOG_ID = 'dialog.settings';

/** The control a setting's schema derives ([ADR-0056](../../../../docs/DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md) Decision 2). */
export type SettingControl = 'boolean' | 'enum' | 'number' | 'text' | 'secret';

/**
 * Which control a setting gets, or `undefined` for a kind with none.
 *
 * **Decided from the SCHEMA, which is the one thing every setting already
 * declares**, so a setting registered tomorrow arrives in the dialog with no
 * edit here — or, being a kind this does not know, is visibly absent from
 * {@link DIALOG_SETTINGS}, which `settings/all.test.ts` pins.
 *
 * A union with a pattern and an array are the kinds with no honest generic
 * control (ADR-0056 Decision 3): a colour typed into a text box satisfies the
 * schema and offers no colour.
 */
export function controlFor(setting: SettingDefinition): SettingControl | undefined {
  const { schema } = setting;
  if (schema instanceof z.ZodBoolean) return 'boolean';
  if (schema instanceof z.ZodEnum) return 'enum';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodString) return setting.secret === true ? 'secret' : 'text';
  return undefined;
}

/** Every registered setting the dialog can render, in registration order. */
export const DIALOG_SETTINGS: readonly SettingDefinition[] = ALL_SETTINGS.filter(
  (setting) => controlFor(setting) !== undefined,
);

/**
 * What the Settings dialog answers: what CHANGED, never the whole state.
 *
 * `values` is the ordinary settings a person altered, each already parsed by its
 * own schema. `secrets` is a replacement per secret id that was typed, or `''`
 * for one a person asked to remove — the channel's own meaning for an empty
 * value. A secret nobody touched is absent, so a dialog opened and saved
 * without looking at the key field cannot remove one.
 */
export const SETTINGS_RESULT = z
  .object({
    values: z.record(z.string(), z.unknown()),
    secrets: z.partialRecord(z.enum(SECRET_SETTING_IDS), z.string()),
  })
  .strict();

/** What the Settings dialog answers with. */
export type SettingsAnswer = z.infer<typeof SETTINGS_RESULT>;

export const SETTINGS_DIALOG = declareDialog({
  id: SETTINGS_DIALOG_ID,
  title: SETTINGS_TITLE,
  /**
   * The state the dialog opens over. **No secret value is here and none can be**:
   * `storedSecrets` is ids, which is all `settings.loadSecrets` answers.
   */
  props: z
    .object({
      values: z.record(z.string(), z.unknown()),
      storedSecrets: z.array(z.enum(SECRET_SETTING_IDS)),
      secretsAvailable: z.boolean(),
    })
    .strict(),
  result: SETTINGS_RESULT,
  component: lazy(() => import('./SettingsBody.js')),
});
