// @ts-check
/**
 * PreToolUse hook: refuses shell commands that write files through a path which
 * resolves escape sequences.
 *
 * ## Why this exists as a mechanism rather than a rule
 *
 * CLAUDE.md's standing rule has said, for its whole life, that for the classes
 * `guardFiles.mjs` cannot see — a swallowed word, a real newline, an octal
 * escape — "the rule is the only defence, so it is written as an absolute rather
 * than a preference."
 *
 * That was not accurate, and the evidence is that **five of the six occurrences
 * happened while it claimed to be the only defence.** A rule an agent must
 * remember at the moment of writing a command is not a defence; it is a hope.
 * The sixth was a `node -e` used to rewrite a check's call site, which ate the
 * backslashes out of `/^docs\/DECISIONS\/\d{4}-.*\.md$/` and turned a `\n` in a
 * template literal into a real newline.
 *
 * A pre-tool hook makes the path UNAVAILABLE instead of forbidden. That is the
 * difference between B5's "make illegal states unrepresentable" and a runtime
 * check somebody has to run.
 *
 * ## What it rejects, and why breadth is correct here
 *
 * The asymmetry decides the design. A false positive costs one retry through the
 * editing tools — which is the route the rule already mandates, so the "cost" is
 * being made to do the right thing. A false negative is a seventh occurrence in
 * a public repository. So the patterns are deliberately broad.
 *
 * Two things are deliberately NOT rejected, because the mechanism is escape
 * RESOLUTION and neither resolves anything:
 *
 *   - A quoted heredoc (`<<'EOF'`) feeding a command's stdin. POSIX performs no
 *     expansion at all inside one, so `git commit -F - <<'EOF'` is byte-faithful.
 *     An UNQUOTED heredoc is rejected everywhere, because that is occurrence 1 —
 *     backticks swallowing a package name.
 *   - A plain `>` redirect from a producer that does not resolve escapes, such
 *     as `git show HEAD:file > out`. Only redirects fed by `echo`, `printf`,
 *     `awk` or a heredoc are rejected.
 *
 * There is no override. An escape hatch here would be a workaround with a config
 * flag on it, which the stage audit names explicitly.
 *
 * ## Failure behaviour
 *
 * Fails CLOSED. An unreadable payload means the guard cannot tell whether the
 * command is dangerous, and "could not check" must never read as "nothing
 * found". That is safe here in a way it would not be elsewhere: Edit and Write
 * are untouched by this hook, so a bug in it can always be fixed through exactly
 * the tools the rule prefers.
 *
 * Contract: docs at code.claude.com/docs/en/hooks. stdin carries
 * `{ tool_name, tool_input: { command } }`; a `permissionDecision` of `"deny"`
 * on stdout with exit 0 blocks the call and shows `permissionDecisionReason`.
 */

/**
 * @typedef {{ pattern: RegExp, what: string, instead: string }} Rule
 */

/**
 * The span between a producer and its redirect, which may not cross a command
 * separator.
 *
 * A redirect belonging to a command three separators later is not this
 * command's redirect, and a gap of `[^\n]*` cannot express that distinction —
 * it walks straight past `&&`, `;` and `|` and attaches the first `>` it finds
 * to whatever producer it started from. That is how
 * `git commit -F - <<'EOF' && git push 2>&1` was read as a heredoc redirected
 * into a file: the `2>&1` belongs to `git push`.
 *
 * `&` is excluded as a separator but re-admitted when it is immediately
 * followed by `>`, because `&>file` is bash's both-streams redirect and is a
 * genuine file write. Excluding it outright would have traded one defect for
 * another.
 */
const SAME_COMMAND = String.raw`(?:[^|;&\n]|&(?=>))*`;

/**
 * The span between a PRODUCER and its redirect, which deliberately spans the
 * whole line.
 *
 * Separator-awareness is right for a heredoc and wrong here, and the difference
 * is where the payload sits. A heredoc's opening line is pure shell syntax —
 * its content is on the lines beneath — so every `;` and `&&` there really is a
 * separator. `echo` and `printf` carry their payload as an ARGUMENT on the same
 * line, so a `;` or `|` in that argument is data, not grammar, and a gap that
 * stops at one stops inside a quoted string.
 *
 * That is not hypothetical. Occurrence 7 was
 * `printf 'export const built = 1;\n' > out/index.js`, whose payload contains a
 * semicolon: with a separator-aware gap the scan halts at it and never reaches
 * the redirect, so the guard would have allowed the exact command it exists to
 * stop. It was found by adding the historical occurrences to the proof
 * verbatim rather than paraphrased.
 *
 * Matching quotes properly would fix it precisely, and is not worth it: a
 * character class cannot know what is quoted, and every attempt to approximate
 * it trades a cheap false positive for a possible false negative. The whole
 * asymmetry of this guard says take the false positive.
 */
