import { I18nProvider } from '@lingui/react';
import type { ReactElement, ReactNode } from 'react';

import { activateCatalogue, i18n } from '../i18n.js';
import { CLOSE_LABEL, DIALOG_CANCEL, EN } from '../messages/en.js';
import { Dialog } from '../primitives/Dialog.js';

/**
 * A dialog body's test host: the catalogue, and the `Dialog` primitive around the body, as the registry mounts it.
 *
 * ONE HOST FOR EVERY BODY TEST, because the dialog pattern's footer (2026-10-02) puts the popup's own close in every
 * body, and that close exists only inside the dialog's root — a body rendered bare throws. Each test once spelt its own
 * provider; a dozen copies of the same wrapper are a dozen places for one to forget the dialog.
 *
 * Used by tests only; the application mounts bodies through `DialogHost`.
 */
export function InDialog({
  children,
  onOpenChange = () => undefined,
}: {
  readonly children: ReactNode;
  readonly onOpenChange?: (open: boolean) => void;
}): ReactElement {
  activateCatalogue('en', EN);
  return (
    <I18nProvider i18n={i18n}>
      <Dialog closeLabel={CLOSE_LABEL} onOpenChange={onOpenChange} open title={DIALOG_CANCEL}>
        {children}
      </Dialog>
    </I18nProvider>
  );
}
