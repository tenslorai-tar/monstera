import { useLingui } from '@lingui/react';
import type { ACCESSIBILITY_HUMAN_CHECKS } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  ACCESSIBILITY_HUMAN_ALT_TEXT,
  ACCESSIBILITY_HUMAN_COLOUR,
  ACCESSIBILITY_HUMAN_HEADINGS,
  ACCESSIBILITY_HUMAN_LANGUAGE,
  ACCESSIBILITY_HUMAN_LINKS,
  ACCESSIBILITY_HUMAN_READING_ORDER,
  ACCESSIBILITY_HUMAN_TABLES,
  ACCESSIBILITY_MACHINE_HEADING,
  ACCESSIBILITY_NOT_CONFORMANCE,
  ACCESSIBILITY_PAGES,
  ACCESSIBILITY_PERSON_HEADING,
  ACCESSIBILITY_REFUSED,
  ACCESSIBILITY_RULE_5_1,
  ACCESSIBILITY_RULE_6_2_1,
  ACCESSIBILITY_RULE_7_16_1,
  ACCESSIBILITY_RULE_7_18_1_2,
  ACCESSIBILITY_RULE_7_18_1_3,
  ACCESSIBILITY_RULE_7_18_3_1,
  ACCESSIBILITY_RULE_7_18_5_2,
  ACCESSIBILITY_RULE_7_1_10,
  ACCESSIBILITY_RULE_7_1_11,
  ACCESSIBILITY_RULE_7_1_4,
  ACCESSIBILITY_RULE_7_1_5,
  ACCESSIBILITY_RULE_7_1_8,
  ACCESSIBILITY_RULE_7_1_9,
  ACCESSIBILITY_RULE_7_21_4_1_1,
  ACCESSIBILITY_RULE_7_3_1,
  ACCESSIBILITY_RULE_UNKNOWN,
  ACCESSIBILITY_SUMMARY,
  ACCESSIBILITY_VERDICT_FAILED,
  ACCESSIBILITY_VERDICT_NOT_APPLICABLE,
  ACCESSIBILITY_VERDICT_NOT_DETERMINED,
  ACCESSIBILITY_VERDICT_PASSED,
} from '../messages/en.js';

type Verdict = 'passed' | 'failed' | 'not-applicable' | 'not-determined';
type HumanCheck = (typeof ACCESSIBILITY_HUMAN_CHECKS)[number];

type AccessibilityProps =
  | {
      readonly kind: 'checked';
      readonly rules: readonly {
        readonly clause: string;
        readonly test: number;
        readonly verdict: Verdict;
        readonly count: number;
        readonly pages: readonly number[];
      }[];
      readonly humanChecks: readonly HumanCheck[];
    }
  | { readonly kind: 'refused' };

/** Each rule the kernel checks, by `clause-test`, in words a person reads. */
const RULE_WORDS: Readonly<Record<string, MessageKey>> = {
  '5-1': ACCESSIBILITY_RULE_5_1,
  '6.2-1': ACCESSIBILITY_RULE_6_2_1,
  '7.1-4': ACCESSIBILITY_RULE_7_1_4,
  '7.1-5': ACCESSIBILITY_RULE_7_1_5,
  '7.1-8': ACCESSIBILITY_RULE_7_1_8,
  '7.1-9': ACCESSIBILITY_RULE_7_1_9,
  '7.1-10': ACCESSIBILITY_RULE_7_1_10,
  '7.1-11': ACCESSIBILITY_RULE_7_1_11,
  '7.3-1': ACCESSIBILITY_RULE_7_3_1,
  '7.16-1': ACCESSIBILITY_RULE_7_16_1,
  '7.18.1-2': ACCESSIBILITY_RULE_7_18_1_2,
  '7.18.1-3': ACCESSIBILITY_RULE_7_18_1_3,
  '7.18.3-1': ACCESSIBILITY_RULE_7_18_3_1,
  '7.18.5-2': ACCESSIBILITY_RULE_7_18_5_2,
  '7.21.4.1-1': ACCESSIBILITY_RULE_7_21_4_1_1,
};

