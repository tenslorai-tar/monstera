// @ts-check
/**
 * Does ONLYOFFICE's `x2t`, converting a file Monstera hands it, ever start `powershell.exe` — and does the container
 * let it? The owner's review of 0.1.16.0, R1.
 *
 * ## Why this exists
 *
 * The Windows App Certification Kit (10.0.26100.7175) reports `resources\native\onlyoffice\kernel_network.dll` as
 * containing a reference to `powershell.exe`. Read from the file (2026-10-20): the one occurrence is a UTF-16 string
 * beside `(new-object System.Net.WebClient).DownloadFile('` — ONLYOFFICE's file downloader, which on Windows tries
 * URLMon first and falls back to a PowerShell `WebClient` started with `CreateProcessW`. x2t calls the downloader for a
 * resource a document names by URL — a picture linked rather than embedded, an HTML image.
 *
 * So the question is not whether the string is there — it is — but whether a document can drive x2t to it, and what
 * happens then. Two documents, each in two cells:
 *
 * - `linked.docx`: a real Word document whose one picture is an EXTERNAL relationship to this script's server;
 * - `page.docx`: an HTML page with an `<img>` from the same server, under a `.docx` name — Monstera copies a picked
 *   file in under a fixed name, and x2t decides the format from the bytes, so this is the worst case of what a person
 *   can hand it.
 *
 * The cells:
 *
 * - FREE (the control): x2t spawned directly, no container and no job. The server must see a request, or this
 *   instrument cannot see a download at all and the contained cell's silence would mean nothing. Its requests are
 *   answered 500 after a pause, so a URLMon attempt fails and the PowerShell fallback is driven — and a `powershell.exe`
 *   child of x2t is looked for while it runs.
 * - CONTAINED: the product's own host surface (`win32HostSurface`) with an AppContainer and the job Monstera gives
 *   every contained process — `ActiveProcessLimit` 1, which refuses any child at `CreateProcessW`. The server must see
 *   nothing and no child may appear.
 *
 * Run by hand; it measures this machine and a 180 MB tree of somebody else's program.
 *
 * ## The reading of 2026-10-20 (ONLYOFFICE Document Builder 9.4.0, Windows 11 26200)
 *
 * - `linked.docx`, free: no request at all — x2t does not fetch a Word document's linked picture.
 * - `page.docx` (HTML), free: two requests — URLMon's (an MSIE user agent), then one with no user agent — and a
 *   `powershell.exe -c "(new-object System.Net.WebClient).DownloadFile(...)"` child of x2t. So the reference the kit
 *   reported is REACHABLE from a file a person can pick.
 * - Both, contained by the product's own start: no request reached the server, and no `powershell.exe` existed. The
 *   AppContainer has no network capability, so URLMon's fetch failed, and the job's one-process limit refuses the
 *   child at `CreateProcessW`. A `conhost.exe` is listed under x2t in the contained HTML cell: the console host Windows
 *   gives a console program, not a process x2t created.
 * - A first version of this script resumed the contained process WITHOUT the job and saw PowerShell started inside the
 *   AppContainer (with no network): the job is the mechanism that refuses the launch, and the AppContainer the one that
 *   refuses the fetch. Each is kernel-enforced.
 *
 * Usage: node scripts/research/x2tNetworkReach.mjs
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { strToU8, zipSync } from 'fflate';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import { onlyofficeRoot, x2tPath } from '../provision/onlyoffice.mjs';

const ROOT = repoRoot();
const TREE = onlyofficeRoot(ROOT);
const CONTAINER = 'monstera-x2t-network';
const BUDGET_MS = 60_000;
/** How long a request is held before its 500: long enough for a child started to fetch it to be seen running. */
const HOLD_MS = 3_000;

if (process.platform !== 'win32' || !existsSync(x2tPath(ROOT))) {
  process.stderr.write('x2tNetworkReach: Win32 with a provisioned ONLYOFFICE only (npm run provision:onlyoffice).\n');
  process.exit(69);
}

/** @param {string} relative */
const built = async (relative) => import(pathToFileURL(join(ROOT, relative)).href);
const pipes = await built('apps/desktop/dist/win32PipeSurface.js');
const directories = await built('apps/desktop/dist/win32DirectorySurface.js');
const sessionDirectories = await built('apps/desktop/dist/sessionDirectories.js');
const hostSurface = await built('apps/desktop/dist/win32HostSurface.js');
const factory = await built('apps/desktop/dist/engineHostFactory.js');
const budget = await built('apps/desktop/dist/budget.js');

/** @type {{ cell: string, path: string, agent: string }[]} */
const requests = [];
let current = '';
const server = createServer((request, response) => {
  requests.push({ cell: current, path: request.url ?? '', agent: request.headers['user-agent'] ?? '(none)' });
  setTimeout(() => {
    response.statusCode = 500;
    response.end();
  }, HOLD_MS);
});
await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(undefined));
});
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('the server has no port');
const base = `http://127.0.0.1:${String(address.port)}`;

