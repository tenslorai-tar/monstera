// @ts-check
/**
 * A workflow step that runs a script needing `node_modules` sits in a job that
 * installs them (finding HHH-1).
 *
 * ## The defect, and why the obvious check did not catch it
 *
 * `check:stackowner` was registered on the Guards job. **Guards runs no
 * `npm ci`**, and the scan builds a TypeScript Program, so both steps would have
 * failed on every run from the commit that added them — on both platforms. The
 * developed-in machine cannot see it: `node_modules` always exists here, so the
 * branch that throws when the compiler is absent never executes locally.
 *
 * The proof case written afterwards asserted that the scan was *named in some
 * workflow, on a line that invokes node*. That is true and it is not the
 * property: it cannot separate a job that installs from one that does not,
 * which is exactly what the defect was. **A compound claim whose true clause
 * vouches for the unchecked one** — item 7's shape, inside a proof case.
 *
 * ## What is derived, and from what
 *
 * Two facts, both literal in the tree, joined here:
 *
 * 1. **Which scripts need `node_modules`.** A `.mjs` under `scripts/` needs them
 *    if it statically imports a BARE specifier — anything that is neither
 *    `node:` nor relative — or if it imports something that does, transitively.
 *    The closure matters: `stackOwnership.proof.mjs` imports
 *    `stackOwnership.mjs` imports `loadTypeScript.mjs`, and only the last one
 *    knows about the compiler.
 * 2. **Which jobs install them.** A job's steps are the lines between its key
 *    and the next job's; it installs if any of them runs `npm ci`.
 *
 * There is exactly ONE declared root, and it is declared because no static walk
 * can derive it: `loadTypeScript.mjs` reaches the compiler through a dynamic
 * `import()` of an absolute path, which is also the reason that module exists
 * (B3a — one resolver for "where does the compiler live"). Everything else is
 * closure over imports.
 *
 * ## The positive control, because this is a SEARCH
 *
 * Its reassuring answer is *no misplaced steps*, which is also what a broken
 * import walk, a job parser that found no jobs, and a workflow directory read
 * from the wrong root all produce. So it must locate a step it knows to be
 * both needing and correctly placed — `preloadSurface.proof.mjs`, which reaches
 * the compiler three imports down and sits in the build job that installs — and
 * refuse to report when it cannot.
 *
 * It refused on its first run, against a control naming `preloadSurface.mjs`
 * rather than the proof that invokes it. No workflow runs the former directly,
 * so the control was unfindable and the scan said so instead of printing a
 * clean tree. That is the control paying for itself before it guarded anything.
 *
 * ## What this does NOT claim
 *
 * `node_modules` is not the only thing a job can lack. A step needing the
 * Electron binary, the MuPDF source, or a provisioned scanner has the same
 * shape and is not checked here: those are provisioned by named steps rather
 * than by one command, so the second fact above has no literal to read. Stated
 * rather than implied, because a limit narrower than the real gap reads as
 * surveyed. It becomes a defect the first time a step is found misplaced for
 * one of those reasons.
 *
 * ## THE SPAWN GAP, COUNTED RATHER THAN LEFT OPEN (2026-09-04)
 *
 * Fact 1 above is a closure over **static imports**. A script that spawns
 * another as a child process needs whatever that child needs, and nothing in
 * the text of `spawnSync(process.execPath, [somePath])` says what that is — so
 * this check is structurally blind to it. It was found the way such things are:
 * `probeLeftovers.proof.mjs` was registered on Guards, spawns
 * `electronImports.proof.mjs`, which imports `eslint`, and Guards installs
 * nothing. Both legs went red and this check had passed.
 *
 * Making the walk follow spawns means resolving an arbitrary argv to a script
 * path and recurring — a reachability walk, the instrument class this project
 * has found blind four times, whose *found nothing* is the reassuring answer.
 * So the class was **counted instead**, which is a grep and a read:
 *
 * - `grep -l 'spawnSync' scripts/proofs/*.mjs` → **19** proofs spawn something.
 * - Of their targets, **three** need `node_modules`:
 *   `rendererPolicy.proof.mjs` → `scripts/build/preload.mjs` (imports `vite`);
 *   `testResolution.proof.mjs` → `npx`; and `probeLeftovers.proof.mjs` →
 *   `electronImports.proof.mjs` (imports `eslint`).
 * - All three are in `ci.yml`, which installs. The remaining sixteen spawn
 *   node-and-local-only targets or fixture scripts they write themselves.
 *
 * A finite list placed correctly, rather than an open class. It goes stale the
 * moment a proof gains a spawn, which is why the counting command is written
 * here rather than the number alone.
 *
 * Usage: node scripts/lib/nodeModulesPlacement.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repoRoot } from './gitScope.mjs';
import { loadTypeScript } from './loadTypeScript.mjs';
import { invokesRepositoryScript } from './workflowInvocations.mjs';

const WORKFLOW_DIR = '.github/workflows';
const SCRIPTS_DIR = 'scripts';

/**
 * The one module whose dependency on `node_modules` cannot be derived: it
 * reaches the compiler through a dynamic `import()` of an absolute path, which
 * is the whole reason it exists as a module rather than as four lines in each
 * caller.
 */
