// @ts-check
/**
 * Proves the Electron surface derivation parses rather than searches, and cannot
 * report a reassuring answer when it is broken.
 *
 * ## Why this proof is shaped by four failures that were not its own
 *
 * The register's own text says invariant 25's symbols can be "DERIVED from
 * Electron's own API surface, the way the OCR doors are derived from the engine
 * source." That is the instrument with the worst record in this repository:
 * `CLAUDE.md` item 4b records the OCR reachability walk failing **four times in
 * a row**, every time reporting "nothing reaches Tesseract", with two of the
 * four live at once and each concealing the other.
 *
 * Those four are four ways to produce one reassuring output, and each gets a
 * case here:
 *
 * | OCR failure | the case that would catch it |
 * |---|---|
 * | direct-call edges only (wrong edge type) | the spawn surface is derived by TYPE, not by name |
 * | a parser that read prose as C (wrong grammar) | the prose sentinel, and the removed-declaration case |
 * | a pattern that could not match at column 0 (anchoring) | the anchors, required on every run |
 * | a scan that swallowed its own input | an empty declaration set throws |
 *
 * **The grammar one is the live risk and its consequence is inverted.**
 * `electron.d.ts` is 56% comments. A text search does not fail to find a symbol
 * that exists — it WITNESSES a symbol that has been removed, which is the
 * reassuring answer and is load-bearing for invariant 25. Measured on
 * electron@43.4.1: `utilityProcess` occurs once in prose, `MessagePortMain` ten
 * times.
 *
 * Usage: node scripts/proofs/electronSurface.proof.mjs
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { parseElectronDeclarations, readElectronSurface } from '../security/electronSurface.mjs';

/** @type {string[]} */
const failures = [];

/**
 * @param {string} directory
 * @param {string} name
 * @param {string} text
 * @returns {Promise<string>}
 */
async function fixture(directory, name, text) {
  const path = join(directory, name);
  await writeFile(path, text, 'utf8');
  return path;
}

/**
 * @param {() => Promise<unknown>} run
 * @returns {Promise<string>} the message, or '' if it did not throw
 */
