import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  SIGNATURE_PROBLEM_ABSENT,
  SIGNATURE_PROBLEM_BLANK,
  SIGNATURE_PROBLEM_CANNOT_WRITE,
  SIGNATURE_PROBLEM_SCAN_BLANK,
  SIGNATURE_PROBLEM_SCAN_LOCKED,
  SIGNATURE_PROBLEM_TOO_LARGE,
  SIGNATURE_PROBLEM_TOO_LONG,
  SIGNATURE_PROBLEM_UNREADABLE,
  SIGNATURE_PROBLEM_TOO_MANY_PIXELS,
} from '../messages/en.js';
import { type FileTooLargeProps, fileTooLargeValues } from './fileTooLarge.js';

type Problem =
  | { readonly reason: 'unreadable' }
  | FileTooLargeProps
  | { readonly reason: 'too-many-pixels' }
  | { readonly reason: 'absent' }
  | { readonly reason: 'cannot-write'; readonly characters: string }
  | { readonly reason: 'too-long' }
  | { readonly reason: 'blank' }
  | { readonly reason: 'scan-blank' }
  | { readonly reason: 'scan-locked' };

/**
 * Each reason that carries nothing, and its sentence — a `Record`, `SignProblemBody`'s reason: a reason added without
 * a sentence is a compile error rather than whichever sentence the last branch printed.
 */
const SENTENCES: Readonly<Record<Exclude<Problem['reason'], 'too-large' | 'cannot-write'>, MessageKey>> = {
  unreadable: SIGNATURE_PROBLEM_UNREADABLE,
  absent: SIGNATURE_PROBLEM_ABSENT,
  'too-long': SIGNATURE_PROBLEM_TOO_LONG,
  blank: SIGNATURE_PROBLEM_BLANK,
  'scan-blank': SIGNATURE_PROBLEM_SCAN_BLANK,
  'scan-locked': SIGNATURE_PROBLEM_SCAN_LOCKED,
  'too-many-pixels': SIGNATURE_PROBLEM_TOO_MANY_PIXELS,
};

/**
 * Says why the signature was not placed. Every sentence ends *Nothing was placed*, which is true because each refusal
 * happens before the bus applies anything (`DocumentCommands.placeSignature`), or before anything is sent at all.
 */
export default function SignatureProblemBody(props: Problem): ReactElement {
  const { _, i18n } = useLingui();
  const sentence =
    props.reason === 'too-large'
      ? _(SIGNATURE_PROBLEM_TOO_LARGE, fileTooLargeValues(i18n, props))
      : props.reason === 'cannot-write'
        ? _(SIGNATURE_PROBLEM_CANNOT_WRITE, { characters: props.characters })
        : _(SENTENCES[props.reason]);
  return <p className="m-signature-problem">{sentence}</p>;
}
