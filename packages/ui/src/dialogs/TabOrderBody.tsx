import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  TAB_ORDER_APPLY,
  TAB_ORDER_COLUMN,
  TAB_ORDER_COLUMN_NOTE,
  TAB_ORDER_LABEL,
  TAB_ORDER_ROW,
  TAB_ORDER_ROW_NOTE,
  TAB_ORDER_STRUCTURE,
  TAB_ORDER_STRUCTURE_NOTE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogChoices, DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { TabOrderAnswer } from './tabOrder.js';

/**
 * The tab order dialog's body: three orders, each with the sentence that says what a person gets, and one action.
 *
 * Row is the first because it is what most forms are filled in. A default export because `declareDialog` takes a
 * `lazy()` component.
 */
export default function TabOrderBody({ resolve }: DialogAnswering<TabOrderAnswer>): ReactElement {
  const [order, setOrder] = useState<TabOrderAnswer['order']>('row');
  return (
    <div className="m-tab-order">
      <DialogChoices<TabOrderAnswer['order']>
        label={TAB_ORDER_LABEL}
        onChange={setOrder}
        options={[
          { value: 'row', label: TAB_ORDER_ROW, note: TAB_ORDER_ROW_NOTE },
          { value: 'column', label: TAB_ORDER_COLUMN, note: TAB_ORDER_COLUMN_NOTE },
          { value: 'structure', label: TAB_ORDER_STRUCTURE, note: TAB_ORDER_STRUCTURE_NOTE },
        ]}
        value={order}
      />
      <DialogFooter>
        <Button
          label={TAB_ORDER_APPLY}
          variant="primary"
          onClick={() => {
            resolve({ order });
          }}
        />
      </DialogFooter>
    </div>
  );
}
