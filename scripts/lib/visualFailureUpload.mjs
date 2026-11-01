// @ts-check
/**
 * Whether each job that keeps its failures uploads them, from where its run keeps them (`KEPT_RUNS`).
 *
 * Read from the workflow's TEXT, because the job that runs this installs nothing and the repository has no YAML parser
 * to install; the unit is the job's block — from its key to the next job's — and each step within it, never a line, so
 * a wrapped step cannot hide a field (CLAUDE.md item 4b's window).
 */

/** @typedef {import('../test/visualFailures.mjs').KeptRun} KeptRun */

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
 * What is wrong with `kept`'s upload, or nothing. The upload is the job's one step that uploads `kept.dir`: a job may
 * upload other things, and only a step naming this run's directory can hold what this run wrote.
 * @param {string} workflow `ci.yml`'s text. @param {KeptRun} kept
 * @returns {string[]}
 */
export function uploadProblems(workflow, kept) {
  const steps = jobSteps(workflow, kept.job);
  if (steps === undefined || steps.length === 0) return [`no "${kept.job}" job with steps was found, so nothing could be checked`];
  const compare = steps.findIndex((step) => step.includes(`--npm ${kept.run}`));
  const uploads = steps
    .map((step, at) => ({ step, at, path: /^\s+path: (\S+)\s*$/mu.exec(step)?.[1] }))
    .filter(({ step }) => step.includes(`uses: ${UPLOAD_ACTION}@`));
  if (compare === -1) return [`the "${kept.job}" job runs no "${kept.run}" step`];
  const mine = uploads.filter(({ path }) => path === kept.dir);
  if (mine.length !== 1) {
    const paths = uploads.map(({ path }) => JSON.stringify(path)).join(', ') || 'none';
    return [`the "${kept.job}" job has ${String(mine.length)} "${UPLOAD_ACTION}" steps with path "${kept.dir}"; one is owed (upload paths: ${paths})`];
  }
  const { step, at } = /** @type {{ step: string, at: number }} */ (mine[0]);
  /** @type {string[]} */
  const problems = [];
  if (at < compare) problems.push(`the upload runs BEFORE "${kept.run}", so it can hold nothing the run wrote`);
  if (!/^\s+if: failure\(\)\s*$/mu.test(step)) problems.push('the upload is not conditioned "if: failure()", so a green run uploads too, or a red one does not');
  if (!new RegExp(`uses: ${UPLOAD_ACTION}@[0-9a-f]{40} # v\\S+`, 'u').test(step)) problems.push('the action is not pinned by a 40-hex commit with its version beside it');
  // THE ARTIFACT'S NAME is the `name:` under `with:`, never the step's own on its first line.
  const name = /^\s+name: (.+?)\s*$/mu.exec(step.split(/\n/u).slice(1).join('\n'))?.[1];
  if (name !== kept.artifact) problems.push(`the upload's artifact is named ${JSON.stringify(name)}; "${kept.artifact}" is owed, so no two uploads in a run collide`);
  return problems;
}
