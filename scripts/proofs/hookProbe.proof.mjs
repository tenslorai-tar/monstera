// @ts-check
/**
 * Proof that the Stage 0 gate on the tool-use guard cannot be satisfied by
 * anything short of the guard actually firing (rule B2), and that a hook
 * registered later cannot inherit that evidence (finding AAAA-13).
 *
 * The gate exists because `CLAUDE.md` asserts a mechanism whose only unproven
 * part is the part that matters — that the hook is ever loaded — and because the
 * first attempt to test it produced an answer that could not mean what it
 * appeared to. So the cases here are mostly about the ways a record can look
 * like evidence and not be one:
 *
 *   - no entry at all;
 *   - an entry about a different hook, because its inputs have since changed;
 *   - an entry taken in a session whose process predates the configuration, so
 *     the hook could not have been loaded and "it did nothing" is
 *     indistinguishable from "there is no hook" — this is attempt 1, and it is
 *     the case the whole record format exists to reject;
 *   - an entry that honestly says the hook did not act;
 *   - an entry for a mechanism nothing registers;
 *   - **a registered hook with no entry of its own**, which is the shape the
 *     single-outcome record could not express at all.
 *
 * Two load-bearing controls, and neither is about a state:
 *
 *   1. `registeredHooks` must REFUSE when it cannot see its anchor. It is a
 *      search, and every way of breaking a search produces the same reassuring
 *      empty list — after which the roster requires nothing of anybody.
 *   2. Both halves of rule 5 must turn `check:docs` red against the real
 *      repository. Without that, every case above could pass while nothing
 *      consulted them — a correct checker nobody calls, which is the
 *      display-only sin this project names.
 *
 * Usage: node scripts/proofs/hookProbe.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { RECORD_FILE, mechanismInputs, probeCoverage, probeState } from '../lib/hookProbe.mjs';
import {
  ANCHOR_EVENT,
  ANCHOR_SCRIPT,
  SETTINGS_FILE,
  mechanismName,
  registeredHooks,
} from '../lib/registeredHooks.mjs';
import { digestInputs } from '../lib/verdict.mjs';

const ROOT = repoRoot();
const ANCHOR = mechanismName(ANCHOR_SCRIPT, ANCHOR_EVENT);

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/**
 * A throwaway tree carrying copies of the anchor mechanism's inputs, so an entry
 * can be fabricated against known bytes without touching this repository.
 *
 * @returns {string}
 */
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'monstera-probe-'));
  // A git work tree, because the recorder asks git for the root before anything
  // else. Without this the recorder dies on "not a git repository" — still
  // fail-closed, but it would let the refusal case below pass for a reason that
  // has nothing to do with the session start it is meant to be testing.
  spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  // Every registered hook's script, not just the anchor's: the settings file is
  // copied whole, so the throwaway root registers whatever this repository does,
  // and a fixture that knew about one hook would start reporting the others as
  // missing the moment a second was registered. Derived here for the same reason
  // it is derived in the checker.
  for (const file of [SETTINGS_FILE, ...registeredHooks(ROOT).map((hook) => hook.script)]) {
    const destination = join(root, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(ROOT, file), destination);
  }
  mkdirSync(join(root, 'docs'), { recursive: true });
  // COMMITTED, and that is load-bearing rather than tidiness. The recorder
  // checks the inputs' git history BEFORE it checks the session start, so an
  // uncommitted tree makes every refusal below come out as "not tracked by
  // git" — and the case named for the session start would pass without ever
  // reaching it. The assertion could not tell its two refusals apart.
  spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf8' });
  spawnSync(
    'git',
    ['-c', 'user.name=probe', '-c', 'user.email=probe@invalid', 'commit', '--quiet', '-m', 'fixture'],
    { cwd: root, encoding: 'utf8' },
  );
  return root;
}

/**
 * @param {string} root
 * @param {Partial<import('../lib/hookProbe.mjs').MechanismEntry>} overrides
 * @param {Record<string, import('../lib/hookProbe.mjs').MechanismEntry>} [others]
 */
