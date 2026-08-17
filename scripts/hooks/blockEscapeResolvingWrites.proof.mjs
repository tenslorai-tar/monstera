// @ts-check
/**
 * Proof that the escape-resolving-write hook blocks what it claims, and only
 * that (rule B2).
 *
 * The load-bearing case is the first one: the EXACT `node -e` shape that
 * rewrote a check's call site on 2026-08-17 and ate the backslashes out of
 * `/^docs\/DECISIONS\/\d{4}-.*\.md$/` while turning a `\n` in a template
 * literal into a real newline. If that command is not blocked, the hook has not
 * closed the class it was written for.
 *
 * The allow cases matter just as much and are not decoration. This project runs
 * `echo` for progress lines, `sed -n` to read file ranges, and
 * `git commit -F - <<'EOF'` for multi-line messages, constantly. A guard that
 * blocks those is a guard someone turns off, and a turned-off guard is worse
 * than the rule it replaced — the rule at least got remembered five times out of
 * eleven.
 *
 * The hook is driven as a subprocess over its real stdin/stdout contract rather
 * than by importing its matcher, so a change to the JSON it emits fails here.
 *
 * Usage: node scripts/hooks/blockEscapeResolvingWrites.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';

const ROOT = repoRoot();
const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'blockEscapeResolvingWrites.mjs');

/**
 * @param {string} command
 * @param {string} [toolName]
 * @returns {{ denied: boolean, reason: string, status: number }}
 */
function ask(command, toolName = 'Bash') {
  const result = spawnSync(
    process.execPath,
    [HOOK],
    {
      input: JSON.stringify({
        session_id: 'proof',
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: { command },
      }),
      encoding: 'utf8',
    },
  );

  const stdout = `${result.stdout ?? ''}`.trim();
  if (stdout === '') return { denied: false, reason: '', status: result.status ?? -1 };

  try {
    const parsed = JSON.parse(stdout);
    const decision = parsed?.hookSpecificOutput?.permissionDecision;
    return {
      denied: decision === 'deny',
      reason: `${parsed?.hookSpecificOutput?.permissionDecisionReason ?? ''}`,
      status: result.status ?? -1,
    };
  } catch {
    return { denied: false, reason: `unparseable stdout: ${stdout.slice(0, 200)}`, status: result.status ?? -1 };
  }
}

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/** @param {string} label @param {string} command @param {string} [toolName] */
function mustBlock(label, command, toolName) {
  const { denied, reason, status } = ask(command, toolName);
  check(
    `BLOCKS ${label}`,
    denied,
    `the hook allowed it (exit ${status}). Command was:\n        ${command}`,
  );
  if (denied) {
    check(
      `  ...and says why, for ${label}`,
      reason.length > 40 && /Instead:/.test(reason),
      `reason was ${JSON.stringify(reason.slice(0, 120))} — a block with no route out is a block ` +
        `that gets worked around rather than obeyed.`,
    );
  }
}

/** @param {string} label @param {string} command @param {string} [toolName] */
function mustAllow(label, command, toolName) {
  const { denied, reason } = ask(command, toolName);
  check(
    `ALLOWS ${label}`,
    !denied,
    `the hook blocked an ordinary command, which is how a guard gets switched off.\n` +
      `        ${command}\n        reason: ${reason.slice(0, 160)}`,
  );
}

// ---------------------------------------------------------------------------
// The occurrence this hook was written for.
// ---------------------------------------------------------------------------
mustBlock(
  "the exact `node -e` that mangled a regex on 2026-08-17",
  'node -e "\n' +
    "const fs=require('fs');\n" +
    "const p='scripts/hooks/documentConsistency.mjs';\n" +
    "const lines=fs.readFileSync(p,'utf8').split('\\n');\n" +
    'fs.writeFileSync(p, lines.join(\'\\n\'));\n' +
    '"',
);

