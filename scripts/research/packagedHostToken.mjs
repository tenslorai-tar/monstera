// @ts-check
/**
 * What does an engine host's token carry when the process that creates it has a
 * package identity — and can that token open a file under the package's data?
 *
 * ## Why this exists
 *
 * MSIX 0.1.1.0, installed on the owner's machine (2026-09-29), refused every
 * document: the host's startup check read `engine-sessions/containment-negative`,
 * a file it was not handed. ADR-0023 Decision 16 had predicted the opposite
 * failure — a host that cannot start under the install root because its token
 * names nothing the install root's DACL grants. Both are claims about ONE token,
 * and neither had been read. This reads it.
 *
 * ## What it does, and what it deliberately does not
 *
 * Creation belongs to the shipped surface (`lowboxSpike.mjs`' rule, RR-3): the
 * host is created by the BUILT `win32HostSurface.js` with the product's own
 * moniker, suspended, and never resumed. Its token is read from outside, then
 * the process is terminated. No script runs inside the container, so no file the
 * container would need to read is part of the measurement.
 *
 * The access question is answered by the kernel, not reasoned: this thread
 * impersonates the child's token and calls `CreateFileW` for read. A granted
 * open is the same access check the host's own read made.
 *
 * It grants nothing and changes no ACL. The one thing it writes is a probe file,
 * under the package's own data folder when a package root is given, removed on
 * exit.
 *
 * ## How it is run
 *
 * Twice, and the pair is the measurement:
 *
 *   - inside the installed package's context —
 *     `Invoke-CommandInDesktopPackage -PackageFamilyName <family> -AppId <id>
 *      -Command <node.exe> -Args "<this file> --expect-package --out <json> --probe-dir <dir>"`
 *   - outside it, from an ordinary shell, with the same `--probe-dir` and no
 *     `--expect-package`. That is the control: one variable flips.
 *
 * `--expect-package` is a positive control on the context itself: a run that
 * claims to be inside a package and whose own process has no package identity
 * measured nothing, and it says so rather than reporting a child's token.
 *
 * Resolution (audit 4a): the two runs must differ in the parent's package
 * reading. If they do not, the pair separates nothing and the result is void.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const ROOT = repoRoot();
const BUILT_SURFACE = join(ROOT, 'apps', 'desktop', 'dist', 'win32HostSurface.js');
const koffi = createRequire(BUILT_SURFACE)('koffi');

/** @param {string} name */
const argument = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : process.argv[at + 1] ?? null;
};
const EXPECT_PACKAGE = process.argv.includes('--expect-package');
const OUT = argument('--out');
const PROBE_DIR = argument('--probe-dir');
const MONIKER = argument('--moniker') ?? 'monstera-engine-host';
/** Further paths to open under the child's token — the install root's files, which P1 was about. */
const READS = process.argv.flatMap((value, at) => (value === '--read' ? [process.argv[at + 1] ?? ''] : []));
/**
 * Whether to measure the layout a fix would rest on: under the probe directory, an
 * INHERITABLE deny for every capability the child holds, a `handed` directory
 * carrying an explicit inheritable allow for the child's container SID, and one
 * file in each. The question is whether Windows' ACE ordering lets the nearer
 * allow win inside `handed` while the deny holds everywhere else.
 */
const DENY_LAYOUT = process.argv.includes('--deny-layout');
if (OUT === null || PROBE_DIR === null) {
  console.error('usage: packagedHostToken.mjs --out <json> --probe-dir <dir> [--expect-package] [--moniker <name>]');
  process.exit(2);
}

const kernel32 = koffi.load('kernel32.dll');
const advapi32 = koffi.load('advapi32.dll');

const GetLastError = kernel32.func('uint32 GetLastError()');
const GetCurrentPackageFullName = kernel32.func('long GetCurrentPackageFullName(_Inout_ uint32 *len, void *name)');
const GetPackageFullName = kernel32.func('long GetPackageFullName(void *proc, _Inout_ uint32 *len, void *name)');
const CloseHandle = kernel32.func('bool CloseHandle(void *h)');
const CreateFileW = kernel32.func(
  'void *CreateFileW(const char16_t *name, uint32 access, uint32 share, void *sa, uint32 disp, uint32 flags, void *tmpl)',
);
const OpenProcessToken = advapi32.func('bool OpenProcessToken(void *proc, uint32 access, _Out_ void **token)');
const GetTokenInformation = advapi32.func(
  'bool GetTokenInformation(void *token, int cls, _Out_ void *info, uint32 len, _Out_ uint32 *ret)',
);
const DuplicateTokenEx = advapi32.func(
  'bool DuplicateTokenEx(void *token, uint32 access, void *sa, int level, int type, _Out_ void **out)',
);
const SetThreadToken = advapi32.func('bool SetThreadToken(void *thread, void *token)');
const RevertToSelf = advapi32.func('bool RevertToSelf()');
const ConvertSidToStringSidW = advapi32.func('bool ConvertSidToStringSidW(void *sid, _Out_ char16_t **out)');