/** @param {string} text */
const xml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** A Word document whose one picture is linked from `url`, not embedded. @param {string} url */
function linkedDocx(url) {
  const main = 'http://schemas.openxmlformats.org';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${main}/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${main}/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${main}/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${main}/package/2006/relationships">` +
        `<Relationship Id="rIdImg" Type="${main}/officeDocument/2006/relationships/image" Target="${xml(url)}" TargetMode="External"/></Relationships>`,
    ),
    'word/document.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${main}/wordprocessingml/2006/main" ` +
        `xmlns:r="${main}/officeDocument/2006/relationships" xmlns:wp="${main}/drawingml/2006/wordprocessingDrawing" ` +
        `xmlns:a="${main}/drawingml/2006/main" xmlns:pic="${main}/drawingml/2006/picture"><w:body>` +
        '<w:p><w:r><w:t>probe</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/>' +
        `<wp:docPr id="1" name="p"/><a:graphic><a:graphicData uri="${main}/drawingml/2006/picture"><pic:pic>` +
        '<pic:nvPicPr><pic:cNvPr id="1" name="p"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:link="rIdImg"/>' +
        '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/>' +
        '<a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData>' +
        '</a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>',
    ),
  });
}

/** An HTML page with one image from `url`. @param {string} url */
const htmlPage = (url) => strToU8(`<!doctype html><html><body><p>probe</p><img src="${xml(url)}"></body></html>\n`);

/**
 * Every `powershell.exe` whose parent is `pid`, read once, as `pid commandline` lines.
 *
 * @param {number} pid
 */
