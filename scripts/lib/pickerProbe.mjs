// @ts-check
/**
 * The picker probe's record: what it holds, when it expires, and who may read
 * it.
 *
 * ## The class of claim this is for
 *
 * `documentPicker.ts` wraps `dialog.showOpenDialog`. Every part of opening a
 * document is proven — the channel, the handle, the four outcomes, the bytes,
 * the pixels — and the one thing no proof can reach is whether the dialog itself
 * works, because a dialog needs a person. That is the same class as the tool-use
 * hook: **executed once and recorded, rather than asserted.**
 *
 * `docs/FEATURES.md`'s open row said **done** directly above a paragraph saying
 * this module had never executed anywhere. A status column contradicting its own
 * body is the display-only sin at document scale, and the repair is either an
 * honest status or a record — this is the record.
 *
 * ## Expiry, which is the whole reason it is not a comment
 *
 * A run certifies the code that ran. `verdict.inputs` digests the two files that
 * decide what the picker does, so editing either one makes the record describe a
 * program that no longer exists, and `check:docs` says so. The pattern is
 * `scripts/lib/hookProbe.mjs`'s and is deliberately not a second one: the same
 * question — *does this recorded observation still describe the current code?* —
 * gets the same answer shape.
 *
 * The digest is over the **picker and the probe**, not over the whole shell.
 * Widening it to every file the probe touches would expire the record on an
 * unrelated renderer change, and a gate that goes red for reasons nobody can act
 * on is one somebody deletes.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** @returns {string} the repository root */
export function repoRoot() {
  return resolve(HERE, '..', '..');
}

/** Where the record lives. Tracked, because a gate's evidence is public. */
export const RECORD_FILE = 'docs/picker-probe.json';

/**
 * The files whose content the record is a claim about.
 *
 * `documentPicker.ts` is the subject. `pickerProbe.ts` is the observer, and it
 * is here because a probe that stopped calling the real picker would leave a
 * record that still looked like evidence — the observer deciding what is
 * observed is the failure this list exists for.
 */
export const PROBE_INPUTS = [
  'apps/desktop/src/documentPicker.ts',
  'apps/desktop/src/pickerProbe.ts',
];

/** The command a person runs to produce a record. */
export const PROBE_COMMAND = 'npm run probe:picker';

/**
 * The digest of the current content of {@link PROBE_INPUTS}.
 *
 * A MISSING INPUT THROWS rather than hashing an empty string. Two files that do
 * not exist hash to the same value as two files that do not exist tomorrow, so a
 * deleted picker would produce a stable digest and a record that never expires —
 * the reassuring answer, arriving through absence.
 *
 * @param {string} [root]
 * @returns {{ digest: string, inputs: { name: string, digest: string }[] }}
 */
export function currentInputDigest(root = repoRoot()) {
  const inputs = PROBE_INPUTS.map((relative) => {
    const path = join(root, relative);
    if (!existsSync(path)) {
      throw new Error(
        `${relative} does not exist, so the picker probe's record cannot be a claim about it. ` +
          `If the module moved, update PROBE_INPUTS in the same commit — a digest over files ` +
          `that are absent is stable, and a record that can never expire is not evidence.`,
      );
    }
    return {
      name: `file:${relative}`,
      // Line endings normalised, because git filters them on the way into the
      // object store (`* text=auto eol=lf`). Without this the digest recorded on
      // Windows differs from the one computed on a Linux runner for identical
      // content, and the gate reports an expired record for a file nobody
      // touched — measured on NOTICE, 2026-08-29, as a whole CI failure.
      digest: createHash('sha256')
        .update(readFileSync(path, 'utf8').replace(/\r\n?/gu, '\n'))
        .digest('hex'),
    };
  });
  const digest = createHash('sha256')
    .update(inputs.map((entry) => `${entry.name}:${entry.digest}`).join('\n'))
    .digest('hex');
  return { digest, inputs };
}

/**
 * The record, or `null` when there is none.
 *
 * @param {string} [root]
 * @returns {Record<string, unknown> | null}
 */
export function readRecord(root = repoRoot()) {
  const path = join(root, RECORD_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Writes the record, with a trailing newline so it is an ordinary text file.
 *
 * @param {Record<string, unknown>} record
 * @param {string} [root]
 * @returns {void}
 */
export function writeRecord(record, root = repoRoot()) {
  writeFileSync(join(root, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

/**
 * What the record currently says, as a state a gate can read.
 *
 * Four states, and the three that are not `observed` are kept apart because they
 * call for different actions: nobody has run it, somebody ran it and the dialog
 * was dismissed, or somebody ran it against code that has since changed.
 *
 * @param {string} [root]
 * @returns {{ state: 'observed' | 'absent' | 'unobserved' | 'expired', detail: string }}
 */
export function probeState(root = repoRoot()) {
  const record = readRecord(root);
  if (record === null) {
    return {
      state: 'absent',
      detail:
        `No ${RECORD_FILE}. Run \`${PROBE_COMMAND}\`, click Open, and choose a PDF — the ` +
        `probe records what it saw either way, and a dismissal is an honest entry that ` +
        `satisfies no gate.`,
    };
  }

  const outcome = record['outcome'];
  const verdict = /** @type {{ digest?: unknown } | undefined} */ (record['verdict']);
  const current = currentInputDigest(root);

  if (verdict?.digest !== current.digest) {
    return {
      state: 'expired',
      detail:
        `${RECORD_FILE} was recorded against different content. One of ${PROBE_INPUTS.join(', ')} ` +
        `has changed since, so the observation describes a program that no longer exists.\n      ` +
        `recorded: ${String(verdict?.digest ?? '(none)')}\n      current:  ${current.digest}\n      ` +
        `Run \`${PROBE_COMMAND}\` again. The point of the digest is that a picker edited after ` +
        `the run is a picker nobody has driven.`,
    };
  }

  if (outcome !== 'opened') {
    return {
      state: 'unobserved',
      detail:
        `${RECORD_FILE} records "${String(outcome)}". Only "opened" is evidence that the dialog ` +
        `returned a path and the document reached the screen — "cancelled" means the dialog was ` +
        `dismissed, and "not-drawn" means a path arrived and nothing was drawn, which is a ` +
        `finding rather than a gate to route around.`,
    };
  }

  return {
    state: 'observed',
    detail:
      `${RECORD_FILE} records a document opened through the real dialog on ` +
      `${String(record['recordedAt'])}: ${String(record['painted'])} painted pixel(s) at ` +
      `${String(record['width'])}x${String(record['height'])}.`,
  };
}
