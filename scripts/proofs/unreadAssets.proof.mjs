// @ts-check
/**
 * Proof for the unread-asset scan (`scripts/lib/unreadAssets.mjs`).
 *
 * ## Both directions, for each of the three kinds
 *
 * A set difference fails two ways that pull apart: it reports nothing because its idea of a reader is too wide (which
 * is what a clean tree prints too), or it reports everything because its idea of a reader is too narrow. So each route
 * by which an asset is read has a case that must NOT be reported, and each kind has an unread asset that must be.
 *
 * ## And the places a reader is easy to mistake
 *
 * A test names a class without drawing it; the settings registry lists a setting without reading it; a stylesheet's
 * declaration value and its comments hold dotted text that is not a selector. Each is a case.
 *
 * Usage: node scripts/proofs/unreadAssets.proof.mjs
 */

import { CONTROL, CONTROL_UNREAD, classesStyled, isTest, unreadIn } from '../lib/unreadAssets.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 13 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** The rule over one kind's fixture, as `kind:name` strings. @param {Partial<Parameters<typeof unreadIn>[0]>} input */
function unread(input) {
  return unreadIn({ stylesheets: [], catalogue: null, settings: [], sources: [], ...input }).map((each) => `${each.kind}:${each.name}`);
}

// THE MODULE'S OWN CONTROL, which the running scan refuses to report without.
{
  const found = unread(CONTROL);
  check('the control’s three unread assets are reported, and its three read ones are not', JSON.stringify(found) === JSON.stringify(CONTROL_UNREAD), `reported ${JSON.stringify(found)}`);
}

// CLASSES.
{
  const sheet = [{ file: 'a.css', text: '.m-named { color: red; }\n.m-built--on { color: red; }\n.m-joined--on { color: red; }\n.m-dead { color: red; }' }];
  const found = unread({
    stylesheets: sheet,
    sources: [{ file: 'a.tsx', text: "<div className='m-named' />; const b = `m-built--${on}`; const c = 'm-joined--' + on;" }],
  });
  check('a class named whole is read', !found.includes('class:m-named'), `reported ${JSON.stringify(found)}`);
  check('a class a template literal builds from its prefix is read', !found.includes('class:m-built--on'), `reported ${JSON.stringify(found)}`);
  check('a class a string joined with + builds from its prefix is read', !found.includes('class:m-joined--on'), `reported ${JSON.stringify(found)}`);
  check('a class nothing names is reported', found.includes('class:m-dead'), `reported ${JSON.stringify(found)}`);
  check(
    'a declaration’s value and a comment are not selectors, and a class outside the namespace is not the application’s',
    JSON.stringify([...classesStyled('/* .m-commented */ .m-real { width: 0.5em; } .textLayer { color: red; }')]) === JSON.stringify(['m-real']),
    `read ${JSON.stringify([...classesStyled('/* .m-commented */ .m-real { width: 0.5em; } .textLayer { color: red; }')])}`,
  );
  check(
    'a test is not a reader: the tree walk leaves it out',
    isTest('Thing.test.tsx') && isTest('walk.pw.ts') && isTest('screens.a.capture.ts') && !isTest('Thing.tsx'),
    'a test file was taken as a source, or a source as a test',
  );
}

// MESSAGE KEYS.
{
  const catalogue = {
    file: 'packages/ui/src/messages/en.ts',
    text: [
      "export const KEY_NAMED = messageKey('a');",
      "export const KEY_IN_TABLE = messageKey('b');",
      "export const KEY_IN_INNER = messageKey('c');",
      "export const KEY_DEAD = messageKey('d');",
      "export const KEY_IN_DEAD_TABLE = messageKey('e');",
      'export const INNER = { one: KEY_IN_INNER } as const;',
      'export const TABLE = { one: KEY_IN_TABLE, two: INNER } as const;',
      'export const DEAD_TABLE = { one: KEY_IN_DEAD_TABLE } as const;',
    ].join('\n'),
  };
  const found = unread({ catalogue, sources: [catalogue, { file: 'b.tsx', text: '_(KEY_NAMED); read(TABLE);' }] });
  check('a key named outside the catalogue is read', !found.includes('message:KEY_NAMED'), `reported ${JSON.stringify(found)}`);
  check(
    'a key held by a read table is read, and through a table inside that table too',
    !found.includes('message:KEY_IN_TABLE') && !found.includes('message:KEY_IN_INNER'),
    `reported ${JSON.stringify(found)}`,
  );
  check(
    'a key nothing names is reported, and so is a key held only by a table nothing reads',
    found.includes('message:KEY_DEAD') && found.includes('message:KEY_IN_DEAD_TABLE'),
    `reported ${JSON.stringify(found)}`,
  );
}

// SETTINGS.
{
  const definitions = [
    {
      file: 'packages/ui/src/settings/one.ts',
      text: [
        "export const BY_CONSTANT = {\n  id: 'one.by-constant',\n};",
        "export const BY_ID = {\n  id: 'one.by-id',\n};",
        "export const LISTED_ONLY = {\n  id: 'one.listed-only',\n};",
      ].join('\n'),
    },
  ];
  const found = unread({
    settings: definitions,
    sources: [
      ...definitions,
      { file: 'packages/ui/src/settings/all.ts', text: 'export const ALL = [BY_CONSTANT, BY_ID, LISTED_ONLY];' },
      { file: 'c.tsx', text: "useSetting(BY_CONSTANT); settings.get('one.by-id');" },
    ],
  });
  check('a setting read through its constant is read', !found.includes('setting:one.by-constant'), `reported ${JSON.stringify(found)}`);
  check('a setting read by its id is read', !found.includes('setting:one.by-id'), `reported ${JSON.stringify(found)}`);
  check('a setting the registry lists and nothing reads is reported', found.includes('setting:one.listed-only'), `reported ${JSON.stringify(found)}`);
}

if (failures.length > 0) {
  process.stderr.write(
    `\nUnread-asset scan proof — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      '\n\nA scan that cannot separate a read asset from an unread one reads as coverage while a deleted screen leaves ' +
      'its rules, words and settings behind.\n\n',
  );
  process.exit(1);
}

process.stdout.write(roster.format('unread-asset case'));