export const DECLARED_ROOTS = Object.freeze(['scripts/lib/loadTypeScript.mjs']);

/** The export of a declared root whose call throws when the compiler is absent. */
const DECLARED_ROOT_EXPORT = 'loadTypeScript';

/** The bucket for calls that run when the module is evaluated, not inside a function. */
const MODULE_SCOPE = '*module*';

/** A step that is known to need `node_modules` AND to be correctly placed. */
const CONTROL_SCRIPT = 'scripts/proofs/preloadSurface.proof.mjs';

/**
 * `npm ci` on a line that is not a comment.
 *
 * `guards.yml` says *"this job runs no `npm ci`"* in prose, twice. Matching the
 * raw line classified the one job in this repository that does not install as
 * one that does — the parser answering yes because the prose said no. It would
 * then have reported a clean tree over the exact defect this scan was built for.
 */
const INSTALL = /^\s*[^#\n]*\bnpm ci\b/u;
/**
 * A job's runner, from its own `runs-on:` line (finding UUU-1).
 *
 * NOT matched inside a comment: `[^#\n]*` on the INSTALL line above is there for
 * the same reason, and this rule needs it more, since prose about placement
 * quotes runner names constantly — which is the very thing that went wrong.
 *
 * A matrix expression (`${{ matrix.os }}`) is captured verbatim rather than
 * resolved. Resolving it means reading the `strategy` block, which is a second
 * structural parser for a fact the raw text already states usefully: "this job
 * is a matrix" is exactly the distinction UUU-1's comments got wrong, and it
 * survives being unresolved.
 */
const RUNS_ON = /^\s{4}runs-on:\s*([^#\n]+?)\s*$/u;
// The invocation rule comes from `workflowInvocations.mjs` (AAAA-10). This file
// carried a non-capturing copy and `annotateCoverage.mjs` a capturing one, and
// both were correct — a capture answers the test question for free, so there was
// never a reason for two.
/** Every repository script named on a line. */
const SCRIPT_TOKEN = /scripts\/[\w./-]+\.mjs/gu;

/**
 * @param {string} dir
 * @returns {string[]} Absolute paths of every `.mjs` beneath `dir`.
 */
function everyScript(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...everyScript(path));
    else if (entry.endsWith('.mjs')) found.push(path);
  }
  return found;
}

/**
 * The import graph of `scripts/`, and which files name a bare specifier.
 *
 * ## Why the compiler, and not a regex
 *
 * The first version matched `from '…'` textually and reported **28 misplaced
 * steps in a job that is green** — every one a `from` inside a comment or a
 * fixture string. That is the wall `scriptsLoadingAtRuntime` already documents
 * in its own refusal message: *this repository's own proof fixtures contain the
 * exact string being searched for.* A guard that cries wolf is a guard someone
 * relaxes, so the loose version was not shippable in the safe direction either.
 *
 * `noResolve` and `noLib`: this needs the syntax of each file, never the
 * meaning of what it imports, so nothing is loaded from disk beyond the files
 * themselves.
 *
 * A dynamic `import()` of a computed expression stays invisible — which is
 * exactly what `DECLARED_ROOTS` exists for, and the only such case here.
 *
 * @typedef {{ name: string, guarded: boolean }} CallSite
 *
 * @param {string} root
 * @returns {Promise<{
 *   imports: Map<string, string[]>,
 *   direct: Set<string>,
 *   callSites: Map<string, Map<string, CallSite[]>>,
 *   importBindings: Map<string, Map<string, string>>,
 * }>}
 *   `imports` maps a repo-relative path to the paths it imports; `direct` holds
 *   the files naming a bare specifier; `callSites` every call of a plain
 *   identifier and whether a catch encloses it; `importBindings` each local name
 *   to the file it came from.
 */
export async function importGraph(root) {
  const ts = await loadTypeScript(
    'the import graph cannot be parsed, and a text scan is not a substitute: this repository ' +
      'holds `from \'…\'` inside comments and fixture strings, and matching them reported 28 ' +
      'misplaced steps in a job that is green.',
  );
  const base = join(root, SCRIPTS_DIR);
  const files = everyScript(base);
  if (files.length === 0) {
    // An empty intermediate result is a broken parse, not a clean input.
    throw new Error(`No .mjs files under ${base}. Every conclusion below would be an artefact.`);
  }

  const program = ts.createProgram({
    rootNames: files,
    options: { allowJs: true, noLib: true, noResolve: true, skipLibCheck: true },
  });

  /** @type {Map<string, string[]>} */
  const imports = new Map();
  /** @type {Set<string>} */
  const direct = new Set();
  /** @type {Map<string, Map<string, CallSite[]>>} */
  const callSites = new Map();
  /** @type {Map<string, Map<string, string>>} */
  const importBindings = new Map();

  for (const absolute of files) {
    const key = relative(root, absolute).replace(/\\/gu, '/');
    const source = program.getSourceFile(absolute);
    if (source === undefined) {
      throw new Error(`${key} was listed but the compiler produced no source file for it.`);
    }
    /** @type {string[]} */
    const edges = [];
    /** @type {Map<string, string>} */
    const bindings = new Map();
    /** @param {string} specifier @param {import('typescript').Node} node */
    const record = (specifier, node) => {
      if (specifier.startsWith('node:')) return;
      if (specifier.startsWith('.')) {
        const target = relative(root, resolve(absolute, '..', specifier)).replace(/\\/gu, '/');
        edges.push(target);
        if (ts.isImportDeclaration(node)) {
          const named = node.importClause?.namedBindings;
          if (named !== undefined && ts.isNamedImports(named)) {
            for (const element of named.elements) bindings.set(element.name.text, target);
          }
          const fallback = node.importClause?.name;
          if (fallback !== undefined) bindings.set(fallback.text, target);
        }
        return;
      }
      // Anything else resolves through node_modules, and it fails at MODULE
      // LOAD — before any `try` in this file or in its importers can run.
      direct.add(key);
    };
    /** @type {Map<string, CallSite[]>} */
    const calls = new Map([[MODULE_SCOPE, []]]);
    /**
     * @param {string} owner
     * @param {CallSite} site
     */
    const addCall = (owner, site) => {
      const bucket = calls.get(owner);
      if (bucket === undefined) calls.set(owner, [site]);
      else bucket.push(site);
    };
    // The parent is threaded through rather than read off the node: a program
    // built with `noResolve` hands back source files whose nodes carry no
    // parent, and `node.parent.kind` then throws inside the compiler's own type
    // guard rather than anywhere in this file.
    /**
     * @param {import('typescript').Node} node
     * @param {boolean} guarded
     * @param {import('typescript').Node | undefined} parent
     * @param {string} owner The named function this node sits inside, or module scope.
     */
    const visit = (node, guarded, parent, owner) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        record(node.moduleSpecifier.text, node);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        record(node.arguments[0].text, node);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        // `f(...).catch(…)` handles the rejection as surely as a `try` does.
        const chained =
          parent !== undefined &&
          ts.isPropertyAccessExpression(parent) &&
          parent.name.text === 'catch';
        addCall(owner, { name: node.expression.text, guarded: guarded || chained });
      }
      // A named function opens a new owner. `electronBinaryPath` and
      // `scriptsLoadingAtRuntime` live in one module and only the second one
      // reaches the compiler; a module-level rule reported the first as needing
      // node_modules and sent two green steps to be moved.
      if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
        visit(node.body, guarded, node, node.name.text);
        return;
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        visit(node.initializer, guarded, node, node.name.text);
        return;
      }
      // A `try` with only a `finally` does NOT handle anything — it runs the
      // cleanup and rethrows. Requiring a catch clause is what separates the
      // proofs that assert the throw from the proofs that merely tidy up after
      // it, and both shapes are in this repository.
      if (ts.isTryStatement(node)) {
        const handled = node.catchClause !== undefined;
        visit(node.tryBlock, guarded || handled, node, owner);
        if (node.catchClause !== undefined) visit(node.catchClause, guarded, node, owner);
        if (node.finallyBlock !== undefined) visit(node.finallyBlock, guarded, node, owner);
        return;
      }
      ts.forEachChild(node, (child) => {
        visit(child, guarded, node, owner);
      });
    };
    visit(source, false, undefined, MODULE_SCOPE);
    imports.set(key, edges);
    callSites.set(key, calls);
    importBindings.set(key, bindings);
  }
  return { imports, direct, callSites, importBindings };
}

