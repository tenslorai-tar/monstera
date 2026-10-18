import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useEffect, useState } from 'react';

import { readWholeList } from '../readWholeList.js';
import type { ListedField } from './fieldFill.js';

/** A list of the form's fields WITH the version it was read at, which is the version a command naming one is composed at. */
export interface HeldFields {
  readonly version: DocVersion;
  readonly fields: readonly ListedField[];
}

/**
 * The form's fields, whole: the ONE reader of `document.formFields` that the surfaces beside the page share (the fields
 * drawn on the visible pages, and the Properties pane's selected fields).
 *
 * ## Only at the version it was read at
 *
 * A field is named by its place in its page's widget walk at a version, so a list read for another version would name
 * the wrong widgets. `fields` is the answer for the version on show and nothing else: no fields while the read is in
 * flight, and no fields for a refusal.
 *
 * ## And the last answer, with its version, for a surface that must not vanish between two
 *
 * `held` is the latest answer for this document, whatever version it describes. The fields drawn on the page take it, so
 * a write does not take every control off the page until the next read lands: measured 2026-10-18 by the forms walk, a
 * tick box pressed three times was a new node after the first write, its focus gone, and a press in that gap met no
 * control. A command composed from `held` names `held.version`, never the version on show, so the stale check judges it
 * at the version its index was read at: the lane follows the move where this renderer's own command kept the field walk,
 * and refuses it as out of date where anything else moved (`documentCommands.ts`, *One document's commands*).
 *
 * @returns the fields at the version on show, the key that says which document and version that is, and the last
 *   answer for this document with its version
 */
export function useFormFieldList(
  client: ContractClient | undefined,
  docId: DocId | undefined,
  version: DocVersion | undefined,
): { readonly key: string; readonly fields: readonly ListedField[]; readonly held: HeldFields | undefined } {
  const [read, setRead] = useState<{
    readonly key: string;
    readonly docId: DocId | undefined;
    readonly version: DocVersion | undefined;
    readonly fields: readonly ListedField[];
  }>({ key: '', docId: undefined, version: undefined, fields: [] });
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
        setRead({ key, docId, version, fields });
      },
      () => {
        if (!cancelled) setRead({ key, docId, version, fields: [] });
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [client, docId, key, version]);

  // ANOTHER DOCUMENT'S ANSWER IS HELD BY NOBODY: its fields are not this document's at any version.
  const held = read.docId === docId && read.version !== undefined ? { version: read.version, fields: read.fields } : undefined;
  return { key, fields: read.key === key ? read.fields : [], held };
}
