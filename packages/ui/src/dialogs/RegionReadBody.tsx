import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';

import {
  REGION_READ_COPY,
  REGION_READ_EXCEL,
  REGION_READ_WORD,
  REGION_READ_TABLE_NOTE,
  REGION_READ_ENGINE_AZURE,
  REGION_READ_ENGINE_CLAUDE,
  REGION_READ_ENGINE_TESSERACT,
  REGION_READ_FAILED,
  REGION_READ_INSERT,
  REGION_READ_NOTE,
  REGION_READ_NOTHING,
  REGION_READ_READING,
  REGION_READ_READING_NOTE,
  REGION_READ_TEXT,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { problemMessage, problemParticulars } from './problemMessages.js';
import type { RegionReadProps, RegionReadReport } from './regionRead.js';

/** Each reader's name in a sentence, keyed by reader so a fourth arrives owing its words. */
const ENGINES: Readonly<Record<RegionReadProps['engine'], MessageKey>> = {
  tesseract: REGION_READ_ENGINE_TESSERACT,
  claude: REGION_READ_ENGINE_CLAUDE,
  azure: REGION_READ_ENGINE_AZURE,
};

/**
 * The panel a box's read answers with: *Reading…* while a service answers, then the words with *Copy* and *Insert as text on
 * the page*, or a plain sentence for a box that held nothing or a read that was refused.
 *
 * ## It tells the command it is up, once
 *
 * A dialog's props are fixed when it opens; the command answers it later with the read, by replying to a report. So the body
 * reports `ready` as it mounts, which hands the command the way to answer — and it reports nothing else on its own.
 *
 * ## The words are shown as read
 *
 * In a read-only field, so they can be selected and copied by hand as well as with the button, and never as a message
 * key: they are what the page said.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function RegionReadBody(props: RegionReadProps & DialogAnswering<RegionReadReport>): ReactElement {
  const { _ } = useLingui();
  const { update } = props;
  // ONCE, FROM THE FIRST COMMIT: `update` is a new function when the command answers with the read, and reporting again
  // then would ask the command to answer a panel it has just answered.
  const told = useRef(false);

  useEffect(() => {
    if (told.current) return;
    told.current = true;
    update({ kind: 'ready' });
  });

  if (props.state === 'reading') {
    return (
      <>
        <p role="status">{_(REGION_READ_READING, { engine: _(ENGINES[props.engine]) })}</p>
        <p>{_(REGION_READ_READING_NOTE)}</p>
        <DialogFooter dismissal="close" />
      </>
    );
  }
  if (props.state === 'nothing') {
    return (
      <>
        <p>{_(REGION_READ_NOTHING)}</p>
        <DialogFooter dismissal="close" />
      </>
    );
  }
  if (props.state === 'failed') {
    const particulars = problemParticulars(props.problem);
    return (
      <>
        <p>{_(REGION_READ_FAILED)}</p>
        <p>{_(problemMessage(props.problem))}</p>
        {particulars === undefined ? null : (
          <dl className="m-command-problem-reference">
            <dt>{_(particulars.label)}</dt>
            <dd>{particulars.value}</dd>
          </dl>
        )}
        <DialogFooter dismissal="close" />
      </>
    );
  }
  return (
    <>
      {/* A LABEL ABOVE and a field the dialog's whole width, tall enough to read: it was a six-row box with the label
          squeezed at its corner (the owner's recording of 2026-10-08). The rows are the page's, a table's cells apart by a tab. */}
      <label className="m-region-read__label">
        <span className="m-region-read__heading">{_(REGION_READ_TEXT)}</span>
        <textarea className="m-region-read__text" readOnly rows={Math.min(14, Math.max(6, props.text.split('\n').length + 1))} value={props.text} />
      </label>
      {props.table ? <p>{_(REGION_READ_TABLE_NOTE)}</p> : null}
      <p>{_(REGION_READ_NOTE)}</p>
      <DialogFooter
        aside={
          <>
            <Button
              label={REGION_READ_COPY}
              onClick={() => {
                update({ kind: 'copy' });
              }}
            />
            {props.table ? (
              <>
                <Button
                  label={REGION_READ_WORD}
                  onClick={() => {
                    update({ kind: 'word' });
                  }}
                />
                <Button
                  label={REGION_READ_EXCEL}
                  onClick={() => {
                    update({ kind: 'excel' });
                  }}
                />
              </>
            ) : null}
          </>
        }
        dismissal="close"
      >
        <Button
          label={REGION_READ_INSERT}
          variant="primary"
          onClick={() => {
            update({ kind: 'insert' });
          }}
        />
      </DialogFooter>
    </>
  );
}
