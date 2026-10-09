# Agent entry point

Before working, read these files in order:

1. [CLAUDE.md](CLAUDE.md), in full: the operating rules bind every agent.
2. [.claude/rules/cloud-agents.md](.claude/rules/cloud-agents.md): apply the
   rules for the environment you are working in.
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the living law wins over the
   derived operating rules. Read the relevant ADRs before changing an area.

Claude Code's tool hooks do not run in Codex. Use these replacements:

- For the escape-resolving-write hook described in `CLAUDE.md`, use only the
  patch/edit tool for file writes; use the shell to read, run and test.
- For the control-character reporting hook, run `npm run guard:staged` after
  staging and before committing. Follow its diagnostics to repair a file.
- The hook invocation probe belongs to Claude Code. Do not change
  `docs/hook-probe.json` or `.claude/settings.json` to claim a Codex invocation.
- Open the operating rules yourself at the start of each run. Read any
  owner-provided lesson index and relevant lessons as read-only guidance.

The Git hooks still apply. Follow the commands and commit discipline in
`CLAUDE.md`; never bypass a rejected hook.