// The other five occurrences in the standing rule, by mechanism.
mustBlock('printf with a redirect (occurrence 5, a batch file)', 'printf "call Build\\vcvars64.bat\\n" > env.bat');
mustBlock('echo with a redirect', 'echo "line one\\nline two" > notes.md');
mustBlock('echo appending to a file', 'echo "more" >> notes.md');
mustBlock('echo piped to tee', 'echo "content" | tee notes.md');
mustBlock('sed in place (occurrence 4)', "sed -i 's/old/new/' docs/JOURNAL.md");
mustBlock('sed in place with a backup suffix', "sed -i.bak 's|a|b|' package.json");
mustBlock('an unquoted heredoc (occurrence 1, backticks)', 'cat <<EOF\ninstall `pkg`\nEOF');
mustBlock('a quoted heredoc redirected into a file', "cat > notes.md <<'EOF'\ntext\nEOF");
mustBlock('python -c', 'python -c "open(\'x\',\'w\').write(\'a\\nb\')"');
mustBlock('python3 -c', 'python3 -c "print(1)"');
mustBlock('perl -e', 'perl -e \'print "a\\n"\'');
mustBlock('node --eval long form', 'node --eval "console.log(1)"');
mustBlock('awk writing to a file', 'awk \'{printf "%s\\n", $1}\' in.txt > out.txt');

// PowerShell reaches the same failure by other names.
mustBlock('Set-Content', 'Set-Content -Path notes.md -Value "a`nb"', 'PowerShell');
mustBlock('Out-File', '"text" | Out-File notes.md', 'PowerShell');
mustBlock('a double-quoted here-string', 'git commit -m @"\nmessage $var\n"@', 'PowerShell');

// ---------------------------------------------------------------------------
// The commands this project actually runs. Every one of these appears in the
// session transcripts; blocking any of them makes the guard the problem.
// ---------------------------------------------------------------------------
mustAllow('a plain progress echo', 'echo "=== exit $? ==="');
mustAllow('echo without a redirect, piped to a counter', 'echo "a b c" | wc -w');
mustAllow('sed reading a line range', 'sed -n 200,240p docs/ARCHITECTURE.md');
mustAllow('a quoted heredoc feeding stdin', "git commit -q -F - <<'EOF'\nSubject line\n\nBody.\nEOF");
mustAllow('an npm script with a pipe', 'npm run check:docs 2>&1 | tail -3');
mustAllow('git plumbing with a redirect from a byte-faithful producer', 'git show HEAD:package.json > /tmp/pkg.json');
mustAllow('running a script by path', 'node scripts/hooks/documentConsistency.mjs');
mustAllow('a build command', 'node scripts/provision/mupdf.mjs --skip-mupdf');
mustAllow('grep with a redirect', 'grep -rn foo src > matches.txt');
mustAllow('an ordinary PowerShell cmdlet', 'Get-ChildItem -Recurse | Measure-Object', 'PowerShell');

// ---------------------------------------------------------------------------
// Structural: the contract, and failing closed.
// ---------------------------------------------------------------------------
{
  const { denied, status } = ask('echo hello');
  check(
    'an allowed command exits 0 and emits nothing',
    !denied && status === 0,
    `exit ${status}. Exit 0 with empty stdout is what "no decision, proceed normally" looks like ` +
      `in the documented contract.`,
  );
}

{
  const result = spawnSync(process.execPath, [HOOK], { input: 'not json at all', encoding: 'utf8' });
  const stdout = `${result.stdout ?? ''}`;
  check(
    'an unreadable payload FAILS CLOSED',
    stdout.includes('"permissionDecision":"deny"'),
    `got ${JSON.stringify(stdout.slice(0, 160))}. A guard that cannot read its input has not ` +
      `cleared anything, and "could not check" must never read as "nothing found". This is safe ` +
      `only because Edit and Write are untouched, so the hook can be repaired without the shell.`,
  );
}

