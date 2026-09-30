// @ts-check
/**
 * Does any process Electron itself starts run in an AppContainer inside an installed package, and does anything
 * write a container principal (`S-1-15-…`) into the package's data?
 *
 * ## Why this exists
 *
 * ADR-0023 Decision 17 (route D) locks the package's data folders so no process holding only the package's
 * capability reaches them. That is safe only if nothing that NEEDS the data reaches it that way. Our own hosts are
 * handed their session folders explicitly; Chromium's children were the open question — a renderer, GPU process or
 * network service running as a package child container would lose its data, and a Chromium grant written onto one
 * of the five locked folders would make the startup check refuse every host. The owner asked for it measured with
 * the lock applied, before 0.1.2.0 was built.
 *
 * ## Two modes, each carrying its own positive control
 *
 *   node scripts/research/packagedChromiumSandbox.mjs tokens <executable-name>
 *   node scripts/research/packagedChromiumSandbox.mjs dacls <package-data-root>
 *   node scripts/research/packagedChromiumSandbox.mjs capability <sid> <name...>
 *
 * `capability` names a capability SID found by `dacls`, by deriving candidate names through Windows.
 *
 * `tokens` reads every running process with that image name — `TokenIsAppContainer`, the integrity level, the
 * container SID and the capabilities — and names each by its Chromium `--type`. It refuses to report unless it also
 * reads THIS process as not a container and a known system AppContainer (`SearchHost.exe`) as one:
 * a reader that says *no container* for everything is this instrument's reassuring answer produced by a failure.
 *
 * `dacls` walks the tree and reports every node whose DACL names an `S-1-15-` principal, and each top folder. It
 * refuses to report unless it found at least one such principal, which a package's `AC` folder always carries.
 *
 * It reads; it changes nothing. Measured 2026-09-30 against the installed 0.1.1.0 with the lock applied — the
 * result is recorded in ADR-0023's Decision 17 addendum.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';

const koffi = createRequire(join(repoRoot(), 'package.json'))('koffi');

const kernel32 = koffi.load('kernel32.dll');
const advapi32 = koffi.load('advapi32.dll');
const OpenProcess = kernel32.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)');
const CloseHandle = kernel32.func('bool CloseHandle(void *handle)');
const GetLastError = kernel32.func('uint32 GetLastError()');
const LocalFree = kernel32.func('void *LocalFree(void *memory)');
const OpenProcessToken = advapi32.func('bool OpenProcessToken(void *process, uint32 access, _Out_ void **token)');
const GetTokenInformation = advapi32.func(
  'bool GetTokenInformation(void *token, int cls, _Out_ uint8 *buffer, uint32 length, _Out_ uint32 *returned)',
);
const ConvertSidToStringSidW = advapi32.func('bool ConvertSidToStringSidW(void *sid, _Out_ void **text)');
const GetSidSubAuthorityCount = advapi32.func('uint8 *GetSidSubAuthorityCount(void *sid)');
const GetSidSubAuthority = advapi32.func('uint32 *GetSidSubAuthority(void *sid, uint32 index)');
const GetNamedSecurityInfoW = advapi32.func(
  'uint32 GetNamedSecurityInfoW(const char16_t *name, int type, uint32 info, void *owner, void *group, ' +
    '_Out_ void **dacl, void *sacl, _Out_ void **sd)',
);
const ToSddl = advapi32.func(
  'bool ConvertSecurityDescriptorToStringSecurityDescriptorW(void *sd, uint32 revision, uint32 info, ' +
    '_Out_ void **text, _Out_ uint32 *length)',
);

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TOKEN_QUERY = 0x8;
const TOKEN_INTEGRITY_LEVEL = 25;
const TOKEN_IS_APP_CONTAINER = 29;
const TOKEN_CAPABILITIES = 30;
const TOKEN_APP_CONTAINER_SID = 31;
const SE_FILE_OBJECT = 1;
const DACL_SECURITY_INFORMATION = 4;

/**
 * @param {unknown} token
 * @param {number} cls
 * @returns {Buffer | null}
 */
function tokenInformation(token, cls) {
  const size = [0];
  GetTokenInformation(token, cls, null, 0, size);
  const length = size[0] ?? 0;
  if (length === 0) return null;
  const buffer = Buffer.alloc(length);
  return GetTokenInformation(token, cls, buffer, buffer.length, size) ? buffer : null;
}

