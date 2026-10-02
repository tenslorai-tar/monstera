# Rules for cloud sessions

The project owner's rules for every cloud session working on Monstera, given on 2026-10-01. They bind every cloud agent, alongside `CLAUDE.md`.

1. Never push to main, and never move main. Only the local agent merges your branches and moves main.
2. Branch from origin/main. Use one branch per group of work, named `work/cloud-<topic>` (for example `work/cloud-screens`). Push at the end of each group. Read the board ONCE per pushed sha, after the runs should have finished. `npm run board` cannot reach GitHub from this sandbox, so use the GitHub connector. Never poll.
3. Never force-push or rewrite history. Never use --no-verify. Until the pre-push hook is executable on main, run `npm run typecheck` yourself before each push: on Linux git skips a hook file without its executable bit, so the hook's own typecheck does not run.
4. Locally, run only what a change reaches: the tests of the changed files, lint on the changed files, and typecheck once per item. Never run check:docs by hand; Guards runs it on your branch. One commit per item.
5. The visual baselines are *-win32.png, and only the local agent regenerates them. Never commit Linux screenshots and never regenerate the baselines. Expect CI's "Visual baselines" job to be red on any branch that changes a screen. In your report, list exactly which screens you expect to change.
6. Run rendered tests on the pinned Chromium (151). cdn.playwright.dev is now allowed in this environment, so install it the project's normal way and confirm the version.
7. ADR NUMBERS: a number is final only once it is on main. Before writing an ADR, take the next number after the highest on origin/main AND on every origin/work/* branch. If one still collides, the local agent renumbers it at merge. Architecture changes still follow B4: the ADR goes first, in its own commit.
8. Keep edits to the shared documents (docs/FEATURES.md, docs/JOURNAL.md, docs/DECISIONS/README.md) minimal, so merges stay clean.
9. Never print, log or commit a secret, and never ask for one in an environment variable. Live AI tests use Haiku 4.5 only. report@monsterapdf.com is not live, the website must not be discoverable before launch, and the update check stays dormant. Design exports are never committed. The owner's personal documents are never copied, quoted or committed.
10. The owner's principles: a user is never refused because of their document; preserve, never drop; never show an unfinished screen.
11. Never start, or suggest starting, a second session for a task you have been given. Never queue a suggested task either: put work you find out of scope in your report, and the owner decides where it goes.
12. Report in plain language: what landed (branch, sha, board result), what is left, questions, and what the local agent must do at merge.