/**
 * Every script under `scripts/` that cannot run without `node_modules`.
 *
 * @param {string} root
 * @returns {Promise<{
 *   needing: Set<string>,
 *   loadTime: Set<string>,
 *   callTime: Set<string>,
 *   dying: Set<string>,
 * }>}
 */
export async function scriptsNeedingModules(root) {
  const { imports, direct, callSites, importBindings } = await importGraph(root);

  // TWO KINDS OF DEATH, and conflating them is what made the first version
  // report 28 misplaced steps in a green job.
  //
  // LOAD-TIME: a bare specifier fails when the module is evaluated, before any
  // `try` anywhere can run. It propagates through importers unconditionally.
  const loadTime = new Set(direct);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [file, edges] of imports) {
      if (loadTime.has(file)) continue;
      if (edges.some((edge) => loadTime.has(edge))) {
        loadTime.add(file);
        changed = true;
      }
    }
  }

  // CALL-TIME: `loadTypeScript` THROWS when the compiler is absent, and callers
  // are allowed to catch that — `engineAdvisories.mjs` and `electron.proof.mjs`
  // both do, and both run green in the job that installs nothing, reporting
  // UNVERIFIABLE rather than failing. That is the register's own philosophy:
  // "could not look" is not "looked and found nothing". So a call-time death
  // propagates only through call sites nothing catches.
  //
  // Tracked per FUNCTION, not per module. `electron.mjs` exports both
  // `scriptsLoadingAtRuntime`, which reaches the compiler, and
  // `electronBinaryPath`, which does not; a module-level rule reported every
  // importer of either as needing node_modules, which is two green steps told
  // to move. The unit of this analysis has to be the thing a caller actually
  // calls.
  /** @type {Set<string>} `file#function` pairs whose call throws. */
  const dying = new Set(DECLARED_ROOTS.map((file) => `${file}#${DECLARED_ROOT_EXPORT}`));
  /** @param {string} file @param {string} name */
  const key = (file, name) => `${file}#${name}`;

  changed = true;
  while (changed) {
    changed = false;
    for (const [file, owners] of callSites) {
      const bindings = importBindings.get(file) ?? new Map();
      /** @param {CallSite} call */
      const reaches = (call) => {
        if (call.guarded) return false;
        const imported = bindings.get(call.name);
        if (imported !== undefined) return dying.has(key(imported, call.name));
        // A local name: same file.
        return dying.has(key(file, call.name));
      };
      for (const [owner, sites] of owners) {
        if (dying.has(key(file, owner))) continue;
        if (sites.some(reaches)) {
          dying.add(key(file, owner));
          changed = true;
        }
      }
    }
  }

  // A FILE dies when its module scope does — that is what running it as an
  // entry point executes. An exported function that dies matters only through
  // the caller that runs it, which the fixed point above has already followed.
  const callTime = new Set(
    [...dying].filter((entry) => entry.endsWith(`#${MODULE_SCOPE}`)).map((entry) => entry.split('#')[0] ?? ''),
  );

  return { needing: new Set([...loadTime, ...callTime]), loadTime, callTime, dying };
}

