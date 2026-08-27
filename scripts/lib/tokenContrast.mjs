// @ts-check
/**
 * Contrast is ENFORCED, not audited — computed from the token file itself.
 *
 * ARCHITECTURE §10.2 and ADR-0003. Every colour role declares a category and,
 * for foregrounds and boundaries, the set of surfaces it may sit on. This
 * evaluates exactly those declared pairs: 4.5:1 for `text`, 3:1 for
 * `boundary-control`, nothing for the rest.
 *
 * ## Why declared pairs rather than every combination
 *
 * ADR-0003's finding: a check derived from *every text role × every surface* is
 * simultaneously over-broad — it fails pairs that never render, and the only
 * ways out are a hand-maintained exception list or a wholesale exemption, both
 * banned — and under-specified, because it cannot tell a divider from a control
 * boundary. Typing the roles is the fix; raising a value until the check passes
 * is the patch.
 *
 * Invariant L16 is what makes *declared pairs* exhaustive rather than narrow: a
 * foreground that is not a token cannot exist, so a pair this does not evaluate
 * cannot render.
 *
 * ## The completeness check is bidirectional, and that is the load-bearing half
 *
 * A missing role declaration silently NARROWS this check — the failure that
 * makes the set smaller, which a count derived from the same file could never
 * disagree with (audit item 4c). So both directions are required: every declared
 * role has a value in every theme, and every value has a declared role. A value
 * with no role is a colour this cannot see, and it reports exactly as a clean
 * run does.
 *
 * ## What this does NOT cover, stated rather than left implied
 *
 * The DERIVED half. §10.2 requires every contrast-bearing companion to be
 * computed at the point of use by `onColor`, and requires CI to exercise that
 * function across every (context, minRatio) pair. Nothing here does that, so
 * `--accent-soft`'s permitted foreground — the derived chrome accent text — is
 * reported as DEFERRED rather than skipped. A skip that prints is a gap; a skip
 * that does not is a check that reads as complete.
 *
 * Usage: node scripts/lib/tokenContrast.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';

/** Contrast obligations by category. `null` means the category carries none. */
const OBLIGATION = {
  surface: null,
  text: 4.5,
  'boundary-control': 3,
  'boundary-decorative': null,
  fill: null,
  derived: null,
};

/** Categories that must declare a surface set, and those that must not. */
const NEEDS_SURFACES = new Set(['text', 'boundary-control']);

/** @param {string} root */
export function tokenFile(root) {
  return join(root, 'packages', 'ui', 'src', 'tokens.css');
}

/**
 * @typedef {{ name: string, category: string, on: string[] }} Role
 * @typedef {{ theme: string, values: Map<string, string> }} Theme
 */

/**
 * @param {string} css
 * @returns {Role[]}
 */
export function rolesIn(css) {
  /** @type {Role[]} */
  const roles = [];
  for (const line of css.split('\n')) {
    const match = /^\s*\*\s*@role\s+(\S+)\s+(\S+)(.*)$/u.exec(line);
    if (match === null) continue;
    const on = (match[3] ?? '').replace(/@on\s*/u, '').trim();
    roles.push({
      name: match[1] ?? '',
      category: match[2] ?? '',
      on: on === '' ? [] : on.split(/\s+/u),
    });
  }
  return roles;
}

/**
 * Every theme block and the custom properties it sets.
 *
 * Only blocks naming a theme are read. The scale block at the end of the file
 * sets `:root` alone and holds no colours, so including it would put spacing
 * values into a colour check.
 *
 * @param {string} css
 * @returns {Theme[]}
 */
export function themesIn(css) {
  /** @type {Theme[]} */
  const themes = [];
  const blocks = css.matchAll(/(\[data-theme='([a-z]+)'\][^{]*)\{([^}]*)\}/gu);
  for (const block of blocks) {
    /** @type {Map<string, string>} */
    const values = new Map();
    for (const declaration of (block[3] ?? '').matchAll(/--([\w-]+)\s*:\s*([^;]+);/gu)) {
      values.set((declaration[1] ?? '').trim(), (declaration[2] ?? '').trim());
    }
    themes.push({ theme: block[2] ?? '', values });
  }
  return themes;
}

/**
 * sRGB channels 0-255 for a hex or `rgba()` value, composited over `over`.
 *
 * An alpha role is evaluated POST-COMPOSITE against each surface it sits on
 * (§10.2), because that is what renders — a check against the raw rgba() would
 * be measuring a colour nobody sees.
 *
 * @param {string} value
 * @param {[number, number, number] | null} over
 * @returns {[number, number, number] | null} null when the value is not a colour
 */
