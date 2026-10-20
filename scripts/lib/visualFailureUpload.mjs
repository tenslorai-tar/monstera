// @ts-check
/**
 * Whether the visual job uploads what a failing case keeps, from where the visual run keeps it.
 *
 * Read from the workflow's TEXT, because the job that runs this installs nothing and the repository has no YAML parser
 * to install; the unit is the job's block — from its key to the next job's — and each step within it, never a line, so
 * a wrapped step cannot hide a field (CLAUDE.md item 4b's window).
 */

import { VISUAL_OUTPUT_DIR } from '../test/visualFailures.mjs';

/** The visual job's key in `ci.yml`. */
export const VISUAL_JOB = 'visual';
/** The step that runs the comparison, which the upload must follow. */
export const COMPARE_RUN = 'test:visual';
/** The action that uploads, by name; its version is pinned by commit as every action here is. */
export const UPLOAD_ACTION = 'actions/upload-artifact';

/**
 * The job's steps, each as its text from its `- ` to the next.
 * @param {string} workflow @param {string} job
 * @returns {string[] | undefined} `undefined` when the job is not there.
 */
export function jobSteps(workflow, job) {
  const lines = workflow.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, at) => at > start && /^ {2}\S/u.test(line));
  const block = lines.slice(start + 1, end === -1 ? lines.length : end);
  /** @type {string[]} */
  const steps = [];
  for (const line of block) {
    if (/^ {6}- /u.test(line)) steps.push(line);
    else if (steps.length > 0) steps[steps.length - 1] += `\n${line}`;
  }
  return steps;
}

/**
 * What is wrong with the visual job's upload, or nothing.
 * @param {string} workflow `ci.yml`'s text.
 * @returns {string[]}
 */
export function uploadProblems(workflow) {
  const steps = jobSteps(workflow, VISUAL_JOB);
  if (steps === undefined || steps.length === 0) return [`no "${VISUAL_JOB}" job with steps was found, so nothing could be checked`];
  const compare = steps.findIndex((step) => step.includes(COMPARE_RUN));
  const uploads = steps.map((step, at) => ({ step, at })).filter(({ step }) => step.includes(`uses: ${UPLOAD_ACTION}@`));
  if (compare === -1) return [`the job runs no "${COMPARE_RUN}" step`];
  if (uploads.length !== 1) return [`the job has ${String(uploads.length)} "${UPLOAD_ACTION}" steps; one is owed`];
  const [{ step, at }] = /** @type {[{ step: string, at: number }]} */ (uploads);
  /** @type {string[]} */
  const problems = [];
  if (at < compare) problems.push('the upload runs BEFORE the comparison, so it can hold nothing the comparison wrote');
  if (!/^\s+if: failure\(\)\s*$/mu.test(step)) problems.push('the upload is not conditioned "if: failure()", so a green run uploads too, or a red one does not');
  if (!new RegExp(`uses: ${UPLOAD_ACTION}@[0-9a-f]{40} # v\\S+`, 'u').test(step)) problems.push('the action is not pinned by a 40-hex commit with its version beside it');
  const path = /^\s+path: (\S+)\s*$/mu.exec(step)?.[1];
  if (path !== VISUAL_OUTPUT_DIR) problems.push(`the upload's path is ${JSON.stringify(path)}; the visual run writes to "${VISUAL_OUTPUT_DIR}"`);
  return problems;
}