/**
 * @typedef {object} WorkflowJob
 * @property {string} file Repository-relative workflow path.
 * @property {string} name The job key.
 * @property {number} from 1-indexed first line of the job.
 * @property {number} to 1-indexed last line of the job.
 * @property {boolean} installs Whether any of its lines runs `npm ci`.
 * @property {string} runsOn Its `runs-on:` value verbatim, or `(none found)`.
 */

/**
 * Every job in every workflow, with whether it installs dependencies.
 *
 * Textual, for the same reason the wrapper rule is per line: a YAML parser here
 * would be a second opinion about a structure two other checks already read as
 * text. A job key is a two-space-indented mapping key inside the top-level
 * `jobs:` block, which is what this repository's workflows are and what a
 * broken read would fail the controls on.
 *
 * @param {string} root
 * @returns {WorkflowJob[]}
 */
export function workflowJobs(root) {
  const dir = join(root, WORKFLOW_DIR);
  const files = readdirSync(dir).filter((name) => /\.ya?ml$/u.test(name));
  if (files.length === 0) {
    throw new Error(`${WORKFLOW_DIR} holds no workflow files. An empty input set is a broken lookup.`);
  }

  /** @type {WorkflowJob[]} */
  const jobs = [];
  for (const name of files) {
    const lines = readFileSync(join(dir, name), 'utf8').split('\n');
    let inJobs = false;
    /** @type {WorkflowJob | undefined} */
    let current;
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index] ?? '';
      if (/^jobs:\s*$/u.test(text)) {
        inJobs = true;
        continue;
      }
      // A top-level key other than `jobs:` ends the block.
      if (inJobs && /^[A-Za-z]/u.test(text)) inJobs = false;
      if (!inJobs) continue;
      const key = /^ {2}([A-Za-z0-9_.-]+):\s*$/u.exec(text);
      if (key?.[1] !== undefined) {
        if (current !== undefined) current.to = index;
        current = {
          file: `${WORKFLOW_DIR}/${name}`,
          name: key[1],
          from: index + 1,
          to: lines.length,
          installs: false,
          runsOn: '(none found)',
        };
        jobs.push(current);
        continue;
      }
      if (current !== undefined && INSTALL.test(text)) current.installs = true;
      const runner = RUNS_ON.exec(text);
      if (current !== undefined && runner?.[1] !== undefined) current.runsOn = runner[1];
    }
  }

  if (jobs.length < 2) {
    throw new Error(
      `Found ${String(jobs.length)} workflow job(s). The job parser is broken, and "no misplaced ` +
        `steps" over zero jobs is the reassuring answer produced by having looked at nothing.`,
    );
  }
  if (!jobs.some((job) => job.installs)) {
    throw new Error(
      'No workflow job was found to run `npm ci`. Every step would then be reported as ' +
        'misplaced, or none would — either way the read is broken, not the workflows.',
    );
  }
  // THE NEGATIVE CONTROL, and it is the one this parser needed. A regex that
  // matches prose classifies EVERY job as installing, and that reads exactly
  // like a repository where every job does — measured, on `guards.yml`, whose
  // comments say "this job runs no `npm ci`" twice. Requiring the parser to
  // separate at least one job in each direction is what tells those apart.
  //
  // Its expiry is stated rather than assumed: the day every job installs, this
  // throw fires and must be replaced by a control that does not rest on one
  // job's configuration.
  if (!jobs.some((job) => !job.installs)) {
    throw new Error(
      'Every workflow job was found to install, which is what a job parser matching PROSE ' +
        'reports. Either the parser is broken or every job now installs — and in the second ' +
        'case this control needs replacing rather than deleting.',
    );
  }
  // THE SAME CONTROL FOR THE RUNNER, because the same failure is available to it
  // (finding UUU-1). A `runs-on` pattern that matches nothing leaves every job
  // reading `(none found)`, and a pattern that matches comments gives every job
  // whichever runner the nearest paragraph mentions. Both produce a report that
  // reads fine. Requiring the derivation to have found a runner for every job,
  // and to have found more than one distinct value, separates them.
  //
  // The second half has a stated expiry, like its sibling above: the day every
  // job runs the same runner, this fires and wants replacing rather than
  // deleting.
  const runnerless = jobs.filter((job) => job.runsOn === '(none found)');
  if (runnerless.length > 0) {
    throw new Error(
      `No \`runs-on\` was found for: ${runnerless.map((job) => `${job.file}:${job.name}`).join(', ')}. ` +
        'Every GitHub job has one, so this is the pattern failing rather than the workflows.',
    );
  }
  if (new Set(jobs.map((job) => job.runsOn)).size < 2) {
    throw new Error(
      'Every workflow job reported the SAME runner. That is what a pattern matching a comment ' +
        'or the first line of the file produces, and it reads exactly like a single-platform ' +
        'repository. If the workflows genuinely converged on one runner, replace this control.',
    );
  }
  return jobs;
}

