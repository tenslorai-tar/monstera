// @ts-check
/**
 * Contrast is ENFORCED, not audited — computed from the token file itself.
 *
 * ARCHITECTURE §10.2 and ADR-0003. Every colour role declares a category and,
 * for foregrounds, boundaries and graphics, the set of surfaces it may sit on.
 * This evaluates exactly those declared pairs: 4.5:1 for `text` — 7:1 where the
 * theme is `hc` (ADR-0003, corrected 2026-09-16) — 3:1 for
 * `boundary-control` and for `graphic` (a chrome graphic drawn over the document,
 * ADR-0003 corrected 2026-09-15), nothing for the rest.
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
import { pathToFileURL } from 'node:url';

import { TOKEN_CONTRAST, refuseStaleBuild } from './buildFreshness.mjs';
import { repoRoot } from './gitScope.mjs';

/**
 * The colour maths, from the BUILD of `packages/shared`.
 *
 * ## This check did not need a build until 2026-08-28, and now does
 *
 * Stated rather than absorbed, because a check that silently acquires a
 * provisioning condition is one that starts answering *could not look* in the
 * voice of *looked and found nothing* (audit item 3). The refusal below is what
 * keeps those two apart: a missing or stale build stops the run rather than
 * evaluating the token file against a previous version of the formula.
 *
 * Verified before moving it: CI's `build` job runs `npm run build` before the
 * step that runs this, so the dependency is satisfied where it matters.
 * `roleMainService.mjs` and `roleMupdfHost.mjs` take the same shape for the
 * same reason.
 *
 * Dynamic because the freshness check has to run BEFORE the import: a static
 * `import` is hoisted above every statement in this file, which would make the
 * guard below dead code that reads like a guard.
 */
const SHARED_BUILT = 'packages/shared/dist/colour.js';

// THROUGH THE OWNER, and this file was one of THREE private copies of the same
// rule (B3a). `buildFreshness.mjs` holds it, and what the copies did not have is
// what makes it correct: a directory walk, a test-file exclusion, and a refusal
// when the walk comes back empty — each measured, each absent here.
refuseStaleBuild(repoRoot(), TOKEN_CONTRAST, 1);

const colour = await import(pathToFileURL(join(repoRoot(), SHARED_BUILT)).href);

/** Contrast obligations by category. `null` means the category carries none. */
const OBLIGATION = {
  surface: null,
  // THE WINDOW'S GROUND and the light laid over it (the owner's v5 `--ambient`, 2026-09-26): no obligation of their
  // own, and the reason they are roles at all — a translucent surface is only as dark or light as what it sits on, so
  // the grounds and the glows are the inputs every such surface is composited over.
  ground: null,
  glow: null,
  // A TINT is a translucent colour a surface's own gradient lays over it at its peak (the v5 per-surface gradients).
  // It declares the surfaces it tints with `@on`, and each is evaluated with and without it.
  tint: null,
  // THE DEFAULT FLOOR, and the pair loop below asks again per theme:
  // `textContrastFloor` answers 7 under `hc` (ADR-0003, corrected 2026-09-16). Taken from
  // the same function rather than spelt here, so 4.5 has one home.
  text: colour.textContrastFloor(null),
  'boundary-control': 3,
  'boundary-decorative': null,
  fill: null,
  graphic: 3,
  derived: null,
};

/** Categories that must declare a surface set, and those that must not. */
const NEEDS_SURFACES = new Set(['text', 'boundary-control', 'graphic', 'tint']);

/**
 * Theme values that are not colour roles, BY NAME: the paint built FROM the roles — gradients, shadows, glows, blur
 * radii, amounts. Named rather than pattern-matched: a rule like "skip anything that is not a colour" would skip a
 * colour the parser failed to read, which is this check's reassuring answer produced by a broken parse. Every
 * gradient here is built from `var()`s of declared roles wherever it carries a colour a text sits on, so what the
 * pairs evaluate is what the gradients draw.
 *
 * **That sentence was false for five of them until the stage audit of 1e1bfad..e24eca0e**: `--accent-grad`,
 * `--status-bg`, `--hero-bg` and `--dialog-head` carried raw colours under text, and `--bubble` was painted nowhere.
 * The first four are now built from roles (`--accent-grad-top`/`-bottom`, `--tint-status`, `--tint-hero`,
 * `--dialog-head-wash`) and `--bubble` is deleted; the light primary button's label had been solved against a colour
 * its gradient never draws. A gradient's secondary stops (the teal ends) are not roles: each tint is held at its
 * peak, the stronger stop.
 */