/**
 * @param {unknown} sid
 * @returns {string}
 */
function sidText(sid) {
  const out = [null];
  if (!ConvertSidToStringSidW(sid, out)) return '(unconvertible)';
  const text = koffi.decode(out[0], 'char16_t', -1);
  LocalFree(out[0]);
  return text;
}

/**
 * @typedef {{ pid: number, error?: string, appContainer?: boolean, integrity?: string, containerSid?: string | null,
 *   capabilities?: string[] }} TokenReading
 */

/**
 * @param {number} pid
 * @returns {TokenReading}
 */
function readToken(pid) {
  const process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (process === null) return { pid, error: `OpenProcess ${String(GetLastError())}` };
  try {
    const token = [null];
    if (!OpenProcessToken(process, TOKEN_QUERY, token)) {
      return { pid, error: `OpenProcessToken ${String(GetLastError())}` };
    }
    try {
      const isContainer = tokenInformation(token[0], TOKEN_IS_APP_CONTAINER);
      const label = tokenInformation(token[0], TOKEN_INTEGRITY_LEVEL);
      let integrity = '(unread)';
      if (label !== null) {
        const sid = koffi.decode(label, 0, 'void *');
        const count = koffi.decode(GetSidSubAuthorityCount(sid), 'uint8');
        integrity = `0x${koffi.decode(GetSidSubAuthority(sid, count - 1), 'uint32').toString(16)}`;
      }
      const containerBuffer = tokenInformation(token[0], TOKEN_APP_CONTAINER_SID);
      const containerPointer = containerBuffer === null ? null : koffi.decode(containerBuffer, 0, 'void *');
      /** @type {string[]} */
      const capabilities = [];
      const groups = tokenInformation(token[0], TOKEN_CAPABILITIES);
      if (groups !== null) {
        // TOKEN_GROUPS: a DWORD count padded to a pointer, then { PSID, DWORD } pairs of two pointers each.
        const pointer = koffi.sizeof('void *');
        for (let index = 0; index < groups.readUInt32LE(0); index += 1) {
          capabilities.push(sidText(koffi.decode(groups, pointer + index * 2 * pointer, 'void *')));
        }
      }
      return {
        pid,
        appContainer: isContainer === null ? false : isContainer.readUInt32LE(0) !== 0,
        integrity,
        containerSid: containerPointer === null ? null : sidText(containerPointer),
        capabilities,
      };
    } finally {
      CloseHandle(token[0]);
    }
  } finally {
    CloseHandle(process);
  }
}

/**
 * Processes by image name with their command lines, from CIM — read-only.
 *
 * @param {string} image
 * @returns {{ pid: number, commandLine: string }[]}
 */
function processesNamed(image) {
  const query =
    `Get-CimInstance Win32_Process -Filter "Name='${image.replaceAll("'", '')}'" | ` +
    'Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', query], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`the process query failed: ${result.stderr}`);
  const text = result.stdout.trim();
  if (text === '') return [];
  /** @type {{ ProcessId: number, CommandLine: string | null }[]} */
  const rows = [JSON.parse(text)].flat();
  return rows.map((row) => ({ pid: row.ProcessId, commandLine: row.CommandLine ?? '' }));
}

/**
 * @param {string} commandLine
 * @returns {string}
 */
function kindOf(commandLine) {
  const type = /--type=(\S+)/u.exec(commandLine)?.[1];
  if (type !== undefined) {
    const sub = /--utility-sub-type=(\S+)/u.exec(commandLine)?.[1];
    return sub === undefined ? type : `${type} ${sub}`;
  }
  const entry = /(\w+Entry)\.js/u.exec(commandLine)?.[1];
  return entry ?? 'main';
}

function tokens(/** @type {string} */ image) {
  const self = readToken(process.pid);
  // Windows' own shell hosts, read as containers on 2026-09-30. `StartMenuExperienceHost.exe` was the first choice
  // and reads as NOT one — which this control refused on its first run, so it is not in the list.
  const system = [...processesNamed('SearchHost.exe'), ...processesNamed('ShellExperienceHost.exe')][0];
  const known = system === undefined ? null : readToken(system.pid);
  if (self.appContainer !== false || known?.appContainer !== true) {
    throw new Error(
      `REFUSING TO REPORT: the reader's controls did not separate — this process read appContainer=` +
        `${String(self.appContainer)} (must be false), a system shell host read ${String(known?.appContainer)} ` +
        '(must be true). A reader that cannot see a container would report every process as outside one.',
    );
  }
  const rows = processesNamed(image).map(({ pid, commandLine }) => ({ kind: kindOf(commandLine), ...readToken(pid) }));
  if (rows.length === 0) throw new Error(`no process named ${image} is running; start the application first`);
  return { controls: { self: self.appContainer, knownContainer: known.appContainer }, processes: rows };
}

