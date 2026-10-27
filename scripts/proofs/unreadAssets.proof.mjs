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

import { CONTROL, CONTROL_UNREAD, classesStyled, isTest, settingIdsIn, unreadIn } from '../lib/unreadAssets.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 21 });

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

// THE CATALOGUE'S OWN RECORD IS NOT A TABLE. The English record names every key as a computed property name to give it
// its words, and the application imports it, so taking it for a table read every key: a planted dead key with its
// English words was reported by nothing (measured 2026-10-27, the stage audit of dabf6041..f1c1dc16).
{
  const catalogue = {
    file: 'packages/ui/src/messages/en.ts',
    text: [
      "export const KEY_USED = messageKey('a');",
      "export const KEY_WORDS_ONLY = messageKey('b');",
      "export const KEY_SPACED =messageKey('c');",
      "export const EN: Readonly<Record<MessageKey, string>> = {\n  [KEY_USED]: 'Used',\n  [KEY_WORDS_ONLY]: 'Words only',\n  [KEY_SPACED]: 'Spaced',\n};",
    ].join('\n'),
  };
  const found = unread({ catalogue, sources: [catalogue, { file: 'i18n.ts', text: 'activate(EN); _(KEY_USED); _(KEY_SPACED);' }] });
  check('a key with its words in the English record and no other reader is reported', found.includes('message:KEY_WORDS_ONLY'), `reported ${JSON.stringify(found)}`);
  check('a key written without the space before messageKey is parsed and judged', !found.includes('message:KEY_SPACED') && found.length === 1, `reported ${JSON.stringify(found)}`);
  let refused = '';
  try {
    unread({ catalogue: { file: catalogue.file, text: "const HIDDEN = messageKey('d');" } });
  } catch (error) {
    refused = String(error);
  }
  check('a key the parse cannot see refuses the run rather than passing it', refused.includes('found 0 of its 1 keys'), `answered ${refused || 'without refusing'}`);
}

// A SETTING'S TITLE IS READ IN THE SETTINGS DEFINITIONS, and a comment or a visual test names without reading.
{
  const catalogue = { file: 'packages/ui/src/messages/en.ts', text: "export const TITLE_OF_SETTING = messageKey('a');\nexport const KEY_IN_COMMENT = messageKey('b');" };
  const found = unread({
    catalogue,
    sources: [catalogue, { file: 'packages/ui/src/settings/one.ts', text: 'export const S = { title: TITLE_OF_SETTING };' }, { file: 'x.tsx', text: '// KEY_IN_COMMENT\n/* KEY_IN_COMMENT */ go();' }],
  });
  check('a key the settings definitions read is read', !found.includes('message:TITLE_OF_SETTING'), `reported ${JSON.stringify(found)}`);
  check('a key named only in comments is reported, and a visual capture is a test', found.includes('message:KEY_IN_COMMENT') && isTest('gallery.visual.ts'), `reported ${JSON.stringify(found)}`);
}

// A SETTING WHOSE ID IS A CONSTANT, one whose id is an expression, and a holder that closes with a bracket.
{
  const definitions = [
    {
      file: 'packages/ui/src/settings/two.ts',
      text: [
        "export const READ_ID = 'two.read';",
        "export const DEAD_ID = 'two.dead';",
        'export const BY_READ = {\n  id: READ_ID,\n};',
        'export const BY_DEAD = {\n  id: DEAD_ID,\n};',
        'export const MADE = make({\n  id: \'two.made\',\n});',
        'const UNHELD = make({\n  id: \'two.unheld\',\n});',
        'export const LOOPED = names.map((name) => ({\n  id: KEYS[name].setting,\n}));',
      ].join('\n'),
    },
  ];
  const sources = [...definitions, { file: 'd.tsx', text: 'useSetting(READ_ID); useSetting(MADE);' }];
  const found = unread({ settings: definitions, sources });
  check(
    'a setting whose id is a constant is judged: read through it, and reported by its id when nothing reads it',
    !found.includes('setting:two.read') && found.includes('setting:two.dead'),
    `reported ${JSON.stringify(found)}`,
  );
  check('a setting after a definition that closes with a bracket is not credited to it', found.includes('setting:two.unheld') && !found.includes('setting:two.made'), `reported ${JSON.stringify(found)}`);
  const { notFollowed } = settingIdsIn(definitions, sources);
  check('an id written as an expression is named as not followed, not counted read', JSON.stringify(notFollowed.map((each) => each.expression)) === JSON.stringify(['KEYS[name].setting']), `named ${JSON.stringify(notFollowed)}`);
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
