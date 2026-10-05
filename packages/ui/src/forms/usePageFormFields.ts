import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useEffect, useMemo, useState } from 'react';

import { readWholeList } from '../readWholeList.js';
import type { ListedField } from './fieldFill.js';

/**
 * The form fields on each visible page, at the document's version (ADR-0168 Decision 1).
 *
 * ## The whole form, once per version
 *
 * `document.formFields` describes the document, not a page: there is no per-page read, because the Forms panel asks
 * about all of it. So this reads it whole, in parts (ADR-0130), once per version, and hands each visible page the
 * fields that sit on it. A scroll reads nothing. The panel reads the same list for itself; two readers of one list
 * are two readers, and neither holds an opinion about it.
 *
 * ## Only at the version it was read at
 *
 * A field is named by its place in its page's widget walk at a version, so a field from another version's list would
 * fill the wrong one. The answer is kept with the version it describes, and an answer that does not match the version
 * on show is no fields at all, which is what a page shows while the read is in flight. A refusal is no fields too:
 * nothing to press is what a form that could not be read shows, and the Forms panel says why.
 */
export function usePageFormFields(
  client: ContractClient | undefined,
  docId: DocId | undefined,
  version: DocVersion | undefined,
  visible: ReadonlySet<number>,
): ReadonlyMap<number, readonly ListedField[]> {
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

  const wanted = [...visible].sort((a, b) => a - b).join(',');
  return useMemo(() => {
    const byPage = new Map<number, ListedField[]>();
    if (read.key !== key) return byPage;
    const pages = new Set(wanted === '' ? [] : wanted.split(',').map(Number));
    for (const field of read.fields) {
      if (!pages.has(field.page)) continue;
      const onPage = byPage.get(field.page);
      if (onPage === undefined) byPage.set(field.page, [field]);
      else onPage.push(field);
    }
    return byPage;
  }, [key, read, wanted]);
}