/**
 * @typedef {object} PlacedStep
 * @property {string} file
 * @property {number} line
 * @property {string} text
 * @property {string} script The repository script the line runs.
 * @property {string} job
 * @property {boolean} installs Whether that job runs `npm ci`.
 */

/**
 * @typedef {object} PlacementResult
 * @property {PlacedStep[]} steps Every step running a script that needs modules.
 * @property {PlacedStep[]} violations Those in a job that does not install.
 * @property {string[]} needing Repo-relative scripts that need `node_modules`.
 * @property {boolean} blind Whether the control could not be located.
 * @property {WorkflowJob[]} jobs Every job, with its runner and whether it installs.
 */

/**
 * @param {{ root?: string, control?: string }} [options]
 * @returns {Promise<PlacementResult>}
 */
export async function scan(options = {}) {
  const root = options.root ?? repoRoot();
  const control = options.control ?? CONTROL_SCRIPT;
  const { needing } = await scriptsNeedingModules(root);
  const jobs = workflowJobs(root);

  /** @type {PlacedStep[]} */
  const steps = [];
  for (const job of jobs) {
    const lines = readFileSync(join(root, job.file), 'utf8').split('\n');
    for (let index = job.from; index < job.to; index += 1) {
      const text = lines[index] ?? '';
      // The line must INVOKE node — a `hashFiles('scripts/x.mjs')` cache key
      // runs nothing. Once it does, EVERY script named on it is one that runs
      // there: a wrapped step is `node annotate.mjs <target>`, and the target is
      // not preceded by `node`. Taking only the first token found the wrapper
      // and never the script it exists to run, which reported zero steps across
      // four jobs — a search returning its reassuring answer because it was
      // matching the wrong half of every line.
      if (!invokesRepositoryScript(text)) continue;
      SCRIPT_TOKEN.lastIndex = 0;
      for (const match of text.matchAll(SCRIPT_TOKEN)) {
        const script = match[0];
        if (!needing.has(script)) continue;
        steps.push({
          file: job.file,
          line: index + 1,
          text: text.trim(),
          script,
          job: job.name,
          installs: job.installs,
        });
      }
    }
  }

  // THE CONTROL. A step known to need modules and known to be placed correctly
  // must be found, every run. Without it, "no misplaced steps" is also what a
  // broken import walk and an empty job list produce.
  const located = steps.some((step) => step.script === control && step.installs);

  return {
    steps,
    violations: steps.filter((step) => !step.installs),
    needing: [...needing].sort(),
    blind: !located,
    jobs,
  };
}

