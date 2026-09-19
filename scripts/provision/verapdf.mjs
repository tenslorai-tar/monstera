// @ts-check
/**
 * Provisions veraPDF 1.30.2 and the Java runtime it needs — for DEVELOPMENT only
 * ([ADR-0075](../../docs/DECISIONS/0075-pdfa-2b-is-ghostscripts-pdfwrite-and-what-it-removes-is-reported.md)
 * Decision 5).
 *
 * ## It never ships, and nothing here reaches the notice
 *
 * The application does not claim a file was validated: PDF/A-2b is Ghostscript's `pdfwrite`, and
 * what it removed is shown to the person in its own words. veraPDF is how this repository checks
 * that claim about the output — the validator the ADR's readings were taken with — so it lives
 * under `.tools/` beside the other development tools, and the installer and its runtime are not
 * in any package this build produces. That is why there is no licence comparison and no NOTICE
 * entry here, where every shipped component has both.
 *
 * ## Two signatures, each against a pinned key, each digest-pinned first
 *
 * - the veraPDF installer, signed by the veraPDF consortium's key `13DD102B…78B17FE7`;
 * - Eclipse Temurin JRE 21.0.12.1, signed by Adoptium's key `3B04D753…65F8F04B`.
 *
 * Both keys are committed beside this file and both verifications go through
 * `openpgpVerify.mjs`, the one verifier the other provisioning scripts use (B3a). The digests were
 * read 2026-09-17, when both signatures were first verified with a wrong-file control refused;
 * the digest is checked BEFORE the signature, so a swapped file never reaches the verifier.
 * Temurin publishes a binary signature packet and the verifier reads armor, so it is armored here
 * — base64 of the same bytes, which changes nothing the signature covers.
 *
 * ## Installed headless
 *
 * The installer is an IzPack jar; `auto-install.xml` selects the command-line validator and
 * nothing else, into `.tools/verapdf/1.30.2/install`. It is written by this script rather than
 * committed, because the install path is this checkout's.
 *
 * Usage: node scripts/provision/verapdf.mjs [--check] [--force]
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract } from '../lib/extract.mjs';
import { downloadVerified, fileExists, toolPath } from '../lib/fetchVerified.mjs';
import { verifyDetached } from '../lib/openpgpVerify.mjs';
import { formatError } from '../lib/reportError.mjs';
import { ADOPTIUM_KEY_FINGERPRINT, adoptiumKeyPath } from './keys/adoptiumKey.mjs';
import { VERAPDF_KEY_FINGERPRINT, verapdfKeyPath } from './keys/verapdfKey.mjs';

export const VERAPDF_VERSION = '1.30.2';
export const JRE_VERSION = '21.0.12.1+1';

/** The installer and its detached signature, digests read 2026-09-17. */
const INSTALLER = {
  url: `https://software.verapdf.org/rel/1.30/verapdf-greenfield-${VERAPDF_VERSION}-installer.zip`,
  sha256: '6cc6341cb1af644044054b81f00a6590a7918abb18f762243de115258bcad838',
  bytes: 32923960,
  signatureSha256: 'f33175e402f28c42e80866aa62aa337c5d7d7a16a4ea1ae4ff50b0f13343ff26',
};

/** Temurin's Windows x64 JRE zip and its binary signature, digests read 2026-09-17. */
const JRE = {
  url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip',
  sha256: 'd35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636',
  bytes: 48999141,
  signatureSha256: '480d7443ed9e65c9b212858758cd0395144bee1c634eaf662cd290d1db8fd4ca',
};

/** GitHub answers a release asset with a redirect to its asset host. */
const GITHUB_HOSTS = ['github.com', 'release-assets.githubusercontent.com'];

/** @param {string} root */
export function verapdfRoot(root) {
  return toolPath(root, 'verapdf', VERAPDF_VERSION);
}

/** @param {string} root */
export function javaPath(root) {
  return join(verapdfRoot(root), `jdk-${JRE_VERSION}-jre`, 'bin', 'java.exe');
}

/** @param {string} root */
export function verapdfInstall(root) {
  return join(verapdfRoot(root), 'install');
}

/**
 * The arguments that run veraPDF's command-line validator on the provisioned runtime — what
 * `verapdf.bat` does, without a batch file between us and the process.
 *
 * @param {string} root
 * @param {readonly string[]} rest
 */
export function verapdfArguments(root, rest) {
  const install = verapdfInstall(root);
  return [
    '-classpath', `${join(install, 'etc')};${join(install, 'bin', '*')}`,
    '-Dfile.encoding=UTF8', `-Dapp.home=${install}`, `-Dbasedir=${install}`,
    '--add-exports=java.base/sun.security.pkcs=ALL-UNNAMED',
    'org.verapdf.apps.GreenfieldCliWrapper',
    ...rest,
  ];
}

/** Wraps a binary signature packet in armor, which is all `verifyDetached` reads. @param {Buffer} bytes */
function armored(bytes) {
  const body = bytes.toString('base64').replace(/(.{64})/gu, '$1\n');
  return `-----BEGIN PGP SIGNATURE-----\n\n${body}\n-----END PGP SIGNATURE-----\n`;
}

/** @param {string} installPath */
function autoInstall(installPath) {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<AutomatedInstallation langpack="eng">',
    '  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>',
    '  <com.izforge.izpack.panels.target.TargetPanel id="install_dir">',
    `    <installpath>${installPath}</installpath>`,
    '  </com.izforge.izpack.panels.target.TargetPanel>',
    '  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">',
    '    <pack index="0" name="veraPDF GUI" selected="true"/>',
    '    <pack index="1" name="veraPDF Batch files" selected="true"/>',
    '    <pack index="2" name="veraPDF Validation model" selected="false"/>',
    '    <pack index="3" name="veraPDF Documentation" selected="false"/>',
    '    <pack index="4" name="veraPDF Sample Plugins" selected="false"/>',
    '  </com.izforge.izpack.panels.packs.PacksPanel>',
    '  <com.izforge.izpack.panels.install.InstallPanel id="install"/>',
    '  <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>',
    '</AutomatedInstallation>',
    '',
  ].join('\n');
}