{
  const { denied } = ask('', 'Bash');
  check(
    'an empty command is allowed rather than treated as a violation',
    !denied,
    'blocking on absence would fire on every tool whose input this hook does not understand',
  );
}

// ---------------------------------------------------------------------------
// The WIRING. A correct script that nothing invokes is the display-only sin:
// every case above would still pass while the shell path stayed wide open.
// ---------------------------------------------------------------------------
{
  const settingsPath = join(ROOT, '.claude', 'settings.json');
  check(
    'the repository tracks .claude/settings.json',
    existsSync(settingsPath),
    'the hook has to be in TRACKED settings, or it protects one machine rather than the project',
  );

  if (existsSync(settingsPath)) {
    /** @type {{ hooks?: { PreToolUse?: Array<{ matcher?: string, hooks?: Array<{ type?: string, command?: string }> }> } }} */
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const entries = settings.hooks?.PreToolUse ?? [];
    const handlers = entries.flatMap((entry) =>
      (entry.hooks ?? []).map((handler) => ({ matcher: entry.matcher ?? '', handler })),
    );

    const shellHandlers = handlers.filter(
      ({ matcher }) => /Bash/.test(matcher) && /PowerShell/.test(matcher),
    );
    check(
      'a PreToolUse hook is registered for BOTH shells',
      shellHandlers.length > 0,
      `matchers found: [${handlers.map((h) => h.matcher).join(', ')}]. This environment has two ` +
        `shells and both resolve escapes; covering one leaves the other open.`,
    );

    const wired = shellHandlers.filter(({ handler }) =>
      `${handler.command ?? ''}`.includes('blockEscapeResolvingWrites.mjs'),
    );
    check(
      'that hook invokes this guard',
      wired.length > 0,
      `commands: [${shellHandlers.map((h) => h.handler.command).join(' | ')}]`,
    );

    for (const { handler } of wired) {
      // Expand the documented variable the way the harness does, and confirm the
      // command it ends up running actually denies. This is what catches a typo
      // in the path: the script would be perfect and never reached.
      const resolved = `${handler.command}`.replaceAll('${CLAUDE_PROJECT_DIR}', ROOT);
      const run = spawnSync(resolved, {
        shell: true,
        input: JSON.stringify({
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'node -e "writeFileSync(1)"' },
        }),
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
      });
      check(
        'the configured command string, run verbatim, denies',
        /"permissionDecision":"deny"/.test(`${run.stdout ?? ''}`),
        `exit ${run.status}, stdout ${JSON.stringify(`${run.stdout ?? ''}`.slice(0, 120))}, ` +
          `stderr ${JSON.stringify(`${run.stderr ?? ''}`.slice(0, 160))}\n      Resolved to: ${resolved}`,
      );
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `\nEscape-resolving-write hook proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} escape-guard cases passed.\n`);

// ---------------------------------------------------------------------------
// What this proof CANNOT reach, said out loud.
//
// Everything above runs in a subprocess. The thing that decides whether a
// command is actually blocked is the agent's hook table, which is read when its
// process starts and is not observable from here. So a fully green run above is
// consistent with a session in which the guard is not loaded at all — which is
// exactly what happened on 2026-08-18, when the settings file postdated the
// session by forty hours and the probe ran unimpeded.
//
// The failure this prints against is specific: a command executing when a
// denial was expected looks IDENTICAL whether the guard is broken or merely not
// loaded. Naming the discriminator here is what stops the next reader drawing
// the wrong conclusion from the right observation.
process.stdout.write(
  `\nNOT established by this proof: that the guard is loaded in any given agent\n` +
    `session. Hooks are read at process start, and /compact does not restart the\n` +
    `process. Probe a session with:  node -e "console.log('hook test')"\n` +
    `  denied            -> the guard is live in that session.\n` +
    `  runs, proof green -> the guard is sound; the session predates it. Not a defect.\n` +
    `  runs, proof red   -> the guard itself is broken. Fix it before trusting the rule.\n`,
);
