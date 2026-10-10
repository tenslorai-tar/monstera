import { type ListedField, fieldFill } from './fieldFill.js';

/**
 * The field Tab or Shift+Tab goes to from one field (ADR-0226 Decision 3): the next that can be filled here, in the
 * form's order, which is the widget walk's, page by page; past the last it is the first again, as a form's Tab is.
 *
 * Fillable is `fieldFill`'s answer and nothing of this module's, so a field the page offers no control for is never a
 * place the focus is sent. A field with no place on its page has no control either, and is passed over the same way.
 */
export function nextFillable(
  fields: readonly ListedField[],
  from: { readonly page: number; readonly index: number },
  backwards: boolean,
): ListedField | undefined {
  const order = fields
    .filter((field) => field.rect !== null && fieldFill(field).kind !== 'none')
    .sort((a, b) => a.page - b.page || a.index - b.index);
  if (order.length === 0) return undefined;
  const after = (field: ListedField): boolean => field.page > from.page || (field.page === from.page && field.index > from.index);
  const before = (field: ListedField): boolean => field.page < from.page || (field.page === from.page && field.index < from.index);
  if (backwards) {
    const earlier = order.filter(before);
    return earlier[earlier.length - 1] ?? order[order.length - 1];
  }
  return order.find(after) ?? order[0];
}
