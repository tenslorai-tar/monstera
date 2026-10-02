// @ts-check
/**
 * ONE COMPONENT CLASS OWNS AN ELEMENT'S LAYOUT: the check that two classes on one element do not both set it.
 *
 * ## The defect, and why it hides
 *
 * Every menu bar item carried `.m-menu-bar__item`, a three-column grid (mark, title, chord), and
 * `.m-context-menu-item`, a flex row with `justify-content: space-between`. Both set `display`; the later rule in
 * `app.css` won, so the items were flex rows and each title floated away from its shortcut towards the middle
 * (the owner's review of 0.1.6.0, every menu). Neither rule is wrong alone, and each reads as the item's layout
 * from inside its own block, which is why review passed over it: the defect is the PAIR, and only an element that
 * carries both classes shows it. Which one wins is decided by source order, a fact about the stylesheet that no
 * component author sees.
 *
 * ## What is checked
 *
 * For every `className` string literal in a component (`packages/ui/src/**.tsx`), the `m-` classes it names; for
 * each class, whether a rule whose subject is that class alone sets a LAYOUT property (`LAYOUT_PROPERTIES`). Two or
 * more such classes on one literal is a finding. A BEM modifier (`x--y` beside `x`) is exempt: overriding its own
 * block is what a modifier is for, and the pair is spelt in one place.
 *
 * ## What it cannot see, stated so its silence is not over-read
 *
 * A class list built at runtime from variables, and a rule whose subject is a compound of two classes (that rule IS
 * the deliberate combination, owned in one place). Descendant selectors count for their subject class, since they
 * set that element's layout.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { isMain } from './isMain.mjs';

/** The properties that decide how an element lays out its children. */
export const LAYOUT_PROPERTIES = new Set([
  'display',
  'flex-direction',
  'flex-flow',
  'flex-wrap',
  'justify-content',
  'justify-items',
  'align-items',
  'align-content',
  'place-items',
  'place-content',
  'grid-template',
  'grid-template-columns',
  'grid-template-rows',
  'grid-template-areas',
  'grid-auto-flow',
]);

/**
 * Which classes a stylesheet gives a layout to: class → the properties set, from rules whose subject compound
 * names that one class.
 *
 * @param {string} css
 * @returns {Map<string, Set<string>>}
 */
export function layoutClasses(css) {
  /** @type {Map<string, Set<string>>} */
  const owners = new Map();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // A rule is `selectors { declarations }` with no brace inside the declarations; an at-rule's own braces wrap
  // ordinary rules, which this pattern meets one at a time.
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').trim();
    const body = match[2] ?? '';
    if (selectors.startsWith('@')) continue;
    const properties = [...body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)]
      .map((each) => each[1] ?? '')
      .filter((property) => LAYOUT_PROPERTIES.has(property));
    if (properties.length === 0) continue;
    for (const selector of selectors.split(',')) {
      const compounds = selector.trim().split(/\s*[\s>+~]\s*/);
      const subject = compounds.at(-1) ?? '';
      const classes = [...subject.matchAll(/\.(m-[A-Za-z0-9_-]+)/g)].map((each) => each[1] ?? '');
      if (classes.length !== 1) continue;
      const owner = classes[0] ?? '';
      const set = owners.get(owner) ?? new Set();
      for (const property of properties) set.add(property);
      owners.set(owner, set);
    }
  }
  return owners;
}

/**
 * Every class list a component spells as a string literal in a `className`, with where.
 *
 * @param {string} source
 * @returns {{ line: number, classes: string[] }[]}
 */
export function classLists(source) {
  /** @type {{ line: number, classes: string[] }[]} */
  const lists = [];
  for (const match of source.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)) {
    const line = source.slice(0, match.index).split('\n').length;
    const literals = match[1] !== undefined ? [match[1]] : [...(match[2] ?? '').matchAll(/'([^']*)'|"([^"]*)"/g)].map((each) => each[1] ?? each[2] ?? '');
    for (const literal of literals) {
      const classes = literal.split(/\s+/).filter((name) => name.startsWith('m-'));
      if (classes.length > 1) lists.push({ line, classes });
    }
  }
  return lists;
}

