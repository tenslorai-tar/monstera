import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  SIGNATURE_PROBLEM_ABSENT,
  SIGNATURE_PROBLEM_TOO_LARGE,
  SIGNATURE_PROBLEM_UNENCODABLE,
  SIGNATURE_PROBLEM_UNREADABLE,
} from '../messages/en.js';

/** One megabyte, for saying a byte bound as a person reads one. */
const MEGABYTE = 1024 * 1024;

type Problem =
  | { readonly reason: 'unreadable' }
  | { readonly reason: 'too-large'; readonly limitBytes: number }
  | { readonly reason: 'absent' }
  | { readonly reason: 'unencodable-text' };

/**
 * Each reason that carries nothing, and its sentence — a `Record`, `SignProblemBody`'s reason: a reason added without
 * a sentence is a compile error rather than whichever sentence the last branch printed.
 */
const SENTENCES: Readonly<Record<Exclude<Problem['reason'], 'too-large'>, MessageKey>> = {
  unreadable: SIGNATURE_PROBLEM_UNREADABLE,
  absent: SIGNATURE_PROBLEM_ABSENT,
  'unencodable-text': SIGNATURE_PROBLEM_UNENCODABLE,
};

/**
 * Says why the signature was not placed. Every sentence ends *Nothing was placed*, which is true because each refusal
 * happens before the bus applies anything (`DocumentCommands.placeSignature`).
 */
export default function SignatureProblemBody(props: Problem): ReactElement {
  const { _ } = useLingui();
  const sentence =
    props.reason === 'too-large'
      ? _(SIGNATURE_PROBLEM_TOO_LARGE, { limit: Math.round(props.limitBytes / MEGABYTE) })
      : _(SENTENCES[props.reason]);
  return <p className="m-signature-problem">{sentence}</p>;
}
