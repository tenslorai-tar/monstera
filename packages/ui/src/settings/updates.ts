import { UPDATE_CHECK_SETTING_ID, UPDATE_MANIFEST } from '@monstera/contract';
import { z } from 'zod';

import { UPDATES_CHECK_DESCRIPTION, UPDATES_CHECK_TITLE } from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * Whether Monstera checks monsterapdf.com for a newer version (ADR-0018: *"A settings entry to disable the check,
 * describing exactly what it sends and what it fetches. Default on."*).
 *
 * Main reads it when the check runs, once per start ([ADR-0110](../../../../docs/DECISIONS/0110-the-update-check-is-built-dormant-and-reads-numbers-only.md)).
 */
export const UPDATE_CHECK_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: UPDATE_CHECK_SETTING_ID,
  title: UPDATES_CHECK_TITLE,
  description: UPDATES_CHECK_DESCRIPTION,
  schema: z.boolean(),
  fallback: true,
  category: 'updates',
};

/**
 * The settings this build registers for updates: **the switch only while the check has an address.**
 *
 * A switch for a check that cannot run is the display-only defect — it would read ON while nothing is ever asked.
 * So the row is derived from the same contract value main's check reads, and going live (ADR-0110) brings the row
 * with it in the same one-line change, rather than a second edit somebody has to remember.
 */
export const UPDATES_SETTINGS: readonly SettingDefinition[] =
  UPDATE_MANIFEST.state === 'live' ? [UPDATE_CHECK_SETTING] : [];