function writeEntryIn(root, overrides, others = {}) {
  const digest = digestInputs(mechanismInputs(ANCHOR_SCRIPT), { root });
  /** @type {import('../lib/hookProbe.mjs').MechanismEntry} */
  const entry = {
    script: ANCHOR_SCRIPT,
    event: 'PreToolUse',
    outcome: 'fired',
    certifies: 'detection',
    exercise: 'node -e "console.log(\'hook test\')"',
    evidence: 'fixture',
    recordedAt: '2026-09-01T12:00:00.000Z',
    // A session that started well AFTER its inputs last changed: the healthy
    // shape, which each case below then breaks in exactly one way.
    sessionStartedAt: '2026-09-01T10:00:00.000Z',
    inputsLastChangedAt: '2026-08-18T00:18:39.000Z',
    verdict: {
      digest: digest.digest,
      inputs: digest.inputs.map((input) => ({ name: input.name, digest: input.digest })),
    },
    ...overrides,
  };
  writeFileSync(
    join(root, RECORD_FILE),
    `${JSON.stringify({ mechanisms: { [ANCHOR]: entry, ...others } }, null, 2)}\n`,
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// The states an entry can be in.
// ---------------------------------------------------------------------------
{
  const root = makeRoot();
  try {
    check('no entry at all reads as unrecorded', probeState(ANCHOR, root).state === 'unrecorded', probeState(ANCHOR, root).detail);

    writeEntryIn(root, {});
    check(
      'a complete entry recording a firing is accepted',
      probeState(ANCHOR, root).state === 'fired',
      // The positive case has to exist, or every rejection below is satisfied by
      // a checker that rejects everything.
      probeState(ANCHOR, root).detail,
    );

    writeEntryIn(root, { outcome: 'silent' });
    check(
      'an entry saying the hook did NOTHING is not a satisfied gate',
      probeState(ANCHOR, root).state === 'silent',
      probeState(ANCHOR, root).detail,
    );

    writeEntryIn(root, { outcome: 'unobserved', certifies: null, sessionStartedAt: null });
    check(
      'and neither is one saying it was never exercised',
      probeState(ANCHOR, root).state === 'unobserved',
      `"registered" must not read as "observed"; that gap is the whole of finding AAAA-11. ` +
        `${probeState(ANCHOR, root).detail}`,
    );

    // WHAT A FIRING CERTIFIED IS ITS OWN STATE (finding AAAA-14). A hook shown to
    // be loaded by a benign trigger has established invocation and nothing about
    // its answer, and an entry that declines to say which is one a reader takes
    // for both.
    writeEntryIn(root, { outcome: 'fired', certifies: null });
    check(
      'a firing that does not say WHAT it certified is not a satisfied gate',
      probeState(ANCHOR, root).state === 'unstated',
      probeState(ANCHOR, root).detail,
    );
    writeEntryIn(root, { outcome: 'fired', certifies: 'invocation' });
    check(
      '  ...and one certifying INVOCATION is accepted, and says so where it is read',
      probeState(ANCHOR, root).state === 'fired' &&
        probeState(ANCHOR, root).detail.includes('INVOCATION'),
      `A hook can be reached without being right, and the reader of this line is the one ` +
        `deciding whether a gate closes. ${probeState(ANCHOR, root).detail}`,
    );

    // The asymmetry, which this proof originally had backwards.
    //
    // A hook that never loaded cannot produce its own output, so a firing's own
    // timing cannot weaken it. A silence is the ambiguous one. The first denial
    // this project ever observed came from a session that predated its
    // configuration by forty hours, and a symmetric rule would have thrown that
    // evidence away for being suspiciously old.
    //
    // This is also the property finding AAAA-12 turned on: the gate is keyed on
    // whether an observation is self-certifying, NOT on which hook kind produced
    // it. A PostToolUse report certifies itself exactly as a denial does.
    writeEntryIn(root, {
      outcome: 'fired',
      sessionStartedAt: '2026-08-16T08:29:43.000Z',
      inputsLastChangedAt: '2026-08-18T00:18:39.000Z',
    });
    check(
      'a FIRING is accepted even from a session older than the hook',
      probeState(ANCHOR, root).state === 'fired',
      `A firing is self-certifying: nothing that failed to load the hook can produce its output. ` +
        `${probeState(ANCHOR, root).detail}`,
    );

    writeEntryIn(root, {
      outcome: 'silent',
      sessionStartedAt: '2026-08-16T08:29:43.000Z',
      inputsLastChangedAt: '2026-08-18T00:18:39.000Z',
    });
    check(
      'but a SILENCE from a session older than the hook is rejected',
      probeState(ANCHOR, root).state === 'stale-session',
      `This is the confound that produced attempt 1's result: "it did nothing" cannot be told ` +
        `apart from "there is no hook". ${probeState(ANCHOR, root).detail}`,
    );

    // Resolution test for the boundary itself: one second later must be enough
    // to be a different session, or the comparison is decorative. Run against
    // the ambiguous outcome, because that is the only one the boundary governs.
    writeEntryIn(root, {
      outcome: 'silent',
      sessionStartedAt: '2026-08-18T00:18:40.000Z',
      inputsLastChangedAt: '2026-08-18T00:18:39.000Z',
    });
    check(
      'and one second AFTER the configuration reads as silent, not stale',
      probeState(ANCHOR, root).state === 'silent',
      `the comparison must distinguish its two inputs, not merely reject. ${probeState(ANCHOR, root).detail}`,
    );

    // A silence with no session recorded at all must not slip past the boundary
    // by having nothing to compare. Absence is the ambiguous case, not an exempt
    // one.
    writeEntryIn(root, { outcome: 'silent', sessionStartedAt: null });
    check(
      'a silence with NO session recorded is stale, not exempt',
      probeState(ANCHOR, root).state === 'stale-session',
      probeState(ANCHOR, root).detail,
    );

    check(
      'a mechanism nothing registers reads as unregistered',
      probeState('notAHookAnybodyWiredUp', root).state === 'unregistered',
      'an entry for an unwired hook is a certificate with no mechanism behind it',
    );

    // The verdict half: an entry is about the hook it was taken against.
    writeEntryIn(root, {});
    const settings = join(root, SETTINGS_FILE);
    const original = readFileSync(settings, 'utf8');
    writeFileSync(settings, `${original}\n`, 'utf8');
    check(
      'changing the settings by ONE byte invalidates the entry',
      probeState(ANCHOR, root).state === 'inputs-changed',
      probeState(ANCHOR, root).detail,
    );
    writeFileSync(settings, original, 'utf8');

    const guard = join(root, ANCHOR_SCRIPT);
    const guardSource = readFileSync(guard, 'utf8');
    writeFileSync(guard, `${guardSource}\n`, 'utf8');
    check(
      'and so does changing the hook script',
      probeState(ANCHOR, root).state === 'inputs-changed',
      'a probe run against a different script is not evidence about this one',
    );
    writeFileSync(guard, guardSource, 'utf8');

    check('restoring both bytes restores the verdict', probeState(ANCHOR, root).state === 'fired', probeState(ANCHOR, root).detail);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The roster is DERIVED, and the resolver refuses rather than returning empty.
// ---------------------------------------------------------------------------
{
  const root = makeRoot();
  try {
    // Positive control, on every run: the resolver locates something it is known
    // to be able to find. Everything below asserts an absence, and an absence is
    // worthless from an instrument that cannot see.
    const hooks = registeredHooks(root);
    check(
      'the resolver LOCATES the hook it is known to be able to find',
      hooks.some((hook) => hook.script === ANCHOR_SCRIPT),
      `found: ${hooks.map((hook) => hook.script).join(', ') || '(nothing)'}`,
    );

    // An entry for every hook the copied settings register — derived, so this
    // stays true as hooks are added. It caught itself the day the reporter was
    // registered: the fixture wrote one entry and the settings named two.
    writeEntryIn(
      root,
      {},
      Object.fromEntries(
        registeredHooks(root)
          .filter((hook) => hook.name !== ANCHOR)
          .map((hook) => [
            hook.name,
            /** @type {import('../lib/hookProbe.mjs').MechanismEntry} */ ({
              script: hook.script,
              event: hook.event,
              outcome: 'unobserved',
              certifies: null,
              exercise: 'fixture',
              evidence: 'fixture',
              recordedAt: '2026-09-01T12:00:00.000Z',
              sessionStartedAt: null,
              inputsLastChangedAt: '2026-08-18T00:18:39.000Z',
              verdict: {
                digest: digestInputs(mechanismInputs(hook.script), { root }).digest,
                inputs: digestInputs(mechanismInputs(hook.script), { root }).inputs.map((input) => ({
                  name: input.name,
                  digest: input.digest,
                })),
              },
            }),
          ]),
      ),
    );
    check(
      'with every registered hook recorded, nothing is missing',
      probeCoverage(root).missing.length === 0,
      `missing: ${probeCoverage(root).missing.join(', ')}`,
    );

    // Register a SECOND hook and record nothing about it. Under the single
    // outcome this record used to hold, this state was not expressible: the file
    // said "denied" and the new hook was covered by it. Now it owes its own
    // entry, derived from the file that registered it.
    const settings = join(root, SETTINGS_FILE);
    const original = readFileSync(settings, 'utf8');
    const parsed = JSON.parse(original);
    parsed.hooks.PostToolUse = [
      {
        matcher: 'Write|Edit',
        hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/scripts/hooks/somethingElse.mjs"' }],
      },
    ];
    writeFileSync(settings, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    check(
      'registering a second hook makes it OWE an entry of its own',
      probeCoverage(root).missing.includes('somethingElse@PostToolUse'),
      `missing: ${probeCoverage(root).missing.join(', ') || '(nothing — the second hook inherited the first one\'s evidence)'}`,
    );
    // ...and it must not be satisfied by the first hook's entry, which is still
    // present and still valid for the first hook.
    check(
      'while the first hook keeps its own, unaffected by the second existing',
      probeCoverage(root).states.find((entry) => entry.name === ANCHOR)?.state === 'inputs-changed',
      `Registering anything rewrites the settings, which is an input to every entry, so the ` +
        `anchor's verdict must go stale rather than carrying over: ` +
        `${probeCoverage(root).states.map((entry) => `${entry.name}=${entry.state}`).join(' ')}`,
    );
    writeFileSync(settings, original, 'utf8');

    // An entry for a hook nothing registers any more.
    writeEntryIn(root, {}, {
      retiredHook: /** @type {import('../lib/hookProbe.mjs').MechanismEntry} */ ({
        script: 'scripts/hooks/retiredHook.mjs',
        event: 'PreToolUse',
        outcome: 'fired',
        certifies: 'detection',
        exercise: 'whatever it used to be',
        evidence: 'fixture',
        recordedAt: '2026-09-01T12:00:00.000Z',
        sessionStartedAt: '2026-09-01T10:00:00.000Z',
        inputsLastChangedAt: '2026-08-18T00:18:39.000Z',
        verdict: { digest: 'stale', inputs: [] },
      }),
    });
    check(
      'and evidence about a hook nothing registers is reported, not ignored',
      probeCoverage(root).unrecognised.includes('retiredHook'),
      `unrecognised: ${probeCoverage(root).unrecognised.join(', ') || '(nothing)'}`,
    );

    // ONE SCRIPT ON TWO EVENTS (finding AAAA-17). The key used to be the
    // filename alone while the thing registered is a (script, event) pair, so
    // this shape produced two rows carrying one name and the second inherited
    // the first's entry — AAAA-13's one-certificate-for-two-mechanisms, inside
    // AAAA-13's own fix. No fixture reached it, which is why it was found by
    // building the shape rather than by anything going red.
    {
      const settingsPath = join(root, SETTINGS_FILE);
      const before = readFileSync(settingsPath, 'utf8');
      const doubled = JSON.parse(before);
      doubled.hooks['SessionStart'] = [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: `node "\${CLAUDE_PROJECT_DIR}/${ANCHOR_SCRIPT}"` }],
        },
      ];
      writeFileSync(settingsPath, `${JSON.stringify(doubled, null, 2)}\n`, 'utf8');
      const names = registeredHooks(root)
        .filter((hook) => hook.script === ANCHOR_SCRIPT)
        .map((hook) => hook.name);
      check(
        'one script on TWO events is two mechanisms, not one with two homes',
        names.length === 2 && new Set(names).size === 2,
        `names: ${names.join(', ')}. A key coarser than the registration it identifies is a ` +
          `shared certificate by construction.`,
      );
      check(
        '  ...so the second registration owes its own entry',
        probeCoverage(root).missing.includes(`${mechanismName(ANCHOR_SCRIPT, 'SessionStart')}`),
        `missing: ${probeCoverage(root).missing.join(', ') || '(nothing — the second event is covered by the first one\'s evidence)'}`,
      );
      writeFileSync(settingsPath, before, 'utf8');
    }

    // THE ROOT AXIS. A classifier fails independently on what it matches, where
    // it looks and which states it understands, and this repository has already
    // paid for a fix that corrected a pattern and left a directory. Hooks can be
    // registered in an untracked sibling, where they are as in force as any and
    // no tracked entry can ever vouch for them.
    const localPath = join(root, '.claude', 'settings.local.json');
    check(
      'with no local settings file, nothing is reported as untracked',
      probeCoverage(root).untracked.length === 0,
      `absence must read as absence: ${probeCoverage(root).untracked.join(', ')}`,
    );
    writeFileSync(
      localPath,
      `${JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/scripts/hooks/privateThing.mjs"' }],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    check(
      'a hook registered in the UNTRACKED sibling is named, not silently uncovered',
      probeCoverage(root).untracked.includes('privateThing@PreToolUse'),
      `untracked: ${probeCoverage(root).untracked.join(', ') || '(nothing — a hook is in force with no entry that could vouch for it)'}`,
    );
    check(
      'and it does not join the roster, because it can never earn an entry',
      !probeCoverage(root).missing.includes('privateThing@PreToolUse'),
      `Folding it into the roster would demand a tracked certificate for a file nobody else has, ` +
        `which is a red build no commit can clear. missing: ${probeCoverage(root).missing.join(', ')}`,
    );
    rmSync(localPath, { force: true });

    // THE CONTROL for the resolver itself: blind it, and it must refuse rather
    // than report a clean empty roster. Item 4b — every way of breaking a search
    // produces the reassuring answer, and here the reassuring answer would make
    // the roster requirement vacuous for every hook at once.
    const blinded = JSON.parse(original);
    blinded.hooks.PreToolUse[0].hooks[0].command = 'node "${CLAUDE_PROJECT_DIR}/scripts/hooks/elsewhere.mjs"';
    writeFileSync(settings, `${JSON.stringify(blinded, null, 2)}\n`, 'utf8');
    let refused = false;
    try {
      registeredHooks(root);
    } catch (error) {
      refused = /did not find/u.test(String(error));
    }
    check(
      'CONTROL: the resolver REFUSES when it cannot see its anchor',
      refused,
      'a blinded search reports an empty roster, and an empty roster requires nothing of anybody',
    );

    writeFileSync(settings, '{ not json', 'utf8');
    let refusedParse = false;
    try {
      registeredHooks(root);
    } catch (error) {
      refusedParse = /not readable JSON/u.test(String(error));
    }
    check(
      'and refuses an unreadable settings file rather than parsing it as empty',
      refusedParse,
      'an empty intermediate result is a broken parse, not a clean input',
    );
    writeFileSync(settings, original, 'utf8');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The recorder refuses what it cannot stand behind.
// ---------------------------------------------------------------------------
{
  const root = makeRoot();
  const recorder = join(ROOT, 'scripts', 'hooks', 'recordHookProbe.mjs');
  try {
    // No agent session transcript corresponds to this throwaway root, so the
    // session start cannot be established. Recording anyway would produce
    // exactly the unverifiable pass the format exists to prevent.
    // --certifies is supplied so the recorder gets PAST the argument checks and
    // reaches the session question. Without it the refusal is the certifies one,
    // and the case would again be satisfied by a refusal it is not named for —
    // which is what the tightened assertion below caught within the hour.
    const result = spawnSync(
      process.execPath,
      [recorder, ANCHOR, 'fired', '--exercise', 'x', '--certifies', 'invocation'],
      { cwd: root, encoding: 'utf8' },
    );
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    check(
      'the recorder refuses when it cannot establish the session start',
      result.status !== 0 && /cannot determine when this session/iu.test(output),
      `The refusal must be the SESSION one. This asserted on two alternatives for a range, and ` +
        `the tree it ran against produced the other one — so the case never reached what it is ` +
        `named for.\nexit ${result.status}, output:\n${output.slice(0, 500)}`,
    );

    const usage = spawnSync(process.execPath, [recorder], { cwd: ROOT, encoding: 'utf8' });
    check(
      'and refuses an outcome it was not given',
      usage.status !== 0,
      'an unrecorded outcome must not default to the happy one',
    );

    const unwired = spawnSync(process.execPath, [recorder, 'notAHook', 'fired', '--exercise', 'x'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    check(
      'and refuses to record a mechanism nothing registers',
      unwired.status !== 0 && /not registered/u.test(`${unwired.stdout ?? ''}${unwired.stderr ?? ''}`),
      `exit ${unwired.status}; an entry can only exist for a hook that is wired up`,
    );

    // Against the throwaway root, which carries no record, so nothing can be
    // inherited. Run against this repository it would inherit the real entry's
    // exercise, succeed, and overwrite the real record with an `unobserved`.
    const noExercise = spawnSync(process.execPath, [recorder, ANCHOR, 'unobserved'], {
      cwd: root,
      encoding: 'utf8',
    });
    check(
      'and refuses an entry nobody could reproduce',
      noExercise.status !== 0 && /exercise is required/u.test(`${noExercise.stdout ?? ''}${noExercise.stderr ?? ''}`),
      `exit ${noExercise.status}; provenance nobody can check is not provenance`,
    );

    // ...but once a mechanism HAS an exercise, a later recording inherits it.
    // The settings file is an input to every entry, so registering any hook
    // invalidates them all and each must be re-established; if that meant
    // retyping a shell command with nested quotes, the tool would get run some
    // other way. `unobserved` is used here because it is the one outcome that
    // needs no session, which a throwaway root cannot supply.
    writeEntryIn(root, { exercise: 'the-distinctive-exercise-text' });
    const inherited = spawnSync(process.execPath, [recorder, ANCHOR, 'unobserved'], {
      cwd: root,
      encoding: 'utf8',
    });
    const carried = JSON.parse(readFileSync(join(root, RECORD_FILE), 'utf8'));
    check(
      'and a later recording inherits the exercise it already had',
      inherited.status === 0 && carried.mechanisms[ANCHOR].exercise === 'the-distinctive-exercise-text',
      `exit ${inherited.status}, exercise now ${JSON.stringify(carried.mechanisms?.[ANCHOR]?.exercise)}\n` +
        `${`${inherited.stdout ?? ''}${inherited.stderr ?? ''}`.slice(0, 400)}`,
    );
    check(
      'while the OUTCOME it was given replaces the one that was there',
      carried.mechanisms[ANCHOR].outcome === 'unobserved',
      `Inheriting the exercise must not inherit the verdict. outcome now ` +
        `${JSON.stringify(carried.mechanisms?.[ANCHOR]?.outcome)}, and it was "fired" before this ran.`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// THE CONTROL: both halves of the rule turn the document check red.
// ---------------------------------------------------------------------------
{
  const featuresPath = join(ROOT, 'docs', 'FEATURES.md');
  const original = readFileSync(featuresPath, 'utf8');

  // The gate is satisfied now, so claiming the row done is legitimate and the
  // control has to remove the EVIDENCE rather than merely make the claim. This
  // case failed the moment the first denial was recorded, which is the control
  // doing its job: its premise had changed and it said so instead of passing.
  const recordPath = join(ROOT, RECORD_FILE);
  const savedRecord = existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : null;
  const claudePath = join(ROOT, 'CLAUDE.md');
  const savedClaude = readFileSync(claudePath, 'utf8');
  // A contributor may legitimately have one. Never overwrite it, and never
  // delete one this proof did not create.
  const localSettingsPath = join(ROOT, '.claude', 'settings.local.json');
  const hadLocalSettings = existsSync(localSettingsPath);
  if (hadLocalSettings) {
    throw new Error(
      `${localSettingsPath} exists. This proof needs to write one for a moment and will not ` +
        `touch yours. Move it aside and re-run — and note that check:docs is refusing already ` +
        `if it registers any hook.`,
    );
  }

  /** @returns {{ ok: boolean, output: string }} */
  const runDocs = () => {
    const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'hooks', 'documentConsistency.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  };

  /**
   * Whether `check:docs` is complaining about THIS gate, as opposed to about
   * anything else it checks.
   *
   * The cases below used to assert `check:docs` exited 0, which couples a proof
   * about the hook gate to every other consistency check in the repository.
   * Measured: the stage-audit gate went red for an unrelated range being over
   * budget, and this proof failed on both platforms — reporting the hook gate as
   * broken when it was fine.
   *
   * Asserting on the rule's own messages decouples them. **Absence is only
   * meaningful because its sibling asserts presence in the same run**: if the
   * checker printed nothing at all, the induced-failure cases below fail. That
   * pairing is what stops "the message is gone" from being satisfied by "the
   * checker is broken".
   *
   * @param {string} output
   */
  const complainsAboutTheGate = (output) => /observed to fire/iu.test(output);
  /** @param {string} output */
  const complainsAboutTheRoster = (output) => /has no\s+entry for it/iu.test(output);
  /** @param {string} output */
  const complainsAboutAnUnclaimedHook = (output) => /and no document names it/iu.test(output);
  /** @param {string} output */
  const complainsAboutALocalHook = (output) => /settings\.local\.json registers/iu.test(output);

  try {
    const quiet = runDocs();
    check(
      'with the gate unclaimed the check does not complain about it',
      !complainsAboutTheGate(quiet.output),
      `a gate that fails from the day it is written is a red build people learn to read past.\n${quiet.output.slice(-600)}`,
    );
    check(
      'and with every registered hook recorded it does not complain about the roster',
      !complainsAboutTheRoster(quiet.output),
      `the roster half must be quiet when it is satisfied.\n${quiet.output.slice(-600)}`,
    );

    // Rewrites the status cell to done whatever it currently says. Matching only
    // the unclaimed form broke the moment the gate was genuinely satisfied,
    // which would have left the control below testing nothing.
    let rowFound = false;
    const claimed = original
      .split('\n')
      .map((line) => {
        if (!line.includes('the PreToolUse write guard has been')) return line;
        rowFound = true;
        return line.replace(/\|\s*(?:—|\*\*done\*\*|wip|partly done)\s*\|?\s*$/u, '| **done** |');
      })
      .join('\n');
    check(
      'the gate row is present and its status cell can be set',
      rowFound && /the PreToolUse write guard has been[\s\S]*?\|\s*\*\*done\*\*\s*\|/u.test(claimed),
      'the row was not found or its status cell did not match; the control below would be vacuous',
    );
    writeFileSync(featuresPath, claimed, 'utf8');
    rmSync(recordPath, { force: true });

    const red = runDocs();
    check(
      'CONTROL: claiming the gate done with no evidence fails check:docs',
      !red.ok && complainsAboutTheGate(red.output),
      `exit ok=${red.ok}. If this passes, the gate is a sentence in a table that nothing reads.\n` +
        `${red.output.slice(-800)}`,
    );
    check(
      'CONTROL: a registered hook with no entry fails check:docs',
      !red.ok && complainsAboutTheRoster(red.output),
      `exit ok=${red.ok}. If this passes, the derived roster is a correct list nothing consults, ` +
        `and the next hook registered inherits this one's certificate.\n${red.output.slice(-800)}`,
    );

    if (savedRecord !== null) writeFileSync(recordPath, savedRecord, 'utf8');
    writeFileSync(featuresPath, original, 'utf8');
    const green = runDocs();
    check(
      'and stops complaining once the evidence is back',
      !complainsAboutTheGate(green.output) && !complainsAboutTheRoster(green.output),
      `The control must restore what it removed, or every later run of check:docs is measuring ` +
        `this proof's leftovers.\n${green.output.slice(-600)}`,
    );

    // ---------------------------------------------------------------------
    // THE OTHER TWO BRANCHES OF THE SAME RULE. Both were written with unit
    // coverage and no proof that check:docs consumes them — a correct checker
    // nobody calls, which is the display-only sin the control above exists for,
    // found by asking which branches no fixture reached (finding AAAA-18).
    // ---------------------------------------------------------------------
    check(
      'with every registered hook claimed, the check is quiet about claims',
      !complainsAboutAnUnclaimedHook(green.output),
      `the claim half must be silent when it is satisfied.\n${green.output.slice(-600)}`,
    );

    // Strip ONE hook's claim — not the anchor's, which claimedHooks refuses to
    // proceed without. That refusal is the positive control, and removing it
    // here would test the blinded path instead of this one.
    const stripped = 'scripts/hooks/reportControlCharacters.mjs';
    writeFileSync(featuresPath, original.replaceAll(stripped, 'the reporter'), 'utf8');
    writeFileSync(claudePath, savedClaude.replaceAll(stripped, 'the reporter'), 'utf8');
    const unclaimed = runDocs();
    check(
      'CONTROL: a registered hook that no document names fails check:docs',
      !unclaimed.ok && complainsAboutAnUnclaimedHook(unclaimed.output),
      `exit ok=${unclaimed.ok}. Without this the claim anchor protects only the hooks somebody ` +
        `remembered to write down, and a hook nobody names can be deleted without opening a ` +
        `second file.\n${unclaimed.output.slice(-800)}`,
    );
    writeFileSync(featuresPath, original, 'utf8');
    writeFileSync(claudePath, savedClaude, 'utf8');

    check(
      'with no local settings file, the check is quiet about untracked hooks',
      !complainsAboutALocalHook(runDocs().output),
      'the untracked half must be silent when there is nothing to say',
    );

    // HARMLESS IF LOADED, which is why the command names a hook that is already
    // registered rather than an invented one. This file is real for the length
    // of one check:docs run, and a session that picks it up in that window runs
    // exactly what it would have run anyway.
    writeFileSync(
      localSettingsPath,
      `${JSON.stringify(
        {
          hooks: {
            PostToolUse: [
              {
                matcher: 'Write',
                hooks: [
                  { type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/scripts/hooks/reportControlCharacters.mjs"' },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const local = runDocs();
    check(
      'CONTROL: a hook registered in the untracked sibling fails check:docs',
      !local.ok && complainsAboutALocalHook(local.output),
      `exit ok=${local.ok}. A hook in force that no tracked entry can vouch for must not read as ` +
        `covered.\n${local.output.slice(-800)}`,
    );
  } finally {
    writeFileSync(featuresPath, original, 'utf8');
    writeFileSync(claudePath, savedClaude, 'utf8');
    if (savedRecord !== null) writeFileSync(recordPath, savedRecord, 'utf8');
    if (!hadLocalSettings) rmSync(localSettingsPath, { force: true });
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `\nHook-probe gate proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} hook-probe gate cases passed.\n`);
