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
const roster = createRoster(failures, { cases: 8 });

/**
 * Every rule that must be registered, by name.
 *
 * **A LITERAL ON PURPOSE, and this restores coverage AAAA-9 removed without
 * noticing.** `documentConsistency` used to declare `cases: 9` — an independent
 * number that went red if a rule stopped recording. AAAA-9 replaced it with
 * `chosen.length`, derived from the very array being iterated, which is right
 * for a *selection* and cannot disagree with any size. So deleting a whole rule
 * became silent, and nothing here caught it: the partition assertion below holds
 * for any N and the two floors only require one rule of each kind.
 *
 * That is finding AAAA-16 — a roster derived from the set it governs cannot
 * notice that set shrinking — and the remedy for the class is an anchor the
 * shrinker has to touch separately. This list is that anchor. It lives in the
 * proof rather than beside the rules deliberately: a second file, which deleting
 * a rule does not open.
 *
 * Adding a rule means adding a line here. That is the cost, and it is the one
 * worth paying: a list that goes stale fails loudly, and a derivation that
 * shrinks fails silently.
 */
const EXPECTED_RULES = [
  'CLAUDE.md cites the invariant count ARCHITECTURE §9 defines',
  'every ADR is indexed, and no index row contradicts its file',
  'every registered hook has its own probe entry, and the gate is not claimed without one',
  'every row in a FEATURES table has as many cells as its table declares',
  'every scripts/ path named in a tracked document resolves',
  'no FEATURES row this commit edited grew past its length target',
  'no document states a claim an ADR correction withdrew',
  'the open clause is not claimed done without a picker the dialog actually drove',
  'the threat model raises all 3 carried questions',
  "the watermark and the journal's newest audit are the same string, and the range is within one batch",
  '§9.17 states each budget value once, in the machine-read line',
];

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

const perDocument = DOCUMENT_RULES.filter((rule) => rule.scope === 'per-document');
const wholeCorpus = DOCUMENT_RULES.filter((rule) => rule.scope === 'whole-corpus');

{
  const registered = DOCUMENT_RULES.map((rule) => rule.name).sort();
  const expected = [...EXPECTED_RULES].sort();
  const missing = expected.filter((name) => !registered.includes(name));
  const extra = registered.filter((name) => !expected.includes(name));
  check(
    'the registered rule set is exactly the set this proof names',
    missing.length === 0 && extra.length === 0,
    `${missing.length > 0 ? `NO LONGER REGISTERED: ${missing.join(' | ')}. ` : ''}` +
      `${extra.length > 0 ? `REGISTERED BUT NOT NAMED HERE: ${extra.join(' | ')}. ` : ''}` +
      `A rule that leaves takes its own requirement with it, so nothing derived from the rule ` +
      `list can notice. If a rule was retired on purpose, delete its line here in the same ` +
      `commit and say why in the message.`,
  );
}

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