export function channels(value, over = null) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(value.trim());
  if (hex !== null) {
    const digits = hex[1] ?? '';
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((digit) => `${digit}${digit}`)
            .join('')
        : digits;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }

  const rgba = /^rgba?\(([^)]+)\)$/u.exec(value.trim());
  if (rgba === null) return null;
  const parts = (rgba[1] ?? '').split(',').map((part) => Number(part.trim()));
  const [red, green, blue, alpha = 1] = parts;
  if (![red, green, blue].every((part) => Number.isFinite(part))) return null;
  if (alpha >= 1 || over === null) {
    return [Number(red), Number(green), Number(blue)];
  }
  return [
    Number(red) * alpha + over[0] * (1 - alpha),
    Number(green) * alpha + over[1] * (1 - alpha),
    Number(blue) * alpha + over[2] * (1 - alpha),
  ];
}

/** @param {[number, number, number]} rgb @returns {number} WCAG relative luminance */
export function luminance([red, green, blue]) {
  /** @param {number} raw */
  const channel = (raw) => {
    const value = raw / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/**
 * @param {[number, number, number]} foreground
 * @param {[number, number, number]} background
 * @returns {number}
 */
export function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * @typedef {{
 *   blind: string | null,
 *   evaluated: number,
 *   deferred: string[],
 *   failures: string[],
 *   tightest: { pair: string, ratio: number, minimum: number } | null,
 * }} ContrastResult
 */

/**
 * @param {string} css
 * @returns {ContrastResult}
 */
export function evaluate(css) {
  const roles = rolesIn(css);
  const themes = themesIn(css);

  if (roles.length === 0) {
    return { blind: 'no @role declarations found', evaluated: 0, deferred: [], failures: [], tightest: null };
  }
  if (themes.length === 0) {
    return { blind: 'no theme blocks found', evaluated: 0, deferred: [], failures: [], tightest: null };
  }

  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const deferred = [];
  let evaluated = 0;
  /**
   * The pair with the least headroom over its threshold.
   *
   * Printed on a PASSING run, because a value drifting toward its threshold is
   * invisible in a green check until the commit that crosses it — and ADR-0003's
   * solved values clear 3:1 by hundredths, so this is a margin somebody will
   * spend without noticing.
   *
   * @type {{ pair: string, ratio: number, minimum: number } | null}
   */
  let tightest = null;

  // ---- Both directions of completeness, before any contrast is computed ----
  const declared = new Set(roles.map((role) => role.name));
  for (const role of roles) {
    if (NEEDS_SURFACES.has(role.category) && role.on.length === 0) {
      failures.push(`--${role.name} is ${role.category} and declares no @on surfaces`);
    }
    if (!NEEDS_SURFACES.has(role.category) && role.on.length > 0) {
      failures.push(`--${role.name} is ${role.category} and may not declare @on surfaces`);
    }
    if (!(role.category in OBLIGATION)) {
      failures.push(`--${role.name} declares unknown category ${role.category}`);
    }
    for (const theme of themes) {
      if (!theme.values.has(role.name)) {
        failures.push(`--${role.name} is declared but has no value in the ${theme.theme} theme`);
      }
    }
  }
  for (const theme of themes) {
    for (const name of theme.values.keys()) {
      // `--shadow` is an elevation value rather than a colour role. Named here
      // rather than pattern-matched: a rule like "skip anything not a colour"
      // would skip a colour the parser failed to read, which is this check's
      // reassuring answer produced by a broken parse.
      if (name === 'shadow') continue;
      if (!declared.has(name)) {
        failures.push(`--${name} has a value in ${theme.theme} but no @role declaration`);
      }
    }
  }

  // ---- The declared pairs ----
  for (const theme of themes) {
    for (const role of roles) {
      const minimum = OBLIGATION[/** @type {keyof typeof OBLIGATION} */ (role.category)];
      if (minimum === null || minimum === undefined) continue;

      const rawForeground = theme.values.get(role.name);
      if (rawForeground === undefined) continue;

      for (const surfaceName of role.on) {
        const rawSurface = theme.values.get(surfaceName);
        if (rawSurface === undefined) {
          failures.push(`--${role.name} declares @on ${surfaceName}, which has no value in ${theme.theme}`);
          continue;
        }
        const background = channels(rawSurface);
        if (background === null) {
          deferred.push(`${theme.theme}: --${role.name} on --${surfaceName} (surface is not a static colour)`);
          continue;
        }
        const foreground = channels(rawForeground, background);
        if (foreground === null) {
          deferred.push(`${theme.theme}: --${role.name} on --${surfaceName} (foreground is derived)`);
          continue;
        }
        evaluated += 1;
        const ratio = contrast(foreground, background);
        const pair = `${theme.theme}: --${role.name} on --${surfaceName}`;
        if (tightest === null || ratio - minimum < tightest.ratio - tightest.minimum) {
          tightest = { pair, ratio, minimum };
        }
        if (ratio < minimum) {
          failures.push(
            `${theme.theme}: --${role.name} on --${surfaceName} is ${ratio.toFixed(2)}:1, ` +
              `below ${minimum}:1 (${role.category})`,
          );
        }
      }
    }
  }

  // The derived half, named rather than absent. `--accent-soft` is declared a
  // surface whose only permitted foreground is the derived chrome accent text
  // (ADR-0003), and nothing here computes that.
  if (declared.has('accent-soft')) {
    deferred.push(
      'every theme: --accent-soft carries only the DERIVED chrome accent text, which needs ' +
        'onColor() — the derivation half of §10.2, owed',
    );
  }

  return { blind: null, evaluated, deferred, failures, tightest };
}

/** A fixture whose failure this check must report, and whose pass it must not. */
export const CONTROL_FIXTURE = [
  ' * @role bg surface',
  ' * @role text text @on bg',
  ' * @role ghost text @on bg',
  "[data-theme='probe'] {",
  '  --bg: #ffffff;',
  '  --text: #000000;',
  '  --ghost: #f2f2f2;',
  '}',
].join('\n');

/**
 * @param {{ root?: string }} [options]
 * @returns {ContrastResult}
 */
export function scan({ root = repoRoot() } = {}) {
  // The positive control, on every run. This check's reassuring answer is "no
  // failures", which is also what a wrong role pattern, an unreadable file and
  // an empty theme list all report.
  const control = evaluate(CONTROL_FIXTURE);
  const seesTheFailure = control.failures.some((failure) => failure.includes('--ghost'));
  const passesTheGoodPair = !control.failures.some((failure) => failure.includes('--text on'));
  if (!seesTheFailure || !passesTheGoodPair) {
    return {
      blind:
        `the control fixture did not behave: --ghost on --bg must FAIL and --text on --bg must ` +
        `PASS. Got ${control.failures.length} failure(s): ${control.failures.join('; ') || 'none'}`,
      evaluated: 0,
      deferred: [],
      failures: [],
      tightest: null,
    };
  }

  const path = tokenFile(root);
  if (!existsSync(path)) {
    return { blind: `${path} does not exist`, evaluated: 0, deferred: [], failures: [], tightest: null };
  }
  return evaluate(readFileSync(path, 'utf8'));
}

/** @param {ContrastResult} result @returns {string} */
export function report(result) {
  if (result.blind !== null) {
    return (
      `  !!  the token contrast check could not see, so it reported nothing\n` +
      `      ${result.blind}\n`
    );
  }
  const deferredLines = result.deferred.map((entry) => `  --  DEFERRED: ${entry}\n`).join('');
  if (result.failures.length === 0) {
    const margin =
      result.tightest === null
        ? ''
        : `      tightest: ${result.tightest.pair} at ${result.tightest.ratio.toFixed(2)}:1 ` +
          `against ${result.tightest.minimum}:1\n`;
    return (
      `  ok  ${result.evaluated} declared token pair(s) meet their contrast obligation\n` +
      `  ok  and the control fixture failed the pair it must fail, so that means something\n` +
      margin +
      deferredLines
    );
  }
  return (
    `  !!  ${result.failures.length} token contrast or completeness failure(s)\n\n` +
    result.failures.map((failure) => `      ${failure}`).join('\n') +
    `\n\n      Raising a value until this passes is the patch ADR-0003 rejected. The value is ` +
    `the design draft's, which M2 names as the seed and the naming authority, so a failure ` +
    `here is a question for the owner rather than a number to move.\n` +
    deferredLines
  );
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  const outcome = scan();
  process.stdout.write(report(outcome));
  process.exitCode = outcome.blind !== null || outcome.failures.length > 0 ? 1 : 0;
}