const VERDICT_WORDS: Readonly<Record<Verdict, MessageKey>> = {
  passed: ACCESSIBILITY_VERDICT_PASSED,
  failed: ACCESSIBILITY_VERDICT_FAILED,
  'not-applicable': ACCESSIBILITY_VERDICT_NOT_APPLICABLE,
  'not-determined': ACCESSIBILITY_VERDICT_NOT_DETERMINED,
};

const HUMAN_WORDS: Readonly<Record<HumanCheck, MessageKey>> = {
  'reading-order': ACCESSIBILITY_HUMAN_READING_ORDER,
  'alternative-text-meaningful': ACCESSIBILITY_HUMAN_ALT_TEXT,
  'headings-reflect-structure': ACCESSIBILITY_HUMAN_HEADINGS,
  'table-headers-correct': ACCESSIBILITY_HUMAN_TABLES,
  'colour-not-sole-means': ACCESSIBILITY_HUMAN_COLOUR,
  'language-of-passages': ACCESSIBILITY_HUMAN_LANGUAGE,
  'link-text-meaningful': ACCESSIBILITY_HUMAN_LINKS,
};

/** Failures first, then what could not be decided, then the rest — what needs acting on leads. */
const ORDER: Readonly<Record<Verdict, number>> = { failed: 0, 'not-determined': 1, passed: 2, 'not-applicable': 3 };

/**
 * The accessibility check's body.
 *
 * ## It never says the document is accessible
 *
 * The sentence under the summary says what the automatic checks are and are not, on every run —
 * including one where none failed, which is exactly when a reader would take silence for a pass.
 * The checks for a person follow as a list of their own, never with a verdict.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function AccessibilityCheckBody(props: AccessibilityProps): ReactElement {
  const { _, i18n } = useLingui();
  if (props.kind === 'refused') return <p className="m-accessibility-check">{_(ACCESSIBILITY_REFUSED)}</p>;

  const number = new Intl.NumberFormat(i18n.locale);
  const failed = props.rules.filter((rule) => rule.verdict === 'failed').length;
  const undetermined = props.rules.filter((rule) => rule.verdict === 'not-determined').length;
  const ordered = [...props.rules].sort((left, right) => ORDER[left.verdict] - ORDER[right.verdict]);

  return (
    <div className="m-accessibility-check">
      <p>{_(ACCESSIBILITY_SUMMARY, { failed, undetermined })}</p>
      <p>{_(ACCESSIBILITY_NOT_CONFORMANCE)}</p>
      <h3>{_(ACCESSIBILITY_MACHINE_HEADING)}</h3>
      <ul className="m-accessibility-check__rules">
        {ordered.map((rule) => {
          const words = RULE_WORDS[`${rule.clause}-${String(rule.test)}`];
          return (
            <li key={`${rule.clause}-${String(rule.test)}`} data-verdict={rule.verdict}>
              <span className="m-accessibility-check__verdict">{_(VERDICT_WORDS[rule.verdict])}</span>
              <span>
                {words === undefined
                  ? _(ACCESSIBILITY_RULE_UNKNOWN, { clause: rule.clause, test: rule.test })
                  : _(words)}
              </span>
              {rule.pages.length > 0 ? (
                <span className="m-accessibility-check__pages">
                  {_(ACCESSIBILITY_PAGES, { pages: rule.pages.map((page) => number.format(page)).join(', ') })}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <h3>{_(ACCESSIBILITY_PERSON_HEADING)}</h3>
      <ul className="m-accessibility-check__human">
        {props.humanChecks.map((check) => (
          <li key={check}>{_(HUMAN_WORDS[check])}</li>
        ))}
      </ul>
    </div>
  );
}
