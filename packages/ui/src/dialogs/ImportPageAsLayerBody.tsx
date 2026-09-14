import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  IMPORT_PAGE_AS_LAYER_APPLY,
  IMPORT_PAGE_AS_LAYER_LABEL,
  IMPORT_PAGE_AS_LAYER_WHICH,
} from '../messages/en.js';
import { type DocumentChoice, DocumentChoiceSelect } from './DocumentChoice.js';
import type { ImportPageAsLayerAnswer } from './importPageAsLayerResult.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * The import-page-as-layer dialog's body — which document's first page is placed on the
 * page on screen.
 *
 * `ReplacePageBody`'s position, for its reason: the page is the one the reader is looking
 * at, so the dialog states it and asks one question. The number shown is 1-based,
 * converted here and nowhere else (`pageNumbering.ts`).
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ImportPageAsLayerBody({
  choices,
  page,
  resolve,
}: {
  readonly choices: readonly DocumentChoice[];
  /** Zero-based, as every page index crossing a boundary here is. */
  readonly page: number;
} & DialogAnswering<ImportPageAsLayerAnswer>): ReactElement {
  const { _ } = useLingui();
  const [source, setSource] = useState(choices[0]?.docId ?? '');

  return (
    <div className="m-import-page-as-layer">
      <p className="m-import-page-as-layer__which">
        {_(IMPORT_PAGE_AS_LAYER_WHICH, { page: page + 1 })}
      </p>
      <DocumentChoiceSelect
        label={IMPORT_PAGE_AS_LAYER_LABEL}
        choices={choices}
        value={source}
        onChange={setSource}
        marker="import-page-as-layer"
      />
      <Button
        label={IMPORT_PAGE_AS_LAYER_APPLY}
        variant="primary"
        disabled={source === ''}
        onClick={() => {
          if (source === '') return;
          resolve({ source });
        }}
      />
    </div>
  );
}
