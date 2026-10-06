import type { MessageKey } from '@monstera/shared';

import {
  ACCESSIBILITY_EXPLAIN_5_1,
  ACCESSIBILITY_EXPLAIN_6_2_1,
  ACCESSIBILITY_EXPLAIN_7_1_10,
  ACCESSIBILITY_EXPLAIN_7_1_11,
  ACCESSIBILITY_EXPLAIN_7_1_4,
  ACCESSIBILITY_EXPLAIN_7_1_5,
  ACCESSIBILITY_EXPLAIN_7_1_8,
  ACCESSIBILITY_EXPLAIN_7_1_9,
  ACCESSIBILITY_EXPLAIN_7_16_1,
  ACCESSIBILITY_EXPLAIN_7_18_1_2,
  ACCESSIBILITY_EXPLAIN_7_18_1_3,
  ACCESSIBILITY_EXPLAIN_7_18_3_1,
  ACCESSIBILITY_EXPLAIN_7_18_5_2,
  ACCESSIBILITY_EXPLAIN_7_21_4_1_1,
  ACCESSIBILITY_EXPLAIN_7_3_1,
  ACCESSIBILITY_RULE_5_1,
  ACCESSIBILITY_RULE_6_2_1,
  ACCESSIBILITY_RULE_7_1_10,
  ACCESSIBILITY_RULE_7_1_11,
  ACCESSIBILITY_RULE_7_1_4,
  ACCESSIBILITY_RULE_7_1_5,
  ACCESSIBILITY_RULE_7_1_8,
  ACCESSIBILITY_RULE_7_1_9,
  ACCESSIBILITY_RULE_7_16_1,
  ACCESSIBILITY_RULE_7_18_1_2,
  ACCESSIBILITY_RULE_7_18_1_3,
  ACCESSIBILITY_RULE_7_18_3_1,
  ACCESSIBILITY_RULE_7_18_5_2,
  ACCESSIBILITY_RULE_7_21_4_1_1,
  ACCESSIBILITY_RULE_7_3_1,
} from '../messages/en.js';

/** What a person is told about one rule: its name, and in one line what a failure means and what to do about it. */
export interface RuleWords {
  readonly label: MessageKey;
  readonly explain: MessageKey;
}

/**
 * Each rule the kernel checks, by `clause-test`, in words a person reads (ADR-0183).
 *
 * The label says what the document should have; the explanation says what is wrong when it does not, why that matters
 * to someone using a screen reader, and what to do — naming the program that made the file where Monstera cannot make
 * the repair itself, since promising a tool that does not exist is worse than saying whose job it is.
 */
export const RULE_WORDS: Readonly<Record<string, RuleWords>> = {
  '5-1': { label: ACCESSIBILITY_RULE_5_1, explain: ACCESSIBILITY_EXPLAIN_5_1 },
  '6.2-1': { label: ACCESSIBILITY_RULE_6_2_1, explain: ACCESSIBILITY_EXPLAIN_6_2_1 },
  '7.1-4': { label: ACCESSIBILITY_RULE_7_1_4, explain: ACCESSIBILITY_EXPLAIN_7_1_4 },
  '7.1-5': { label: ACCESSIBILITY_RULE_7_1_5, explain: ACCESSIBILITY_EXPLAIN_7_1_5 },
  '7.1-8': { label: ACCESSIBILITY_RULE_7_1_8, explain: ACCESSIBILITY_EXPLAIN_7_1_8 },
  '7.1-9': { label: ACCESSIBILITY_RULE_7_1_9, explain: ACCESSIBILITY_EXPLAIN_7_1_9 },
  '7.1-10': { label: ACCESSIBILITY_RULE_7_1_10, explain: ACCESSIBILITY_EXPLAIN_7_1_10 },
  '7.1-11': { label: ACCESSIBILITY_RULE_7_1_11, explain: ACCESSIBILITY_EXPLAIN_7_1_11 },
  '7.3-1': { label: ACCESSIBILITY_RULE_7_3_1, explain: ACCESSIBILITY_EXPLAIN_7_3_1 },
  '7.16-1': { label: ACCESSIBILITY_RULE_7_16_1, explain: ACCESSIBILITY_EXPLAIN_7_16_1 },
  '7.18.1-2': { label: ACCESSIBILITY_RULE_7_18_1_2, explain: ACCESSIBILITY_EXPLAIN_7_18_1_2 },
  '7.18.1-3': { label: ACCESSIBILITY_RULE_7_18_1_3, explain: ACCESSIBILITY_EXPLAIN_7_18_1_3 },
  '7.18.3-1': { label: ACCESSIBILITY_RULE_7_18_3_1, explain: ACCESSIBILITY_EXPLAIN_7_18_3_1 },
  '7.18.5-2': { label: ACCESSIBILITY_RULE_7_18_5_2, explain: ACCESSIBILITY_EXPLAIN_7_18_5_2 },
  '7.21.4.1-1': { label: ACCESSIBILITY_RULE_7_21_4_1_1, explain: ACCESSIBILITY_EXPLAIN_7_21_4_1_1 },
};

/** The key a rule's words are held under. */
export function ruleKey(rule: { readonly clause: string; readonly test: number }): string {
  return `${rule.clause}-${String(rule.test)}`;
}
