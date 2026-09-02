import { useLingui } from '@lingui/react';
import { messageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import { SETTINGS_APPLIED_NOW, SETTINGS_NOT_STORED } from '../messages/en.js';

/**
 * The settings-problem dialog's body.
 *
 * ## What is true FIRST, for `SaveProblemBody`'s reason
 *
 * The change did take effect. A user who has just seen the ruler appear and is
 * then shown an error will assume it did not, and will do it again — so the
 * first line says the preference is in force and the second says it will not
 * survive a restart. Leading with the failure teaches the wrong lesson about
 * what they are looking at.
 *
 * ## The setting's name is resolved HERE
 *
 * The prop is a message key, so the name renders in the locale that is active
 * when the dialog is read rather than the one that was active when the write
 * failed. Those differ in exactly one case — a language change that did not
 * persist — which is the case where getting it wrong is most confusing.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SettingsProblemBody({
  setting,
}: {
  readonly setting: string;
}): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-settings-problem">
      {/* `messageKey` THROWS on a value that is not a key, which is right here:
          the prop is a schema-validated string, so a non-key means the caller
          passed a rendered sentence — and a dialog that silently displayed it
          would make the locale bug invisible. */}
      <p>{_(SETTINGS_APPLIED_NOW, { setting: _(messageKey(setting)) })}</p>
      <p>{_(SETTINGS_NOT_STORED)}</p>
    </div>
  );
}
