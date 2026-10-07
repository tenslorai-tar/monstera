import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useMemo } from 'react';

import type { ListedField } from './fieldFill.js';
import { useFormFieldList } from './useFormFieldList.js';

/**
 * The form fields on each visible page, at the document's version (ADR-0168 Decision 1).
 *
 * ## The whole form, once per version
 *
 * `document.formFields` describes the document, not a page: there is no per-page read, because the Forms panel asks
 * about all of it. So this reads it whole, in parts (ADR-0130), once per version through {@link useFormFieldList}, and
 * hands each visible page the fields that sit on it. A scroll reads nothing. The panel reads the same list for itself;
 * two readers of one list are two readers, and neither holds an opinion about it.
 *
 * A field is named by its place in its page's widget walk at a version, so a field from another version's list would
 * fill the wrong one: the list is no fields at all for a version it was not read at.
 */
export function usePageFormFields(
  client: ContractClient | undefined,
  docId: DocId | undefined,
  version: DocVersion | undefined,
  visible: ReadonlySet<number>,
): ReadonlyMap<number, readonly ListedField[]> {
  const { fields } = useFormFieldList(client, docId, version);
  const wanted = [...visible].sort((a, b) => a - b).join(',');
  return useMemo(() => {
    const byPage = new Map<number, ListedField[]>();
    const pages = new Set(wanted === '' ? [] : wanted.split(',').map(Number));
    for (const field of fields) {
      if (!pages.has(field.page)) continue;
      const onPage = byPage.get(field.page);
      if (onPage === undefined) byPage.set(field.page, [field]);
      else onPage.push(field);
    }
    return byPage;
  }, [fields, wanted]);
}
