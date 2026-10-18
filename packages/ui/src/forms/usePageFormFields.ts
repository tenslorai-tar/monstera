import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useMemo } from 'react';

import type { ListedField } from './fieldFill.js';
import { useFormFieldList } from './useFormFieldList.js';

/** The fields on each visible page, and the version they were read at, which a fill from them names. */
export interface PageFormFields {
  readonly byPage: ReadonlyMap<number, readonly ListedField[]>;
  readonly version: DocVersion | undefined;
}

/**
 * The form fields on each visible page (ADR-0168 Decision 1).
 *
 * ## The whole form, once per version
 *
 * `document.formFields` describes the document, not a page: there is no per-page read, because the Forms panel asks
 * about all of it. So this reads it whole, in parts (ADR-0130), once per version through {@link useFormFieldList}, and
 * hands each visible page the fields that sit on it. A scroll reads nothing. The panel reads the same list for itself;
 * two readers of one list are two readers, and neither holds an opinion about it.
 *
 * ## The last list, with ITS version, until the next one lands
 *
 * A field is named by its place in its page's widget walk at a version. The page keeps drawing the last list read while
 * a write's re-read is in flight (`useFormFieldList`' `held`), so its controls are not taken off the page and put back
 * as new nodes after every write; and the version answered here is that list's, which a fill from it must name.
 */
export function usePageFormFields(
  client: ContractClient | undefined,
  docId: DocId | undefined,
  version: DocVersion | undefined,
  visible: ReadonlySet<number>,
): PageFormFields {
  const { held } = useFormFieldList(client, docId, version);
  const fields = held?.fields;
  const wanted = [...visible].sort((a, b) => a - b).join(',');
  const byPage = useMemo(() => {
    const onPages = new Map<number, ListedField[]>();
    const pages = new Set(wanted === '' ? [] : wanted.split(',').map(Number));
    for (const field of fields ?? []) {
      if (!pages.has(field.page)) continue;
      const onPage = onPages.get(field.page);
      if (onPage === undefined) onPages.set(field.page, [field]);
      else onPage.push(field);
    }
    return onPages;
  }, [fields, wanted]);
  return { byPage, version: held?.version };
}