async function refusal(run) {
  try {
    await run();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// A minimal but REAL declaration file: the anchors, the sentinel in a comment,
// and a utility-process factory. Cases below vary one thing at a time from this.
const ANCHORS = `
declare class app {}
declare class BrowserWindow {}
declare class ipcMain {}
declare class WebContents {}
`;
const SENTINEL_COMMENT = `
/**
 * @deprecated Deprecated in favour of something else. This comment mentions
 * Deprecated and utilityProcess in PROSE and declares neither.
 */
`;

async function main() {
  const roster = createRoster(failures, { cases: 8 });
  const scratch = await mkdtemp(join(tmpdir(), 'monstera-electron-surface-'));

  try {
    // -------------------------------------------------------------------------
    // The real thing, when it is installed.
    // -------------------------------------------------------------------------
    let mark = roster.mark();
    const live = await readElectronSurface();
    if (live.checked) {
      for (const symbol of ['utilityProcess', 'UtilityProcess', 'MessageChannelMain']) {
        if (!live.declared.includes(symbol)) {
          failures.push(
            `electron ${live.version} does not DECLARE ${symbol}, which invariant 25's register ` +
              `names. Either the API moved — in which case the invariant's symbol list is stale ` +
              `and the containment verdict is watching a name nothing can produce — or this walk ` +
              `is broken.`,
          );
        }
      }
      if (!live.spawnSurface.includes('utilityProcess')) {
        failures.push(
          `the derived spawn surface is ${JSON.stringify(live.spawnSurface)} and does not include ` +
            `utilityProcess. That is the factory invariant 25 exists for.`,
        );
      }
    }
    // `ran` is `live.checked`: with no node_modules this case verified nothing,
    // and reporting it as a pass is precisely the "did not look" / "looked and
    // found nothing" collapse the roster exists to stop.
    roster.record(mark, 'the installed electron declares every symbol the register names', live.checked);

    // -------------------------------------------------------------------------
    // THE CASE THAT SEPARATES A PARSE FROM A SEARCH.
    // -------------------------------------------------------------------------
    mark = roster.mark();
    {
      const path = await fixture(
        scratch,
        'prose-only.d.ts',
        `${ANCHORS}${SENTINEL_COMMENT}declare const somethingReal: typeof UtilityProcess;\ndeclare class UtilityProcess {}\n`,
      );
      const parsed = await parseElectronDeclarations({ path, describe: 'a prose fixture' });

      // `utilityProcess` appears in the comment and is declared nowhere.
      if (parsed.declared.includes('utilityProcess')) {
        failures.push(
          `a symbol that appears ONLY in a doc comment was reported as declared. This is the ` +
            `defect the whole module exists to prevent, and its consequence is inverted from the ` +
            `usual one: it does not miss a symbol that exists, it WITNESSES one that has been ` +
            `REMOVED — the reassuring answer, on which invariant 25 rests.`,
        );
      }
      if (!parsed.declared.includes('somethingReal')) {
        failures.push(
          `CONTROL: the fixture's real declaration was not found either, so the case above passes ` +
            `because this walk finds nothing at all.`,
        );
      }
    }
    roster.record(mark, 'RESOLUTION: a symbol in PROSE is not reported as declared');

    // -------------------------------------------------------------------------
    // Derived by TYPE, not by name — the OCR "wrong edge type" failure.
    // -------------------------------------------------------------------------
    mark = roster.mark();
    {
      const path = await fixture(
        scratch,
        'by-type.d.ts',
        `${ANCHORS}${SENTINEL_COMMENT}declare class UtilityProcess {}\ndeclare const spawnerWithAnUnrelatedName: typeof UtilityProcess;\ndeclare const notASpawner: typeof BrowserWindow;\n`,
      );
      const parsed = await parseElectronDeclarations({ path, describe: 'a type fixture' });

      if (!parsed.spawnSurface.includes('spawnerWithAnUnrelatedName')) {
        failures.push(
          `a declaration typed as the utility-process factory was missed because its NAME does ` +
            `not look like one. Deriving by name is a hand-picked list wearing a derivation's ` +
            `clothes, and it is how a renamed API escapes invariant 25 silently.`,
        );
      }
      if (parsed.spawnSurface.includes('notASpawner')) {
        failures.push(
          `CONTROL: a declaration typed by something else was counted as a spawner, so the case ` +
            `above is satisfied by a rule that admits everything.`,
        );
      }
    }
    roster.record(mark, 'the spawn surface is derived from TYPES, not from names');

    // -------------------------------------------------------------------------
    // The controls that must throw. Each is a way to produce "nothing found".
    // -------------------------------------------------------------------------
    mark = roster.mark();
    {
      const path = await fixture(scratch, 'empty.d.ts', `${SENTINEL_COMMENT}\n`);
      const message = await refusal(() =>
        parseElectronDeclarations({ path, describe: 'an empty fixture' }),
      );
      if (!message.includes('no declarations at all')) {
        failures.push(
          `a declaration file with nothing in it ${message === '' ? 'was accepted' : `said: ${message}`}. ` +
            `An empty intermediate result is a broken parse, not a clean input — and an empty ` +
            `symbol set makes every "not declared" true by vacuity.`,
        );
      }
    }
    roster.record(mark, 'an empty declaration set THROWS rather than reporting nothing found');

    mark = roster.mark();
    {
      const path = await fixture(
        scratch,
        'no-anchors.d.ts',
        `${SENTINEL_COMMENT}declare class SomethingElse {}\ndeclare class UtilityProcess {}\n`,
      );
      const message = await refusal(() =>
        parseElectronDeclarations({ path, describe: 'an anchorless fixture' }),
      );
      if (!message.includes('known-present')) {
        failures.push(
          `a file declaring none of ${'app, BrowserWindow, ipcMain, WebContents'} was accepted: ` +
            `${message || '(no refusal)'}. The positive control lives IN the instrument because ` +
            `the proof runs in CI and the instrument gets run by hand on the day someone needs ` +
            `an answer.`,
        );
      }
    }
    roster.record(mark, 'a walk that cannot find known-present names THROWS');

    mark = roster.mark();
    {
      // The control's own control: a file with no sentinel in its text cannot
      // distinguish a parse from a search, so the sentinel check is inert and
      // must say so rather than passing.
      const path = await fixture(
        scratch,
        'no-sentinel.d.ts',
        `${ANCHORS}declare class UtilityProcess {}\ndeclare const utilityProcess: typeof UtilityProcess;\n`,
      );
      const message = await refusal(() =>
        parseElectronDeclarations({ path, describe: 'a sentinel-less fixture' }),
      );
      if (!message.includes('no longer appears')) {
        failures.push(
          `a file with no prose sentinel in it was accepted: ${message || '(no refusal)'}. A ` +
            `control that cannot fail is not a control, and this one silently stops separating ` +
            `a parse from a search the day the token disappears.`,
        );
      }
    }
    roster.record(mark, "CONTROL: the prose control's own absence is refused");

    mark = roster.mark();
    {
      const path = await fixture(
        scratch,
        'no-spawner.d.ts',
        `${ANCHORS}${SENTINEL_COMMENT}declare class Something {}\n`,
      );
      const message = await refusal(() =>
        parseElectronDeclarations({ path, describe: 'a spawnerless fixture' }),
      );
      if (!message.includes('typed by UtilityProcess')) {
        failures.push(
          `a declaration file where nothing spawns a process was accepted: ` +
            `${message || '(no refusal)'}. Either the API was renamed and the invariant's list is ` +
            `stale, or the type walk is broken. Both need a person; neither may report an empty ` +
            `spawn surface as "nothing spawns processes".`,
        );
      }
    }
    roster.record(mark, 'an empty SPAWN surface THROWS rather than reporting none');

    // -------------------------------------------------------------------------
    // Absent is not broken — the state Guards runs in.
    // -------------------------------------------------------------------------
    mark = roster.mark();
    {
      const bare = await mkdtemp(join(tmpdir(), 'monstera-no-electron-'));
      try {
        const surface = await readElectronSurface({ root: bare });
        if (surface.checked || surface.reason === '') {
          failures.push(
            `a tree with no node_modules reported checked=${String(surface.checked)}. Guards runs ` +
              `check:advisories with no npm ci at all, so this is its NORMAL state: the symbols ` +
              `are unverifiable and say why. It is --require-derivation, in the one job that ` +
              `installs, that turns "could not look" into a failure.`,
          );
        }
        if (surface.declared.length > 0 || surface.spawnSurface.length > 0) {
          failures.push(
            `a derivation that could not run returned ${String(surface.declared.length)} ` +
              `declaration(s). "Could not look" must carry no findings, or it reads as "looked ` +
              `and found these".`,
          );
        }
      } finally {
        await rm(bare, { recursive: true, force: true });
      }
    }
    roster.record(mark, 'ABSENT IS NOT BROKEN: no node_modules reports unverifiable, not empty');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    process.stderr.write(
      `\n${failures.length} electron surface failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`,
    );
    return 1;
  }

  process.stdout.write(roster.format('electron surface case'));
  return 0;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  },
);