const TOKEN_QUERY = 0x0008;
const TOKEN_DUPLICATE = 0x0002;
const TOKEN_IMPERSONATE = 0x0004;
const TokenIsAppContainer = 29;
const TokenCapabilities = 30;
const TokenAppContainerSid = 31;
const SecurityImpersonation = 2;
const TokenImpersonationType = 2;
const GENERIC_READ = 0x80000000;
const SHARE_ALL = 0x7;
const OPEN_EXISTING = 3;
const APPMODEL_ERROR_NO_PACKAGE = 15700;

/** @param {(len: number[], buf: Buffer | null) => number} call */
function packageName(call) {
  const len = [0];
  const first = call(len, null);
  if (first === APPMODEL_ERROR_NO_PACKAGE) return { package: null, code: first };
  const buffer = Buffer.alloc((len[0] ?? 0) * 2);
  const second = call(len, buffer);
  if (second !== 0) return { package: null, code: second };
  return { package: buffer.toString('utf16le').replace(/\0+$/, ''), code: 0 };
}

/** @param {unknown} sid */
function sidText(sid) {
  const out = [null];
  if (!ConvertSidToStringSidW(sid, out)) return `unconvertible (${String(GetLastError())})`;
  return String(out[0]);
}

/** @param {unknown} token @param {number} cls */
function tokenInformation(token, cls) {
  const size = [0];
  GetTokenInformation(token, cls, null, 0, size);
  const length = size[0] ?? 0;
  if (length === 0) return null;
  const buffer = Buffer.alloc(length);
  if (!GetTokenInformation(token, cls, buffer, length, size)) return null;
  return buffer;
}

/**
 * TOKEN_GROUPS: a DWORD count, then SID_AND_ATTRIBUTES { PSID; DWORD } aligned to a pointer.
 * @param {Buffer} buffer
 */
function groupSids(buffer) {
  const count = buffer.readUInt32LE(0);
  const pointer = koffi.sizeof('void *');
  const entry = pointer * 2;
  const sids = [];
  for (let i = 0; i < count; i += 1) {
    const offset = pointer + i * entry;
    const sid = koffi.decode(buffer, offset, 'void *');
    sids.push(sidText(sid));
  }
  return sids;
}

/** @param {unknown} token */
function readToken(token) {
  const isContainer = tokenInformation(token, TokenIsAppContainer);
  const container = tokenInformation(token, TokenAppContainerSid);
  const capabilities = tokenInformation(token, TokenCapabilities);
  return {
    isAppContainer: isContainer === null ? 'unreadable' : isContainer.readUInt32LE(0) !== 0,
    appContainerSid:
      container === null ? 'unreadable' : (() => {
        const sid = koffi.decode(container, 0, 'void *');
        return sid === null ? null : sidText(sid);
      })(),
    capabilities: capabilities === null ? 'unreadable' : groupSids(capabilities),
  };
}

/**
 * Opens `path` for read under `token`, on this thread, and says what the kernel answered.
 * @param {unknown} token
 * @param {string} path
 */
function openAs(token, path) {
  const duplicated = [null];
  if (!DuplicateTokenEx(token, TOKEN_IMPERSONATE | TOKEN_QUERY, null, SecurityImpersonation, TokenImpersonationType, duplicated)) {
    return { opened: 'could-not-impersonate', error: GetLastError() };
  }
  if (!SetThreadToken(null, duplicated[0])) {
    const error = GetLastError();
    CloseHandle(duplicated[0]);
    return { opened: 'could-not-impersonate', error };
  }
  const handle = CreateFileW(path, GENERIC_READ, SHARE_ALL, null, OPEN_EXISTING, 0, null);
  const error = GetLastError();
  RevertToSelf();
  CloseHandle(duplicated[0]);
  const address = koffi.address(handle);
  const invalid = address === 0n || address === 0xffffffffffffffffn;
  if (!invalid) CloseHandle(handle);
  return invalid ? { opened: false, error } : { opened: true };
}

/**
 * @param {string[]} args
 * @returns {{ ok: boolean, said: string }}
 */
function icacls(args) {
  const ran = spawnSync('icacls', args, { encoding: 'utf8', windowsHide: true });
  return { ok: ran.status === 0, said: `${ran.stdout ?? ''}${ran.stderr ?? ''}`.trim().split(/\r?\n/)[0] ?? '' };
}

