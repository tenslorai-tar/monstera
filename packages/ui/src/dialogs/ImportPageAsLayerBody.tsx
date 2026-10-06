import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  IMPORT_PAGE_AS_LAYER_APPLY,
  IMPORT_PAGE_AS_LAYER_LABEL,
  IMPORT_PAGE_AS_LAYER_RANGE,
  IMPORT_PAGE_AS_LAYER_SOURCE_PAGE,
  IMPORT_PAGE_AS_LAYER_WHICH,
  IMPORT_PAGE_AS_LAYER_WHICH_NONE,
  SOURCE_PAGES_NOTE,
} from '../messages/en.js';
import { useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { SourceDocumentRow } from './DocumentChoice.js';
import type { ImportPageAsLayerAnswer } from './importPageAsLayerResult.js';
import type { SourceDocument } from './sourceDocuments.js';

/**
 * The import-page-as-layer dialog's body — which document's page, and which page of it, is laid over the page the
 * command acts on.
 *
 * The sentence says what will happen in plain words — *Page 1 of Letterhead.pdf will be laid over page 3* — and follows
 * the choices as they change. The numbers shown are 1-based, converted here and nowhere else (`pageNumbering.ts`); a
 * page the source lacks is said on the press, `PageRangeChoice`'s rule.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ImportPageAsLayerBody({
  choices,
  source: openedOn,
  page,
  draft,
  resolve,
}: {
  readonly choices: readonly SourceDocument[];
  readonly source?: string | undefined;
  /** Zero-based, as every page index crossing a boundary here is. */
  readonly page: number;
  readonly draft?: { readonly sourcePage: string } | undefined;
} & DialogAnswering<ImportPageAsLayerAnswer>): ReactElement {
  const { _ } = useLingui();
  const [source, setSource] = useState(openedOn ?? choices[0]?.docId ?? '');
  const chosen = choices.find((choice) => choice.docId === source);
  const [typed, setTyped] = useState(draft?.sourcePage ?? '1');
  const attempt = useAttempt();

  const parsed = Number.parseInt(typed, 10);
  const last = chosen?.pageCount ?? 1;
  const named = /^\d+$/u.test(typed.trim()) && Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= last;
  const problem = attempt.tried && !named ? _(IMPORT_PAGE_AS_LAYER_RANGE, { last }) : '';

  return (
    <div className="m-import-page-as-layer">
      <p className="m-import-page-as-layer__which">
        {chosen === undefined || !named
          ? _(IMPORT_PAGE_AS_LAYER_WHICH_NONE, { page: page + 1 })
          : _(IMPORT_PAGE_AS_LAYER_WHICH, { source: parsed, name: chosen.name, page: page + 1 })}
      </p>
      <SourceDocumentRow
        label={IMPORT_PAGE_AS_LAYER_LABEL}
        choices={choices}
        value={source}
        onChange={setSource}
        onChooseFile={() => {
          resolve({ kind: 'choose-file', draft: { sourcePage: typed } });
        }}
        marker="import-page-as-layer"
      />
      {chosen === undefined ? null : (
        <DialogRow label={IMPORT_PAGE_AS_LAYER_SOURCE_PAGE} note={SOURCE_PAGES_NOTE} problem={problem}>
          <span className="m-page-number-field">
            <Input
              invalid={problem !== ''}
              label={IMPORT_PAGE_AS_LAYER_SOURCE_PAGE}
              labelShownBeside
              value={typed}
              onValueChange={setTyped}
            />
          </span>
        </DialogRow>
      )}
      <DialogFooter>
        <Button
          label={IMPORT_PAGE_AS_LAYER_APPLY}
          variant="primary"
          disabled={chosen === undefined}
          onClick={() => {
            if (chosen === undefined) return;
            attempt.attempt();
            if (!named) return;
            // THE ONE CONVERSION. 1-based on screen, 0-based on the wire.
            resolve({ kind: 'import', source, sourcePage: parsed - 1 });
          }}
        />
      </DialogFooter>
    </div>
  );
}