const NOT_COLOUR_ROLES = new Set([
  'shadow',
  'ambient',
  'grain-opacity',
  'mica',
  'ribbon-bg',
  'rail-bg',
  'panel-bg',
  'status-bg',
  'float-bg',
  'canvas-bg',
  'hero-bg',
  'dialog-head',
  'active-bg',
  'accent-grad',
  'wordmark-fill',
  'panel-edge',
  'float-shadow',
  'page-shadow',
  'active-edge',
  'glow',
  'glow-sm',
  'sel-glow',
  'vignette',
  'scrim',
  'blur-menu',
  'blur-dialog',
  'blur-toolbar',
  'blur-scrim',
]);

/** The backgrounds `@on` and `@over` may name that are not tokens: the window's ground, and anything at all. */
const PSEUDO_SURFACES = new Set(['ground', 'any']);

/**
 * What `@over any` stands for: a surface that floats over ANYTHING — a menu over the white page, a dialog over a black
 * image. A blur averages what is behind and can only move the result towards the middle, so the flat extremes are the
 * worst cases.
 */
const ANYTHING = /** @type {const} */ ([
  ['white', [255, 255, 255]],
  ['black', [0, 0, 0]],
]);

/** @param {string} root */
export function tokenFile(root) {
  return join(root, 'packages', 'ui', 'src', 'tokens.css');
}

/**
 * @typedef {{ name: string, category: string, on: string[], over: string[] }} Role
 * @typedef {{ theme: string, values: Map<string, string> }} Theme
 */

/**
 * The words after `keyword` in a declaration's tail, up to the next `@` keyword.
 *
 * @param {string} tail
 * @param {string} keyword
 * @returns {string[]}
 */
function listAfter(tail, keyword) {
  const match = new RegExp(`@${keyword}\\s+([^@]*)`, 'u').exec(tail);
  const words = (match?.[1] ?? '').trim();
  return words === '' ? [] : words.split(/\s+/u);
}

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
    const tail = match[3] ?? '';
    roles.push({
      name: match[1] ?? '',
      category: match[2] ?? '',
      on: listAfter(tail, 'on'),
      over: listAfter(tail, 'over'),
    });
  }
  return roles;
}

/**
 * A colour's alpha, or 1 for a solid one — the question of whether a surface depends on what is behind it.
 *
 * @param {string} value
 */
function alphaOf(value) {
  const rgba = /^rgba\(([^)]+)\)$/u.exec(value.trim());
  if (rgba === null) return 1;
  const alpha = Number((rgba[1] ?? '').split(',')[3]);
  return Number.isFinite(alpha) ? alpha : 1;
}

/**
 * EVERY OPAQUE COLOUR each surface can present, per theme — the backgrounds a foreground on it is held against.
 *
 * A solid surface presents itself. A translucent one presents itself composited over each colour of each surface it
 * declares `@over` — `ground` for the window's own, `any` for flat white and black — and each tint declared `@on` it is
 * laid over every one of those as well. The GROUND is each ground role alone and under each glow at its peak: the v5
 * glows peak in different corners of the window (top-left, bottom-right, bottom-centre, top-right), so a point lies
 * under one of them at full strength, never two.
 *
 * @param {Role[]} roles
 * @param {Theme} theme
 * @param {string[]} failures
 * @returns {Map<string, { name: string, colour: [number, number, number] }[]>}
 */
