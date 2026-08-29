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
import { POWERSHELL_RULES, SHELL_RULES } from './blockEscapeResolvingWrites.mjs';

const ROOT = repoRoot();
const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'blockEscapeResolvingWrites.mjs');

/**
 * @param {string} command
 * @param {string} [toolName]
 * @returns {{ denied: boolean, reason: string, status: number }}
 */
function ask(command, toolName = 'Bash') {
  // THE THIRD ARGUMENT IS A TOOL NAME, and five call sites had passed prose
  // there — a rationale for the case, in the slot that selects the rule set.
  // They were not vacuous, but only because `firstViolation` treats every name
  // that is not `PowerShell` as a shell, so the wrong argument fell to the right
  // default. A PowerShell case written the same way would have silently been
  // asserted against SHELL_RULES and passed for the wrong reason.
  //
  // B5 over a comment: refuse the value rather than describe the slot. A
  // rationale now belongs above the call, where the other twenty are.
  if (toolName !== 'Bash' && toolName !== 'PowerShell') {
    throw new Error(
      `ask() got ${JSON.stringify(toolName)} as a tool name. The third argument selects the ` +
        `rule set and takes 'Bash' or 'PowerShell' only; put a rationale in a comment.`,
    );
  }
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

  return decisionFrom(`${result.stdout ?? ''}`, result.status, `${result.stderr ?? ''}`, command);
}

/**
 * The decision the hook's own output carries, or a refusal naming why there is
 * none.
 *
 * Separated from {@link ask} so it can be exercised without a hook: the branches
 * below fire when the hook is BROKEN, which is the state a run of the real hook
 * cannot produce on purpose. Its cases are at the end of this file.
 *
 * @param {string} rawStdout
 * @param {number | null} status
 * @param {string} stderr
 * @param {string} command
 * @returns {{ denied: boolean, reason: string, status: number }}
 */
