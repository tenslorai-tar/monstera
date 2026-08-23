// @ts-check
/**
 * Proof that every document rule declares a scope, that the scope selects, and
 * that a selection matching nothing cannot read as a clean commit
 * (rule B2, finding AAAA-9).
 *
 * The registry is imported rather than reimplemented: importing
 * `documentConsistency.mjs` runs its rules only when it is the entry point, so
 * the rules are available here without the pass being run.
 *
 * Usage: node scripts/proofs/documentRuleScope.proof.mjs
 */

import { DOCUMENT_RULES, runDocumentRules } from '../hooks/documentConsistency.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 7 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

const perDocument = DOCUMENT_RULES.filter((rule) => rule.scope === 'per-document');
const wholeCorpus = DOCUMENT_RULES.filter((rule) => rule.scope === 'whole-corpus');

check(
  'every registered rule declares one of the two scopes',
  DOCUMENT_RULES.length === perDocument.length + wholeCorpus.length,
  `${String(DOCUMENT_RULES.length)} rules, ${String(perDocument.length)} per-document and ` +
    `${String(wholeCorpus.length)} whole-corpus. A rule in neither bucket is enforced by nothing.`,
);

// THE CONDITION THE RULING NAMED, and the one that cannot be checked by reading
// the file: a scoping expression that matches nothing produces the reassuring
// answer. This repository has been bitten by that twice in eight commits.
check(
  'at least one rule is PER-DOCUMENT, or the pre-commit gate runs nothing',
  perDocument.length > 0,
  'the gate reports success for a check that did not happen, which is exactly what the ' +
    'scope was introduced to stop.',
);
check(
  'CONTROL: and at least one is WHOLE-CORPUS, or the split is decorative',
  wholeCorpus.length > 0,
  'if every rule were per-document the scope would be a field nobody reads, and the next ' +
    'rule would inherit a meaningless choice.',
);

// A per-document rule names exactly ONE document, enforced at registration.
// Without this, "per-document" would drift into "cheap enough, probably", and a
// rule reading a second file would be selected on the wrong signal.
check(
  'every per-document rule names exactly one document, and it is a docs/ path',
  perDocument.every((rule) => rule.documents.length === 1 && rule.documents[0]?.startsWith('docs/')),
  `got ${JSON.stringify(perDocument.map((rule) => rule.documents))}.`,
);

// SELECTION, driven both ways. The reassuring answer here is "nothing to run",
// so the case that matters is the one requiring something to run.
{
  const targeted = runDocumentRules({
    scope: 'per-document',
    documents: perDocument.flatMap((rule) => [...rule.documents]),
  });
  check(
    'selecting on every per-document rule’s own file runs all of them',
    targeted.selected === perDocument.length && targeted.registered === perDocument.length,
    `selected ${String(targeted.selected)} of ${String(targeted.registered)}. A selection that ` +
      `drops rules whose document IS staged is the silent half of this mechanism.`,
  );
  check(
    'CONTROL: and they pass against the tree as it stands, so the gate is not red by default',
    targeted.failures.length === 0,
    `a gate that fails on a clean tree is one somebody removes. Failures:\n${targeted.failures.join('\n')}`,
  );
}
{
  const none = runDocumentRules({ scope: 'per-document', documents: ['docs/NOTHING-HERE.md'] });
  check(
    'a commit staging none of their documents selects zero rules — and still REGISTERS them',
    none.selected === 0 && none.registered === perDocument.length,
    `selected ${String(none.selected)}, registered ${String(none.registered)}. These two zeros ` +
      `mean different things: nothing to check is legitimate, nothing REGISTERED is a broken ` +
      `selection, and the gate keys its refusal on the second.`,
  );
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} document-rule-scope case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('document-rule-scope case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
