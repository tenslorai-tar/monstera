// @ts-check
/**
 * Every stylesheet class, message key and setting the application defines has a reader.
 *
 * ## The defect this exists for
 *
 * The owner's rule for the rebuilt editor (ADR-0271, Milestone 2): *the rebuild replaces the old editor completely; no
 * traces may remain.* A module that is deleted takes its imports with it, and the compiler says so. What it leaves
 * behind is what the compiler never sees: the rules in `app.css` that styled it, the message keys only its words used,
 * the settings only it read. Each keeps working, costs nothing anyone measures, and reads to the next person as a part of
 * the product, which is the whole defect: a stylesheet rule for a screen that no longer exists is a specification of a
 * screen that no longer exists.
 *
 * ## Three set differences
 *
 * - **A class** a stylesheet under `packages/*` or `apps/*` styles, in the application's own namespace (`m-`), is read
 *   when a source file names it as a whole token, or builds it: a template literal or a string whose literal part ends
 *   where an interpolation or a `+` begins (`m-kit__run--${kind}`, `'m-tab--' + state`) reads every class with that
 *   prefix. A class outside the namespace is a library's (PDF.js draws `.textLayer`), which this repository styles and
 *   does not write.
 * - **A message key** (`export const NAME = messageKey(...)` in `messages/en.ts`) is read when a source file other than
 *   the catalogues names it, or when another export of the catalogue that is itself read names it (a table of option
 *   titles is read through its own name): a fixed point over the catalogue's exports.
 * - **A setting** (an `id: '<group>.<name>'` in `packages/ui/src/settings/*`) is read when a source file outside the
 *   settings definitions names its id, or names the exported constant that holds it. The settings registry's listing
 *   (`settings/all.ts`) is not a reader: it shows a setting, and a setting shown and never read is the defect.
 *
 * A TEST IS NOT A READER. A test that names a class proves something about a screen; it does not draw it.
 *
 * ## What it deliberately does not decide
 *
 * A class built from a variable with no literal prefix (`className={name}`) cannot be followed to the stylesheet from
 * the text. Each such class must still be named somewhere as a whole token or prefix, which is the shape every class in
 * this tree has on the day this was written; a class reached only through a computed string reads as unread, and the
 * remedy is to name it, not to widen this rule.
 *
 * ## Its own positive control
 *
 * A search's reassuring answer is *found nothing*. So the scan runs its rule over {@link CONTROL} first, a fixture of a
 * stylesheet, a catalogue, a setting and a source, and refuses to report unless it finds the three unread assets the
 * fixture plants and passes the three read ones beside them, each read by one of the rule's routes (a token, a prefix,
 * a constant).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { isMain } from './isMain.mjs';

/** The application's own class namespace. */
const NAMESPACE = 'm-';

/** The message catalogues: a key named only here is unread. */
const CATALOGUES = new Set(['packages/ui/src/messages/en.ts', 'packages/ui/src/messages/pseudo.ts']);

/** The settings definitions: a setting named only here, or in the registry's listing, is unread. */
const SETTINGS_DIR = 'packages/ui/src/settings/';

/**
 * @typedef {{ file: string, text: string }} Source
 * @typedef {{ kind: 'class' | 'message' | 'setting', name: string, file: string }} Unread
 */

