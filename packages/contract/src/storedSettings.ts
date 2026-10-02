import { z } from 'zod';

import { AI_PROVIDER_IDS, AZURE_OPENAI_ENDPOINT_SETTING_ID, CHAT_HISTORY_SETTING_ID, AI_MODELS_SETTING_ID } from './aiProviders.js';
import {
  BACKUP_COPIES,
  BACKUP_COPIES_SETTING_ID,
  CRASH_REPORTS_SETTING_ID,
  LOG_DETAILS,
  LOG_DETAIL_SETTING_ID,
  MAX_MODEL_ID,
  RECENT_PREVIEWS_SETTING_ID,
  REVIEW_PROMPTS_SETTING_ID,
  UPDATE_CHECK_SETTING_ID,
  type BackupCopies,
} from './channels.js';
import { AZURE_ENDPOINT_SETTING_ID, DOCUSIGN_ENVIRONMENTS, DOCUSIGN_ENVIRONMENT_SETTING_ID } from './schemas.js';

/**
 * The settings `main` reads, each defined ONCE: its id, the schema a stored value must pass, and what an unset or
 * refused value is.
 *
 * ## Why these live here and not only in the registry
 *
 * The settings registry (`packages/ui/src/registries/settings.ts`) is where a setting is declared, and `main` cannot
 * import `packages/ui`. So every value `main` acts on — keep crash reports, how many backups a save keeps, which model
 * reads a scan — used to be read from the settings document by a function of its own, each re-deriving the schema and
 * the default the registry already held: `!== false` for a switch that is on by default, `=== true` for one that is
 * off, a literal `'production'`, a count taken from `.one` and `.ten`. Twelve readers, and every one agreed with the
 * registry on 2026-10-01 — which is the dangerous shape, a partial reimplementation agreeing most of the time, with
 * nothing to compare the two (row 265's Stage 10 audit, CLAUDE.md B3a).
 *
 * So each is a definition here, the registry's entry SPREADS it (the dialog's title, description and category are
 * the registry's own), and `main` reads it only through {@link storedSetting}. A default changed in one place is
 * changed in both, and `settingsReads.test.ts` refuses a new reader in `main` that indexes the document directly.
 */
export interface StoredSetting<Schema extends z.ZodType = z.ZodType> {
  /** `<domain>.<name>`, the key the value is stored under. */
  readonly id: string;
  /** What a stored value must pass. */
  readonly schema: Schema;
  /** What an unset or refused value is. */
  readonly fallback: z.infer<Schema>;
}

/** A setting whose value is text, named without the schema library — `main` takes it and does not depend on `zod`. */
export type TextSetting = StoredSetting<z.ZodString>;

/**
 * The value a stored settings document holds for `setting`: what is stored when the schema accepts it, and the
 * setting's fallback otherwise — a first launch and a hand-edited file are both the default, never an error.
 */
export function storedSetting<Schema extends z.ZodType>(
  stored: Readonly<Record<string, unknown>>,
  setting: StoredSetting<Schema>,
): z.infer<Schema> {
  const parsed = setting.schema.safeParse(stored[setting.id]);
  return parsed.success ? parsed.data : setting.fallback;
}

/** Recent files keep a picture of their first page: on (ADR-0100). */
export const RECENT_PREVIEWS_STORED: StoredSetting<z.ZodBoolean> = {
  id: RECENT_PREVIEWS_SETTING_ID,
  schema: z.boolean(),
  fallback: true,
};

/** Crash reports are kept on this computer: on (ADR-0109, the owner's decision of 2026-09-26). */
export const CRASH_REPORTS_STORED: StoredSetting<z.ZodBoolean> = {
  id: CRASH_REPORTS_SETTING_ID,
  schema: z.boolean(),
  fallback: true,
};

/** Monstera may ask for a Store rating: on. This value IS the opt-out (E3). */
export const REVIEW_PROMPTS_STORED: StoredSetting<z.ZodBoolean> = {
  id: REVIEW_PROMPTS_SETTING_ID,
  schema: z.boolean(),
  fallback: true,
};

/** Check the Store for a newer version: on (ADR-0110). */
export const UPDATE_CHECK_STORED: StoredSetting<z.ZodBoolean> = {
  id: UPDATE_CHECK_SETTING_ID,
  schema: z.boolean(),
  fallback: true,
};

/** How much the diagnostics log records: problems only. */
export const LOG_DETAIL_STORED: StoredSetting<z.ZodEnum<{ [Detail in (typeof LOG_DETAILS)[number]]: Detail }>> = {
  id: LOG_DETAIL_SETTING_ID,
  schema: z.enum(LOG_DETAILS),
  fallback: 'problems',
};

/** The assistant's chats are kept: off (ADR-0093, the owner's specification). */
export const CHAT_HISTORY_STORED: StoredSetting<z.ZodBoolean> = {
  id: CHAT_HISTORY_SETTING_ID,
  schema: z.boolean(),
  fallback: false,
};

/** The model chosen per provider; a provider absent is the provider's default model (ADR-0117). */
export const AI_MODELS_STORED = {
  id: AI_MODELS_SETTING_ID,
  schema: z.partialRecord(z.enum(AI_PROVIDER_IDS), z.string().min(1).max(MAX_MODEL_ID)),
  fallback: {},
} satisfies StoredSetting;

/** Azure OpenAI's resource address: none until the person gives one. */
export const AZURE_OPENAI_ENDPOINT_STORED: StoredSetting<z.ZodString> = {
  id: AZURE_OPENAI_ENDPOINT_SETTING_ID,
  schema: z.string(),
  fallback: '',
};

/** Azure Document Intelligence's resource address, for OCR: none until the person gives one. */
export const AZURE_ENDPOINT_STORED: StoredSetting<z.ZodString> = {
  id: AZURE_ENDPOINT_SETTING_ID,
  schema: z.string(),
  fallback: '',
};

/** Which DocuSign environment an envelope goes to: production. */
export const DOCUSIGN_ENVIRONMENT_STORED: StoredSetting<
  z.ZodEnum<{ [Environment in (typeof DOCUSIGN_ENVIRONMENTS)[number]]: Environment }>
> = {
  id: DOCUSIGN_ENVIRONMENT_SETTING_ID,
  schema: z.enum(DOCUSIGN_ENVIRONMENTS),
  fallback: 'production',
};

/** How many backups a save keeps: one, the one `.bak` every save wrote before this was a choice. */
export const BACKUP_COPIES_STORED = {
  id: BACKUP_COPIES_SETTING_ID,
  schema: z.enum(Object.keys(BACKUP_COPIES) as [BackupCopies, ...BackupCopies[]]),
  fallback: 'one' as BackupCopies,
} satisfies StoredSetting;

/**
 * Every definition above, for the checks that hold them to the registry. A LITERAL list: the failure to fear is one
 * going missing, and a list derived from this module's exports would agree with any omission (audit item 4c).
 */
export const STORED_SETTINGS: readonly StoredSetting[] = [
  RECENT_PREVIEWS_STORED,
  CRASH_REPORTS_STORED,
  REVIEW_PROMPTS_STORED,
  UPDATE_CHECK_STORED,
  LOG_DETAIL_STORED,
  CHAT_HISTORY_STORED,
  AI_MODELS_STORED,
  AZURE_OPENAI_ENDPOINT_STORED,
  AZURE_ENDPOINT_STORED,
  DOCUSIGN_ENVIRONMENT_STORED,
  BACKUP_COPIES_STORED,
];