/**
 * @param {unknown} token
 * @param {unknown} reading the child's token reading
 */
function measureDenyLayout(token, reading) {
  const container = /** @type {{ appContainerSid?: unknown, capabilities?: unknown }} */ (reading);
  const capabilities = Array.isArray(container.capabilities) ? container.capabilities : [];
  if (typeof container.appContainerSid !== 'string' || capabilities.length === 0) {
    return { skipped: 'the child holds no capability, so there is nothing to deny' };
  }
  /** @param {string} label @param {string[]} denied */
  const variant = (label, denied) => {
    const root = join(PROBE_DIR ?? '', `deny-${label}`);
    const handed = join(root, 'handed');
    mkdirSync(handed, { recursive: true });
    const outside = join(root, 'not-handed');
    const inside = join(handed, 'handed-file');
    writeFileSync(outside, 'o'.repeat(64));
    writeFileSync(inside, 'i'.repeat(64));
    const before = { outside: openAs(token, outside), inside: openAs(token, inside) };
    const steps = [
      ...denied.map((sid) => icacls([root, '/deny', `*${sid}:(OI)(CI)(F)`])),
      icacls([handed, '/grant', `*${String(container.appContainerSid)}:(OI)(CI)(M)`]),
    ];
    // The positive control on the layout itself: the deny must be READ BACK on the
    // file it is meant to refuse, or an open that succeeds says nothing about denies.
    const aclOfOutside = spawnSync('icacls', [outside], { encoding: 'utf8', windowsHide: true }).stdout ?? '';
    const denyArrived = denied.every((sid) => aclOfOutside.includes(sid) && /\(DENY\)|\(N\)|:\(I\)\(DENY\)/.test(aclOfOutside));
    const after = { outside: openAs(token, outside), inside: openAs(token, inside) };
    rmSync(root, { recursive: true, force: true });
    return { denied, steps, denyArrived, aclOfOutside: aclOfOutside.trim().split(/\r?\n/).map((line) => line.trim()), before, after };
  };
  return {
    capability: variant('capability', capabilities.map(String)),
    container: variant('container', [container.appContainerSid]),
  };
}

const self = packageName((len, buf) => GetCurrentPackageFullName(len, buf));
/**
 * @type {{ measuredAt: string, expectPackage: boolean, moniker: string, parentPackage: unknown, probeDir: string,
 *   verdict?: string, childPackage?: unknown, childToken?: unknown, childOpensNegative?: unknown,
 *   childReads?: unknown, denyLayout?: unknown }}
 */
const result = {
  measuredAt: new Date().toISOString(),
  expectPackage: EXPECT_PACKAGE,
  moniker: MONIKER,
  parentPackage: self,
  probeDir: PROBE_DIR,
};

if (EXPECT_PACKAGE && self.package === null) {
  result.verdict = 'VOID: asked to run inside a package and this process has no package identity';
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  process.exit(3);
}

mkdirSync(PROBE_DIR, { recursive: true });
const negative = join(PROBE_DIR, 'token-probe-negative');
writeFileSync(negative, 'n'.repeat(64));

const { createWin32HostSurface } = await import(pathToFileURL(BUILT_SURFACE).href);
const binary = electronBinaryPath(ROOT);
const surface = createWin32HostSurface({
  program: { runs: 'electron-node', executablePath: binary, commandArguments: ['token-probe-never-resumed.js'] },
  workingDirectory: dirname(binary),
  containerName: MONIKER,
  diagnosticPath: null,
});

try {
  const created = surface.createSuspended();
  if (!created.ok) {
    result.verdict = `NOT CREATED: ${created.error}`;
  } else {
    const child = created.value;
    try {
      result.childPackage = packageName((len, buf) => GetPackageFullName(child.process, len, buf));
      const token = [null];
      if (!OpenProcessToken(child.process, TOKEN_QUERY | TOKEN_DUPLICATE, token)) {
        result.childToken = `OpenProcessToken failed: ${String(GetLastError())}`;
      } else {
        result.childToken = readToken(token[0]);
        result.childOpensNegative = openAs(token[0], negative);
        result.childReads = READS.map((path) => ({ path, ...openAs(token[0], path) }));
        if (DENY_LAYOUT) result.denyLayout = measureDenyLayout(token[0], result.childToken);
        CloseHandle(token[0]);
      }
      result.verdict = 'MEASURED';
    } finally {
      surface.terminate(child.process);
      surface.close(child.thread);
      surface.close(child.process);
    }
  }
} finally {
  rmSync(negative, { force: true });
}

writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