/** @param {string} text */
function withoutBlockComments(text) {
  return text.replaceAll(/\/\*[\s\S]*?\*\//gu, (comment) => comment.replaceAll(/[^\n]/gu, ' '));
}

/**
 * The classes a stylesheet styles, in the namespace: every `.name` in a selector, a rule's text before its brace. A
 * declaration's value is not a selector, so `0.5em` is never read as a class.
 * @param {string} css
 */
export function classesStyled(css) {
  const found = new Set();
  const text = withoutBlockComments(css);
  for (const selector of text.matchAll(/(?:^|[{}])([^{}@;]*)\{/gu)) {
    for (const match of (selector[1] ?? '').matchAll(/\.(-?[A-Za-z_][\w-]*)/gu)) {
      const name = match[1] ?? '';
      if (name.startsWith(NAMESPACE)) found.add(name);
    }
  }
  return found;
}

/**
 * What the sources name: every identifier-like token (for whole names), and every literal prefix that a dynamic part
 * continues (for built classes).
 * @param {readonly Source[]} sources
 */
function namesIn(sources) {
  const tokens = new Set();
  const prefixes = new Set();
  for (const { text } of sources) {
    for (const match of text.matchAll(/[A-Za-z_][\w.-]*/gu)) {
      // A TOKEN AND EACH OF ITS DOTTED PARTS: `editing.fallback-face` names the setting, and a class is never dotted.
      tokens.add(match[0]);
      for (const part of match[0].split('.')) tokens.add(part);
    }
    for (const match of text.matchAll(/([A-Za-z_][\w-]*[-_])(?:\$\{|['"]\s*\+)/gu)) prefixes.add(match[1]);
  }
  return { tokens, prefixes };
}

/**
 * The rule, over named texts, which is what makes it provable: a proof that wrote files would be testing the walker.
 * @param {{ stylesheets: readonly Source[], catalogue: Source | null, settings: readonly Source[], sources: readonly Source[] }} input
 * @returns {Unread[]}
 */
export function unreadIn({ stylesheets, catalogue, settings, sources }) {
  /** @type {Unread[]} */
  const unread = [];
  const readers = sources.filter(({ file }) => !CATALOGUES.has(file) && !file.startsWith(SETTINGS_DIR));
  const { tokens, prefixes } = namesIn(readers);
  const prefixList = [...prefixes];

  for (const sheet of stylesheets) {
    for (const name of classesStyled(sheet.text)) {
      if (tokens.has(name) || prefixList.some((prefix) => name.startsWith(prefix))) continue;
      unread.push({ kind: 'class', name, file: sheet.file });
    }
  }

  if (catalogue !== null) {
    const keys = [...catalogue.text.matchAll(/^export const ([A-Z][A-Z0-9_]*) = messageKey\(/gmu)].map((match) => match[1] ?? '');
    // EVERY OTHER EXPORT of the catalogue and the names its body uses, for the fixed point: a table of titles is read
    // through its own name, and every key it holds is read with it.
    const exportsOf = new Map();
    const blocks = catalogue.text.split(/^(?=export )/mu);
    for (const block of blocks) {
      const name = /^export (?:const|function) ([A-Za-z_]\w*)/u.exec(block)?.[1];
      if (name === undefined || keys.includes(name)) continue;
      exportsOf.set(name, new Set(block.match(/[A-Z][A-Z0-9_]+/gu) ?? []));
    }
    const read = new Set(keys.filter((key) => tokens.has(key)));
    const readExports = new Set([...exportsOf.keys()].filter((name) => tokens.has(name)));
    let grew = true;
    while (grew) {
      grew = false;
      for (const name of readExports) {
        for (const used of exportsOf.get(name) ?? []) {
          if (keys.includes(used) && !read.has(used)) {
            read.add(used);
            grew = true;
          }
          if (exportsOf.has(used) && !readExports.has(used)) {
            readExports.add(used);
            grew = true;
          }
        }
      }
    }
    for (const key of keys) if (!read.has(key)) unread.push({ kind: 'message', name: key, file: catalogue.file });
  }

  for (const definition of settings) {
    const text = definition.text;
    for (const match of text.matchAll(/\bid:\s*'([a-z][\w-]*\.[\w.-]+)'/gu)) {
      const id = match[1] ?? '';
      // THE CONSTANT THAT HOLDS IT, where one does: the nearest `export const NAME` above the id.
      const before = text.slice(0, match.index);
      const holder = [...before.matchAll(/^export const ([A-Z][A-Z0-9_]*)\b/gmu)].at(-1)?.[1];
      const holderIsNear = holder !== undefined && before.lastIndexOf(`export const ${holder}`) > before.lastIndexOf('\n};');
      if (tokens.has(id) || (holderIsNear && tokens.has(holder))) continue;
      unread.push({ kind: 'setting', name: id, file: definition.file });
    }
  }
  return unread;
}

/** The fixture the rule must report three of, and pass three of. */
export const CONTROL = {
  stylesheets: [{ file: 'control.css', text: '.m-control-read { color: red; } .m-control-built--on, .m-control-unread { margin: 0.5em; }' }],
  catalogue: {
    file: 'control-catalogue.ts',
    text: [
      "export const CONTROL_READ = messageKey('control.read');",
      "export const CONTROL_UNREAD = messageKey('control.unread');",
      "export const CONTROL_TABLED = messageKey('control.tabled');",
      'export const CONTROL_TABLE = { one: CONTROL_TABLED } as const;',
    ].join('\n'),
  },
  settings: [
    {
      file: `${SETTINGS_DIR}control.ts`,
      text: "export const CONTROL_SETTING = {\n  id: 'control.read-setting',\n};\nconst other = {\n  id: 'control.unread-setting',\n};\n",
    },
  ],
  sources: [
    {
      file: 'control-source.tsx',
      text: "const a = <div className='m-control-read' title={_(CONTROL_READ)} />; const b = `m-control-built--${state}`; read(CONTROL_TABLE, CONTROL_SETTING);",
    },
  ],
};

/** What the control must report: the three unread assets, and nothing else. */
export const CONTROL_UNREAD = ['class:m-control-unread', 'message:CONTROL_UNREAD', 'setting:control.unread-setting'];

/** @param {string} dir @param {(name: string) => boolean} wanted @returns {string[]} */
function filesIn(dir, wanted) {
  /** @type {string[]} */
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const full = join(dir, name);
    const entry = statSync(full);
    if (entry.isDirectory()) found.push(...filesIn(full, wanted));
    else if (wanted(name)) found.push(full);
  }
  return found;
}

/** A test, which names things without reading them. @param {string} name */
export const isTest = (name) => /\.(test|spec|pw|capture)\.[cm]?[jt]sx?$/u.test(name);

/** The tree's own input to the rule. @param {string} root */
export function treeInput(root = repoRoot()) {
  const read = (/** @type {string} */ file) => ({ file: relative(root, file).replaceAll('\\', '/'), text: readFileSync(file, 'utf8') });
  const areas = ['packages', 'apps'].map((area) => join(root, area));
  const stylesheets = areas.flatMap((area) => filesIn(area, (name) => name.endsWith('.css'))).map(read);
  const sources = areas.flatMap((area) => filesIn(area, (name) => /\.(tsx?|html)$/u.test(name) && !name.endsWith('.d.ts') && !isTest(name))).map(read);
  const catalogue = sources.find((source) => source.file === 'packages/ui/src/messages/en.ts') ?? null;
  const settings = sources.filter((source) => source.file.startsWith(SETTINGS_DIR) && !source.file.endsWith('/all.ts'));
  return { stylesheets, catalogue, settings, sources };
}

if (isMain(import.meta.url)) {
  const control = unreadIn(CONTROL).map((each) => `${each.kind}:${each.name}`);
  if (JSON.stringify(control) !== JSON.stringify(CONTROL_UNREAD)) {
    process.stderr.write(`The unread-asset scan could not tell its control apart: it reported ${JSON.stringify(control)}, where ${JSON.stringify(CONTROL_UNREAD)} was planted. It reports nothing until it can.\n`);
    process.exit(2);
  }
  const input = treeInput();
  if (input.stylesheets.length === 0 || input.catalogue === null || input.settings.length === 0) {
    process.stderr.write('The unread-asset scan found no stylesheet, catalogue or settings to read, so it has looked at nothing.\n');
    process.exit(2);
  }
  const unread = unreadIn(input);
  process.stdout.write(`  ok  the scan reported its control's three unread assets and passed its three read ones\n`);
  for (const each of unread) process.stdout.write(`  UNREAD ${each.kind} ${each.name} (${each.file})\n`);
  process.stdout.write(`${unread.length === 0 ? '  ok ' : 'FAIL'} ${String(unread.length)} unread asset(s) among ${String(input.stylesheets.length)} stylesheet(s), the message catalogue and ${String(input.settings.length)} settings module(s)\n`);
  process.exitCode = unread.length === 0 ? 0 : 1;
}