function presentedSurfaces(roles, theme, failures) {
  /** @type {Map<string, { name: string, colour: [number, number, number] }[]>} */
  const presented = new Map();
  const value = (/** @type {string} */ name) => theme.values.get(name) ?? '';

  /** @type {{ name: string, colour: [number, number, number] }[]} */
  const ground = [];
  const glows = roles.filter((role) => role.category === 'glow');
  for (const role of roles.filter((candidate) => candidate.category === 'ground')) {
    const base = channels(value(role.name));
    if (base === null) continue;
    ground.push({ name: `--${role.name}`, colour: base });
    for (const glow of glows) {
      const lit = channels(value(glow.name), base);
      if (lit !== null) ground.push({ name: `--${role.name} under --${glow.name}`, colour: lit });
    }
  }
  // THE TINTS ON THE GROUND ITSELF — the title bar's and menu bar's mica, the start screen's glow — are laid over every
  // ground colour, glow-lit ones included: the title bar's green sits at the top-left, where the green glow peaks.
  // EACH ALONE: the tints on one surface are drawn in different places (the mica on the title bar, the start glow on the
  // start screen), so no colour is under two of them.
  const tints = roles.filter((role) => role.category === 'tint');
  const untinted = [...ground];
  for (const tint of tints.filter((candidate) => candidate.on.includes('ground'))) {
    for (const entry of untinted) {
      const colour = channels(value(tint.name), entry.colour);
      if (colour !== null) ground.push({ name: `${entry.name} tinted --${tint.name}`, colour });
    }
  }
  presented.set('ground', ground);
  // A SURFACE sits on the bare ground: the ground's tints belong to what is drawn directly on it (the title bar's mica,
  // the start screen's glow), and no panel is drawn on either.
  presented.set('ground-bare', untinted);
  presented.set(
    'any',
    ANYTHING.map(([name, colour]) => ({ name: `flat ${name}`, colour: /** @type {[number, number, number]} */ ([...colour]) })),
  );

  const surfaces = roles.filter((role) => role.category === 'surface');
  // Resolved in dependency order: a surface is ready once everything it declares @over is.
  const pending = new Set(surfaces.map((role) => role.name));
  for (let pass = 0; pass <= surfaces.length && pending.size > 0; pass += 1) {
    for (const role of surfaces) {
      if (!pending.has(role.name)) continue;
      const raw = value(role.name);
      const solid = alphaOf(raw) >= 1;
      if (!solid && role.over.length === 0) {
        failures.push(
          `${theme.theme}: --${role.name} is translucent and declares no @over, so what it presents cannot be known`,
        );
        pending.delete(role.name);
        continue;
      }
      if (!solid && !role.over.every((under) => presented.has(under))) continue;
      /** @type {{ name: string, colour: [number, number, number] }[]} */
      const own = [];
      if (solid) {
        const colour = channels(raw);
        if (colour !== null) own.push({ name: `--${role.name}`, colour });
      } else {
        for (const under of role.over) {
          for (const below of presented.get(under === 'ground' ? 'ground-bare' : under) ?? []) {
            const colour = channels(raw, below.colour);
            if (colour !== null) own.push({ name: `--${role.name} over ${below.name}`, colour });
          }
        }
      }
      const bare = [...own];
      for (const tint of tints.filter((candidate) => candidate.on.includes(role.name))) {
        for (const entry of bare) {
          const colour = channels(value(tint.name), entry.colour);
          if (colour !== null) own.push({ name: `${entry.name} tinted --${tint.name}`, colour });
        }
      }
      presented.set(role.name, own);
      pending.delete(role.name);
    }
  }
  for (const name of pending) {
    failures.push(`${theme.theme}: --${name} declares @over a surface that is never resolved (a cycle or a typo)`);
  }
  return presented;
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
 * The colour maths, RE-EXPORTED rather than implemented (B3a).
 *
 * `channels`, `luminance` and `contrast` were defined here until 2026-08-28,
 * and this file was their only caller. The UI primitives now need the same WCAG
 * answer at the point of use (`onColor`, ADR-0003 and §10.2), and two
 * implementations of an external authority's formula is the shape B3a forbids —
 * so the definition moved to `packages/shared` and this became a caller.
 *
 * They are re-exported because `tokenContrast.proof.mjs` imports them from
 * here, and pointing that proof at a second module would make *where the
 * contrast formula lives* a question with two answers again, one layer along.
 */
export const channels = colour.channels;

/** @see {@link colour.luminance} — WCAG relative luminance. */
export const luminance = colour.luminance;

/** @see {@link colour.contrast} — the WCAG ratio. */
export const contrast = colour.contrast;

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
      // The paint and the amounts, by name (`NOT_COLOUR_ROLES`). Named rather than pattern-matched: a rule like
      // "skip anything not a colour" would skip a colour the parser failed to read, which is this check's
      // reassuring answer produced by a broken parse.
      if (NOT_COLOUR_ROLES.has(name)) continue;
      if (!declared.has(name)) {
        failures.push(`--${name} has a value in ${theme.theme} but no @role declaration`);
      }
    }
  }

  // ---- The declared pairs, against every colour each surface can present ----
  for (const theme of themes) {
    const presented = presentedSurfaces(roles, theme, failures);
    for (const role of roles) {
      const declared = OBLIGATION[/** @type {keyof typeof OBLIGATION} */ (role.category)];
      if (declared === null || declared === undefined) continue;
      // PER THEME for `text`, because the floor is the theme's rather than the category's:
      // 7:1 under `hc` and 4.5:1 elsewhere. `boundary-control` and `graphic` keep 3:1
      // everywhere — WCAG 1.4.11 has no enhanced level.
      const minimum =
        role.category === 'text' ? colour.textContrastFloor(theme.theme) : declared;

      const rawForeground = theme.values.get(role.name);
      if (rawForeground === undefined) continue;

      for (const surfaceName of role.on) {
        // `ground` and `any` are the two backgrounds that are not a token: the window's own, and anything at all.
        if (!PSEUDO_SURFACES.has(surfaceName) && theme.values.get(surfaceName) === undefined) {
          failures.push(`--${role.name} declares @on ${surfaceName}, which has no value in ${theme.theme}`);
          continue;
        }
        const backgrounds = presented.get(surfaceName) ?? [];
        if (backgrounds.length === 0) {
          deferred.push(`${theme.theme}: --${role.name} on --${surfaceName} (surface is not a static colour)`);
          continue;
        }
        // THE WORST colour the surface presents is the pair's reading: a text that clears its floor over the plain
        // ground and fails under the green glow fails.
        /** @type {{ ratio: number, where: string } | null} */
        let worst = null;
        for (const background of backgrounds) {
          const foreground = channels(rawForeground, background.colour);
          if (foreground === null) continue;
          const ratio = contrast(foreground, background.colour);
          if (worst === null || ratio < worst.ratio) worst = { ratio, where: background.name };
        }
        if (worst === null) {
          deferred.push(`${theme.theme}: --${role.name} on --${surfaceName} (foreground is derived)`);
          continue;
        }
        evaluated += 1;
        const pair = `${theme.theme}: --${role.name} on ${worst.where}`;
        if (tightest === null || worst.ratio - minimum < tightest.ratio - tightest.minimum) {
          tightest = { pair, ratio: worst.ratio, minimum };
        }
        if (worst.ratio < minimum) {
          failures.push(`${pair} is ${worst.ratio.toFixed(2)}:1, below ${minimum}:1 (${role.category})`);
        }
      }
    }
  }

  // THE DIALOG'S GLASS is no longer a block of its own (it was, 2026-09-25 → 2026-09-26): every floating surface —
  // dialogs, menus, the quick toolbar — is `--float`, declared `@over any`, so the pairs above already hold each text
  // on it to its floor over flat white and flat black. One mechanism for every translucent surface rather than one
  // per surface that happened to be translucent first.

  // The derived half, named rather than absent. `--accent-soft` is declared a
  // surface whose only permitted foreground is the derived chrome accent text
  // (ADR-0003), and nothing here computes that.
  if (declared.has('accent-soft')) {
    deferred.push(
      'every theme: --accent-soft carries only the DERIVED chrome accent text. onColor() now ' +
        'EXISTS (packages/shared/src/colour.ts) and this still defers, because the derivation ' +
        'needs an input this file does not have: the colour the design asks for before it is ' +
        'adjusted. That arrives with the first primitive that renders on --accent-soft, and the ' +
        'pair becomes checkable then',
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