/**
 * The classes in `classes` that would each set the element's layout, a BEM modifier beside its own block removed.
 *
 * @param {readonly string[]} classes
 * @param {Map<string, Set<string>>} owners
 * @returns {string[]}
 */
export function layoutOwnersOf(classes, owners) {
  return classes.filter((name) => {
    if (!owners.has(name)) return false;
    const block = name.split('--')[0] ?? name;
    return !(block !== name && classes.includes(block));
  });
}

/**
 * Every element spelt with two layout owners, across the given components and stylesheets.
 *
 * @param {{ components: readonly { path: string, source: string }[], stylesheets: readonly string[] }} input
 * @returns {{ path: string, line: number, owners: string[] }[]}
 */
export function findTwoOwners({ components, stylesheets }) {
  /** @type {Map<string, Set<string>>} */
  const owners = new Map();
  for (const css of stylesheets) {
    for (const [name, properties] of layoutClasses(css)) {
      const set = owners.get(name) ?? new Set();
      for (const property of properties) set.add(property);
      owners.set(name, set);
    }
  }
  /** @type {{ path: string, line: number, owners: string[] }[]} */
  const findings = [];
  for (const { path, source } of components) {
    for (const { line, classes } of classLists(source)) {
      const both = layoutOwnersOf(classes, owners);
      if (both.length > 1) findings.push({ path, line, owners: both });
    }
  }
  return findings;
}

/**
 * The repository's components and stylesheets under `packages/ui/src`, tests excluded.
 *
 * @param {string} root the repository root
 */
export function uiSources(root) {
  const base = join(root, 'packages', 'ui', 'src');
  /** @type {{ path: string, source: string }[]} */
  const components = [];
  /** @type {string[]} */
  const stylesheets = [];
  /** @param {string} directory */
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) {
        components.push({ path: relative(root, path), source: readFileSync(path, 'utf8') });
      } else if (name.endsWith('.css')) {
        stylesheets.push(readFileSync(path, 'utf8'));
      }
    }
  };
  walk(base);
  return { components, stylesheets };
}

/** The pair this check was written for, as a fixture the scan must report on every run. */
const CONTROL = {
  components: [{ path: 'control.tsx', source: '<Menu.Item className="m-context-menu-item m-menu-bar__item" />' }],
  stylesheets: ['.m-menu-bar__item { display: grid; }\n.m-context-menu-item { display: flex; justify-content: space-between; }'],
};

if (isMain(import.meta.url)) {
  // A SEARCH THAT CANNOT SEE says "found nothing" (audit item 4b), so this run must first find the pair it exists
  // for in a fixture, and must find in the real stylesheets the class known to own a menu item's layout.
  const control = findTwoOwners(CONTROL);
  const input = uiSources(repoRoot());
  const owners = new Map();
  for (const css of input.stylesheets) for (const [name, set] of layoutClasses(css)) owners.set(name, set);
  const lists = input.components.reduce((count, { source }) => count + classLists(source).length, 0);
  if (control.length !== 1 || !owners.has('m-context-menu-item') || lists === 0) {
    process.stderr.write(
      `Layout ownership — REFUSING TO REPORT: the scan could not see.\n` +
        `  fixture pair reported: ${String(control.length)} (expected 1)\n` +
        `  m-context-menu-item found as a layout owner: ${String(owners.has('m-context-menu-item'))}\n` +
        `  multi-class lists read: ${String(lists)} across ${String(input.components.length)} component(s)\n`,
    );
    process.exit(2);
  }
  const findings = findTwoOwners(input);
  if (findings.length > 0) {
    process.stderr.write(
      `Layout ownership — ${String(findings.length)} element(s) whose classes BOTH set layout; source order decides ` +
        `which wins, so one must own it:\n\n` +
        findings.map((finding) => `  ${finding.path}:${String(finding.line)}  ${finding.owners.join(' + ')}\n`).join('') +
        `\n  Give one class the layout, and let the other configure it (a custom property on a container), or\n` +
        `  make the second a BEM modifier of the first.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `Layout ownership — ${String(lists)} multi-class list(s) across ${String(input.components.length)} component(s), ` +
      `${String(owners.size)} layout-owning class(es): no element has two owners.\n` +
      `  ok  the fixture pair was reported, so that result means something\n`,
  );
}
