// @ts-check
/**
 * Proof that the layout-ownership scan reports two classes setting one element's layout, and only that (rule B2).
 *
 * The control is the shape it was written for: the menu bar item as it stood until 2026-10-01, a grid class and a
 * flex class on one element. The tolerance cases are the shapes the scan must leave alone, because a check that
 * reports a BEM modifier or a deliberate compound rule is one somebody turns off.
 *
 * Usage: node scripts/proofs/layoutOwnership.proof.mjs
 */

import { classLists, findTwoOwners, layoutClasses, layoutOwnersOf, uiSources } from '../lib/layoutOwnership.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @param {string} source @param {string} css */
function scan(source, css) {
  return findTwoOwners({ components: [{ path: 'case.tsx', source }], stylesheets: [css] });
}

{
  const found = scan(
    '<Menu.Item className="m-context-menu-item m-menu-bar__item" />',
    '.m-menu-bar__item { display: grid; }\n.m-context-menu-item { display: flex; justify-content: space-between; }',
  );
  check(
    'CONTROL: the menu bar item as it stood (grid class and flex class on one element) is reported',
    found.length === 1 && found[0]?.owners.join(' ') === 'm-context-menu-item m-menu-bar__item',
    `reported ${JSON.stringify(found)}.`,
  );
}
{
  const found = scan(
    '<Menu.Item className="m-context-menu-item m-menu-bar__item" />',
    '.m-menu-bar__item { color: red; padding: 4px; }\n.m-context-menu-item { display: grid; }',
  );
  check('a second class that sets no layout property is not an owner', found.length === 0, `reported ${JSON.stringify(found)}.`);
}
{
  const found = scan('<b className="m-button m-button--primary" />', '.m-button { display: flex; }\n.m-button--primary { display: inline-flex; }');
  check('a BEM modifier beside its own block is exempt: overriding its block is what it is for', found.length === 0, `reported ${JSON.stringify(found)}.`);
}
{
  const found = scan('<b className="m-a m-b" />', '.m-a { display: flex; }\n.m-a.m-b { display: grid; }');
  check(
    'a rule on the COMPOUND of both classes is the deliberate combination, owned in one place, and not a second owner',
    found.length === 0,
    `reported ${JSON.stringify(found)}.`,
  );
}
{
  const owners = layoutClasses('.m-row .m-cell:hover { align-items: center; }\n@media (width > 1px) { .m-other { display: grid; } }');
  check(
    'a descendant selector counts for its SUBJECT, and a rule inside an at-rule is read',
    owners.has('m-cell') && !owners.has('m-row') && owners.has('m-other'),
    `owners ${JSON.stringify([...owners.keys()])}.`,
  );
}
{
  const lists = classLists("<b className={open ? 'm-a m-b' : 'm-c m-d'} />");
  check(
    'both literals of a conditional className are read',
    lists.length === 2 && lists[0]?.classes.join(' ') === 'm-a m-b' && lists[1]?.classes.join(' ') === 'm-c m-d',
    `read ${JSON.stringify(lists)}.`,
  );
}
{
  const owners = layoutClasses('/* .m-x { display: flex; } */ .m-y { display: flex; }');
  check('a commented-out rule is not read as one', !owners.has('m-x') && owners.has('m-y'), `owners ${JSON.stringify([...owners.keys()])}.`);
}
{
  const owners = new Map([
    ['m-a', new Set(['display'])],
    ['m-b', new Set(['display'])],
  ]);
  check(
    'a class with no rule at all is no owner, so a list of one owner and a hook class passes',
    layoutOwnersOf(['m-a', 'm-hook'], owners).length === 1,
    `owners ${JSON.stringify(layoutOwnersOf(['m-a', 'm-hook'], owners))}.`,
  );
}
{
  const findings = findTwoOwners(uiSources(repoRoot()));
  check(
    'this tree has no element with two layout owners',
    findings.length === 0,
    `found ${JSON.stringify(findings)}.`,
  );
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} layoutOwnership case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('layoutOwnership case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
