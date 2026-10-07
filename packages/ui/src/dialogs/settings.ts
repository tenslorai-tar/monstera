import { AI_PROVIDER_IDS, AZURE_DI_PAGES, SECRET_SETTING_IDS, aiModelListSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { SETTINGS_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import type { SettingCategory, SettingDefinition } from '../registries/settings.js';
import { colourKindOf, enumeratedOf } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { SETTINGS_PAGES, type SettingsPage } from '../settings/pages.js';

/** The id the Settings command opens. */
export const SETTINGS_DIALOG_ID = 'dialog.settings';

/** The control a setting's schema derives ([ADR-0056](../../../../docs/DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md) Decision 2). */
export type SettingControl = 'boolean' | 'enum' | 'choices' | 'number' | 'text' | 'secret' | 'colour' | 'ai-models';

/**
 * Which control a setting gets, or `undefined` for a kind with none.
 *
 * **Decided from the SCHEMA, which is the one thing every setting already
 * declares**, so a setting registered tomorrow arrives in the dialog with no
 * edit here — or, being a kind this does not know, is visibly absent from
 * {@link DIALOG_SETTINGS}, which `settings/all.test.ts` pins.
 *
 * **A colour is the registry's answer, asked first**: a schema `colourSchema`
 * built, never a union recognised by its shape (ADR-0056, corrected 2026-09-15).
 * Any other union with a pattern, and an array of anything but an enum's members,
 * have no honest generic control (Decision 3): a colour typed into a text box
 * satisfies the schema and offers no colour. A SET of an enum's members does — a
 * box per member (ADR-0056, corrected 2026-09-28).
 */
export function controlFor(setting: SettingDefinition): SettingControl | undefined {
  // A DECLARED CONTROL IS ASKED FIRST: it exists because no schema shape could say it (ADR-0117 Decision 3).
  if (setting.control !== undefined) return setting.control;
  const { schema } = setting;
  if (colourKindOf(schema) !== undefined) return 'colour';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  // THE REGISTRY'S READING OF *ENUMERATED*, so a set whose members it titles is a set this draws (ADR-0056,
  // corrected 2026-09-28).
  const enumerated = enumeratedOf(schema);
  if (enumerated !== null) return enumerated.several ? 'choices' : 'enum';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodString) return setting.secret === true ? 'secret' : 'text';
  return undefined;
}

/**
 * Every registered setting the dialog SHOWS, in registration order: one this file can draw a control
 * for, and not one the application merely remembers (`remembered`) — a panel's width is state, and
 * the control for it is the splitter.
 */
export const DIALOG_SETTINGS: readonly SettingDefinition[] = ALL_SETTINGS.filter(
  (setting) => controlFor(setting) !== undefined && setting.remembered !== true,
);

/**
 * Pages listed although no setting sits on them, because what they hold is words or an action.
 *
 * **Named, rather than derived from the page notes**, and that stopped being the same thing the moment
 * every page got a note: listing a page *because it has a note* would have put an empty Viewing page back
 * the instant one was written for it, which is exactly the screen the owner's design calls out. A page
 * earns its place by holding something to read or press — Keyboard points at F1, and Updates says who
 * updates this build. Privacy left this list when *Show previews of recent files* gave it a setting
 * (ADR-0100).
 */
const PAGES_WITHOUT_SETTINGS: readonly SettingCategory[] = ['keyboard', 'updates'];

/**
 * The pages the dialog lists, in the design's order: each that holds a setting it shows, and the two that
 * hold words. **A function of the settings**, so the rule can be asked of a set that leaves a page empty —
 * which the application's own set no longer does, since Saving gained autosave.
 */
export function listedPages(settings: readonly SettingDefinition[]): readonly SettingsPage[] {
  return SETTINGS_PAGES.filter(
    (page) => settings.some((setting) => setting.category === page.id) || PAGES_WITHOUT_SETTINGS.includes(page.id),
  );
}

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
    /**
     * A button on a page, rather than a setting — reported to the command that opened the dialog
     * (ADR-0094), because the body has no client and the command is the writer. `reset` is the
     * footer's *Reset to defaults*; `export` writes the settings to a file a person picks; `import` is the one
     * ANSWERED rather than reported — it closes the dialog, whose values are props fixed while it is open, and the
     * command reopens it on what was imported; and
     * `clear-chat-history` and `clear-recent` empty the saved conversations and the Recent list from the
     * Privacy page.
     */
    action: z.enum(['reset', 'export', 'import', 'clear-chat-history', 'clear-recent']).optional(),
    /**
     * A provider whose STORED key the person asked to check (ADR-0158). Reported, never answered: the command asks
     * `ai.models` for it and replies with that provider's list and one more answered check in {@link SETTINGS_DIALOG}'s
     * `checked`. No key travels, here or in the reply.
     */
    check: z.enum(AI_PROVIDER_IDS).optional(),
    /**
     * A provider whose model list the AI page asks for because a key is stored for it — the same read as {@link check}
     * without the check's verdict: nothing is said about the key, and `checked` does not move. Reported when the page
     * is shown and when the provider changes, so the list a person chooses a model from is the provider's own and
     * never only the build's.
     */
    refresh: z.enum(AI_PROVIDER_IDS).optional(),
    /**
     * A page the OCR setup links to, reported for the opener to open (`app.openWebPage` takes the PLACE and `main` holds
     * the address, so nothing here composes one). Never answered: the dialog stays where it was.
     */
    openPage: z.enum(AZURE_DI_PAGES).optional(),
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
      /**
       * Each provider's model list as `main` held it when the dialog opened — fetched this session or the fallback,
       * never fetched for the dialog (ADR-0117, corrected 2026-09-28). A provider is absent only when that query
       * failed, and its row then says the list could not be read.
       */
      models: z.partialRecord(z.enum(AI_PROVIDER_IDS), aiModelListSchema),
      /**
       * How many of each provider's key checks have been answered since the dialog opened (ADR-0158), the answer being
       * that provider's entry in `models`. A count rather than a flag, so the body can tell the answer to the check it
       * last asked from an earlier one still arriving. Absent until a reply.
       */
      checked: z.partialRecord(z.enum(AI_PROVIDER_IDS), z.number().int().positive()).optional(),
      /** How many of each provider's {@link SETTINGS_RESULT} `refresh` reads have been answered, `checked`'s way. */
      refreshed: z.partialRecord(z.enum(AI_PROVIDER_IDS), z.number().int().positive()).optional(),
    })
    .strict(),
  result: SETTINGS_RESULT,
  component: lazy(() => import('./SettingsBody.js')),
});
