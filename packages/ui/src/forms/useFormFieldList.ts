import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useEffect, useState } from 'react';

import { readWholeList } from '../readWholeList.js';
import type { ListedField } from './fieldFill.js';

/**
 * The form's fields, whole, at the version on show: the ONE reader of `document.formFields` that the surfaces beside the
 * page share (the fields drawn on the visible pages, and the Properties pane's selected fields).
 *
 * ## Only at the version it was read at
 *
 * A field is named by its place in its page's widget walk at a version, so a list read for another version would name
 * the wrong widgets. The answer is kept with the version it describes, and an answer that does not match the version on
 * show is no fields at all, which is what a surface shows while the read is in flight. A refusal is no fields too.
 *
 * @returns the fields, and the key that says which document and version they describe
 */
export function useFormFieldList(
  client: ContractClient | undefined,
  docId: DocId | undefined,
  version: DocVersion | undefined,
): { readonly key: string; readonly fields: readonly ListedField[] } {
  const [read, setRead] = useState<{ readonly key: string; readonly fields: readonly ListedField[] }>({
    key: '',
    fields: [],
  });
  const key = `${String(docId)}@${String(version)}`;

  useEffect(() => {
    if (client === undefined || docId === undefined || version === undefined) return;
    let cancelled = false;
    void readWholeList(
      (from) => client['document.formFields']({ docId, from }),
      (part) => part.fields,
    ).then(
      (answer) => {
        if (cancelled) return;
        // ANOTHER VERSION'S LIST IS NO LIST: its indices name widgets in a walk that has moved.
        const fields = answer.ok && answer.value.version === version ? answer.value.items : [];
        setRead({ key, fields });
      },
      () => {
        if (!cancelled) setRead({ key, fields: [] });
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [client, docId, key, version]);

  return read.key === key ? read : { key, fields: [] };
}