export function decisionFrom(rawStdout, status, stderr, command) {
  // SILENCE IS THE PROTOCOL'S ALLOW, and only at exit 0. A PreToolUse hook that
  // permits a call says nothing and exits 0, so an empty stdout is a real
  // decision rather than a broken read — measured 2026-08-27 by asserting the
  // opposite and watching every ALLOWS case throw.
  //
  // What is NOT a decision is silence at a non-zero exit, or stdout that is not
  // JSON. Both used to answer `denied: false`, which is `mustAllow`'s passing
  // answer, so a hook that crashed would pass every ALLOWS case here. The
  // `mustDeny` half reddens either way and the run still fails — but an
  // individual allow case reporting the reassuring answer for the one condition
  // it cannot distinguish is the shape `boardStatus.mjs` was fixed for.
  const stdout = rawStdout.trim();
  if (stdout === '') {
    if (status === 0) return { denied: false, reason: '', status: 0 };
    throw new Error(
      `the hook exited ${String(status)} with no stdout for ` +
        `${JSON.stringify(command.slice(0, 120))}. Silence means ALLOW only at exit 0; here it ` +
        `means the hook did not reach a decision, and reading it as a permission would pass ` +
        `every ALLOWS case in this file.` +
        (stderr === '' ? '' : `\nstderr: ${stderr.slice(0, 300)}`),
    );
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (cause) {
    throw new Error(
      `the hook's stdout is not JSON, so no decision can be read from it: ${stdout.slice(0, 200)}`,
      { cause },
    );
  }
  const output = /** @type {{ hookSpecificOutput?: Record<string, unknown> }} */ (parsed)
    .hookSpecificOutput;
  const decision = output?.['permissionDecision'];
  if (decision !== 'deny' && decision !== 'allow' && decision !== 'ask') {
    throw new Error(
      `the hook's JSON carries no recognisable permissionDecision (got ` +
        `${JSON.stringify(decision)}). A missing field is not an allowance.`,
    );
  }
  return {
    denied: decision === 'deny',
    reason: `${output?.['permissionDecisionReason'] ?? ''}`,
    status: status ?? -1,
  };
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
mustBlock('Tee-Object writing to a file', '"text" | Tee-Object notes.md', 'PowerShell');

// The same false negative, in the other shell. A PowerShell producer carries
// its payload on the matched line, so a separator-aware gap halts inside the
// quotes and never reaches the redirect. One shell fixed and the other left is
// the half-fix shape, and both are registered in .claude/settings.json.
mustBlock('Write-Output whose payload contains a semicolon', "Write-Output 'const x = 1;' > f.js", 'PowerShell');
mustBlock('Write-Output whose payload contains a pipe', "Write-Output 'a|b' > f.txt", 'PowerShell');
mustBlock('Write-Output whose payload contains a chain operator', "Write-Output 'a && b' > f.txt", 'PowerShell');
mustBlock('Write-Host whose payload contains a semicolon', "Write-Host 'a; b' > f.txt", 'PowerShell');
mustBlock('a PowerShell echo alias writing to a file', "echo 'a; b' > f.txt", 'PowerShell');
mustBlock('Write-Output appending to a file', "Write-Output 'a; b' >> f.txt", 'PowerShell');
mustBlock('Write-Output with an explicit stdout descriptor', "Write-Output 'a; b' 1> f.txt", 'PowerShell');

// And the descriptor distinction, which this rule also predated.
mustAllow('Write-Output sending stderr to a file', "Write-Output 'a; b' 2> errors.log", 'PowerShell');
mustAllow('Write-Output sending stderr to stdout', "Write-Output 'a; b' 2>&1", 'PowerShell');
mustAllow('an ordinary PowerShell pipeline with a semicolon in a string', "Write-Output 'a; b' | Select-Object -First 1", 'PowerShell');

// ---------------------------------------------------------------------------
// Constructs no rule anchored on. Found by enumerating from the mechanism —
// what resolves escapes AND can reach a file — rather than by auditing the
// rules that happened to exist, which cannot see a rule that is absent.
// ---------------------------------------------------------------------------
mustBlock(
  'a bare double-quoted string redirected into a file',
  'Write-Output x; "line1\u0060nline2" > out.txt',
  'PowerShell',
);
mustBlock('a double-quoted string with a backtick escape, at statement start', '"a\u0060tb" > out.txt', 'PowerShell');
mustBlock('a double-quoted string expanding a variable', '"value: $env:PATH" > out.txt', 'PowerShell');
mustBlock('a double-quoted string appended to a file', '"a\u0060nb" >> out.txt', 'PowerShell');
mustBlock('New-Item writing content through -Value', 'New-Item -Path f.txt -Value "a\u0060nb"', 'PowerShell');

// The control that keeps the double-quote rule honest: a quoted ARGUMENT to a
// command whose output is redirected is inert, and denying it would be a false
// positive on entirely ordinary work.
mustAllow('a command with a quoted path whose OUTPUT is redirected', 'Get-ChildItem "C:\\logs" > out.txt', 'PowerShell');
mustAllow('a single-quoted string redirected, which expands nothing', "'a`nb' > out.txt", 'PowerShell');
mustAllow('a double-quoted string with no escape or expansion', '"plain text" > out.txt', 'PowerShell');

mustBlock('a here-string redirected into a file', "cat <<< $'a\\nb' > f");
mustBlock('a here-string with a variable, redirected', 'cat <<< "$content" > f');
// Either operand order, for both new rules. The heredoc rule already carried
// this lesson and neither new one inherited it until a case failed.
mustBlock("ANSI-C quoting whose result reaches a file", "cat > f <<< $'x\\ty'");
mustBlock("a here-string with the redirect first", "cat > f <<< 'plain'");
mustBlock("ANSI-C quoting with the redirect first", "printf > f $'x\\ty'");
mustBlock('sed substitution written through a redirect', "sed 's/x/a\\nb/' in.txt > out.txt");
mustBlock('perl in-place editing', "perl -pi -e 's/a/b/' notes.md");
mustBlock('perl in-place with a backup suffix', "perl -i.bak -pe 's/a/b/' notes.md");

mustAllow('a here-string feeding stdin with no file redirect', 'grep x <<< "$content"');
mustAllow('sed reading a range with no redirect', "sed -n '1,5p' notes.md");

// ---------------------------------------------------------------------------
// The commands this project actually runs. Every one of these appears in the
// session transcripts; blocking any of them makes the guard the problem.
// ---------------------------------------------------------------------------
mustAllow('a plain progress echo', 'echo "=== exit $? ==="');
mustAllow('echo without a redirect, piped to a counter', 'echo "a b c" | wc -w');
mustAllow('sed reading a line range', 'sed -n 200,240p docs/ARCHITECTURE.md');
mustAllow('a quoted heredoc feeding stdin', "git commit -q -F - <<'EOF'\nSubject line\n\nBody.\nEOF");

// ---------------------------------------------------------------------------
// The redirect scan must not cross a command separator, and must tell a file
// write from a descriptor duplication. Both halves were defects, found by the
// guard firing on the commit that reported its own first denial.
//
// The deny cases here are the ones that make the fix a correction rather than a
// narrowing: a redirect genuinely inside the heredoc's own segment still has to
// be caught, whether the segment sits first, last or alone.
// ---------------------------------------------------------------------------
mustBlock('a heredoc redirected into a file, alone', "cat <<'EOF' > f\nx\nEOF");
mustBlock('a heredoc whose redirect comes first', "cat > f <<'EOF'\nx\nEOF");
mustBlock('a heredoc redirected into a file after a separator', "true && cat <<'EOF' > f\nx\nEOF");
mustBlock('a heredoc redirected into a file before a separator', "cat <<'EOF' > f && true\nx\nEOF");
mustBlock('a heredoc sending BOTH streams to a file with &>', "cat <<'EOF' &> f\nx\nEOF");
mustBlock('a heredoc sending both streams to a file with >&word', "cat <<'EOF' >& f\nx\nEOF");

mustAllow(
  // The exact command that was denied on 2026-08-18. The 2>&1 belongs to
  // `git push`, three separators away from the heredoc.
  'a commit heredoc chained with a later command that redirects stderr',
  "git commit -F - <<'MSG' && git log --oneline -1 && git push 2>&1 | tail -2\nSubject\nMSG",
);
mustAllow('a heredoc whose own line duplicates a descriptor', "cat <<'EOF' 2>&1\nx\nEOF");
mustAllow('a heredoc whose own line closes a descriptor', "cat <<'EOF' 2>&-\nx\nEOF");
mustAllow('echo sending stderr to stdout', 'echo hello 2>&1');
mustAllow('echo sending stderr to stdout, then piped', 'echo hello 2>&1 | grep h');
mustAllow('awk sending stderr to stdout', "awk '{print}' input.txt 2>&1");

// ---------------------------------------------------------------------------
// A redirect carries content only when its descriptor is stdout. `2>` sends
// stderr, which is never what an escape-resolving producer formatted.
// ---------------------------------------------------------------------------
mustAllow('printf discarding stderr', 'printf "%s" "$x" 2>/dev/null');
mustAllow('echo with stderr sent to a log', 'echo hello 2> errors.log');
mustAllow('echo appending stderr to a log', 'echo hello 2>> errors.log');
mustAllow('a heredoc with stderr sent to a file', "cat <<'EOF' 2> errors.log\nx\nEOF");
mustAllow('awk with stderr sent to a file', "awk '{print}' in.txt 2> errors.log");

// ---------------------------------------------------------------------------
// A target beginning `=` is a comparison, never a redirect.
//
// `awk 'NR>=386 && NR<=390' file` was denied. It writes nothing: the `>` belongs
// to `>=` inside a quoted awk program. A file literally named `=…` is one nobody
// writes, while `>=` is routine in awk, perl, JS and shell arithmetic — the
// asymmetry is why excluding it is a correctness fix rather than a narrowing.
//
// The last two are the ones that keep it honest. `>` followed by a real filename
// must still be caught with `=` anywhere else in the line, or this exclusion
// would have bought a false negative to cure a false positive.
// ---------------------------------------------------------------------------
mustAllow('awk with a >= line-number range', "awk 'NR>=386 && NR<=390' scripts/hooks/guardFiles.mjs");
mustAllow('awk printing when a field exceeds a bound', "awk '$2 >= 100 {print $1}' data.txt");
mustAllow('grep for a literal >= in source', "grep -rn 'x >= 1' packages/kernel/src");

// ---------------------------------------------------------------------------
// A producer in one command and a redirect in another are not a write.
//
// f84c686 stopped the scan crossing a separator; 63242af generalised the rules
// into eitherOrder() built on SAME_LINE and reintroduced it for all three. The
// first case here is the exact command that was denied during the audit of that
// range, and it writes nothing: `echo` prints to the terminal, and the redirect
// belongs to `git show`.
//
// The `| tee` cases are what stops the fix going too far — SAME_COMMAND ends
// before `|`, so the alternative has to reach its own pipe.
// ---------------------------------------------------------------------------
mustAllow('echo, then an unrelated command whose output is redirected', 'echo "step" ; git show HEAD --stat > /dev/null');
mustAllow('echo, then a redirect in a && chain', 'echo "step" && git show HEAD:package.json > out.json');
mustAllow('printf, then an unrelated redirect after a semicolon', "printf 'x' ; git log --oneline > log.txt");
// `tee` writes what echo resolved, and `-a` is still a write.
mustBlock('echo piped to tee', 'echo "content" | tee out.txt');
mustBlock('printf piped to tee -a', "printf 'a\\n' | tee -a out.txt");
// `>>=` is the case that showed excluding `=` alone was not enough: with `>>?`
// greedy the engine matched `>>`, saw `=`, backtracked to a single `>` and
// accepted the SECOND `>` as a one-character filename.
mustAllow('a shift-assign inside a quoted program', "awk 'BEGIN { x = 1; x >>= 2; print x }'");
// Inline perl is banned in its own right, whatever follows it. Kept as a BLOCK
// so the exclusion above is never mistaken for a general amnesty on comparisons.
// The inline-interpreter rule is independent of the redirect test.
mustBlock('an inline perl script containing a comparison', "perl -ne 'print if $. >= 10' notes.txt");
// THE FALSE NEGATIVE, and the fixture is the command that produced it. An
// eval flag behind another flag walked past this guard until 2026-08-29 —
// measured by typing it, not by reading the pattern.
mustBlock('an eval flag behind another node flag', 'node --input-type=module -e "console.log(1)"');
mustBlock('and behind two of them', 'node --no-warnings --experimental-vm-modules --eval "x"');
mustBlock('the print form behind a flag', 'node --no-warnings -p "1 + 1"');
// THE CONTROLS THAT BOUND IT. Skipping arbitrary tokens rather than flag-shaped
// ones would deny all three of these, and a guard that denies an ordinary `sed
// -e` in a compound is a guard someone turns off.
mustAllow('an ordinary node invocation with flags', 'node --experimental-strip-types scripts/x.mts');
mustAllow('a script whose own argument is -e', 'node scripts/build.mjs -e production');
mustAllow('an eval flag in a DIFFERENT command after a separator', "node --version && sed -e 's/a/b/' f.txt");
// A `=` elsewhere on the line must not disarm the redirect test.
mustBlock('printf redirected to a file whose name follows an unrelated =', 'printf "a=b\\n" > out.txt');
// The comparison and the redirect are different operators; only one is a write.
mustBlock(
  'printf redirected to a file, with a comparison earlier in the command',
  "awk 'NR>=2' in.txt && printf 'x\\n' > out.txt",
);

// ---------------------------------------------------------------------------
// CONSERVATISM ON A COMPOUND — pinned so it is a decision rather than a
// surprise (finding SSS-2).
//
// These deny, they are false positives, and they STAY. Pinned because the
// alternative is that the next person to hit one reads it as a parsing bug and
// the pressure lands on adding an override, which the standing rule says has no
// route. A disposition nobody wrote down is one that gets relitigated by
// whoever it inconveniences.
//
// **AND THE TEST FOR WHICH ONES STAY IS WHETHER A REDIRECT EXISTS AT ALL.** A
// third class was pinned here for one commit and should not have been: a `>`
// inside a quoted program, with nothing on the line redirecting anything. The
// argument below does not reach it — there is no ambiguous redirect to fail
// closed on — and it is fixed rather than pinned, in the section further down.
// Failing closed is a posture for a genuine ambiguity, not a blanket.
//
// MECHANISM, because "the scan crosses a separator" is NOT it — f84c686 fixed
// that and the three `mustAllow` cases above still hold. SAME_COMMAND_QUOTED
// consumes a quoted span whole, so a separator inside quotes is text; what it
// cannot do is decide WHICH quote opens the span. Given `echo "a"; cmd "b" >f`
// the engine pairs the CLOSING quote of the first argument with the OPENING
// quote of the second, swallows the `;` between them as quoted text, and
// reaches the redirect. The two controls below delete one of the two quoted
// arguments each, leaving nothing to pair with, and both then allow — which is
// what makes this an observation about quote pairing rather than a guess.
//
// Deciding it properly means attributing a redirect to a command, which is
// shell parsing: a second opinion about what a shell does, in the one file
// whose whole subject is what a shell does to bytes on the way past (B3a).
// Failing closed is the correct direction for THIS guard — the cost of a false
// positive is splitting a command in two, and the cost of a false negative is
// occurrence 8.
// ---------------------------------------------------------------------------
mustBlock(
  'a quoted argument either side of a separator, with the redirect on the second command',
  'echo "a"; git rev-parse "$REF" >/dev/null',
);
mustAllow(
  'CONTROL: the same command with the SECOND argument unquoted, so no pair spans the `;`',
  'echo "a"; git rev-parse $REF >/dev/null',
);
mustAllow(
  "CONTROL: the same command with the PRODUCER's argument unquoted",
  'echo a; git rev-parse "$REF" >/dev/null',
);

// A byte-faithful reader with a REAL redirect. `sed -n '1,5p' f > out` copies
// lines and resolves nothing, so this is a false positive too — and unlike the
// pair above there is no ambiguity to blame: the guard simply does not read
// sed's script to see whether it substitutes.
//
// It stays for the reason the rule exists at all. `sed -n` and
// `sed 's/x/a\nb/'` differ by one argument, the second resolves escapes, and a
// guard that separates them has to parse sed's language — the same second
// opinion one level down. The cost is `sed -n '1,5p' f` and reading the output,
// which is what a range read wanted anyway.
mustBlock('a sed range read redirected into a file', "sed -n '390,450p' notes.md > extract.txt");
mustAllow('CONTROL: the same range read with no redirect', "sed -n '390,450p' notes.md");

// ---------------------------------------------------------------------------
// A `>` INSIDE A QUOTED RUN IS NOT A REDIRECT — the third class, and the one
// with no fail-closed argument behind it (finding TTT-1, fixed).
//
// `TO_FILE` already excluded a target beginning `=`, because `awk 'NR>=386'`
// writes nothing and was denied. These are that same fact one character along.
// None of them redirects anything: there is no `>` outside quotes and no
// command on the line writes a file, so unlike the compound cases above there
// is no ambiguity to fail closed on.
//
// THE CASE THAT SHOWS WHY IT SURVIVED is the fourth one. Its `>=` twin was
// already a `mustAllow` here, named "awk printing when a field exceeds a bound"
// — a case whose NAME describes the natural shape, written with the one
// operator the fix had handled. The fixture was built from the shape the defect
// handles correctly, so no mutation test could find it (item 4).
//
// The fix masks a quoted `>` and leaves every other character in place, which
// is why the compound block above still denies: that one turns on quote
// PAIRING, and nothing here changes which quotes pair.
// ---------------------------------------------------------------------------
mustAllow('an awk comparison inside a quoted program', 'awk \'index($0, "x") > 0 {print NR}\' notes.md');
mustAllow('an awk field comparison, the >= twin of a case already here', "awk '$2 > 100 {print $1}' data.txt");
mustAllow('a sed replacement whose text contains a >', "sed 's/value/<set>/' notes.md");
mustAllow('a double-quoted awk program with a comparison', 'awk "NR > 2 { print }" notes.txt');
// CONTROLS. Masking a quoted `>` must not reach an unquoted one, and the two
// sit side by side in each of these.
mustBlock('a quoted comparison AND a real redirect on the same line', "awk '$2 > 100' data.txt > out.txt");
mustBlock('a quoted > in the payload of a producer that redirects', "printf 'a > b\\n' > out.txt");
mustBlock('an UNTERMINATED quote does not disarm the redirect test', 'echo "a > b > out.txt');

// The historical occurrences are stdout redirects and must stay caught. These
// are the reason the descriptor test is a lookbehind rather than a blanket
// exemption for anything with a digit in front of it.
// Payloads carrying shell metacharacters. A separator-aware gap stops INSIDE
// the quoted string and never reaches the redirect, which is how the guard
// came to allow occurrence 7 verbatim. These are the regression cases for that.
mustBlock('printf whose payload contains a semicolon', "printf 'const x = 1;\\n' > f.js");
mustBlock('printf whose payload contains a pipe', "printf 'a|b\\n' > f.txt");
mustBlock('printf whose payload contains an ampersand', "printf 'a && b\\n' > f.txt");
mustBlock('echo whose payload contains a semicolon', "echo 'a; b' > f.txt");

mustBlock('printf writing to a file (occurrence 5)', 'printf "C:\\Build\\vcvars64.bat" > path.txt');
mustBlock('printf writing a fixture (occurrence 7)', "printf 'export const built = 1;\\n' > out/index.js");
mustBlock('echo with an EXPLICIT stdout descriptor', 'echo hello 1> notes.txt');
mustBlock('echo appending to a file', 'echo hello >> notes.txt');
mustBlock('echo with both streams to a file', 'echo hello &> notes.txt');
mustBlock('echo appending both streams to a file', 'echo hello &>> notes.txt');
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
// GENERATED per-rule property cases, from the rule table itself.
//
// Four corrections were each found by hand, one incident at a time: the
// descriptor test, the span class, operand order, statement anchoring. Two
// became structural — TO_FILE and SAME_LINE/SAME_COMMAND are shared fragments,
// so a rule built from them inherits those lessons whether or not its author
// knows they exist. The other two live in each pattern's own shape and are
// inherited by nobody, which is precisely why those two were the ones missed.
//
// Generating from the table, the way boundaries.proof.mjs generates from
// ALLOWED_IMPORTS, makes them coverage rather than memory: a rule added next
// year is exercised against both operand orders, the descriptor cases and its
// span class on the day it lands, without anyone recalling four corrections
// spread across a hundred hand-written cases.
// ---------------------------------------------------------------------------
{
  /** @type {Array<{ rules: readonly import('./blockEscapeResolvingWrites.mjs').Rule[], shell: 'Bash' | 'PowerShell' }>} */
  const tables = [
    { rules: SHELL_RULES, shell: 'Bash' },
    { rules: POWERSHELL_RULES, shell: 'PowerShell' },
  ];

  for (const { rules, shell } of tables) {
    for (const rule of rules) {
      // The forcing function. A rule whose pattern contains a redirect but
      // declares no probe would silently opt out of every property below, which
      // is the state this whole section exists to make impossible.
      const usesRedirect = /TO_FILE|>/.test(rule.pattern.source);
      if (usesRedirect && rule.probe === undefined) {
        failures.push(
          `${shell} rule "${rule.what}" matches a redirect but declares no probe, so it is ` +
            `covered by no generated property case. Add one — see the Probe typedef.`,
        );
        continue;
      }
      if (rule.probe === undefined) continue;

      const { plain, semicolon, chain, span, reversible, reversed } = rule.probe;
      const name = `[generated] ${rule.what}`;

      /**
       * Puts the redirect where the construct takes it. A fragment naming `{R}`
       * says so explicitly; anything else takes it at the end.
       *
       * @param {string} fragment @param {string} redirect
       */
      const compose = (fragment, redirect) =>
        fragment.includes('{R}') ? fragment.replaceAll('{R}', redirect) : `${fragment} ${redirect}`;

      mustBlock(`${name}: redirected into a file`, compose(plain, '> out.txt'), shell);
      mustBlock(`${name}: appended to a file`, compose(plain, '>> out.txt'), shell);

      if (reversible) {
        // `cat > f <<'EOF'` and `cat <<'EOF' > f` are the same command. FOUR
        // rules matched only one order, three of them found by this generator
        // on its first run.
        mustBlock(
          `${name}: redirect written first`,
          reversed === undefined ? `> out.txt ${plain}` : compose(reversed, '> out.txt'),
          shell,
        );
      }

      // A descriptor redirect writes no content this guard is about.
      mustAllow(`${name}: stderr to a file`, compose(plain, '2> errors.log'), shell);
      mustAllow(`${name}: stderr duplicated to stdout`, compose(plain, '2>&1'), shell);

      if (span === 'line') {
        // The payload sits on the matched line, so a separator inside it is
        // data. This is occurrence 7's mechanism.
        mustBlock(`${name}: payload carrying a semicolon`, compose(semicolon, '> out.txt'), shell);
        mustBlock(`${name}: payload carrying a chain operator`, compose(chain, '> out.txt'), shell);
      } else {
        // The payload is beneath the matched line, so a separator on it really
        // is a separator and a later command's redirect is not this one's.
        mustAllow(
          `${name}: a later command's redirect is not this construct's`,
          `${compose(plain, '')} && git push 2>&1 | tail -2`,
          shell,
        );
      }
    }
  }
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

// ---------------------------------------------------------------------------
// `decisionFrom` — the branches a working hook cannot produce.
//
// Found by census 2026-08-27: this file's reader answered `denied: false` for
// silence AND for unparseable stdout, and `mustAllow` asserts exactly `!denied`.
// So a hook that crashed would have passed all 245 ALLOWS cases. The mustDeny
// half reddens, so the run still failed — but each allow case individually
// reported the reassuring answer for the one condition it could not see.
//
// The first repair threw on ANY empty stdout and turned every ALLOWS case red
// at once: silence at exit 0 is how the protocol says *allow*. The exit code is
// what separates the two, which is why these three cases exist rather than one.
// ---------------------------------------------------------------------------
{
  /** @param {() => unknown} body @returns {string | null} */
  const threw = (body) => {
    try {
      body();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  const allowed = decisionFrom('', 0, '', 'echo hello');
  check(
    "silence at exit 0 is the protocol's ALLOW, not a broken read",
    allowed.denied === false && allowed.status === 0,
    `got ${JSON.stringify(allowed)}. A PreToolUse hook that permits a call says nothing and ` +
      `exits 0. Refusing this reddens every ALLOWS case in this file, which is what the first ` +
      `version of this repair did.`,
  );

  const crashed = threw(() => decisionFrom('', 1, 'ReferenceError: git is not defined', 'echo hi'));
  check(
    'silence at a NON-ZERO exit is refused rather than read as a permission',
    crashed !== null && /exited 1/u.test(crashed) && /ReferenceError/u.test(crashed),
    `got ${JSON.stringify(crashed)}. This is the case the census found: a hook that died prints ` +
      `nothing, and \`denied: false\` is mustAllow's passing answer. The stderr has to reach the ` +
      `message, because "the hook did not run" and "why" are different questions.`,
  );

  const garbage = threw(() => decisionFrom('<html>502 Bad Gateway</html>', 0, '', 'echo hi'));
  check(
    'stdout that is not JSON is refused rather than read as a permission',
    garbage !== null && /not JSON/u.test(garbage),
    `got ${JSON.stringify(garbage)}.`,
  );

  const noField = threw(() => decisionFrom('{"hookSpecificOutput":{}}', 0, '', 'echo hi'));
  check(
    'JSON carrying no permissionDecision is refused rather than defaulted to allow',
    noField !== null && /permissionDecision/u.test(noField),
    `got ${JSON.stringify(noField)}. A missing field is not an allowance — it is the same ` +
      `absence the two cases above cover, arriving one level further in.`,
  );
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
  `\nNOT established by this proof: that the guard is loaded in the agent session\n` +
    `running it. That lives in the agent's own hook table and no subprocess can see\n` +
    `it. It HAS been observed once — 2026-08-18, recorded in docs/hook-probe.json —\n` +
    `but liveness is a property of each session, not a fact about the repository.\n\n` +
    `Registering a hook does not make it live immediately, and the delay is not\n` +
    `explained by process lifetime: one session ran a covered command unimpeded at\n` +
    `01:20 and was denied at 06:45, with no restart between. So assume neither.\n` +
    `Probe the session, and read the result asymmetrically:\n` +
    `  denied            -> live here. A denial cannot come from an unloaded guard.\n` +
    `  runs, proof green -> the guard is sound; this session has not picked it up.\n` +
    `  runs, proof red   -> the guard itself is broken. Fix it before trusting the rule.\n`,
);