function powershellChildren(pid) {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${String(pid)}" | ForEach-Object { "$($_.ProcessId) $($_.Name) $($_.CommandLine)" }`,
    ],
    { encoding: 'utf8', timeout: 20_000 },
  );
  return `${result.stdout}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-x2t-network-'));

/**
 * One conversion's params, beside its input, writing into `output`.
 *
 * @param {string} folder where the input and params go
 * @param {string} output where the PDF and temp go
 * @param {string} name
 * @param {Uint8Array} bytes
 */
function prepare(folder, output, name, bytes) {
  const input = join(folder, 'in.docx');
  writeFileSync(input, bytes);
  const temp = join(output, 'temp');
  mkdirSync(temp, { recursive: true });
  const params = join(folder, 'params.xml');
  writeFileSync(
    params,
    '<?xml version="1.0" encoding="utf-8"?>\n<TaskQueueDataConvert>' +
      `<m_sFileFrom>${xml(input)}</m_sFileFrom><m_sFileTo>${xml(join(output, `${name}.pdf`))}</m_sFileTo>` +
      '<m_nFormatTo>513</m_nFormatTo>' +
      `<m_sFontDir>${xml(join(TREE, 'fonts'))}</m_sFontDir>` +
      `<m_sAllFontsPath>${xml(join(TREE, 'sdkjs', 'common', 'AllFonts.js'))}</m_sAllFontsPath>` +
      `<m_sThemeDir>${xml(join(TREE, 'sdkjs', 'slide', 'themes'))}</m_sThemeDir>` +
      `<m_sTempDir>${xml(temp)}</m_sTempDir>` +
      '</TaskQueueDataConvert>\n',
    'utf8',
  );
  return params;
}

/** @param {string} cell @param {Uint8Array} bytes */
async function free(cell, bytes) {
  current = cell;
  const folder = join(scratch, cell);
  mkdirSync(folder, { recursive: true });
  const params = prepare(folder, folder, cell, bytes);
  const child = spawn(x2tPath(ROOT), [params], { cwd: TREE, stdio: 'ignore' });
  const pid = child.pid ?? 0;
  const exited = new Promise((resolve) => {
    child.once('exit', resolve);
  });
  // THE WATCH RUNS BESIDE THE CHILD: a synchronous loop would hold the event loop the server answers on, so it polls
  // between awaits instead.
  /** @type {Set<string>} */
  const children = new Set();
  const deadline = Date.now() + BUDGET_MS;
  let done = false;
  void exited.then(() => {
    done = true;
  });
  while (!done && Date.now() < deadline) {
    for (const found of powershellChildren(pid)) children.add(found);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!done) child.kill();
  return { children: [...children], finished: done, pdf: existsSync(join(folder, `${cell}.pdf`)) };
}

/** @param {string} cell @param {Uint8Array} bytes @param {number} index */
async function contained(cell, bytes, index) {
  current = cell;
  const user = pipes.currentUserSid();
  const container = pipes.hostContainerSid(CONTAINER);
  const name = sessionDirectories.sessionDirectoryName(`cd-${index.toString(16)}-${process.pid.toString(16)}`);
  if (!user.ok || !container.ok || !name.ok) {
    throw new Error(`no session identity for the contained cell: ${JSON.stringify({ user: user.ok || user.error, container: container.ok || container.error, name: name.ok || name.error })}`);
  }
  const paths = sessionDirectories.sessionDirectoryPaths(scratch, name.value);
  const made = sessionDirectories.createSessionDirectories(directories.createWin32DirectorySurface(), paths, user.value, container.value);
  if (!made.ok) throw new Error(`no session pair: ${String(made.error.detail)}`);
  const params = prepare(paths.snapshot, paths.output, cell, bytes);
  const surface = hostSurface.createWin32HostSurface({
    program: { runs: 'converter', executablePath: x2tPath(ROOT), commandArguments: [params] },
    workingDirectory: TREE,
    containerName: CONTAINER,
    diagnosticPath: join(scratch, `${cell}.log`),
  });
  // THE PRODUCT'S OWN START (`createContainedHost`, which every converter takes through `runContainedConverter`): the
  // process created suspended, put in its job — one active process, the memory limit, kill on close — membership and
  // limits read back, and only then resumed. A cell that resumed it without the job would measure the AppContainer
  // alone, which is not what ships.
  const created = factory.createContainedHost(surface, budget.ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);
  if (!created.ok) throw new Error(`the contained start was refused: ${JSON.stringify(created.error)}`);
  // THE SERVER MUST KEEP ANSWERING while this cell runs, so the watch yields between reads as the free cell's does.
  const pid = created.value.pid;
  /** @type {Set<string>} */
  const children = new Set();
  const deadline = Date.now() + BUDGET_MS;
  while (alive(pid) && Date.now() < deadline) {
    for (const found of powershellChildren(pid)) children.add(found);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const finished = !alive(pid);
  if (!finished) surface.terminate(created.value.process);
  surface.close(created.value.process);
  // THE JOB'S CLOSE IS THE KILL of anything left in it, as `runContainedConverter` closes it on every path.
  surface.close(created.value.job);
  return { children: [...children], finished, pdf: existsSync(join(paths.output, `${cell}.pdf`)) };
}

try {
  process.stdout.write(`x2t: ${x2tPath(ROOT)}\nserver: ${base}\n\n`);
  const documents = [
    ['linked', linkedDocx(`${base}/linked.png`)],
    ['page', htmlPage(`${base}/page.png`)],
  ];
  /** @type {{ cell: string, result: { children: string[], finished: boolean, pdf: boolean } }[]} */
  const results = [];
  let index = 0;
  for (const [label, bytes] of /** @type {[string, Uint8Array][]} */ (documents)) {
    results.push({ cell: `${label}-free`, result: await free(`${label}-free`, bytes) });
    index += 1;
    results.push({ cell: `${label}-contained`, result: await contained(`${label}-contained`, bytes, index) });
  }
  for (const { cell, result } of results) {
    const seen = requests.filter((request) => request.cell === cell);
    process.stdout.write(
      `${cell}: ${result.finished ? 'exited' : 'STILL RUNNING at the budget'}, pdf ${result.pdf ? 'written' : 'none'}\n` +
        `  requests: ${seen.length === 0 ? 'none' : seen.map((request) => `${request.path} [${request.agent}]`).join(', ')}\n` +
        `  powershell children: ${result.children.length === 0 ? 'none' : result.children.join(' || ')}\n`,
    );
  }
  // THE POSITIVE CONTROLS: a free cell must have been seen to fetch AND to start PowerShell, or a contained cell's silence
  // on either says nothing — the request watcher and the process watcher each need a case they are known to see.
  const powershellIn = (/** @type {string} */ cell) =>
    (results.find((each) => each.cell === cell)?.result.children ?? []).some((child) => / powershell\.exe /u.test(child));
  const seesFetch = requests.some((request) => request.cell.endsWith('-free'));
  const seesLaunch = results.some((each) => each.cell.endsWith('-free') && powershellIn(each.cell));
  const containedFetched = requests.some((request) => request.cell.endsWith('-contained'));
  const containedLaunched = results.some((each) => each.cell.endsWith('-contained') && powershellIn(each.cell));
  process.stdout.write(
    `\nCONTROL: a free cell fetched — ${seesFetch ? 'yes' : 'NO'}; a free cell started PowerShell — ${seesLaunch ? 'yes' : 'NO'}\n` +
      `CONTAINED: a request reached the server — ${containedFetched ? 'YES' : 'no'}; PowerShell started — ${containedLaunched ? 'YES' : 'no'}\n`,
  );
  if (!seesFetch || !seesLaunch) process.exitCode = 2;
  else if (containedFetched || containedLaunched) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  server.close();
}