function dacls(/** @type {string} */ root) {
  /** @type {{ path: string, flags: string, containerAces: string[] }[]} */
  const rows = [];
  let examined = 0;
  let principals = 0;
  /**
   * @param {string} path
   * @param {number} depth
   */
  const walk = (path, depth) => {
    const dacl = [null];
    const sd = [null];
    let sddl = null;
    if (GetNamedSecurityInfoW(path, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, null, null, dacl, null, sd) === 0) {
      const text = [null];
      const length = [0];
      if (ToSddl(sd[0], 1, DACL_SECURITY_INFORMATION, text, length)) {
        sddl = koffi.decode(text[0], 'char16_t', -1);
        LocalFree(text[0]);
      }
      LocalFree(sd[0]);
    }
    examined += 1;
    const aces = [...(sddl ?? '').matchAll(/\(([^)]*)\)/gu)].map((match) => match[1] ?? '');
    const containerAces = aces.filter((ace) => (ace.split(';')[5] ?? '').startsWith('S-1-15-'));
    principals += containerAces.length;
    if (depth === 1 || containerAces.length > 0) {
      rows.push({
        path: path.slice(root.length) || '.',
        flags: sddl === null ? '(unreadable)' : (/D:([A-Z]*)/u.exec(sddl)?.[1] ?? ''),
        containerAces,
      });
    }
    // A file answers ENOTDIR, and a folder the reader may not list is reported through its DACL row above.
    const entries = (() => {
      try {
        return readdirSync(path, { withFileTypes: true });
      } catch {
        return [];
      }
    })();
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) walk(join(path, entry.name), depth + 1);
    }
  };
  walk(root, 0);
  if (principals === 0) {
    throw new Error(
      `REFUSING TO REPORT: ${String(examined)} node(s) examined and no S-1-15- principal found anywhere. A package ` +
        "root's AC folder always carries one, so this is a reader that cannot see them, not a clean tree.",
    );
  }
  return { root, examined, rows };
}

/**
 * Which of `names` derives to `sid`, through Windows' own derivation. `internetClient` is the control: its SID is
 * the well-known `S-1-15-3-1`, so a derivation that cannot reproduce it cannot be trusted to say *no match*.
 *
 * @param {string} sid
 * @param {readonly string[]} names
 */
function capability(sid, names) {
  const derive = koffi
    .load('kernelbase.dll')
    .func(
      'bool DeriveCapabilitySidsFromName(const char16_t *name, _Out_ void **groups, _Out_ uint32 *groupCount, ' +
        '_Out_ void **sids, _Out_ uint32 *sidCount)',
    );
  /** @param {string} name @returns {string[]} */
  const derived = (name) => {
    const groups = [null];
    const groupCount = [0];
    const sids = [null];
    const sidCount = [0];
    if (!derive(name, groups, groupCount, sids, sidCount)) return [];
    return koffi.decode(sids[0], koffi.array('void *', sidCount[0] ?? 0)).map(sidText);
  };
  if (!derived('internetClient').includes('S-1-15-3-1')) {
    throw new Error('REFUSING TO REPORT: internetClient did not derive to S-1-15-3-1, so a miss here means nothing.');
  }
  return names.map((name) => ({ name, derived: derived(name), matches: derived(name).includes(sid) }));
}

const [mode, argument, ...rest] = process.argv.slice(2);
if (mode === 'tokens' && argument !== undefined) console.log(JSON.stringify(tokens(argument), null, 2));
else if (mode === 'dacls' && argument !== undefined) console.log(JSON.stringify(dacls(argument), null, 2));
else if (mode === 'capability' && argument !== undefined) {
  console.log(JSON.stringify(capability(argument, rest), null, 2));
} else {
  throw new Error(
    'usage: packagedChromiumSandbox.mjs tokens <executable-name> | dacls <package-data-root> | ' +
      'capability <sid> <name...>',
  );
}
