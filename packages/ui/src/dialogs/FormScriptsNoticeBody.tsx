import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { FORM_SCRIPTS_NOTICE_BODY, FORM_SCRIPTS_NOTICE_MORE, FORM_SCRIPTS_NOTICE_STANDARD } from '../messages/en.js';

/**
 * The fields whose scripts are never run, named, and that the standard sums and formats still work.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function FormScriptsNoticeBody({ names, more }: { readonly names: readonly string[]; readonly more: number }): ReactElement {
  const { _ } = useLingui();
  const listed = names.join(', ');
  const fields = more > 0 ? _(FORM_SCRIPTS_NOTICE_MORE, { fields: listed, count: more }) : listed;
  return (
    <div className="m-form-scripts-notice" data-form-scripts-notice="">
      <p>{_(FORM_SCRIPTS_NOTICE_BODY, { fields })}</p>
      <p>{_(FORM_SCRIPTS_NOTICE_STANDARD)}</p>
    </div>
  );
}
