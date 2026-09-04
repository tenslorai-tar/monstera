import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  BATES_NUMBER_ALL,
  BATES_NUMBER_APPLY,
  BATES_NUMBER_DIGITS,
  BATES_NUMBER_EDGE_FOOTER,
  BATES_NUMBER_EDGE_HEADER,
  BATES_NUMBER_NOT_A_NUMBER,
  BATES_NUMBER_PREFIX,
  BATES_NUMBER_PREVIEW,
  BATES_NUMBER_SLOT_CENTRE,
  BATES_NUMBER_SLOT_LEFT,
  BATES_NUMBER_SLOT_RIGHT,
  BATES_NUMBER_START,
  BATES_NUMBER_SUFFIX,
  BATES_NUMBER_THIS,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { BatesNumberAnswer } from './batesNumberResult.js';

/** Where the stamp can sit, as the two axes the command carries. */
const EDGES = [
  { key: 'footer', label: BATES_NUMBER_EDGE_FOOTER },
  { key: 'header', label: BATES_NUMBER_EDGE_HEADER },
] as const;

const SLOTS = [
  { key: 'left', label: BATES_NUMBER_SLOT_LEFT },
  { key: 'centre', label: BATES_NUMBER_SLOT_CENTRE },
  { key: 'right', label: BATES_NUMBER_SLOT_RIGHT },
] as const;

/**
 * What a person gets without typing.
 *
 * Bottom-right at 9pt is where every court filing carries its Bates number, and
 * a four-digit field is the width that covers an exhibit set without wrapping.
 * Defaults for a control, not tokens — this is content written into a document.
 */
const DEFAULT_START = '1';
const DEFAULT_DIGITS = '4';
const DEFAULT_SIZE = '9';
const DEFAULT_MARGIN = '36';

/**
 * The Bates dialog's body.
 *
 * ## THE PREVIEW IS THE POINT, and it is not decoration
 *
 * Four fields combine into one identifier, and *ABC-0001* is what the user is
 * actually deciding — the fields are how they say it. Showing the first
 * identifier as they type is the difference between a form somebody fills in
 * and a form somebody has to run to find out what it did.
 *
 * It is built here by the same concatenation the kernel uses, which is a second
 * implementation of `batesIdentifier` and is deliberate: `packages/ui` may not
 * import the kernel, and the alternative is a round trip per keystroke to
 * preview a string. What keeps the two honest is that a disagreement is
 * **visible to the person typing** — the preview says one thing and the stamped
 * page says another, in front of the user, which is the loudest place a drift
 * can surface.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function BatesNumberBody({
  page,
  resolve,
}: {
  readonly page: number;
} & DialogAnswering<BatesNumberAnswer>): ReactElement {
  const { _ } = useLingui();
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [start, setStart] = useState(DEFAULT_START);
  const [digits, setDigits] = useState(DEFAULT_DIGITS);
  const [edge, setEdge] = useState<(typeof EDGES)[number]['key']>('footer');
  const [slot, setSlot] = useState<(typeof SLOTS)[number]['key']>('right');
  const [everyPage, setEveryPage] = useState(true);

  const startValue = readInteger(start, DEFAULT_START);
  const digitsValue = readInteger(digits, DEFAULT_DIGITS);
  const ready =
    startValue !== null &&
    startValue <= 999_999_999 &&
    digitsValue !== null &&
    digitsValue >= 1 &&
    digitsValue <= 12;

  return (
    <div className="m-bates-number">
      <Input
        label={BATES_NUMBER_PREFIX}
        value={prefix}
        onValueChange={(next) => {
          setPrefix(next);
        }}
      />
      <Input
        label={BATES_NUMBER_START}
        value={start}
        onValueChange={(next) => {
          setStart(next);
        }}
      />
      <Input
        label={BATES_NUMBER_DIGITS}
        value={digits}
        onValueChange={(next) => {
          setDigits(next);
        }}
      />
      <Input
        label={BATES_NUMBER_SUFFIX}
        value={suffix}
        onValueChange={(next) => {
          setSuffix(next);
        }}
      />
      <p className="m-bates-number__preview">
        {ready ? previewOf(prefix, suffix, startValue, digitsValue) : _(BATES_NUMBER_PREVIEW)}
      </p>
      <fieldset className="m-bates-number__edge">
        {EDGES.map(({ key, label }) => (
          <Button
            key={key}
            label={label}
            variant={edge === key ? 'primary' : 'default'}
            onClick={() => {
              setEdge(key);
            }}
          />
        ))}
      </fieldset>
      <fieldset className="m-bates-number__slot">
        {SLOTS.map(({ key, label }) => (
          <Button
            key={key}
            label={label}
            variant={slot === key ? 'primary' : 'default'}
            onClick={() => {
              setSlot(key);
            }}
          />
        ))}
      </fieldset>
      <fieldset className="m-bates-number__scope">
        <Button
          label={BATES_NUMBER_THIS}
          variant={everyPage ? 'default' : 'primary'}
          onClick={() => {
            setEveryPage(false);
          }}
        />
        <Button
          label={BATES_NUMBER_ALL}
          variant={everyPage ? 'primary' : 'default'}
          onClick={() => {
            setEveryPage(true);
          }}
        />
      </fieldset>
      <p className="m-bates-number__problem" role="status">
        {ready ? '' : _(BATES_NUMBER_NOT_A_NUMBER)}
      </p>
      <Button
        label={BATES_NUMBER_APPLY}
        variant="primary"
        disabled={!ready}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute, for
          // `CropPagesBody`'s reason.
          if (startValue === null || digitsValue === null || !ready) return;
          resolve({
            pages: everyPage ? 'all' : [page],
            prefix,
            suffix,
            start: startValue,
            digits: digitsValue,
            edge,
            slot,
            fontSize: Number(DEFAULT_SIZE),
            marginPoints: Number(DEFAULT_MARGIN),
          });
        }}
      />
    </div>
  );
}

/** The first identifier the command would stamp, as the person will see it. */
function previewOf(prefix: string, suffix: string, start: number, digits: number): string {
  return `${prefix}${String(start).padStart(digits, '0')}${suffix}`;
}

/**
 * One field's whole number, falling back to its default when empty.
 *
 * DIGITS ONLY — no decimal point, unlike the other dialogs' readers. A Bates
 * number of `1.5` is not a number this feature has a meaning for, and accepting
 * it here would push the refusal to the schema, which throws at the user.
 */
function readInteger(text: string, fallback: string): number | null {
  const value = text.trim().length === 0 ? fallback : text.trim();
  if (!/^\d+$/u.test(value)) return null;
  return Number(value);
}