const SAME_LINE = String.raw`[^\n]*`;

/**
 * A redirect that writes CONTENT to a file.
 *
 * Two things disqualify a redirect, and both were learned by the guard denying
 * ordinary work.
 *
 * **The descriptor must be stdout** — explicit `1>` or the default `>`. A `2>`
 * redirects stderr, which is not the content an escape-resolving tool produces,
 * so it can never be the write this guard exists to catch. `printf … 2>/dev/null`
 * was denied on that basis; nothing printf formats goes near the file. The
 * lookbehind also rejects a preceding `>`, so the second angle of `2>>` cannot
 * be matched as though it were a fresh redirect.
 *
 * **The target must be a file, not a descriptor.** `2>&1` and `2>&-` move or
 * close a descriptor; nothing is written. The distinction is what follows `>&`:
 * a digit or `-` is a descriptor, anything else is a filename, because `>&word`
 * in bash sends both streams to `word`. `&>` and `&>>` still match, since both
 * include stdout.
 *
 * Both halves were measured against real shell semantics rather than assumed,
 * and both historical occurrences remain caught: occurrence 5 and occurrence 7
 * are stdout redirects.
 */
const TO_FILE = String.raw`(?<![02-9>])>>?\s*(?!&[0-9-])\S`;

/** Commands whose own evaluation resolves escapes before anything is written. */
const SHELL_RULES = /** @type {readonly Rule[]} */ ([
  {
    pattern: /\bnode\s+(?:-[a-zA-Z]*e|--eval|-[a-zA-Z]*p\b|--print)\b/,
    what: 'node -e / --eval / --print',
    instead:
      'put the program in a file with the Write tool and run it by path. This is the exact ' +
      'call that mangled a regex and a template literal on 2026-08-17.',
  },
  {
    pattern: /\b(?:python3?|py)\s+-c\b/,
    what: 'python -c',
    instead: 'write the script to a file and run it by path',
  },
  {
    pattern: /\b(?:perl\s+-[eEn]*e|ruby\s+-e|php\s+-r)\b/,
    what: 'an inline interpreter script',
    instead: 'write the script to a file and run it by path',
  },
  {
    pattern: /\bsed\s+(?:-[a-zA-Z]*i|--in-place)/,
    what: 'sed in-place editing',
    instead:
      'use Edit. sed was used on a markdown file once already and survived only by luck — ' +
      'occurrence 4 in the standing rule.',
  },
  {
    // echo/printf feeding a redirect or tee. The producer resolves escapes
    // (`\n`, `\a`, `\v`, octal) before a single byte reaches the file.
    pattern: new RegExp(String.raw`\b(?:echo|printf)\b${SAME_LINE}(?:${TO_FILE}|\|\s*tee\b)`),
    what: 'echo/printf writing to a file',
    instead:
      'use Write. printf turned `\\v` into a vertical tab and `\\2` into an octal escape in a ' +
      'build path — occurrence 5, and it was a batch file, which is why the rule is not scoped ' +
      'to prose.',
  },
  {
    pattern: new RegExp(String.raw`\bawk\b${SAME_LINE}${TO_FILE}`),
    what: 'awk writing to a file',
    instead: "use Write. awk's printf resolves the same escapes.",
  },
  {
    // An UNQUOTED heredoc delimiter: `<<EOF` expands $variables and backticks.
    // `<<'EOF'` and `<<"EOF"` are excluded — the first expands nothing.
    pattern: /<<-?\s*(?![''"])[A-Za-z_][\w-]*/,
    what: 'an unquoted heredoc',
    instead:
      "quote the delimiter (<<'EOF') so the shell expands nothing, or use Write. Backticks in " +
      'an unquoted heredoc swallowed a package name — occurrence 1.',
  },
  {
    // Any heredoc whose output is redirected into a file, quoted or not — in
    // EITHER operand order. `cat <<'EOF' > f` and `cat > f <<'EOF'` are the same
    // command, and the first version of this rule only matched the first form.
    pattern: new RegExp(
      String.raw`(?:<<[-~]?\s*['"]?[A-Za-z_][\w-]*['"]?${SAME_COMMAND}${TO_FILE}` +
        String.raw`|${TO_FILE}${SAME_COMMAND}<<[-~]?\s*['"]?[A-Za-z_])`,
    ),
    what: 'a heredoc redirected into a file',
    instead: 'use Write, which puts the bytes down exactly as given',
  },
]);

/** PowerShell reaches the same failure through different names. */
const POWERSHELL_RULES = /** @type {readonly Rule[]} */ ([
  {
    // Tee-Object joins the list for the same reason bash's rule covers `| tee`:
    // it writes its input to a file. Its absence was the same half-fix shape as
    // the producer rule below — the bash side had the tee branch from the start.
    pattern: /\b(?:Set-Content|Add-Content|Out-File|Tee-Object)\b/i,
    what: 'Set-Content / Add-Content / Out-File / Tee-Object',
    instead: 'use Write',
  },
  {
    pattern: /\[(?:System\.)?IO\.File\]::(?:WriteAll|Append)/i,
    what: 'a .NET file write from an inline expression',
    instead: 'use Write',
  },
  {
    pattern: /@"/,
    what: 'a double-quoted here-string, which expands $variables and subexpressions',
    instead: "use a single-quoted here-string (@'...'@) for stdin, or Write for a file",
  },
  {
    // A PowerShell producer carries its payload as an argument on the same line,
    // exactly like echo and printf, so the gap scans the line and the descriptor
    // test applies. This rule kept a separator-aware gap and a bare redirect
    // after both were corrected for bash — one shell fixed and the other left is
    // the half-fix Rule 0 names, and both shells are registered in
    // .claude/settings.json because both resolve escapes.
    //
    // `Write-Output 'a;b' > f` halted at the semicolon inside the quotes and
    // never reached the redirect, which is occurrence 7's mechanism in the other
    // shell.
    pattern: new RegExp(String.raw`\b(?:echo|Write-Output|Write-Host)\b${SAME_LINE}${TO_FILE}`, 'i'),
    what: 'echo/Write-Output writing to a file',
    instead: 'use Write',
  },
]);

/** @param {string} command @param {string} toolName @returns {Rule | null} */
function firstViolation(command, toolName) {
  const rules = toolName === 'PowerShell' ? POWERSHELL_RULES : SHELL_RULES;
  for (const rule of rules) {
    if (rule.pattern.test(command)) return rule;
  }
  return null;
}

/** @param {string} reason @returns {never} */
function deny(reason) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
  process.exit(0);
}

/** @returns {never} */
function allow() {
  process.exit(0);
}

async function main() {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');

  /** @type {{ tool_name?: unknown, tool_input?: { command?: unknown } }} */
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Fail closed: a guard that cannot read its input has not cleared anything.
    // Safe here because Edit and Write are untouched, so this hook can always be
    // repaired through the tools the rule prefers.
    deny(
      'The escape-resolving-write guard could not parse its input, so it cannot say whether ' +
        'this command is safe. Fix scripts/hooks/blockEscapeResolvingWrites.mjs with the ' +
        'editing tools.',
    );
  }

  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '';
  const command = typeof payload.tool_input?.command === 'string' ? payload.tool_input.command : '';
  if (command === '') allow();

  const violation = firstViolation(command, toolName);
  if (violation === null) allow();

  deny(
    `Blocked: this command writes a file through ${violation.what}, which resolves escape ` +
      `sequences on the way past.\n\n` +
      `Instead: ${violation.instead}\n\n` +
      `This is a standing rule in CLAUDE.md and it has been broken six times. The rule used to ` +
      `be the only defence for the classes guardFiles.mjs cannot see — a swallowed word, a real ` +
      `newline, an octal escape — and five of those six happened while it said so. There is no ` +
      `override: an escape hatch here would be a workaround with a config flag on it.`,
  );
}

main().catch((error) => {
  deny(
    `The escape-resolving-write guard itself failed: ${error instanceof Error ? error.message : String(error)}. ` +
      `A guard that errors is treated as a guard that found something.`,
  );
});