/**
 * @param {PlacementResult} result
 * @returns {string}
 */
export function report(result) {
  if (result.blind) {
    return (
      `\n  BLIND — ${CONTROL_SCRIPT} was not found running in a job that installs.\n` +
      `        That step is known to need node_modules and known to be placed correctly, so\n` +
      `        failing to locate it means the import walk, the job parser or the workflow\n` +
      `        read is broken. Reporting nothing here would mean "could not look".\n`
    );
  }
  // THE DERIVED JOB TABLE, printed on every run (finding UUU-1).
  //
  // Two workflow comments stated the wrong operating system for the shim job —
  // "ubuntu-only" for a job that is and always was `windows-latest` — and it was
  // the stated reason for a step's placement. Nothing was hiding: the field is
  // in the same file, and this parser was already walking every one of those
  // lines for a neighbouring question.
  //
  // So the runner is derived beside `installs` and PRINTED, because the failure
  // is somebody reasoning about placement from memory. A table nobody has to ask
  // for is the cheapest available answer to that; a check that reads prose and
  // decides whether it agrees would be a second opinion about English.
  //
  // What this deliberately does NOT do: assert that a Windows-only script sits
  // in a Windows job. That needs a classifier for "Windows-only", which is a
  // search with its own blind spots, and this file already carries the lesson
  // about what a classifier's silence looks like.
  const table = result.jobs
    .map(
      (job) =>
        `        ${`${job.file}:${job.name}`.padEnd(44)} ${job.runsOn.padEnd(24)} ` +
        `${job.installs ? 'installs' : 'no npm ci'}\n`,
    )
    .join('');

  if (result.violations.length === 0) {
    return (
      `  ok  ${String(result.steps.length)} workflow step(s) run one of ` +
      `${String(result.needing.length)} scripts needing node_modules, all in jobs that install\n` +
      `  ok  and the control step was located, so that result means something\n` +
      `  ok  every job's runner was derived from its own \`runs-on\`, and they are not all one\n` +
      table
    );
  }
  return (
    result.violations
      .map(
        (step) =>
          `  FAIL  ${step.file}:${String(step.line)} — runs ${step.script}, which needs\n` +
          `        node_modules, inside job "${step.job}", which does not run npm ci.\n` +
          `        ${step.text}\n` +
          `        This fails on every run, on every platform, and a machine with node_modules\n` +
          `        installed cannot reproduce it.\n`,
      )
      .join('') + `\n${String(result.violations.length)} misplaced step(s).\n`
  );
}

/**
 * @returns {Promise<number>} Process exit code.
 */
export async function main() {
  const result = await scan();
  const text = report(result);
  if (result.blind || result.violations.length > 0) {
    process.stderr.write(text);
    return 1;
  }
  process.stdout.write(text);
  return 0;
}

/* c8 ignore start */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
/* c8 ignore stop */
