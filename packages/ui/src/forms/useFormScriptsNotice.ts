import type { DocId } from '@monstera/shared';
import { useEffect, useRef } from 'react';

import { FORM_SCRIPTS_NAMED, FORM_SCRIPTS_NOTICE_DIALOG_ID } from '../dialogs/formScriptsNotice.js';
import type { ListedField } from './fieldFill.js';

/**
 * What the notice names for a form: each field carrying a script that is never run, once by name and in the form's
 * order, up to {@link FORM_SCRIPTS_NAMED}, and how many more; `undefined` for a form with none. The fields are the
 * kernel's (`scripts`, `scriptsNotRunOf`): a standard calculation or format carries none, so it is never named.
 */
export function formScriptsNoticeOf(fields: readonly ListedField[]): { readonly names: string[]; readonly more: number } | undefined {
  const names = [...new Set(fields.filter((field) => (field.scripts?.length ?? 0) > 0).map((field) => field.name))];
  if (names.length === 0) return undefined;
  return { names: names.slice(0, FORM_SCRIPTS_NAMED), more: Math.max(0, names.length - FORM_SCRIPTS_NAMED) };
}

/**
 * ONE notice per document (the owner's decision of 2026-10-18): asked the first time the document's field list on show
 * names a field with a script, and never again for that document in this window. The list is empty while it is read,
 * which asks nothing, so the notice comes with the first answer that names one.
 */
export function useFormScriptsNotice(
  docId: DocId | undefined,
  fields: readonly ListedField[],
  ask: (id: typeof FORM_SCRIPTS_NOTICE_DIALOG_ID, props: { readonly names: string[]; readonly more: number }) => unknown,
): void {
  const told = useRef(new Set<DocId>());
  useEffect(() => {
    if (docId === undefined || told.current.has(docId)) return;
    const notice = formScriptsNoticeOf(fields);
    if (notice === undefined) return;
    told.current.add(docId);
    void ask(FORM_SCRIPTS_NOTICE_DIALOG_ID, notice);
  }, [ask, docId, fields]);
}