/**
 * @param {{ root: string, force?: boolean }} options
 * @returns {Promise<{ provisioned: boolean, java: string }>}
 */
export async function provisionVerapdf({ root, force = false }) {
  const java = javaPath(root);
  if (!force && (await fileExists(java)) && (await fileExists(join(verapdfInstall(root), 'verapdf.bat')))) {
    return { provisioned: false, java };
  }

  const versionDirectory = verapdfRoot(root);
  const staging = `${versionDirectory}.staging-${String(process.pid)}`;
  await rm(staging, { recursive: true, force: true });
  const downloads = join(staging, 'downloads');
  await mkdir(downloads, { recursive: true });

  try {
    process.stderr.write(`Provisioning veraPDF ${VERAPDF_VERSION} and Temurin JRE ${JRE_VERSION} (development only)…\n`);

    const installerZip = join(downloads, 'installer.zip');
    await downloadVerified({ url: INSTALLER.url, allowedHosts: ['software.verapdf.org'], sha256: INSTALLER.sha256, maxBytes: INSTALLER.bytes + 1024 * 1024, destination: installerZip });
    const installerSignature = join(downloads, 'installer.zip.asc');
    await downloadVerified({ url: `${INSTALLER.url}.asc`, allowedHosts: ['software.verapdf.org'], sha256: INSTALLER.signatureSha256, maxBytes: 16 * 1024, destination: installerSignature });
    await verifyDetached({
      file: installerZip,
      signature: await readFile(installerSignature, 'utf8'),
      publicKey: await readFile(verapdfKeyPath(), 'utf8'),
      fingerprint: VERAPDF_KEY_FINGERPRINT,
    });

    const jreZip = join(downloads, 'jre.zip');
    await downloadVerified({ url: JRE.url, allowedHosts: GITHUB_HOSTS, sha256: JRE.sha256, maxBytes: JRE.bytes + 1024 * 1024, destination: jreZip });
    const jreSignature = join(downloads, 'jre.zip.sig');
    await downloadVerified({ url: `${JRE.url}.sig`, allowedHosts: GITHUB_HOSTS, sha256: JRE.signatureSha256, maxBytes: 16 * 1024, destination: jreSignature });
    await verifyDetached({
      file: jreZip,
      signature: armored(await readFile(jreSignature)),
      publicKey: await readFile(adoptiumKeyPath(), 'utf8'),
      fingerprint: ADOPTIUM_KEY_FINGERPRINT,
    });

    // IN `downloads`, and the runtime's folder moved up after: `extract` takes a file name in
    // the directory it unpacks into, never a path.
    extract(downloads, 'jre.zip');
    await rename(join(downloads, `jdk-${JRE_VERSION}-jre`), join(staging, `jdk-${JRE_VERSION}-jre`));
    extract(downloads, 'installer.zip');

    const stagedJava = join(staging, `jdk-${JRE_VERSION}-jre`, 'bin', 'java.exe');
    if (!existsSync(stagedJava)) throw new Error(`the JRE archive did not unpack to ${stagedJava}`);
    const installerJar = join(downloads, `verapdf-greenfield-${VERAPDF_VERSION}`, `verapdf-izpack-installer-${VERAPDF_VERSION}.jar`);
    if (!existsSync(installerJar)) throw new Error(`the installer archive did not unpack to ${installerJar}`);

    // THE FINAL PATH, not the staging one: IzPack writes it into the batch files it installs, so
    // an install made in staging would point at a directory that is renamed away.
    const answers = join(downloads, 'auto-install.xml');
    await writeFile(answers, autoInstall(verapdfInstall(root)));
    await rm(versionDirectory, { recursive: true, force: true });
    await mkdir(dirname(versionDirectory), { recursive: true });
    await rename(staging, versionDirectory);

    const install = spawnSync(javaPath(root), ['-jar', join(versionDirectory, 'downloads', `verapdf-greenfield-${VERAPDF_VERSION}`, `verapdf-izpack-installer-${VERAPDF_VERSION}.jar`), join(versionDirectory, 'downloads', 'auto-install.xml')], { encoding: 'utf8', timeout: 300_000 });
    if (install.error !== undefined) throw install.error;
    if (install.status !== 0 || !existsSync(join(verapdfInstall(root), 'verapdf.bat'))) {
      throw new Error(`the veraPDF installer exited ${String(install.status)} without installing:\n${install.stdout}\n${install.stderr}`);
    }
    await rm(join(versionDirectory, 'downloads'), { recursive: true, force: true });
    return { provisioned: true, java: javaPath(root) };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (process.argv.includes('--check')) {
    const java = javaPath(root);
    process.stdout.write(existsSync(java) ? `veraPDF ${VERAPDF_VERSION}: ${verapdfInstall(root)}\n` : `veraPDF ${VERAPDF_VERSION}: not provisioned\n`);
    process.exitCode = existsSync(java) ? 0 : 1;
  } else {
    try {
      const { provisioned, java } = await provisionVerapdf({ root, force: process.argv.includes('--force') });
      process.stdout.write(`${provisioned ? 'Provisioned' : 'Already provisioned'}: veraPDF ${VERAPDF_VERSION} on ${java}\n`);
    } catch (error) {
      process.stderr.write(`\n${formatError(error)}\n`);
      process.exitCode = 1;
    }
  }
}
