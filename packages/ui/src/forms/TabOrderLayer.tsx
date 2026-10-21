import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import type { OverlayPage } from '../annotations/annotationSpace.js';
import { overlayTransform } from '../annotations/annotationSpace.js';
import { TAB_ORDER_BAR, TAB_ORDER_BAR_CANCEL, TAB_ORDER_BAR_SET, TAB_ORDER_BOX, TAB_ORDER_LAYER_LABEL } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { pixelsOf } from './fieldDesign.js';
import type { ListedField } from './fieldFill.js';

/**
 * *Tab order* as the page list carries it (ADR-0226 Decision 15): a value of the slot the editing modes share, so it
 * never holds together with Edit fields or Edit text.
 */
export interface TabOrderEditing {
  readonly mode: 'tab-order';
  /** The fields clicked so far, in order, as `page:index` keys. */
  readonly picked: readonly string[];
  readonly onPick: (page: number, index: number) => void;
}

/**
 * Where each field of one page comes in the order a click order makes: the fields clicked on this page first, in the
 * order they were clicked, then the page's others in the order they have. The ONE answer the numbers on the page and the
 * command both take, so what a person sees numbered is what Tab will do (`setTabOrder`'s own rule, in the kernel).
 */
export function tabNumbers(page: number, indices: readonly number[], picked: readonly string[]): ReadonlyMap<number, number> {
  const first = picked.flatMap((key) => {
    const [on, at] = key.split(':').map(Number);
    return on === page && at !== undefined && indices.includes(at) ? [at] : [];
  });
  const order = [...first, ...[...indices].sort((a, b) => a - b).filter((index) => !first.includes(index))];
  return new Map(order.map((index, at) => [index, at + 1]));
}

/**
 * One page in *Tab order*: every field a box carrying its number in the order Tab will take, a clicked one marked as
 * chosen. A press on a field puts it next; nothing here moves, resizes or fills.
 */
export function TabOrderLayer({
  page,
  geometry,
  fields,
  picked,
  onPick,
}: {
  readonly page: number;
  readonly geometry: OverlayPage;
  readonly fields: readonly ListedField[];
  readonly picked: readonly string[];
  readonly onPick: (index: number) => void;
}): ReactElement {
  const { _ } = useLingui();
  const transform = overlayTransform(geometry);
  const placed = fields.flatMap((field) => (field.rect === null ? [] : [{ field, box: pixelsOf(field.rect, transform) }]));
  const numbers = tabNumbers(page, fields.map((field) => field.index), picked);
  return (
    <div aria-label={_(TAB_ORDER_LAYER_LABEL, { page: page + 1 })} className="m-field-design-layer" data-tab-order-layer={String(page)} role="group">
      {placed.map(({ field, box }) => {
        const chosen = picked.includes(`${String(page)}:${String(field.index)}`);
        const number = numbers.get(field.index) ?? 0;
        return (
          <button
            aria-label={_(TAB_ORDER_BOX, { name: field.name, number })}
            aria-pressed={chosen}
            className={chosen ? 'm-field-box m-field-box--selected m-tab-order-box' : 'm-field-box m-tab-order-box'}
            data-tab-order-box={String(field.index)}
            key={field.index}
            onClick={() => {
              onPick(field.index);
            }}
            style={{ left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }}
            type="button"
          >
            <span className="m-tab-order-box__number">{number}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * What the page says while a person gives the tab order: what to do, how many are chosen, and the two ways out. Over the
 * page area, where the clicking is; Escape is *Cancel* (the caller's key listener), and nothing is set until *Set this
 * order*.
 */
export function TabOrderBar({
  count,
  onSet,
  onCancel,
}: {
  readonly count: number;
  readonly onSet: () => void;
  readonly onCancel: () => void;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-tab-order-bar" role="status">
      <span className="m-tab-order-bar__text">{_(TAB_ORDER_BAR, { count })}</span>
      <Button label={TAB_ORDER_BAR_CANCEL} onClick={onCancel} />
      <Button disabled={count === 0} label={TAB_ORDER_BAR_SET} onClick={onSet} variant="primary" />
    </div>
  );
}
