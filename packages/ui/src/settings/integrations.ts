import {
  DOCUSIGN_ENVIRONMENT_SETTING_ID,
  DOCUSIGN_ENVIRONMENTS,
  DOCUSIGN_INTEGRATION_KEY_SETTING_ID,
} from '@monstera/contract';
import { z } from 'zod';

import {
  DOCUSIGN_ENVIRONMENT_TITLES,
  INTEGRATIONS_DOCUSIGN_ENVIRONMENT_TITLE,
  INTEGRATIONS_DOCUSIGN_KEY_TITLE,
} from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * DocuSign's integration key — the client id registered in DocuSign's Apps and Keys.
 *
 * **Secret**, because `BUILD-PROMPT.md` Part F files every DocuSign value under
 * *Integrations (all secret)*. It never travels on `settings.save`, and the Settings
 * dialog's field is write-only
 * ([ADR-0056](../../../../docs/DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)).
 *
 * **The tokens a sign-in obtains are NOT settings.** `main` holds them in the secret
 * store under its own id, outside the list the renderer may write
 * ([ADR-0059](../../../../docs/DECISIONS/0059-a-sign-in-redirect-returns-on-loopback-for-one-request.md)
 * Decision 4).
 *
 * An empty string is the absent state, and the DocuSign command is hidden while it
 * is — the Azure pair's rule and its reason.
 */
export const DOCUSIGN_INTEGRATION_KEY_SETTING: SettingDefinition<z.ZodString> = {
  id: DOCUSIGN_INTEGRATION_KEY_SETTING_ID,
  title: INTEGRATIONS_DOCUSIGN_KEY_TITLE,
  schema: z.string(),
  fallback: '',
  category: 'integrations',
  secret: true,
};

/**
 * Which DocuSign environment a sign-in reaches.
 *
 * Production by default, because a person sending a document means the real
 * service; the developer demo environment is where an integration key is usually
 * first registered, and the choice is theirs to make.
 */
export const DOCUSIGN_ENVIRONMENT_SETTING: SettingDefinition<z.ZodEnum<{
  production: 'production';
  demo: 'demo';
}>> = {
  id: DOCUSIGN_ENVIRONMENT_SETTING_ID,
  title: INTEGRATIONS_DOCUSIGN_ENVIRONMENT_TITLE,
  schema: z.enum(DOCUSIGN_ENVIRONMENTS),
  fallback: 'production',
  category: 'integrations',
  optionTitles: DOCUSIGN_ENVIRONMENT_TITLES,
};
